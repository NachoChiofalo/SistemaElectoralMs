/**
 * Logica del padron: votantes, relevamientos, condiciones especiales y resultados.
 *
 * Reemplaza a PadronService, DetalleVotanteService y la parte de negocio que estaba
 * dentro de PadronController (938 lineas que mezclaban HTTP, reglas y SQL).
 */

const { errores } = require('../../core/errors');
const { importarCsv } = require('./importer');

const OPCIONES_POLITICAS = ['PJ', 'UCR', 'Indeciso'];
const REGISTROS_POR_PAGINA = 50;
const LIMITE_MAXIMO_PAGINA = 500;

/**
 * Cache en memoria de las agregaciones de resultados.
 *
 * Los cinco endpoints de resultados/* recorren el padron entero para agregar. En un
 * dashboard abierto eso se repite cada pocos segundos sobre datos que casi no cambian.
 * El TTL es corto y cualquier escritura de relevamiento lo invalida, asi que la vista
 * nunca queda desactualizada respecto de una edicion propia.
 */
class CacheResultados {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entradas = new Map();
  }

  async resolver(clave, calcular) {
    const entrada = this.entradas.get(clave);
    if (entrada && Date.now() - entrada.momento < this.ttlMs) return entrada.valor;

    const valor = await calcular();
    this.entradas.set(clave, { valor, momento: Date.now() });
    return valor;
  }

  invalidar() {
    this.entradas.clear();
  }
}

class PadronService {
  constructor(repositorio, auditoria, logger, { ttlCacheMs = 60_000 } = {}) {
    this.repo = repositorio;
    this.auditoria = auditoria;
    this.logger = logger;
    this.cache = new CacheResultados(ttlCacheMs);
  }

  // ------------------------------------------------------------- consulta

  async votantesPaginados(pagina, filtros) {
    const limite = Math.min(filtros.limite || REGISTROS_POR_PAGINA, LIMITE_MAXIMO_PAGINA);
    return this.repo.votantesPaginados(Math.max(pagina, 1), limite, filtros);
  }

  async votantePorDni(dni) {
    const votante = await this.repo.votantePorDni(dni);
    if (!votante) throw errores.noEncontrado('Votante no encontrado');
    return votante;
  }

  /** Como votantePorDni pero devuelve null en lugar de lanzar. */
  buscarVotante(dni) {
    return this.repo.votantePorDni(dni);
  }

  async estado() {
    const [total, estadisticas] = await Promise.all([
      this.repo.contarVotantes(),
      this.repo.estadisticasBasicas(),
    ]);

    return {
      votantesCargados: total,
      relevamientosRegistrados: Number(estadisticas.total_relevados || 0),
      opcionesPoliticasDisponibles: OPCIONES_POLITICAS,
      // El flag viejo (csvCargado) era estado en memoria que se perdia al reiniciar.
      // Que haya padron cargado se deduce de la base.
      csvCargado: total > 0,
    };
  }

  configuracion() {
    return { opcionesPoliticas: OPCIONES_POLITICAS, registrosPorPagina: REGISTROS_POR_PAGINA };
  }

  async filtrosDisponibles() {
    const [circuitos, sexos] = await Promise.all([
      this.repo.circuitosDisponibles(),
      this.repo.sexosDisponibles(),
    ]);

    return {
      circuitos: circuitos.map((f) => f.circuito),
      mesas: [], // en este padron el circuito cumple el rol de la mesa
      sexos: sexos.map((f) => f.sexo),
      opcionesPoliticas: OPCIONES_POLITICAS,
    };
  }

  // ------------------------------------------------------------ escritura

