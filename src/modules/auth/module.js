/**
 * Modulo de autenticacion, usuarios, roles y permisos.
 *
 * Cubre /api/auth y /api/users, que antes servia auth-service en el puerto 3002 y el
 * gateway proxeaba. La verificacion de tokens ya no vive aca: es core/security, que
 * corre en el mismo proceso que atiende el request.
 *
 * requiresAuth es false porque el login tiene que ser publico; cada ruta protegida
 * declara requireAuth en routes.js.
 */

const path = require('path');
const AuthRepository = require('./repository');
const { AuthService } = require('./service');
const { UsersService } = require('./users.service');
const construirRutas = require('./routes');

// Cada cuanto se borran de la base los tokens vencidos. Antes esto pasaba en cada
// logout, dentro del request del usuario.
const INTERVALO_PURGA_MS = 6 * 60 * 60 * 1000;

let temporizadorPurga = null;

module.exports = {
  name: 'auth',
  basePath: '/api',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: false,
  permissions: ['admin.users', 'admin.roles', 'admin.system'],

  register({ db, services, logger }) {
    const repo = new AuthRepository(db);
    const auth = new AuthService(repo, services.auditoria, logger);
    const usuarios = new UsersService(repo, services.auditoria);

    this._auth = auth;
    this._logger = logger;

    return {
      router: construirRutas(auth, usuarios),
      provides: { auth, usuarios },
    };
  },

  async onStart() {
    await this._auth.purgarTokensVencidos();

    temporizadorPurga = setInterval(
      () => this._auth.purgarTokensVencidos().catch((error) => this._logger.warn('Fallo la purga de tokens', error)),
      INTERVALO_PURGA_MS,
    );
    // No debe mantener vivo el proceso si es lo unico que queda pendiente.
    temporizadorPurga.unref();
  },

  async onStop() {
    if (temporizadorPurga) clearInterval(temporizadorPurga);
  },
};
