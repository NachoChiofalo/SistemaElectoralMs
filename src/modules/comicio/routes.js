const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');
const { requirePermission } = require('../../core/security/authorize');

function extraerDatosComicio(body) {
  return { nombre: body.nombre, tipoEleccion: body.tipoEleccion };
}

function extraerListaIds(body) {
  if (!Array.isArray(body.listaIds)) return body.listaIds;
  return body.listaIds.map(Number);
}

function extraerDatosMesa(body) {
  return {
    numero: Number(body.numero),
    desdeDni: body.desdeDni,
    hastaDni: body.hastaDni,
  };
}

function construirRutas(servicio) {
  const router = express.Router();

  // ---- Comicios ----

  router.get('/', requirePermission('comicio.view'), asyncHandler(async (req, res) => {
    const resultado = await servicio.listarComicios({ page: req.query.page, limit: req.query.limite });
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

  router.get('/:id', requirePermission('comicio.view'), asyncHandler(async (req, res) => {
    const comicio = await servicio.porIdComicio(Number(req.params.id));
    if (!comicio) throw errores.noEncontrado('Comicio no encontrado');
    res.json({ success: true, data: comicio });
  }));

  router.post('/', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const comicio = await servicio.crearComicio(req, extraerDatosComicio(req.body), extraerListaIds(req.body));
    res.status(201).json({ success: true, data: comicio });
  }));

  router.put('/:id', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const comicio = await servicio.actualizarComicio(
      req,
      Number(req.params.id),
      extraerDatosComicio(req.body),
      extraerListaIds(req.body),
    );
    res.json({ success: true, data: comicio });
  }));

  router.delete('/:id', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    await servicio.eliminarComicio(req, Number(req.params.id));
    res.json({ success: true });
  }));

  // ---- Metricas ----

  router.get('/:id/metricas', requirePermission('comicio.view'), asyncHandler(async (req, res) => {
    const metricas = await servicio.metricas(Number(req.params.id));
    res.json({ success: true, data: metricas });
  }));

  // ---- Mesas ----

  router.post('/:id/mesas', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const mesa = await servicio.crearMesa(req, Number(req.params.id), extraerDatosMesa(req.body));
    res.status(201).json({ success: true, data: mesa });
  }));

  router.put('/:id/mesas/:mesaId', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const mesa = await servicio.actualizarMesa(
      req,
      Number(req.params.id),
      Number(req.params.mesaId),
      extraerDatosMesa(req.body),
    );
    res.json({ success: true, data: mesa });
  }));

  router.delete('/:id/mesas/:mesaId', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    await servicio.eliminarMesa(req, Number(req.params.id), Number(req.params.mesaId));
    res.json({ success: true });
  }));

  // ---- Votos ----

  router.get('/:id/mesas/:mesaId/votos', requirePermission('comicio.view'), asyncHandler(async (req, res) => {
    const votos = await servicio.votosDeMesa(Number(req.params.id), Number(req.params.mesaId));
    res.json({ success: true, data: votos });
  }));

  router.put('/:id/mesas/:mesaId/votos', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const votos = await servicio.cargarVotos(req, Number(req.params.id), Number(req.params.mesaId), {
      blancos: Number(req.body.blancos),
      nulos: Number(req.body.nulos),
      porLista: Array.isArray(req.body.porLista)
        ? req.body.porLista.map((v) => ({ listaId: Number(v.listaId), cantidad: Number(v.cantidad) }))
        : req.body.porLista,
    });
    res.json({ success: true, data: votos });
  }));

  return router;
}

module.exports = construirRutas;
