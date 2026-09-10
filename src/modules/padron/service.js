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

  async actualizarRelevamiento(dni, { opcionPolitica, observacion, telefono }, req) {
    if (!OPCIONES_POLITICAS.includes(opcionPolitica)) {
      throw errores.solicitudInvalida(
        `opcionPolitica debe ser una de: ${OPCIONES_POLITICAS.join(', ')}`,
      );
    }

    const anterior = await this.repo.votantePorDni(dni);
    if (!anterior) throw errores.noEncontrado('Votante no encontrado');

    const relevamiento = await this.repo.upsertRelevamiento(dni, {
      opcion_politica: opcionPolitica,
      observacion: observacion || '',
      telefono: telefono || '',
    });

    this.cache.invalidar();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ACTUALIZAR_RELEVAMIENTO',
      entidad: 'relevamiento',
      entidad_id: dni,
      datos_anteriores: anterior,
      datos_nuevos: relevamiento,
      detalles: `Relevamiento actualizado para DNI ${dni}: ${opcionPolitica}`,
    });

    return relevamiento;
  }

  async relevamientoPorDni(dni) {
    const votante = await this.votantePorDni(dni);

    return {
      dni: votante.dni,
      opcionPolitica: votante.opcion_politica || 'Indeciso',
      observacion: votante.observacion || '',
      telefono: votante.telefono || '',
      fechaRelevamiento: votante.fecha_relevamiento || null,
      fechaModificacion: votante.fecha_modificacion || votante.fecha_relevamiento || null,
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

    const fila = await this.repo.guardarDetalle(dni, normalizadas);
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
