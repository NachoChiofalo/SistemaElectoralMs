/**
 * Modulo de fiscales: alta de fiscales (registro de datos, sin cuenta de usuario) y su
 * calendario de asignaciones a mesas por franja horaria (08:00-18:00). Una mesa no
 * puede tener dos fiscales a la vez, y un fiscal no puede estar en dos mesas a la vez.
 *
 * Los permisos fiscales.view/fiscales.edit ya estaban sembrados en
 * auth/migrations/002_roles_y_permisos.sql desde antes, asi que este modulo no trae
 * una migracion de permisos propia.
 *
 * Depende de que exista elecciones.mesas (015): una asignacion referencia una mesa. Se
 * registra despues de comicio por eso.
 */

const path = require('path');
const { FiscalesRepository } = require('./repository');
const { FiscalesService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name: 'fiscales',
  basePath: '/api/fiscales',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['fiscales.view', 'fiscales.edit'],

  register({ db, services }) {
    const repo = new FiscalesRepository(db);
    const servicio = new FiscalesService(repo, services.auditoria);

    return {
      router: construirRutas(servicio),
      provides: { fiscales: servicio },
    };
  },
};
