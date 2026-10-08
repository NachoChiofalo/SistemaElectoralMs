const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');
const { requirePermission, requireAdmin } = require('../../core/security/authorize');

/**
 * Rutas del mapa (018). Todas exigen territorio.view, que en la etapa 1 tiene solo el administrador.
 * Ninguna hace calculos geograficos: leen lo que reubicar() dejo en la base. El umbral de privacidad lo
 * aplica el servicio, no estas rutas.
 */
const verMapa = requirePermission('territorio.view');

/** Un id de zona: entero positivo. Los ids de manzana vienen de la fuente y son grandes, pero caben. */
function idDe(valor) {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n <= 0) throw errores.solicitudInvalida('Id de zona invalido');
  return n;
}

function construirRutas(servicio) {
  const router = express.Router();

  // Barrios y manzanas para dibujar. Express responde 304 si el navegador ya la tiene (ETag).
  router.get('/geometria', verMapa, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await servicio.geometria() });
  }));

  router.get('/estadisticas', verMapa, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await servicio.estadisticas() });
  }));

  router.get('/zonas/:tipo/:id', verMapa, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await servicio.zona(req.params.tipo, idDe(req.params.id)) });
  }));

  router.get('/manzanas/:id/votantes', verMapa, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await servicio.votantesDeManzana(idDe(req.params.id), req.query.pagina) });
  }));

  router.get('/sin-ubicar', verMapa, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await servicio.sinUbicar() });
  }));

  // Recalcular es una escritura sobre todo el padron: ademas del permiso, el rol de administrador.
  router.post('/reubicar', verMapa, requireAdmin, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await servicio.reubicar(req) });
  }));

  return router;
}

module.exports = construirRutas;
