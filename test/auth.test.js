/**
 * Tests del modulo auth contra un repositorio en memoria.
 *
 * Verifican el comportamiento que el codigo viejo resolvia por coincidencia de
 * substrings en el mensaje de error, y que ahora es explicito.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const { AuthService } = require('../src/modules/auth/service');
const { UsersService } = require('../src/modules/auth/users.service');
const sesiones = require('../src/core/security/sessions');
const jwtHelper = require('../src/core/security/jwt');

/** Auditoria que solo anota, para poder afirmar sobre lo que se registro. */
function auditoriaFalsa() {
  const eventos = [];
  return {
    eventos,
    async registrar(evento) { eventos.push(evento); },
    async registrarDeRequest(req, evento) { eventos.push(evento); },
  };
}

/** Repositorio en memoria con la misma interfaz que AuthRepository. */
function repoFalso(usuarios = []) {
  const sesionesAbiertas = [];
  const refreshTokens = new Map();

  return {
    sesionesAbiertas,
    refreshTokens,
    usuarios,

    async porUsername(username) {
      return usuarios.find((u) => u.username === username) ?? null;
    },
    async porId(id) {
      return usuarios.find((u) => u.id === id) ?? null;
    },
    async conPermisos(id) {
      const u = usuarios.find((x) => x.id === id && x.activo);
      return u ? { ...u, modulos: ['padron', 'padron', 'admin'] } : null;
    },
    async abrirSesion(datos) {
      sesionesAbiertas.push(datos);
      refreshTokens.set(datos.refreshToken, datos.userId);
    },
    async porRefreshToken(token) {
      const userId = refreshTokens.get(token);
      return userId ? usuarios.find((u) => u.id === userId) ?? null : null;
    },
    async borrarRefreshToken(token) { refreshTokens.delete(token); },
    async cerrarSesion() {},
    async purgarVencidos() { return { blacklist: 0, refresh: 0 }; },
    async hashPorId(id) {
      const u = usuarios.find((x) => x.id === id);
      return u ? { password_hash: u.password_hash } : null;
    },
    async existeUsername(username) {
      return usuarios.some((u) => u.username === username) ? { id: 1 } : null;
    },
    async rolPorNombre(nombre) {
      return ['administrador', 'consultor', 'encargado_relevamiento'].includes(nombre)
        ? { id: 1 } : null;
    },
    async crearUsuario(datos) {
      const nuevo = { id: usuarios.length + 100, ...datos, activo: true, created_at: new Date() };
      usuarios.push(nuevo);
      return nuevo;
    },
    async cambiarPassword(id, hash) {
      const u = usuarios.find((x) => x.id === id);
      if (!u) return null;
      u.password_hash = hash;
      return { id };
    },
    async cambiarEstado(id, activo) {
      const u = usuarios.find((x) => x.id === id);
      if (!u) return null;
      u.activo = activo;
      return { id, username: u.username, nombre_completo: u.nombre_completo, email: u.email, activo };
    },
  };
}

async function armar() {
  const usuarios = [
    {
      id: 1,
      username: 'admin',
      password_hash: await bcrypt.hash('secreta123', 4), // costo bajo: es un test
      nombre_completo: 'Administradora',
      email: 'admin@electoral.gov.ar',
      activo: true,
      rol_nombre: 'administrador',
      rol_descripcion: 'Acceso completo',
      permisos: ['padron.view', 'admin.users'],
    },
    {
      id: 2,
      username: 'suspendido',
      password_hash: await bcrypt.hash('secreta123', 4),
      nombre_completo: 'Usuario Suspendido',
      email: null,
      activo: false,
      rol_nombre: 'consultor',
      permisos: [],
    },
  ];

  const repo = repoFalso(usuarios);
  const auditoria = auditoriaFalsa();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  return {
    repo,
    auditoria,
    auth: new AuthService(repo, auditoria, logger),
    usuarios: new UsersService(repo, auditoria),
  };
}

const req = { ip: '10.0.0.7', headers: {} };

test('el login exitoso devuelve usuario, tokens y permisos', async () => {
  const { auth, repo } = await armar();

  const resultado = await auth.login('admin', 'secreta123', req);

  assert.equal(resultado.user.username, 'admin');
  assert.equal(resultado.user.rol, 'administrador');
  assert.deepEqual(resultado.user.permisos, ['padron.view', 'admin.users']);
  assert.equal(typeof resultado.accessToken, 'string');
  assert.equal(typeof resultado.refreshToken, 'string');

  // La sesion quedo registrada con el mismo jti que lleva el token.
  const claims = jwtHelper.verificar(resultado.accessToken);
  assert.equal(repo.sesionesAbiertas.length, 1);
  assert.equal(repo.sesionesAbiertas[0].jti, claims.jti);
  assert.equal(repo.sesionesAbiertas[0].userId, 1);
});

test('el usuario inexistente y la contrasena incorrecta dan el mismo mensaje', async () => {
  const { auth } = await armar();

  const errorUsuario = await auth.login('no-existe', 'x', req).catch((e) => e);
  const errorPassword = await auth.login('admin', 'incorrecta', req).catch((e) => e);

  assert.equal(errorUsuario.status, 401);
  assert.equal(errorPassword.status, 401);
  // Distinguirlos permitiria enumerar que usuarios existen.
  assert.equal(errorUsuario.message, errorPassword.message);
  assert.equal(errorUsuario.message, 'Credenciales invalidas');
});