  async crearVotante({ dni, nombre, apellido, anioNac, domicilio, circuito, sexo }, req) {
    const anio = anioNac ? Number.parseInt(anioNac, 10) : null;

    const votante = await this.repo.insertarVotante({
      dni,
      anio_nac: anio,
      apellido,
      nombre,
      domicilio: domicilio || '',
      tipo_ejemplar: null,
      circuito: circuito || '',
      sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
      edad: anio ? new Date().getFullYear() - anio : null,
    });

    this.cache.invalidar();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR_VOTANTE',
      entidad: 'votante',
      entidad_id: dni,
      datos_nuevos: { dni, nombre, apellido, anioNac, domicilio, circuito, sexo },
      detalles: `Votante creado: ${apellido}, ${nombre} (DNI: ${dni})`,
    });

    return votante;
  }

  /**
   * Actualiza solo los campos que vinieron en el cuerpo.
   *
   * La distincion que sostiene todo esto: **la clave ausente no toca el campo; la cadena
   * vacia lo vacia**. Por eso los campos viajan como null y no como '' — un `|| ''` aca
   * volveria a convertir "no me lo mandaron" en "borralo", que es exactamente la perdida
   * de datos que este cambio viene a sacar.
   *
   * opcionPolitica dejo de ser obligatoria por lo mismo: exigirla obligaba a quien solo
   * queria cargar un telefono a leerla primero y reenviarla.
   */
  async actualizarRelevamiento(dni, { opcionPolitica, observacion, telefono, version }, req) {
    const campos = {
      opcion_politica: opcionPolitica === undefined ? null : opcionPolitica,
      observacion: observacion === undefined ? null : observacion,
      telefono: telefono === undefined ? null : telefono,
    };

    if (Object.values(campos).every((valor) => valor === null)) {
      // Ojo: la firma del autor NO cuenta como campo. Un cuerpo vacio sigue siendo 400.
      throw errores.solicitudInvalida(
        'Hay que mandar al menos uno de: opcionPolitica, observacion, telefono',
      );
    }

    if (campos.opcion_politica !== null && !OPCIONES_POLITICAS.includes(campos.opcion_politica)) {
      throw errores.solicitudInvalida(
        `opcionPolitica debe ser una de: ${OPCIONES_POLITICAS.join(', ')}`,
      );
    }

    // Sin version no se escribe. La ruta ya lo valida; esto esta aca porque el `WHERE
    // version = $7` con NULL no matchea nunca, asi que una llamada interna sin version
    // no fallaria: no escribiria nada y devolveria 200. Un no-op silencioso es peor que
    // un error.
    if (!Number.isInteger(version) || version < 0) {
      throw errores.solicitudInvalida('version es obligatoria y tiene que ser un entero no negativo');
    }

    const anterior = await this.repo.votantePorDni(dni);
    if (!anterior) throw errores.noEncontrado('Votante no encontrado');

    const relevamiento = await this.repo.upsertRelevamiento(dni, {
      ...campos,
      ...autorDe(req),
      version_esperada: version,
    });

    // Cero filas no alcanza para saber que paso: puede ser que otra persona haya escrito
    // en el medio (la version no coincide) o que no hubiera nada que cambiar. Son dos
    // respuestas distintas —409 y 200— y distinguirlas exige releer.
    if (!relevamiento) return this.resolverEscrituraSinEfecto(dni, version, req);

    this.cache.invalidar();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ACTUALIZAR_RELEVAMIENTO',
      entidad: 'relevamiento',
      entidad_id: dni,
      datos_anteriores: anterior,
      datos_nuevos: relevamiento,
      // Que campos se tocaron importa mas que el valor de uno solo, ahora que una
      // escritura puede traer cualquier subconjunto.
      detalles: `Relevamiento actualizado para DNI ${dni}: ${nombresDeCampos(campos)}`,
    });

    return relevamiento;
  }

  /**
   * Por que el upsert no escribio nada.
   *
   * Dos casos, y la diferencia importa:
   *
   * - **La version no coincide.** Otra persona guardo entre que esta abrio la ficha y
   *   apreto Guardar. Es 409 con el estado del servidor en el cuerpo, para que la UI
   *   pueda mostrar los dos valores y que decida una persona. No se mergea nada:
   *   concatenar dos textos inventa contenido que no escribio ninguno de los dos.
   *
   * - **No habia nada que cambiar.** Guardar un valor identico al que ya estaba no es un
   *   conflicto ni una escritura: es 200 y la fila queda intacta. Eso es tambien lo que
   *   evita que un guardado sin cambios mueva la firma de "ultima edicion" y le marque
   *   la fila como novedad a todos los demas.
   */
  async resolverEscrituraSinEfecto(dni, versionEsperada, req) {
    const actual = await this.repo.relevamientoCrudo(dni);

    // La ficha desaparecio entre la lectura y la escritura. Es rarisimo, pero devolver
    // 409 aca mandaria a alguien a resolver un conflicto contra algo que ya no existe.
    if (!actual) throw errores.noEncontrado('Votante no encontrado');

    // Misma version: no habia nada que cambiar. La escritura no se aplico porque no
    // hacia falta, no porque alguien se haya metido en el medio.
    if (Number(actual.version) === Number(versionEsperada)) return actual;

    // Es una condicion esperada del dominio, no una falla: va como info. Y es el unico
    // dato que despues permite decidir el item 014 (señal de presencia) con un numero en
    // vez de una intuicion.
    this.logger.info('Conflicto de edicion en un relevamiento', {
      dni,
      usuario: req?.user?.username ?? null,
      versionEnviada: versionEsperada,
      versionActual: actual.version,
      ultimaEdicionDe: actual.actualizado_por_username ?? null,
    });

    throw errores.conflicto(
      'Otra persona modifico esta ficha mientras la editabas',
      { actual: aRelevamiento(actual) },
    );
  }

  async relevamientoPorDni(dni) {
    return aRelevamiento(await this.votantePorDni(dni));
  }

  /**
   * Que fichas cambiaron desde un momento dado.
   *
   * Lo consume la tabla del padron para marcar las filas que otra persona movio mientras
   * la pagina estaba abierta. Devuelve DNIs y no filas completas a proposito: quien lo
   * llama ya tiene los datos en pantalla y solo necesita saber cuales marcar.
   */
  async cambiosDesde(desde) {
    const momento = new Date(desde);
    if (Number.isNaN(momento.getTime())) {
      throw errores.solicitudInvalida('El parametro desde tiene que ser una fecha ISO valida');
    }

    const filas = await this.repo.dnisModificadosDesde(momento);

    return {
      desde: momento.toISOString(),
      hasta: new Date().toISOString(),
      cambios: filas.map((fila) => ({
        dni: fila.dni,
        cambiadoEn: fila.cambiado_en,
        actualizadoPor: fila.actualizado_por_username || null,
      })),
    };
  }

  // -------------------------------------------------- condiciones especiales

  async guardarDetalle(dni, condiciones, req) {
    const normalizadas = normalizarCondiciones(condiciones);

    if (!await this.repo.existeVotante(dni)) {
      throw errores.noEncontrado(`Votante con DNI ${dni} no existe`);
    }

    const previo = await this.repo.detallePorDni(dni);
    const anterior = await this.repo.votantePorDni(dni);

    const fila = await this.repo.guardarDetalle(dni, normalizadas, autorDe(req));
    this.cache.invalidar();

    const despues = await this.repo.votantePorDni(dni);

    await this.auditoria.registrarDeRequest(req, {
      operacion: previo ? 'ACTUALIZAR_DETALLE' : 'CREAR_DETALLE',
      entidad: 'detalle_votante',
      entidad_id: dni,
      datos_anteriores: anterior,
      datos_nuevos: despues,
      detalles: `${previo ? 'Actualizado' : 'Creado'} detalle para DNI ${dni}`,
    });

    return aDetalle(fila);
  }

  async detallePorDni(dni) {
    const fila = await this.repo.detallePorDni(dni);
    return fila ? aDetalle(fila) : null;
  }

  async eliminarDetalle(dni, req) {
    const anterior = await this.repo.votantePorDni(dni);
    const eliminado = await this.repo.limpiarDetalle(dni);

    if (!eliminado) throw errores.noEncontrado('No se encontro el detalle a eliminar');

    this.cache.invalidar();
    const despues = await this.repo.votantePorDni(dni);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR_DETALLE',
      entidad: 'detalle_votante',
      entidad_id: dni,
      datos_anteriores: anterior,
      datos_nuevos: despues,
      detalles: `Detalle eliminado para DNI ${dni}`,
    });
  }

  async votantesConCondicionesEspeciales(filtros) {
    const filas = await this.repo.votantesConCondicionesEspeciales(filtros);

    return filas.map((fila) => ({
      votante: {
        dni: fila.dni,
        apellido: fila.apellido,
        nombre: fila.nombre,
        edad: fila.edad,
        sexo: fila.sexo,
        circuito: fila.circuito,
      },
      detalle: aDetalle(fila),
      relevamiento: {
        opcionPolitica: fila.opcion_politica,
        observacion: fila.observacion,
      },
    }));
  }

  async estadisticasCondicionesEspeciales() {
    return this.cache.resolver('condiciones-especiales', async () => {
      const fila = await this.repo.estadisticasCondicionesEspeciales();

      return {
        totalNuevosVotantes: Number(fila?.total_nuevos_votantes) || 0,
        totalFallecidos: Number(fila?.total_fallecidos) || 0,
        totalEmpleadosMunicipales: Number(fila?.total_empleados_municipales) || 0,
        totalAyudaSocial: Number(fila?.total_ayuda_social) || 0,
        totalConCondicionesEspeciales: Number(fila?.total_con_condiciones_especiales) || 0,
        totalRelevamientos: Number(fila?.total_relevamientos) || 0,
      };
    });
  }

  // ----------------------------------------------------------- resultados

  async estadisticas() {
    return this.cache.resolver('basicas', async () => {
      const fila = await this.repo.estadisticasBasicas();

      const totalVotantes = Number(fila?.total_votantes) || 0;
      const totalRelevados = Number(fila?.total_relevados) || 0;

      return {
        totalVotantes,
        totalRelevamientos: totalRelevados,
        porcentajeRelevados: totalVotantes > 0
          ? Number(((totalRelevados / totalVotantes) * 100).toFixed(2))
          : 0,
        estadisticasPoliticas: {
          PJ: Number(fila?.votos_pj) || 0,
          UCR: Number(fila?.votos_ucr) || 0,
          Indeciso: Number(fila?.votos_indeciso) || 0,
        },
        sinRelevar: Math.max(0, totalVotantes - totalRelevados),
      };
    });
  }

  estadisticasAvanzadas() {
    return this.cache.resolver('avanzadas', () => this.repo.estadisticasAvanzadas());
  }

  estadisticasPorSexo() {
    return this.cache.resolver('por-sexo', () => this.repo.estadisticasPorSexo());
  }

  estadisticasPorRangoEtario() {
    return this.cache.resolver('por-rango-etario', () => this.repo.estadisticasPorRangoEtario());
  }

  estadisticasPorCircuito() {
    return this.cache.resolver('por-circuito', () => this.repo.estadisticasPorCircuito());
  }

  estadisticasCondicionesDetalladas() {
    return this.cache.resolver('condiciones-detalladas', () => this.repo.estadisticasCondicionesDetalladas());
  }

  // ------------------------------------------------------------- importar

  async importar(rutaArchivo, nombreOriginal, req) {
    const resumen = await importarCsv(this.repo.db, rutaArchivo);
    this.cache.invalidar();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'IMPORTAR_CSV',
      entidad: 'csv',
      datos_nuevos: { archivo: nombreOriginal, ...resumen },
      detalles: `Importacion CSV: ${nombreOriginal} (${resumen.insertadas} nuevos, ${resumen.actualizadas} actualizados, ${resumen.descartadas} descartados)`,
    });

    this.logger.info('Importacion de padron completada', { archivo: nombreOriginal, ...resumen });

    return resumen;
  }
}

