/**
 * Tests del modulo territorio (018) que no necesitan base ni red: descarga de capas con un `fetch`
 * falso, asignacion de manzanas a radios censales, umbral de privacidad y contrato del servicio.
 * La logica de ubicacion de un domicilio tiene su propio archivo (geocodificacion.test.js).
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { descargarLocalidad, asignarSectores, centroide, pedir } = require('../src/modules/territorio/capas');

const cuadrado = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];

/**
 * Un portal falso: responde segun la capa pedida y el offset. Registra cada URL para poder comprobar
 * que se pidio lo que se tenia que pedir (y nada del padron).
 */
function portalFalso(respuestas, { fallasPrevias = 0 } = {}) {
  const urls = [];
  let fallas = fallasPrevias;
  const fetch = async (url) => {
    urls.push(url);
    if (fallas > 0) { fallas -= 1; throw new Error('timeout simulado'); }
    const capa = decodeURIComponent(url.match(/services\/([^/]+)\/FeatureServer/)[1]);
    const offset = Number(new URL(url).searchParams.get('resultOffset') || 0);
    const r = respuestas[capa];
    const cuerpo = typeof r === 'function' ? r(offset) : r;
    return { json: async () => cuerpo };
  };
  return { fetch, urls };
}

const tramo = (nombre, aii, afi, aid, afd, paths) => ({ attributes: { NAM: nombre, NAM_LC: 'ALCIRA', NAM_DE: 'RIO CUARTO', AII: aii, AFI: afi, AID: aid, AFD: afd }, geometry: { paths } });

function portalDeAlcira() {
  return portalFalso({
    // Dos paginas de calles: el servicio avisa que hay mas con exceededTransferLimit.
    Visualizador_de_calles: (offset) => (offset === 0
      ? { features: [tramo('GRL PAZ', 101, 199, 102, 200, [[[-64.34, -32.75], [-64.339, -32.75]]])], exceededTransferLimit: true }
      : { features: [tramo('DR ACUÃ‘A', 1, 99, 2, 100, [[[-64.338, -32.751], [-64.337, -32.751]]])] }),
    Manzanas_callejero: { features: [
      { attributes: { ID: 58600 }, geometry: { rings: cuadrado(-64.3399, -32.7499, -64.3391, -32.7491) } },
      { attributes: { ID: 'no-es-numero' }, geometry: { rings: cuadrado(0, 0, 1, 1) } },
    ] },
    Radios2022: { features: [
      { attributes: { LINK: '140980302', CFN: 3, CRO: 2, POB_2022: 412, VIVIENDAS: 170 }, geometry: { rings: cuadrado(-64.35, -32.76, -64.33, -32.74) } },
    ] },
  });
}

test('descargarLocalidad junta las paginas, repara los nombres y normaliza las tres capas', async () => {
  const { fetch, urls } = portalDeAlcira();
  const capas = await descargarLocalidad('Alcira', { fetch, pausaMs: 0 });

  assert.deepEqual(capas.tramos.map((t) => t.nombre), ['GRL PAZ', 'DR ACUÑA'], 'las dos paginas, con la enie reparada');
  assert.equal(capas.tramos[0].aii, 101);
  assert.equal(capas.tramos[0].camino.length, 2);

  assert.deepEqual(capas.manzanas.map((m) => m.id), [58600], 'el id es numerico; uno invalido se descarta');
  assert.equal(capas.sectores.length, 1);
  assert.deepEqual(
    { codigo: capas.sectores[0].codigo, nombre: capas.sectores[0].nombre, poblacion: capas.sectores[0].poblacion },
    { codigo: '140980302', nombre: 'Radio 3.2', poblacion: 412 },
  );
  assert.deepEqual(capas.localidades, ['ALCIRA (RIO CUARTO)']);

  // Se pidio por nombre de localidad (sin acentos, en mayusculas) y despues por envolvente.
  const calles = urls.filter((u) => u.includes('Visualizador_de_calles'));
  assert.equal(calles.length, 2, 'una consulta por pagina');
  assert.match(decodeURIComponent(calles[0]).replace(/\+/g, ' '), /NAM_LC LIKE '%ALCIRA%'/);
  assert.ok(urls.some((u) => u.includes('Manzanas_callejero') && u.includes('esriGeometryEnvelope')));
  assert.ok(urls.every((u) => u.includes('outSR=4326')), 'coordenadas en grados');
});

