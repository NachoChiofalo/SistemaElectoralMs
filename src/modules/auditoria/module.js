/**
 * Modulo de auditoria.
 *
 * Es transversal: registra tanto los eventos de sesion del modulo auth como las
 * operaciones sobre el padron. Por eso es un modulo propio y va PRIMERO en
 * modules/index.js — los otros dos lo consumen a traves de services.auditoria.
 *
 * Sus rutas viven bajo /api/padron/auditoria porque es donde el frontend las busca.
 * Al registrarse antes que padron, Express resuelve ese prefijo aca y el resto de
 * /api/padron cae en el modulo padron.
 */

const path = require('path');
const AuditoriaRepository = require('./repository');
const { AuditoriaService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name: 'auditoria',
  basePath: '/api/padron/auditoria',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['admin.system'],

  register({ db, logger }) {
    const servicio = new AuditoriaService(new AuditoriaRepository(db), logger);

    return {
      router: construirRutas(servicio),
      provides: { auditoria: servicio },
    };
  },
};