/**
 * La forma del relevamiento que consume el frontend.
 *
 * La usan la lectura y el cuerpo del 409, y eso es a proposito: ante un conflicto, el
 * estado del servidor tiene que llegar con la misma forma que una lectura normal, o la
 * UI necesitaria dos caminos para dibujar lo mismo.
 *
 * `version` cae en 0 cuando el votante todavia no tiene fila de relevamiento. No es un
 * detalle: es como el cliente dice "yo lei que esto no existia". Si en el medio otra
 * persona la creo, la fila real esta en 1, el 0 no matchea y sale el 409 que corresponde.
 */
function aRelevamiento(fila) {
  return {
    dni: fila.dni,
    opcionPolitica: fila.opcion_politica || 'Indeciso',
    observacion: fila.observacion || '',
    telefono: fila.telefono || '',
    fechaRelevamiento: fila.fecha_relevamiento || null,
    fechaModificacion: fila.fecha_modificacion || fila.fecha_relevamiento || null,
    // La firma de la ultima edicion. Es lo que el panel muestra al abrirse, para que
    // quien va a cargar vea primero que alguien ya toco esta ficha.
    actualizadoPor: fila.actualizado_por_username || null,
    version: fila.version ?? 0,
  };
}

/**
 * La firma de quien escribe, sacada del request.
 *
 * Es el unico lugar del modulo que traduce `req` a columnas: el repositorio no conoce
 * `req` y no tiene por que. Se desnormaliza el username junto al id por la misma razon
 * que lo hace padron.auditoria — mostrar "ultima edicion: jperez" no puede costar un
 * JOIN entre esquemas en el camino del listado.
 *
 * Sin usuario en el request (una tarea interna, un script) la firma queda en null, que
 * es honesto: nadie edito eso a mano.
 */