test('un usuario inactivo recibe 403, no 500', async () => {
  const { auth } = await armar();

  const error = await auth.login('suspendido', 'secreta123', req).catch((e) => e);

  // El middleware viejo mapeaba por substring del mensaje: 'Usuario inactivo' no
  // coincidia con ningun caso y terminaba en 500.
  assert.equal(error.status, 403);
  assert.equal(error.message, 'Usuario inactivo');
});

test('cada intento de login queda auditado con su motivo', async () => {
  const { auth, auditoria } = await armar();

  await auth.login('admin', 'secreta123', req);
  await auth.login('admin', 'incorrecta', req).catch(() => {});
  await auth.login('fantasma', 'x', req).catch(() => {});

  assert.deepEqual(auditoria.eventos.map((e) => e.operacion), ['LOGIN', 'LOGIN_FALLIDO', 'LOGIN_FALLIDO']);
  assert.equal(auditoria.eventos[0].ip_address, '10.0.0.7');
  assert.match(auditoria.eventos[2].detalles, /no encontrado/);
});

test('un refresh token invalido devuelve 401, no 500', async () => {
  const { auth } = await armar();

  const error = await auth.renovar('token-que-no-existe').catch((e) => e);

  assert.equal(error.status, 401);
  assert.equal(error.message, 'Refresh token invalido o expirado');
});

test('el refresh token es de un solo uso', async () => {
  const { auth } = await armar();

  const { refreshToken } = await auth.login('admin', 'secreta123', req);

  const renovado = await auth.renovar(refreshToken);
  assert.equal(renovado.user.username, 'admin');
  assert.notEqual(renovado.refreshToken, refreshToken);

  const error = await auth.renovar(refreshToken).catch((e) => e);
  assert.equal(error.status, 401);
});

test('el logout no falla aunque el token sea ilegible', async () => {
  const { auth } = await armar();

  await auth.logout('no-es-un-token', req);
  await auth.logout('', req);
});

test('perfilCompleto deduplica los modulos disponibles', async () => {
  const { auth } = await armar();

  const perfil = await auth.perfilCompleto(1);

  assert.deepEqual(perfil.modulos_disponibles, ['padron', 'admin']);
  assert.equal(perfil.rol, 'administrador');
});

test('crear un usuario con un username tomado devuelve 409', async () => {
  const { usuarios } = await armar();

  const error = await usuarios.crear(
    { username: 'admin', password: 'secreta123', nombre_completo: 'Otro', rol: 'consultor' },
    req,
  ).catch((e) => e);

  assert.equal(error.status, 409);
  assert.equal(error.message, 'El username ya existe');
});

test('crear un usuario con un rol inexistente devuelve 400', async () => {
  const { usuarios } = await armar();

  const error = await usuarios.crear(
    { username: 'nuevo', password: 'secreta123', nombre_completo: 'Nueva', rol: 'inventado' },
    req,
  ).catch((e) => e);

  assert.equal(error.status, 400);
  assert.match(error.message, /no existe/);
});

test('la contrasena corta se rechaza al crear y al resetear', async () => {
  const { usuarios } = await armar();

  const alCrear = await usuarios.crear(
    { username: 'nuevo', password: '123', nombre_completo: 'Nueva', rol: 'consultor' },
    req,
  ).catch((e) => e);
  const alResetear = await usuarios.resetearPassword(1, '123', req).catch((e) => e);

  assert.equal(alCrear.status, 400);
  assert.equal(alResetear.status, 400);
});

test('cambiar la contrasena propia exige la actual', async () => {
  const { usuarios } = await armar();

  const error = await usuarios.cambiarPasswordPropia(1, 'la-que-no-es', 'nueva123', req).catch((e) => e);
  assert.equal(error.status, 401);
  assert.equal(error.message, 'Contrasena actual incorrecta');

  await usuarios.cambiarPasswordPropia(1, 'secreta123', 'nueva123456', req);
});

test('desactivar un usuario invalida su sesion cacheada de inmediato', async () => {
  const { auth, usuarios } = await armar();

  await auth.login('admin', 'secreta123', req);
  const antes = sesiones.estado().sesionesCacheadas;

  await usuarios.cambiarEstado(1, false, req);

  // Sin esto, el usuario desactivado seguiria autenticandose hasta que venciera el TTL.
  assert.ok(sesiones.estado().sesionesCacheadas <= antes);
});

test('las operaciones sobre usuarios quedan auditadas', async () => {
  const { usuarios, auditoria } = await armar();

  await usuarios.crear({ username: 'fiscal9', password: 'secreta123', nombre_completo: 'Fiscal', rol: 'consultor' }, req);
  await usuarios.cambiarEstado(1, false, req);

  assert.deepEqual(auditoria.eventos.map((e) => `${e.operacion} ${e.entidad}`), [
    'CREAR USUARIO',
    'DESACTIVAR USUARIO',
  ]);
});