test('el nombre de la localidad no puede romper la consulta', async () => {
  const { fetch, urls } = portalDeAlcira();
  await descargarLocalidad("D'Alcira Ñandú", { fetch, pausaMs: 0, departamento: 'Río Cuarto' });
  const where = decodeURIComponent(urls[0]).match(/where=([^&]*)/)[1].replace(/\+/g, ' ');
  assert.match(where, /NAM_LC LIKE '%D''ALCIRA NANDU%'/, 'comilla escapada, sin acentos');
  assert.match(where, /NAM_DE LIKE '%RIO CUARTO%'/);
});

test('una localidad sin calles da un error que dice que hacer', async () => {
  const { fetch } = portalFalso({ Visualizador_de_calles: { features: [] } });
  await assert.rejects(descargarLocalidad('Inexistente', { fetch, pausaMs: 0 }), /No hay calles para la localidad "Inexistente"/);
});

test('pedir reintenta ante una falla de red y ante un error del servicio, y despues avisa', async () => {
  const conRed = portalFalso({ Manzanas_callejero: { features: [] } }, { fallasPrevias: 2 });
  const ok = await pedir('Manzanas_callejero', {}, { fetch: conRed.fetch, pausaMs: 0 });
  assert.deepEqual(ok.features, []);
  assert.equal(conRed.urls.length, 3, 'dos fallas y un acierto');

  const caido = portalFalso({ Manzanas_callejero: { error: { message: 'Service unavailable' } } });
  await assert.rejects(
    pedir('Manzanas_callejero', {}, { fetch: caido.fetch, pausaMs: 0 }),
    /No se pudo consultar la capa Manzanas_callejero.*Service unavailable/,
  );
  assert.equal(caido.urls.length, 3);
});

test('cada manzana va al radio que contiene su centroide; si ninguno, queda sin barrio', () => {
  const sectores = [
    { codigo: 'A', anillos: cuadrado(0, 0, 10, 10) },
    { codigo: 'B', anillos: cuadrado(10, 0, 20, 10) },
  ];
  const manzanas = [
    { id: 1, anillos: cuadrado(1, 1, 4, 4) },
    { id: 2, anillos: cuadrado(12, 1, 15, 4) },
    // Cruza el limite: cuenta donde cae su centroide (x = 10.5 -> B).
    { id: 3, anillos: cuadrado(9, 1, 12, 4) },
    { id: 4, anillos: cuadrado(30, 30, 31, 31) },
  ];
  const r = asignarSectores(manzanas, sectores);
  assert.deepEqual([...r.entries()], [[1, 'A'], [2, 'B'], [3, 'B'], [4, null]]);
});

test('centroide de area, y el promedio si el poligono no tiene area', () => {
  assert.deepEqual(centroide(cuadrado(0, 0, 4, 2)), [2, 1]);
  assert.deepEqual(centroide([[[1, 1], [3, 1], [1, 1]]]), [5 / 3, 1]);
});

// ---------------------------------------------------------------- servicio y API (F5)

const express = require('express');
const { TerritorioService, aplicarUmbral, metricas } = require('../src/modules/territorio/service');
const construirRutas = require('../src/modules/territorio/routes');
const { manejadorErrores, manejadorNoEncontrado } = require('../src/core/errors');

const OPCIONES = [
  { codigo: 'PJ', etiqueta: 'PJ', color: 1, orden: 1, esNeutra: false },
  { codigo: 'UCR', etiqueta: 'UCR', color: 2, orden: 2, esNeutra: false },
  { codigo: 'Indeciso', etiqueta: 'Indeciso', color: null, orden: 3, esNeutra: true },
];

test('el umbral deja ver el desglose recien desde 10 relevados', () => {
  const zona = (relevados) => metricas({ votantes: 40, relevados, votos: { PJ: relevados } }, ['PJ', 'UCR']);
  assert.deepEqual(aplicarUmbral(zona(9), 10), { votantes: 40, relevados: 9, avance: 22.5, desglose_oculto: true });
  assert.equal(aplicarUmbral(zona(10), 10).desglose_oculto, false);
  assert.equal(aplicarUmbral(zona(10), 10).votos.PJ, 10);
  assert.equal(aplicarUmbral(zona(11), 10).desglose_oculto, false);
  // El umbral es de la instancia, no una constante.
  assert.equal(aplicarUmbral(zona(5), 5).desglose_oculto, false);
  assert.equal(aplicarUmbral(zona(4), 5).desglose_oculto, true);
});

