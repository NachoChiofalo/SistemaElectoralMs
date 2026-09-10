const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');

/**
 * Rutas de consulta de auditoria.
 *
 * Se mantienen bajo /api/padron/auditoria, que es donde las busca el frontend, aunque
 * el modulo ya no viva dentro de padron.
 */
function construirRutas(servicio) {
  const router = express.Router();

  const enteroOpcional = (valor) => {
    if (valor === undefined || valor === '') return undefined;
    const n = Number.parseInt(valor, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  // GET /api/padron/auditoria
  router.get('/', asyncHandler(async (req, res) => {
    const resultado = await servicio.consultar({
      usuario_id: enteroOpcional(req.query.usuario_id),
      operacion: req.query.operacion || undefined,
      entidad: req.query.entidad || undefined,
      fecha_desde: req.query.fecha_desde || undefined,
      fecha_hasta: req.query.fecha_hasta || undefined,
      page: enteroOpcional(req.query.page) || 1,
      // Techo duro: sin el, ?limit=1000000 trae la tabla entera a memoria.
      limit: Math.min(enteroOpcional(req.query.limit) || 25, 200),
    });

    res.json({
      success: true,
      data: resultado.registros,
      paginacion: {
        paginaActual: resultado.page,
        totalPaginas: resultado.totalPages,
        totalRegistros: resultado.total,
        registrosPorPagina: resultado.limit,
      },
    });
  }));

  // GET /api/padron/auditoria/estadisticas
  router.get('/estadisticas', asyncHandler(async (req, res) => {
    const estadisticas = await servicio.estadisticas({
      fecha_desde: req.query.fecha_desde || undefined,
      fecha_hasta: req.query.fecha_hasta || undefined,
    });

    res.json({ success: true, data: estadisticas });
  }));

  // GET /api/padron/auditoria/:id
  router.get('/:id', asyncHandler(async (req, res) => {
    const id = enteroOpcional(req.params.id);
    if (!id) throw errores.solicitudInvalida('El id debe ser numerico');

    const registro = await servicio.porId(id);
    if (!registro) throw errores.noEncontrado('Registro de auditoria no encontrado');

    res.json({ success: true, data: registro });
  }));

  return router;
}

module.exports = construirRutas;
