const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');
const { requirePermission } = require('../../core/security/authorize');

function extraerDatosComicio(body) {
  return { nombre: body.nombre, tipoEleccion: body.tipoEleccion };
}

function extraerFuerzaIds(body) {
  if (!Array.isArray(body.fuerzaIds)) return body.fuerzaIds;
  return body.fuerzaIds.map(Number);
}

function extraerDatosFuerza(body) {
  return {
    nombre: body.nombre,
    sigla: body.sigla || null,
    // Ausente = el color por defecto; un valor invalido ('abc', 99) NO se corrige en
    // silencio a 1: lo rechaza validarDatosFuerza con un 400 (BE-048).
    color: body.color === undefined || body.color === null || body.color === '' ? 1 : Number(body.color),
    listaId: body.listaId ? Number(body.listaId) : null,
  };
}

function extraerDatosMesa(body) {
  return {
    numero: Number(body.numero),
    // El rango es opcional: DNI vacio o ausente se manda como null, no como "".
    desdeDni: body.desdeDni || null,
    hastaDni: body.hastaDni || null,
  };
}

function construirRutas(servicio) {
  const router = express.Router();

  // ---- Fuerzas ----
  // Van antes de comicio.view/:id para que "/fuerzas" no matchee la ruta :id.

  router.get('/fuerzas', requirePermission('comicio.view'), asyncHandler(async (req, res) => {
    const fuerzas = await servicio.listarFuerzas();
    res.json({ success: true, data: fuerzas });
  }));

  router.post('/fuerzas', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const fuerza = await servicio.crearFuerza(req, extraerDatosFuerza(req.body));
    res.status(201).json({ success: true, data: fuerza });
  }));

  router.put('/fuerzas/:id', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const fuerza = await servicio.actualizarFuerza(req, Number(req.params.id), extraerDatosFuerza(req.body));
    res.json({ success: true, data: fuerza });
  }));

  router.delete('/fuerzas/:id', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    await servicio.eliminarFuerza(req, Number(req.params.id));
    res.json({ success: true });
  }));

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
    const comicio = await servicio.crearComicio(req, extraerDatosComicio(req.body), extraerFuerzaIds(req.body));
    res.status(201).json({ success: true, data: comicio });
  }));

  router.put('/:id', requirePermission('comicio.edit'), asyncHandler(async (req, res) => {
    const comicio = await servicio.actualizarComicio(
      req,
      Number(req.params.id),
      extraerDatosComicio(req.body),
      extraerFuerzaIds(req.body),
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
      porFuerza: Array.isArray(req.body.porFuerza)
        ? req.body.porFuerza.map((v) => ({ fuerzaId: Number(v.fuerzaId), cantidad: Number(v.cantidad) }))
        : req.body.porFuerza,
    });
    res.json({ success: true, data: votos });
  }));

  return router;
}

module.exports = construirRutas;