test('el lider es la opcion con mas votos solo si es unica', () => {
  const codigos = ['PJ', 'UCR', 'Indeciso'];
  assert.equal(metricas({ votantes: 20, relevados: 12, votos: { PJ: 7, UCR: 5 } }, codigos).lider, 'PJ');
  assert.equal(metricas({ votantes: 20, relevados: 10, votos: { PJ: 5, UCR: 5 } }, codigos).lider, null, 'empate: sin lider');
  assert.equal(metricas({ votantes: 20, relevados: 0, votos: {} }, codigos).lider, null);
  const m = metricas({ votantes: 20, relevados: 12, votos: { PJ: 7, UCR: 5 } }, codigos);
  assert.deepEqual(m.porcentajes, { PJ: 58.33, UCR: 41.67, Indeciso: 0 });
  assert.equal(m.avance, 60);
});

/**
 * Un repositorio falso con dos barrios: B1 con las manzanas 1 (12 relevados) y 2 (3 relevados), B2 con la
 * manzana 3 (sin votantes ubicados), y la manzana 4 sin barrio.
 */
function repoFalso() {
  const fila = (manzana, votantes, relevados, votos) => ({ manzana: String(manzana), total_votantes: String(votantes), total_relevados: String(relevados), votos });
  const chica = { total: { total_votantes: '6', total_relevados: '3', votos: { PJ: 2, UCR: 1, Indeciso: 0 } },
    porSexo: [{ sexo: 'F', total_votantes: '3', total_relevados: '2', votos: { PJ: 2 } }],
    porEdad: [{ rango_etario: '18-30', total_votantes: '6', total_relevados: '3', votos: { PJ: 2, UCR: 1 } }],
    condiciones: { empleados_municipales: '1', empleados_municipales_por_opcion: { PJ: 1 } } };
  return {
    async configuracion() { return { umbral_privacidad: 10, etiqueta_barrio: 'Radio censal', localidad: 'PRUEBA', cargado_en: new Date('2026-10-08T00:00:00Z') }; },
    async cargadoEn() { return { cargado_en: new Date('2026-10-08T00:00:00Z') }; },
    async estadisticasPorManzana() {
      return [fila(1, 20, 12, { PJ: 7, UCR: 5, Indeciso: 0 }), fila(2, 6, 3, { PJ: 2, UCR: 1, Indeciso: 0 }), fila(4, 4, 1, { PJ: 1 })];
    },
    async manzanasSectores() { return [{ id: '1', sector_id: 10 }, { id: '2', sector_id: 10 }, { id: '3', sector_id: 20 }, { id: '4', sector_id: null }]; },
    async sectores() { return [{ id: 10, codigo: 'B1', nombre: 'Radio 1.1' }, { id: 20, codigo: 'B2', nombre: 'Radio 1.2' }]; },
    async resumenUbicacion() { return [{ estado: 'ok', votantes: 30 }, { estado: 'sin_altura', votantes: 5 }, { estado: 'sin_calcular', votantes: 2 }]; },
    async pendientes() { return [{ estado: 'sin_altura', detalle: 'GRL PAZ', votantes: 5 }]; },
    async manzana(id) { return [1, 2, 3, 4].includes(id) ? { id: String(id), sector_id: id === 4 ? null : 10 } : null; },
    async sector(id) { return id === 10 ? { id: 10, codigo: 'B1', nombre: 'Radio 1.1', poblacion_2022: 50, viviendas_2022: 20 } : null; },
    // Toda zona pedida es "chica": 3 relevados. Es el caso que el umbral tiene que tapar.
    async detalleZona() { return chica; },
    async votantesDeManzana() {
      return [{ dni: '1', apellido: 'A', nombre: 'B', domicilio: 'GRL PAZ 153', edad: 40, calle: 'GRL PAZ', numero: 153, relevado: true, fecha_modificacion: null, total: '1' }];
    },
    async geometria() { return { sectores: [{ id: 10, codigo: 'B1', nombre: 'Radio 1.1', anillos: [[[-64.123456789, -32.1]]] }], manzanas: [{ id: '1', sector_id: 10, anillos: [[[-64.1, -32.1]]] }] }; },
  };
}

