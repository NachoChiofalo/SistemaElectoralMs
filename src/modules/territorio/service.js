/**
 * Logica del mapa por manzana y barrio (018).
 *
 * Dos mitades:
 *   - reubicar(): ubica a todos los votantes, en lote, en una transaccion. Es lo unico que hace calculos
 *     geograficos, y corre al importar el padron, al cargar las capas o con el boton del administrador.
 *   - lecturas: estadisticas por manzana y barrio, detalle de una zona, lista de una manzana, pendientes y
 *     geometria. Todas agregadas, cacheadas, y con el umbral de privacidad aplicado AL FINAL, aca y no en
 *     la pantalla.
 */

const { errores } = require('../../core/errors');
const { CacheResultados } = require('../padron/service');
const { construirIndice, resolver, ESTADOS } = require('./ubicacion');

/**
 * Clave del advisory lock que serializa reubicar(). Fija y arbitraria, como LOCK_IMPORTACION (20260918) y
 * LOCK_MIGRACIONES (20260919): los advisory locks son un espacio de nombres global de la base.
 */
const LOCK_TERRITORIO = 20261008;
const POR_PAGINA = 50;

const pct = (parte, total, decimales) => (total > 0 ? Number(((parte * 100) / total).toFixed(decimales)) : 0);

/**
 * Lo que una zona puede mostrar si tiene suficientes relevados. `votos` es { codigo: n }.
 * El lider es la opcion con mas votos, si es unica; con un empate no hay lider (no se pinta una
 * preferencia que los datos no muestran).
 */
function metricas({ votantes, relevados, votos }, codigos) {
  const v = Object.fromEntries(codigos.map((c) => [c, Number(votos?.[c]) || 0]));
  const maximo = Math.max(0, ...Object.values(v));
  const conMaximo = codigos.filter((c) => v[c] === maximo);
  return {
    votantes,
    relevados,
    avance: pct(relevados, votantes, 1),
    votos: v,
    porcentajes: Object.fromEntries(codigos.map((c) => [c, pct(v[c], relevados, 2)])),
    lider: maximo > 0 && conMaximo.length === 1 ? conMaximo[0] : null,
  };
}

/**
 * EL umbral de privacidad. Una zona con menos relevados que el umbral muestra solo cuantos votantes tiene,
 * cuantos se relevaron y el avance: con pocas personas, cualquier desglose identifica a alguien. Es la
 * ultima funcion que toca cada zona antes de responder; hay un test que recorre todas las rutas.
 */
function aplicarUmbral(zona, umbral) {
  if (zona.relevados < umbral) {
    return { votantes: zona.votantes, relevados: zona.relevados, avance: zona.avance, desglose_oculto: true };
  }
  return { ...zona, desglose_oculto: false };
}

const numero = (x) => Number(x) || 0;
const filaAZona = (f, codigos) => metricas({ votantes: numero(f.total_votantes), relevados: numero(f.total_relevados), votos: f.votos }, codigos);

const CONDICIONES = ['empleados_municipales', 'ayuda_social', 'nuevos_votantes', 'fallecidos'];

class TerritorioService {
  /**
   * @param repo  TerritorioRepository
   * @param deps  { db, padron, auditoria, logger, ttlCacheMs }. `padron` es el servicio del padron: da las
   *              opciones politicas de la instancia. El script de carga lo pasa en null (solo reubica).
   */
  constructor(repo, { db, padron = null, auditoria = null, logger, ttlCacheMs = 60_000 }) {
    this.repo = repo;
    this.db = db;
    this.padron = padron;
    this.auditoria = auditoria;
    this.logger = logger;
    this.cache = new CacheResultados(ttlCacheMs);
    this.geometriaCache = null;
    this.enCurso = null;
    this.repetir = false;
  }

  invalidarCache() {
    this.cache.invalidar();
  }

  // ------------------------------------------------------------ calculo

