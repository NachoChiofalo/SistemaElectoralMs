/**
 * Modulo del padron electoral: votantes, relevamientos, condiciones especiales,
 * resultados e importacion/exportacion.
 *
 * Cubre /api/padron, que antes servia padron-service en el puerto 3001. Se registra
 * DESPUES de auditoria, que le presta el servicio de registro, y despues de auth
 * (aunque no dependa de el) para que el orden de la lista siga el flujo del sistema.
 *
 * Sus rutas de /api/padron/auditoria las atiende el modulo auditoria, que se monta
 * antes y por eso captura ese prefijo.
 */

const path = require('path');
const { PadronRepository } = require('./repository');
const { PadronService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name: 'padron',
  basePath: '/api/padron',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['padron.view', 'padron.edit', 'padron.relevamiento', 'padron.export', 'resultados.view', 'resultados.export'],

  register({ db, services, logger, config }) {
    const repo = new PadronRepository(db);
    const servicio = new PadronService(repo, services.auditoria, logger, {
      ttlCacheMs: config.esProduccion ? 60_000 : 5_000,
    });

    return {
      router: construirRutas(servicio, db),
      provides: { padron: servicio },
    };
  },
};