const servicioFalso = () => new TerritorioService(repoFalso(), {
  db: null, padron: { opciones: { listar: async () => OPCIONES } }, auditoria: null, logger: null,
});

test('cada barrio es la suma exacta de sus manzanas, y los totales cierran', async () => {
  const e = await servicioFalso().estadisticas();
  const b1 = e.barrios.find((b) => b.codigo === 'B1');
  assert.deepEqual([b1.votantes, b1.relevados], [26, 15], 'manzanas 1 + 2');
  assert.deepEqual(b1.votos, { PJ: 9, UCR: 6, Indeciso: 0 });
  assert.equal(b1.desglose_oculto, false, '15 relevados pasan el umbral aunque una de sus manzanas no');
  const b2 = e.barrios.find((b) => b.codigo === 'B2');
  assert.deepEqual([b2.votantes, b2.relevados, b2.desglose_oculto], [0, 0, true]);

  assert.equal(e.manzanas.find((m) => m.id === 2).desglose_oculto, true, 'la manzana de 3 relevados no muestra desglose');
  assert.equal(e.manzanas.find((m) => m.id === 2).votos, undefined);
  assert.equal(e.resumen.sinBarrio, 4, 'la manzana 4 no tiene barrio');
  const r = e.resumen;
  assert.equal(r.ubicados + r.sinUbicar + r.sinCalcular, r.total);
  assert.deepEqual([r.total, r.ubicados, r.sinUbicar, r.sinCalcular], [37, 30, 5, 2]);
});

test('la geometria va redondeada a 5 decimales y la lista nunca trae la opcion politica', async () => {
  const servicio = servicioFalso();
  const g = await servicio.geometria();
  assert.deepEqual(g.barrios[0].anillos, [[[-64.12346, -32.1]]]);
  const l = await servicio.votantesDeManzana(1);
  assert.deepEqual(Object.keys(l.votantes[0]).sort(), ['apellido', 'dni', 'domicilio', 'edad', 'fechaRelevamiento', 'nombre', 'relevado']);
  assert.deepEqual(l.paginacion, { pagina: 1, porPagina: 50, total: 1, paginas: 1 });
});

/** La app con las rutas reales del mapa y un usuario a eleccion. */
function appDelMapa(servicio, usuario) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = usuario; next(); });
  app.use('/api/territorio', construirRutas(servicio));
  app.use(manejadorNoEncontrado);
  app.use(manejadorErrores);
  return app;
}

async function conServidor(app, fn) {
  const servidor = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  try {
    return await fn(`http://127.0.0.1:${servidor.address().port}/api/territorio`);
  } finally {
    await new Promise((res) => servidor.close(res));
  }
}

const ADMIN = { id: 1, username: 'admin', rol: 'administrador', permisos: ['territorio.view'] };

/** Las rutas GET del router, con sus parametros reemplazados por valores de prueba. */
function rutasGet() {
  const router = construirRutas(servicioFalso());
  const rutas = [];
  for (const capa of router.stack) {
    if (!capa.route || !capa.route.methods.get) continue;
    const p = capa.route.path;
    if (p.includes(':tipo')) {
      rutas.push(p.replace(':tipo', 'manzana').replace(':id', '1'), p.replace(':tipo', 'barrio').replace(':id', '10'));
    } else {
      rutas.push(p.replace(':id', '1'));
    }
  }
  return rutas;
}

/** Busca, en cualquier nivel de un JSON, una clave que delate una opcion politica o un desglose. */
function clavesSensibles(valor, ruta = '') {
  const SENSIBLES = ['votos', 'porcentajes', 'lider', 'por_opcion', 'opcionPolitica', 'opcion_politica'];
  if (Array.isArray(valor)) return valor.flatMap((v, i) => clavesSensibles(v, `${ruta}[${i}]`));
  if (!valor || typeof valor !== 'object') return [];
  return Object.entries(valor).flatMap(([k, v]) => [
    ...(SENSIBLES.includes(k) ? [`${ruta}.${k}`] : []),
    ...clavesSensibles(v, `${ruta}.${k}`),
  ]);
}