  /**
   * Ubica a todos los votantes. Idempotente. Dos llamadas simultaneas no se pisan: la segunda espera el
   * advisory lock. Los pendientes nunca reciben coordenadas ni manzana (la base tambien lo impide).
   */
  async reubicar(req = null) {
    const inicio = Date.now();
    const resumen = await this.db.transaccion(async (cliente) => {
      await cliente.query('SELECT pg_advisory_xact_lock($1)', [LOCK_TERRITORIO]);

      const capas = await this.repo.capas(cliente);
      if (!capas.manzanas.length || !capas.tramos.length) {
        throw errores.conflicto('Todavia no hay capas cargadas para esta localidad: hay que correr npm run territorio:cargar');
      }
      const indice = construirIndice(capas.tramos, capas.manzanas);

      const filas = (await this.repo.domicilios(cliente)).map(({ dni, domicilio }) => {
        const r = resolver(indice, domicilio);
        const ok = r.estado === 'ok';
        return {
          dni,
          estado: r.estado,
          detalle: ok ? null : (r.clave || null),
          manzana_id: ok ? r.manzana : null,
          lat: ok ? r.lat : null,
          lon: ok ? r.lon : null,
          calle: ok ? r.calle : null,
          numero: ok ? r.numero : null,
          aproximada: Boolean(r.aproximada),
          estimado: Boolean(r.estimado),
        };
      });

      await this.repo.guardarUbicaciones(cliente, filas);

      const porEstado = {};
      for (const f of filas) porEstado[f.estado] = (porEstado[f.estado] || 0) + 1;
      return { total: filas.length, ubicados: porEstado.ok || 0, porEstado };
    });

    const duracionMs = Date.now() - inicio;
    this.invalidarCache();
    this.logger?.info('Padron ubicado en manzanas', { ...resumen, duracionMs });

    if (req && this.auditoria) {
      await this.auditoria.registrarDeRequest(req, {
        operacion: 'REUBICAR',
        entidad: 'territorio',
        datos_nuevos: resumen,
        detalles: `Recalculo de ubicaciones: ${resumen.ubicados} de ${resumen.total} votantes en una manzana`,
      });
    }
    return { ...resumen, duracionMs };
  }

  /**
   * Reubica sin que nadie espere la respuesta (despues de importar el padron). Si llega otro pedido mientras
   * corre, se repite una vez al terminar en vez de encimarse. Sin capas cargadas no es un error: el mapa
   * todavia no se configuro en esta instancia.
   */
  reubicarEnSegundoPlano() {
    if (this.enCurso) {
      this.repetir = true;
      return this.enCurso;
    }
    this.enCurso = this.reubicar()
      .catch((error) => {
        if (error.status === 409) this.logger?.info('No se reubico el padron: no hay capas cargadas');
        else this.logger?.error('Fallo la ubicacion del padron en manzanas', error);
      })
      .finally(() => {
        this.enCurso = null;
        if (this.repetir) {
          this.repetir = false;
          this.reubicarEnSegundoPlano();
        }
      });
    return this.enCurso;
  }

  // ------------------------------------------------------------ lecturas

  async configuracion() {
    const c = await this.repo.configuracion();
    return {
      localidad: c?.localidad || null,
      umbral: c?.umbral_privacidad ?? 10,
      etiquetaBarrio: c?.etiqueta_barrio || 'Radio censal',
      cargadoEn: c?.cargado_en || null,
    };
  }

  async opciones() {
    const lista = this.padron ? await this.padron.opciones.listar() : [];
    return { lista, codigos: lista.map((o) => o.codigo) };
  }

