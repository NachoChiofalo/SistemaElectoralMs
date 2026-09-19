/**
 * Modulo de comicios: alta de comicio con listas participantes, mesas con rango de
 * padron, carga de votos por mesa (por lista + blancos + nulos) y metricas agregadas.
 *
 * Reemplaza el alcance de 007/008 (cascara sin backend). Los permisos comicio.view/
 * comicio.edit ya estaban sembrados en auth/migrations/002_roles_y_permisos.sql desde
 * entonces, asi que este modulo no trae una migracion de permisos propia.
 *
 * Depende de que exista elecciones.listas (017): un comicio referencia listas ya
 * cargadas. Se registra despues de listas por eso, y despues de padron porque el rango
 * de mesa referencia padron.votantes.
 */

const path = require('path');
const { ComicioRepository } = require('./repository');
const { ComicioService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name: 'comicio',
  basePath: '/api/comicio',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['comicio.view', 'comicio.edit'],

  register({ db, services }) {
    const repo = new ComicioRepository(db);
    const servicio = new ComicioService(repo, services.auditoria);

    return {
      router: construirRutas(servicio),
      provides: { comicio: servicio },
    };
  },
};