test('UMBRAL EN TODAS LAS RUTAS: con 3 relevados ninguna respuesta trae un desglose', async () => {
  const rutas = rutasGet();
  assert.ok(rutas.length >= 6, `se recorrieron ${rutas.length} rutas`);
  await conServidor(appDelMapa(servicioFalso(), ADMIN), async (base) => {
    for (const ruta of rutas) {
      const r = await fetch(base + ruta);
      assert.equal(r.status, 200, ruta);
      const { data } = await r.json();
      // /estadisticas trae la manzana 1 (12 relevados), que SI puede mostrar su desglose: se la saca.
      const aRevisar = ruta === '/estadisticas'
        ? { ...data, manzanas: data.manzanas.filter((m) => m.relevados < 10), barrios: data.barrios.filter((b) => b.relevados < 10) }
        : data;
      assert.deepEqual(clavesSensibles(aRevisar), [], `${ruta} filtra un dato sensible`);
    }
  });
});

test('todas las rutas exigen territorio.view, y recalcular exige ademas ser administrador', async () => {
  const rutas = [...rutasGet().map((r) => ['GET', r]), ['POST', '/reubicar']];
  const sinPermiso = { id: 2, username: 'enc', rol: 'encargado_relevamiento', permisos: ['padron.view', 'padron.edit', 'resultados.view'] };
  await conServidor(appDelMapa(servicioFalso(), sinPermiso), async (base) => {
    for (const [metodo, ruta] of rutas) {
      assert.equal((await fetch(base + ruta, { method: metodo })).status, 403, `${metodo} ${ruta}`);
    }
  });
  // Con el permiso pero sin el rol (el caso de la etapa 2, si se abre el mapa a otro rol).
  const conPermisoSinRol = { ...sinPermiso, permisos: ['territorio.view'] };
  await conServidor(appDelMapa(servicioFalso(), conPermisoSinRol), async (base) => {
    assert.equal((await fetch(`${base}/reubicar`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${base}/estadisticas`)).status, 200);
  });
});

test('zonas: tipo o id invalidos son 400; una zona inexistente es 404', async () => {
  await conServidor(appDelMapa(servicioFalso(), ADMIN), async (base) => {
    assert.equal((await fetch(`${base}/zonas/provincia/1`)).status, 400);
    assert.equal((await fetch(`${base}/zonas/manzana/abc`)).status, 400);
    assert.equal((await fetch(`${base}/zonas/manzana/-3`)).status, 400);
    assert.equal((await fetch(`${base}/zonas/manzana/999`)).status, 404);
    assert.equal((await fetch(`${base}/zonas/barrio/999`)).status, 404);
    assert.equal((await fetch(`${base}/manzanas/999/votantes`)).status, 404);
  });
});

test('una manzana trae tambien su barrio, y cada subgrupo chico va sin desglose', async () => {
  const servicio = new TerritorioService({
    ...repoFalso(),
    // Zona grande, con un subgrupo chico en cada corte.
    async detalleZona() {
      return {
        total: { total_votantes: '30', total_relevados: '14', votos: { PJ: 8, UCR: 6 } },
        porSexo: [{ sexo: 'F', total_votantes: '20', total_relevados: '11', votos: { PJ: 6, UCR: 5 } }, { sexo: 'M', total_votantes: '10', total_relevados: '3', votos: { PJ: 2, UCR: 1 } }],
        porEdad: [{ rango_etario: '60+', total_votantes: '4', total_relevados: '2', votos: { PJ: 2 } }],
        condiciones: { ayuda_social: '12', ayuda_social_por_opcion: { PJ: 7, UCR: 5 }, empleados_municipales: '2', empleados_municipales_por_opcion: { PJ: 2 } },
      };
    },
  }, { db: null, padron: { opciones: { listar: async () => OPCIONES } }, logger: null });

  const z = await servicio.zona('manzana', 1);
  assert.equal(z.desglose_oculto, false);
  assert.equal(z.barrio.nombre, 'Radio 1.1', 'el barrio viene con la manzana');
  assert.equal(z.barrio.censo2022.poblacion, 50);
  assert.equal(z.porSexo.find((x) => x.sexo === 'F').desglose_oculto, false);
  assert.deepEqual(z.porSexo.find((x) => x.sexo === 'M'), { sexo: 'M', votantes: 10, relevados: 3, avance: 30, desglose_oculto: true });
  assert.equal(z.porEdad[0].desglose_oculto, true);
  assert.deepEqual(z.condiciones.ayuda_social, { total: 12, por_opcion: { PJ: 7, UCR: 5, Indeciso: 0 }, desglose_oculto: false });
  assert.deepEqual(z.condiciones.empleados_municipales, { total: 2, desglose_oculto: true });
});

test('la geometria se puede volver a pedir con If-None-Match y responde 304', async () => {
  await conServidor(appDelMapa(servicioFalso(), ADMIN), async (base) => {
    const primera = await fetch(`${base}/geometria`);
    const etag = primera.headers.get('etag');
    assert.ok(etag, 'Express emite ETag');
    // Como revalida un navegador. El fetch de Node, con If-None-Match a mano, agrega "Cache-Control: no-cache",
    // y ante eso Express (con razon) nunca responde 304: hay que decirle explicitamente que es una revalidacion.
    const segunda = await fetch(`${base}/geometria`, { headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' } });
    assert.equal(segunda.status, 304);
  });
});

// ---------------------------------------------------------------- frontend: proyeccion (F6)

test('la proyeccion encaja la localidad en el ancho y deja el norte arriba', () => {
  const { crearProyeccion, pathDe } = require('../public/src/lib/geometria-svg');
  // Un cuadrado de 0,01 grados en Alcira: a esa latitud el ancho real es cos(32,75) del alto.
  const cuadrado = [[[-64.34, -32.76], [-64.33, -32.76], [-64.33, -32.75], [-64.34, -32.75], [-64.34, -32.76]]];
  const { ancho, alto, proyectar } = crearProyeccion(cuadrado, 1000, 0);
  assert.equal(ancho, 1000);
  assert.equal(alto, Math.round(1000 / Math.cos((32.755 * Math.PI) / 180)), 'mas alto que ancho, por la latitud');
  const [, yNorte] = proyectar([-64.34, -32.75]);
  const [, ySur] = proyectar([-64.34, -32.76]);
  assert.ok(yNorte < ySur, 'el norte arriba');
  assert.deepEqual(proyectar([-64.34, -32.75]), [0, 0]);
  // El anillo arranca en la esquina suroeste, que con el norte arriba queda abajo a la izquierda (y maxima).
  const [, yMax] = proyectar([-64.34, -32.76]);
  const y = yMax.toFixed(1);
  assert.equal(pathDe(cuadrado, proyectar), `M0.0 ${y} L1000.0 ${y} L1000.0 0.0 L0.0 0.0 L0.0 ${y} Z`);
  assert.equal(pathDe([[[1, 1], [2, 2]]], proyectar), '', 'un anillo degenerado no se dibuja');
});

// ---------------------------------------------------------------- script de carga

test('territorio:cargar entiende la localidad aunque PowerShell se coma el "--"', () => {
  const { argumentos } = require('../scripts/territorio-cargar');
  // Desde bash/cmd: llegan las opciones tal cual.
  assert.deepEqual(argumentos(['--localidad', 'ALCIRA', '--si'], {}), { localidad: 'ALCIRA', si: true });
  // Desde PowerShell: npm se queda con --localidad y --si (npm_config_*) y al script le llega el valor suelto.
  assert.deepEqual(argumentos(['ALCIRA'], { npm_config_localidad: 'true', npm_config_si: 'true' }), { localidad: 'ALCIRA', si: true });
  assert.deepEqual(argumentos([], { npm_config_localidad: 'ALCIRA', npm_config_departamento: 'RIO CUARTO' }), { localidad: 'ALCIRA', departamento: 'RIO CUARTO' });
  assert.deepEqual(argumentos(['ALCIRA'], {}), { localidad: 'ALCIRA' }, 'sin --si no escribe');
  // La forma que funciona en cualquier consola: palabras sueltas, sin guiones que npm pueda tragarse.
  assert.deepEqual(argumentos(['ALCIRA', 'si'], {}), { localidad: 'ALCIRA', si: true });
  assert.deepEqual(argumentos(['ALCIRA', 'SÍ'], {}), { localidad: 'ALCIRA', si: true });
  assert.deepEqual(argumentos(['si', 'ALCIRA'], {}), { localidad: 'ALCIRA', si: true }, 'en cualquier orden');
  assert.throws(() => argumentos(['--otra'], {}), /Argumento desconocido/);
});
