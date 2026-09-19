const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { asyncHandler, errores } = require('../../core/errors');
const { requireAdmin, requirePermission } = require('../../core/security/authorize');
const { exportar } = require('./exporter');

/**
 * Antes de esto, /api/padron solo exigia estar autenticado: el gateway importaba
 * requirePermission pero nunca lo aplicaba a ninguna ruta, y el controlador solo
 * verificaba rol === 'administrador' en los dos endpoints de exportar CSV. Cualquier
 * usuario logueado, sin importar el rol, podia leer y editar el padron completo.
 *
 * Cada ruta de abajo declara ahora el permiso que realmente le corresponde segun
 * migrations/002_roles_y_permisos.sql. exportar-relevamientos y exportar-padron
 * mantienen requireAdmin, que es el unico control que el sistema anterior si tenia.
 */
const verPadron = requirePermission('padron.view');
const editarPadron = requirePermission('padron.edit');
const relevarPadron = requirePermission('padron.relevamiento');
const verResultados = requirePermission('resultados.view');

const LIMITE_CSV_BYTES = 25 * 1024 * 1024;

/** El archivo subido es temporal: no tiene por que vivir dentro del proyecto. */
const subida = multer({
  dest: path.join(os.tmpdir(), 'padron-uploads'),
  limits: { fileSize: LIMITE_CSV_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const esCsv = file.mimetype === 'text/csv'
      || file.mimetype === 'application/vnd.ms-excel'
      || file.originalname.toLowerCase().endsWith('.csv');

    if (!esCsv) return cb(errores.solicitudInvalida('Solo se permiten archivos CSV'));
    return cb(null, true);
  },
});

