const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');
const { requirePermission } = require('../../core/security/authorize');

function extraerDatosFiscal(body) {
  return { nombre: body.nombre, dni: body.dni || null, telefono: body.telefono || null };
}

function construirRutas(servicio) {
  const router = express.Router();

  // ---- Fiscales ----

  router.get('/', requirePermission('fiscales.view'), asyncHandler(async (req, res) => {
    const resultado = await servicio.listar({ page: req.query.page, limit: req.query.limite });
    res.json({
      success: true,
      data: resultado.registros,
      paginacion: {
        paginaActual: resultado.page,
        registrosPorPagina: resultado.limit,
        totalRegistros: resultado.total,
      },
    });
  }));

  router.get('/:id', requirePermission('fiscales.view'), asyncHandler(async (req, res) => {
    const fiscal = await servicio.porId(Number(req.params.id));
    if (!fiscal) throw errores.noEncontrado('Fiscal no encontrado');
    res.json({ success: true, data: fiscal });
  }));

  router.post('/', requirePermission('fiscales.edit'), asyncHandler(async (req, res) => {
    const fiscal = await servicio.crear(req, extraerDatosFiscal(req.body));
    res.status(201).json({ success: true, data: fiscal });
  }));

  router.put('/:id', requirePermission('fiscales.edit'), asyncHandler(async (req, res) => {
    const fiscal = await servicio.actualizar(req, Number(req.params.id), extraerDatosFiscal(req.body));
    res.json({ success: true, data: fiscal });
  }));

  router.delete('/:id', requirePermission('fiscales.edit'), asyncHandler(async (req, res) => {
    await servicio.eliminar(req, Number(req.params.id));
    res.json({ success: true });
  }));

  // ---- Asignaciones ----

  router.get('/mesas/:mesaId/asignaciones', requirePermission('fiscales.view'), asyncHandler(async (req, res) => {
    const asignaciones = await servicio.asignacionesDeMesa(Number(req.params.mesaId));
    res.json({ success: true, data: asignaciones });
  }));

  router.post('/mesas/:mesaId/asignaciones', requirePermission('fiscales.edit'), asyncHandler(async (req, res) => {
    const asignacion = await servicio.crearAsignacion(req, Number(req.params.mesaId), {
      fiscalId: Number(req.body.fiscalId),
      desde: req.body.desde,
      hasta: req.body.hasta,
    });
    res.status(201).json({ success: true, data: asignacion });
  }));

  router.put('/asignaciones/:id', requirePermission('fiscales.edit'), asyncHandler(async (req, res) => {
    const asignacion = await servicio.actualizarAsignacion(req, Number(req.params.id), {
      fiscalId: Number(req.body.fiscalId),
      desde: req.body.desde,
      hasta: req.body.hasta,
    });
    res.json({ success: true, data: asignacion });
  }));

  router.delete('/asignaciones/:id', requirePermission('fiscales.edit'), asyncHandler(async (req, res) => {
    await servicio.eliminarAsignacion(req, Number(req.params.id));
    res.json({ success: true });
  }));

  // ---- Agenda ----

  router.get('/comicio/:comicioId/agenda', requirePermission('fiscales.view'), asyncHandler(async (req, res) => {
    const agenda = await servicio.agendaDeComicio(Number(req.params.comicioId), req.query.hora);
    res.json({ success: true, data: agenda });
  }));

  return router;
}

module.exports = construirRutas;
