/**
 * Modulo de listas electorales: alta, edicion y baja de borradores (nombre, tipo de
 * eleccion, cantidad de lugares y candidatos ordenados). Insumo directo de 015 (modulo
 * de comicio), que todavia no existe.
 *
 * Vive en su propio schema `elecciones`, no en `padron`: una lista de candidatos no es
 * un dato del votante. Ver specs/017-armado-listas/plan.md.
 */

const path = require('path');
const { ListasRepository } = require('./repository');
const { ListasService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name: 'listas',
  basePath: '/api/listas',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['listas.view', 'listas.edit'],

  register({ db, services }) {
    const repo = new ListasRepository(db);
    const servicio = new ListasService(repo, services.auditoria);

    return {
      router: construirRutas(servicio),
      provides: { listas: servicio },
    };
  },
};