  /**
   * Todas las manzanas y todos los barrios. Una consulta para las manzanas; cada barrio es la suma exacta de
   * sus manzanas, calculada aca.
   */
  estadisticas() {
    return this.cache.resolver('estadisticas', async () => {
      const [conf, { lista, codigos }] = await Promise.all([this.configuracion(), this.opciones()]);
      const [filas, pertenencia, sectores, resumen] = await Promise.all([
        this.repo.estadisticasPorManzana(codigos),
        this.repo.manzanasSectores(),
        this.repo.sectores(),
        this.repo.resumenUbicacion(),
      ]);

      const sectorDe = new Map(pertenencia.map((m) => [Number(m.id), m.sector_id]));
      const sumas = new Map(sectores.map((s) => [s.id, { votantes: 0, relevados: 0, votos: {} }]));
      let sinBarrio = 0;

      const manzanas = filas.map((f) => {
        const id = Number(f.manzana);
        const sector = sectorDe.get(id) ?? null;
        const zona = filaAZona(f, codigos);
        const suma = sumas.get(sector);
        if (suma) {
          suma.votantes += zona.votantes;
          suma.relevados += zona.relevados;
          for (const c of codigos) suma.votos[c] = (suma.votos[c] || 0) + zona.votos[c];
        } else {
          sinBarrio += zona.votantes;
        }
        return { id, sector, ...aplicarUmbral(zona, conf.umbral) };
      });

      const barrios = sectores.map((s) => ({
        id: s.id, codigo: s.codigo, nombre: s.nombre,
        ...aplicarUmbral(metricas(sumas.get(s.id), codigos), conf.umbral),
      }));

      const porEstado = Object.fromEntries(resumen.map((r) => [r.estado, r.votantes]));
      const total = resumen.reduce((a, r) => a + r.votantes, 0);
      const ubicados = porEstado.ok || 0;
      const sinCalcular = porEstado.sin_calcular || 0;

      return {
        configuracion: conf,
        opciones: lista,
        resumen: { total, ubicados, sinUbicar: total - ubicados - sinCalcular, sinCalcular, sinBarrio, porEstado },
        manzanas,
        barrios,
      };
    });
  }

  /**
   * Toda la informacion de una zona. Para una manzana, tambien la de su barrio: la spec pide ver los dos
   * niveles a la vez. El umbral se aplica a la zona Y a cada subgrupo con desglose (un sexo, un rango de edad,
   * una condicion especial): un subgrupo chico identifica igual que una zona chica.
   */
  async zona(tipo, id) {
    if (tipo !== 'manzana' && tipo !== 'barrio') throw errores.solicitudInvalida('El tipo de zona es manzana o barrio');
    return this.cache.resolver(`zona:${tipo}:${id}`, async () => {
      const [conf, { codigos }] = await Promise.all([this.configuracion(), this.opciones()]);

      if (tipo === 'manzana') {
        const m = await this.repo.manzana(id);
        if (!m) throw errores.noEncontrado('Manzana no encontrada');
        const [propia, barrio] = await Promise.all([
          this.detalle('manzana', id, codigos, conf.umbral),
          m.sector_id ? this.barrio(m.sector_id, codigos, conf.umbral) : null,
        ]);
        return { tipo, id: Number(m.id), etiquetaBarrio: conf.etiquetaBarrio, umbral: conf.umbral, ...propia, barrio };
      }

      const b = await this.barrio(id, codigos, conf.umbral);
      if (!b) throw errores.noEncontrado(`${conf.etiquetaBarrio} no encontrado`);
      return { tipo, etiquetaBarrio: conf.etiquetaBarrio, umbral: conf.umbral, ...b };
    });
  }

  async barrio(id, codigos, umbral) {
    const s = await this.repo.sector(id);
    if (!s) return null;
    const detalle = await this.detalle('barrio', id, codigos, umbral);
    return {
      id: s.id, codigo: s.codigo, nombre: s.nombre,
      censo2022: { poblacion: s.poblacion_2022, viviendas: s.viviendas_2022 },
      ...detalle,
    };
  }