function autorDe(req) {
  const usuario = req?.user;
  if (!usuario) return { actualizado_por: null, actualizado_por_username: null };

  return {
    actualizado_por: usuario.id ?? null,
    actualizado_por_username: usuario.username ?? null,
  };
}

/** Los campos que una escritura parcial si toco, para que la auditoria lo diga. */
function nombresDeCampos(campos) {
  const tocados = Object.entries(campos)
    .filter(([, valor]) => valor !== null)
    .map(([nombre]) => nombre);

  return tocados.join(', ');
}

/** Acepta el detalle tanto en camelCase (frontend) como en snake_case (base). */
function normalizarCondiciones(condiciones = {}) {
  const flag = (...nombres) => {
    for (const nombre of nombres) {
      if (condiciones[nombre] !== undefined) return Boolean(condiciones[nombre]);
    }
    return false;
  };

  return {
    esNuevoVotante: flag('esNuevoVotante', 'es_nuevo_votante'),
    estaFallecido: flag('estaFallecido', 'esta_fallecido'),
    esEmpleadoMunicipal: flag('esEmpleadoMunicipal', 'es_empleado_municipal'),
    recibeAyudaSocial: flag('recibeAyudaSocial', 'recibe_ayuda_social'),
    observacionesDetalle: String(condiciones.observacionesDetalle ?? condiciones.observaciones_detalle ?? ''),
  };
}

/**
 * Forma del detalle que espera el frontend. Reemplaza a la clase DetalleVotante, que
 * solo servia para producir este objeto (los metodos de iconos y clases CSS que traia
 * eran presentacion en el servidor y no los usaba nadie).
 */
function aDetalle(fila) {
  const fecha = fila.fecha_detalle || fila.fecha_relevamiento || null;

  return {
    dni: fila.dni,
    esNuevoVotante: Boolean(fila.es_nuevo_votante),
    estaFallecido: Boolean(fila.esta_fallecido),
    esEmpleadoMunicipal: Boolean(fila.es_empleado_municipal),
    recibeAyudaSocial: Boolean(fila.recibe_ayuda_social),
    observacionesDetalle: fila.observaciones_detalle || '',
    fechaCreacion: fecha,
    fechaModificacion: fecha,
  };
}

module.exports = { PadronService, OPCIONES_POLITICAS, normalizarCondiciones, aDetalle };
