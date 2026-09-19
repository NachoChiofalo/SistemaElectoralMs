const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');
const { requirePermission } = require('../../core/security/authorize');

function extraerDatosLista(body) {
  return {
    nombre: body.nombre,
    tipoEleccion: body.tipoEleccion,
    cantidadLugares: Number(body.cantidadLugares),
  };
}

function extraerCandidatos(body) {
  if (!Array.isArray(body.candidatos)) return body.candidatos;
  return body.candidatos.map((c) => ({ nombre: c.nombre, orden: Number(c.orden) }));
}

function construirRutas(servicio) {
  const router = express.Router();

  router.get('/', requirePermission('listas.view'), asyncHandler(async (req, res) => {
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

  router.get('/:id', requirePermission('listas.view'), asyncHandler(async (req, res) => {
    const lista = await servicio.porId(Number(req.params.id));
    if (!lista) throw errores.noEncontrado('Lista no encontrada');
    res.json({ success: true, data: lista });
  }));

  router.post('/', requirePermission('listas.edit'), asyncHandler(async (req, res) => {
    const lista = await servicio.crear(req, extraerDatosLista(req.body), extraerCandidatos(req.body));
    res.status(201).json({ success: true, data: lista });
  }));

  router.put('/:id', requirePermission('listas.edit'), asyncHandler(async (req, res) => {
    const lista = await servicio.actualizar(
      req,
      Number(req.params.id),
      extraerDatosLista(req.body),
      extraerCandidatos(req.body),
    );
    res.json({ success: true, data: lista });
  }));

  router.delete('/:id', requirePermission('listas.edit'), asyncHandler(async (req, res) => {
    await servicio.eliminar(req, Number(req.params.id));
    res.json({ success: true });
  }));

  return router;
}

module.exports = construirRutas;