  async detalle(tipo, id, codigos, umbral) {
    const d = await this.repo.detalleZona(tipo === 'manzana' ? 'manzana' : 'sector', id, codigos);
    const zona = filaAZona(d.total || {}, codigos);
    if (zona.relevados < umbral) return aplicarUmbral(zona, umbral);

    const corte = (filas, clave) => filas.map((f) => ({ [clave]: f[clave], ...aplicarUmbral(filaAZona(f, codigos), umbral) }));
    const condiciones = Object.fromEntries(CONDICIONES.map((c) => {
      const total = numero(d.condiciones?.[c]);
      const porOpcion = Object.fromEntries(codigos.map((k) => [k, numero(d.condiciones?.[`${c}_por_opcion`]?.[k])]));
      return [c, total >= umbral ? { total, por_opcion: porOpcion, desglose_oculto: false } : { total, desglose_oculto: true }];
    }));

    return {
      ...aplicarUmbral(zona, umbral),
      porSexo: corte(d.porSexo, 'sexo'),
      porEdad: corte(d.porEdad, 'rango_etario'),
      condiciones,
    };
  }

  /** La lista para el casa por casa. Sin opcion politica (decision de la spec). */
  async votantesDeManzana(id, pagina = 1) {
    if (!(await this.repo.manzana(id))) throw errores.noEncontrado('Manzana no encontrada');
    const p = Math.max(1, Number.parseInt(pagina, 10) || 1);
    const filas = await this.repo.votantesDeManzana(id, POR_PAGINA, (p - 1) * POR_PAGINA);
    const total = filas.length ? Number(filas[0].total) : 0;
    return {
      votantes: filas.map((f) => ({
        dni: f.dni,
        apellido: f.apellido,
        nombre: f.nombre,
        domicilio: f.domicilio,
        edad: f.edad,
        relevado: Boolean(f.relevado),
        fechaRelevamiento: f.fecha_modificacion || null,
      })),
      paginacion: { pagina: p, porPagina: POR_PAGINA, total, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)) },
    };
  }

  /** Cuantos no se ubicaron, por que, y los detalles mas frecuentes de cada motivo. */
  sinUbicar() {
    return this.cache.resolver('sin-ubicar', async () => {
      const [resumen, pendientes] = await Promise.all([this.repo.resumenUbicacion(), this.repo.pendientes()]);
      const porEstado = Object.fromEntries(resumen.map((r) => [r.estado, r.votantes]));
      const motivos = Object.keys(ESTADOS)
        .filter((e) => e !== 'ok' && porEstado[e])
        .map((estado) => ({
          estado,
          descripcion: ESTADOS[estado],
          votantes: porEstado[estado],
          detalles: pendientes.filter((p) => p.estado === estado && p.detalle).slice(0, 10)
            .map((p) => ({ detalle: p.detalle, votantes: p.votantes })),
        }))
        .sort((a, b) => b.votantes - a.votantes);
      return {
        total: resumen.reduce((a, r) => a + r.votantes, 0),
        sinCalcular: porEstado.sin_calcular || 0,
        motivos,
      };
    });
  }

  /**
   * Barrios y manzanas para dibujar, con 5 decimales (~1 m). Cambia solo cuando se recargan las capas (otro
   * proceso), asi que se guarda en memoria hasta que cambie la fecha de carga, que es una lectura minima.
   */
  async geometria() {
    const { cargado_en: cargadoEn } = (await this.repo.cargadoEn()) || {};
    const clave = cargadoEn ? new Date(cargadoEn).toISOString() : 'sin-carga';
    if (this.geometriaCache?.clave === clave) return this.geometriaCache.valor;

    const [conf, { sectores, manzanas }] = await Promise.all([this.configuracion(), this.repo.geometria()]);
    const r5 = (n) => Math.round(n * 1e5) / 1e5;
    const anillos = (lista) => (lista || []).map((a) => a.map(([x, y]) => [r5(x), r5(y)]));
    const valor = {
      configuracion: conf,
      barrios: sectores.map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre, anillos: anillos(s.anillos) })),
      manzanas: manzanas.map((m) => ({ id: Number(m.id), barrio: m.sector_id, anillos: anillos(m.anillos) })),
    };
    this.geometriaCache = { clave, valor };
    return valor;
  }
}

module.exports = { TerritorioService, aplicarUmbral, metricas, LOCK_TERRITORIO };