function construirRutas(padron, db) {
  const router = express.Router();

  const flagOpcional = (valor) => {
    if (valor === 'true') return true;
    if (valor === 'false') return false;
    return undefined;
  };

  /**
   * La version que el cliente dice haber leido. **Es obligatoria.**
   *
   * Tratar la ausencia como "escribi sin chequear" seria dejar abierta, para siempre y
   * por olvido, la misma puerta que la version viene a cerrar: bastaria con que alguien
   * escriba un cliente nuevo y no la mande. Que falte es un 400, que es visible y se
   * arregla recargando; una escritura a ciegas es invisible y pierde datos.
   *
   * Version 0 significa "lei que este votante no tenia relevamiento". Si en el medio
   * otra persona lo creo, la fila real esta en 1, el 0 no coincide y sale el 409.
   */
  const versionEsperada = (cuerpo) => {
    const valor = (cuerpo || {}).version;

    if (valor === undefined || valor === null) {
      throw errores.solicitudInvalida(
        'Falta version: toda escritura de relevamiento tiene que decir que version leyo',
      );
    }

    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0) {
      throw errores.solicitudInvalida('version tiene que ser un entero no negativo');
    }

    return n;
  };

  const entero = (valor, porDefecto) => {
    const n = Number.parseInt(valor, 10);
    return Number.isFinite(n) && n > 0 ? n : porDefecto;
  };

  // ==================== votantes ====================

  router.get('/votantes', verPadron, asyncHandler(async (req, res) => {
    const incluirDetalles = req.query.includeDetalles === 'true' || req.query.includeDetalles === '1';

    const resultado = await padron.votantesPaginados(entero(req.query.pagina, 1), {
      busqueda: req.query.busqueda,
      circuito: req.query.circuito,
      sexo: req.query.sexo,
      opcionPolitica: req.query.opcionPolitica,
      sinRelevamiento: req.query.sinRelevamiento === 'true',
      ordenCampo: req.query.ordenCampo,
      ordenDireccion: req.query.ordenDireccion,
      limite: entero(req.query.limite, 50),
    });

    res.json({
      success: true,
      data: resultado.votantes.map((fila) => formatearFila(fila, incluirDetalles)),
      detallesIncluidos: incluirDetalles,
      paginacion: {
        paginaActual: resultado.pagina,
        totalPaginas: resultado.totalPaginas,
        totalRegistros: resultado.total,
        registrosPorPagina: resultado.limite,
        inicio: (resultado.pagina - 1) * resultado.limite + 1,
        fin: Math.min(resultado.pagina * resultado.limite, resultado.total),
      },
    });
  }));

  router.post('/votantes', editarPadron, asyncHandler(async (req, res) => {
    const { dni, nombre, apellido } = req.body || {};

    if (!dni || !nombre || !apellido) {
      throw errores.solicitudInvalida('DNI, nombre y apellido son requeridos');
    }

    const votante = await padron.crearVotante(req.body, req);
    res.status(201).json({ success: true, message: 'Votante creado exitosamente', data: votante });
  }));

  router.get('/votantes/:dni', verPadron, asyncHandler(async (req, res) => {
    res.json(await padron.votantePorDni(req.params.dni));
  }));

  // ==================== relevamientos ====================

  router.get('/relevamientos/:dni', verPadron, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await padron.relevamientoPorDni(req.params.dni) });
  }));

  /**
   * Escritura parcial: solo se tocan los campos que vienen en el cuerpo. La clave
   * ausente deja el campo como esta; la cadena vacia lo vacia.
   *
   * Por eso el cuerpo se pasa tal cual y no se desestructura con defaults: un default
   * aca convertiria "no me lo mandaron" en un valor, y se perderia la distincion.
   * Que haya al menos un campo util lo valida el service.
   *
   * `version` es la que el cliente leyo. Si no coincide con la de la base, otra persona
   * escribio en el medio y la respuesta es 409. Un cliente que no la manda escribe sin
   * chequear: es la compatibilidad que permite desplegar backend y frontend por separado,
   * y **se saca cuando el frontend la mande siempre** (tarea 2.8 de la spec 012).
   */
  router.put('/relevamientos/:dni', relevarPadron, asyncHandler(async (req, res) => {
    const { opcionPolitica, observacion, telefono } = req.body || {};

    const relevamiento = await padron.actualizarRelevamiento(
      req.params.dni,
      { opcionPolitica, observacion, telefono, version: versionEsperada(req.body) },
      req,
    );

    res.json({ success: true, relevamiento });
  }));

  /**
   * Que fichas cambiaron desde un momento dado.
   *
   * La tabla del padron lo consulta cada tanto con la hora de su ultima carga y marca
   * las filas que otra persona movio. Es un GET barato contra un indice: la alternativa
   * era una conexion persistente por usuario, y este servidor es chico.
   */
  router.get('/cambios', verPadron, asyncHandler(async (req, res) => {
    if (!req.query.desde) throw errores.solicitudInvalida('Falta el parametro desde');

    res.json({ success: true, data: await padron.cambiosDesde(req.query.desde) });
  }));

  // ==================== estado y configuracion ====================

  router.get('/estado', verPadron, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await padron.estado() });
  }));

  router.get('/health', verPadron, asyncHandler(async (req, res) => {
    const estado = await padron.estado();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'padron-service',
      inicializado: true,
      ...estado,
    });
  }));

  router.get('/configuracion', verPadron, (req, res) => {
    res.json({ success: true, data: padron.configuracion() });
  });

  router.get('/filtros', verPadron, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await padron.filtrosDisponibles() });
  }));

  router.get('/estadisticas', verPadron, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await padron.estadisticas() });
  }));

  // ==================== resultados ====================

  const resultados = {
    'estadisticas-avanzadas': () => padron.estadisticasAvanzadas(),
    'por-sexo': () => padron.estadisticasPorSexo(),
    'por-rango-etario': () => padron.estadisticasPorRangoEtario(),
    'por-circuito': () => padron.estadisticasPorCircuito(),
    'condiciones-detalladas': () => padron.estadisticasCondicionesDetalladas(),
  };

  for (const [ruta, calcular] of Object.entries(resultados)) {
    router.get(`/resultados/${ruta}`, verResultados, asyncHandler(async (req, res) => {
      res.json({ success: true, data: await calcular() });
    }));
  }

  // ==================== detalle de votante ====================

  router.post('/detalle-votante', editarPadron, asyncHandler(async (req, res) => {
    const { dni, condiciones } = req.body || {};
    if (!dni) throw errores.solicitudInvalida('DNI es requerido');

    res.json({ success: true, data: await padron.guardarDetalle(dni, condiciones, req) });
  }));

  /**
   * Que un votante todavia no tenga detalle es normal, no un error: el frontend pide
   * este endpoint al abrir cualquier ficha. Por eso responde 200 con data: null.
   */
  router.get('/detalle-votante/:dni', verPadron, asyncHandler(async (req, res) => {
    const detalle = await padron.detallePorDni(req.params.dni);

    if (!detalle) {
      return res.json({
        success: true,
        data: null,
        notFound: true,
        message: 'Detalle de votante no encontrado',
      });
    }

    return res.json({ success: true, data: detalle });
  }));

  router.delete('/detalle-votante/:dni', editarPadron, asyncHandler(async (req, res) => {
    await padron.eliminarDetalle(req.params.dni, req);
    res.json({ success: true, message: 'Detalle eliminado correctamente' });
  }));

  router.get('/condiciones-especiales', verPadron, asyncHandler(async (req, res) => {
    const votantes = await padron.votantesConCondicionesEspeciales({
      esNuevoVotante: flagOpcional(req.query.esNuevoVotante),
      estaFallecido: flagOpcional(req.query.estaFallecido),
      esEmpleadoMunicipal: flagOpcional(req.query.esEmpleadoMunicipal),
      recibeAyudaSocial: flagOpcional(req.query.recibeAyudaSocial),
    });

    res.json({ success: true, data: votantes });
  }));

  // Estadistica agregada sobre condiciones especiales: le sirve tanto a quien
  // releva (padron.view) como a quien solo mira resultados (resultados.view).
  router.get(
    '/estadisticas-condiciones-especiales',
    requirePermission('padron.view', 'resultados.view'),
    asyncHandler(async (req, res) => {
      res.json({ success: true, data: await padron.estadisticasCondicionesEspeciales() });
    }),
  );

  // ==================== importar y exportar ====================

  router.post('/importar-csv', editarPadron, subida.single('csv'), asyncHandler(async (req, res) => {
    if (!req.file) throw errores.solicitudInvalida('No se ha subido ningun archivo');

    try {
      const resumen = await padron.importar(req.file.path, req.file.originalname, req);

      res.json({
        success: true,
        mensaje: 'CSV procesado exitosamente',
        totalVotantes: resumen.insertadas + resumen.actualizadas,
        votantesNuevos: resumen.insertadas,
        votantesActualizados: resumen.actualizadas,
        filasLeidas: resumen.leidas,
        errores: resumen.descartadas,
      });
    } finally {
      // El temporal se borra pase lo que pase, tambien si la importacion fallo.
      await fs.unlink(req.file.path).catch(() => {});
    }
  }));

  const exportarComo = (nombre, soloRelevados) => asyncHandler(async (req, res) => {
    const hoy = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${nombre}_${hoy}.csv`);

    const filas = await exportar(db, res, soloRelevados);

    // La auditoria va despues de enviar: no debe demorar la descarga.
    await padron.auditoria.registrarDeRequest(req, {
      operacion: 'EXPORTAR_CSV',
      entidad: soloRelevados ? 'relevamiento' : 'padron',
      datos_nuevos: { total_registros: filas },
      detalles: `Exportacion CSV de ${soloRelevados ? 'relevamientos' : 'padron'}: ${filas} registros`,
    });
  });

  router.get('/exportar-relevamientos', requireAdmin, exportarComo('relevamientos', true));
  router.get('/exportar-padron', requireAdmin, exportarComo('padron', false));

  return router;
}

/** Forma de cada votante en el listado, tal como la espera PadronComponent. */
function formatearFila(fila, incluirDetalles) {
  const relevamiento = fila.opcion_politica
    ? {
      opcionPolitica: fila.opcion_politica,
      observacion: fila.observacion || '',
      telefono: fila.telefono || '',
      fechaRelevamiento: fila.fecha_relevamiento,
      // Viaja con el listado para que cambiar la opcion politica desde la tabla —que no
      // abre la ficha ni relee nada— tambien pueda mandar version y no escribir a ciegas.
      version: fila.version ?? 0,
    }
    : null;

  const votante = {
    votante: {
      dni: fila.dni,
      anioNac: fila.anio_nac,
      apellido: fila.apellido,
      nombre: fila.nombre,
      domicilio: fila.domicilio,
      tipoEjempl: fila.tipo_ejemplar,
      circuito: fila.circuito,
      sexo: fila.sexo,
      edad: fila.edad,
    },
    relevamiento,
  };

  if (!incluirDetalles) return votante;

  votante.detalle = fila.relevamiento_dni
    ? {
      dni: fila.dni,
      esNuevoVotante: Boolean(fila.es_nuevo_votante),
      estaFallecido: Boolean(fila.esta_fallecido),
      esEmpleadoMunicipal: Boolean(fila.es_empleado_municipal),
      recibeAyudaSocial: Boolean(fila.recibe_ayuda_social),
      observacionesDetalle: fila.observaciones_detalle || '',
      fechaCreacion: fila.fecha_detalle || fila.fecha_relevamiento || null,
      fechaModificacion: fila.fecha_detalle || fila.fecha_relevamiento || null,
    }
    : null;

  return votante;
}

module.exports = construirRutas;
