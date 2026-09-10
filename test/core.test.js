/**
 * Tests del nucleo. No necesitan base de datos: verifican el cableado de la app
 * (montaje de modulos, autenticacion, forma de los errores) y la firma de tokens.
 *
 *   node --test test/
 */

// La configuracion se lee al importar: hay que fijarla antes de cualquier require.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { crearApp } = require('../src/core/app');
const jwtHelper = require('../src/core/security/jwt');
const { requirePermission, requireRol } = require('../src/core/security/authorize');
const { errores, manejadorErrores } = require('../src/core/errors');

/** Modulo de mentira, con la misma forma que exige el contrato. */
const moduloDePrueba = {
  name: 'prueba',
  basePath: '/api/prueba',
  requiresAuth: true,
  register() {
    const router = express.Router();
    router.get('/ping', (req, res) => res.json({ success: true, usuario: req.user.username }));
    return { router, provides: { prueba: { ok: true } } };
  },
};

const moduloAbierto = {
  name: 'abierto',
  basePath: '/api/abierto',
  requiresAuth: false,
  register() {
    const router = express.Router();
    router.get('/ping', (req, res) => res.json({ success: true }));
    return { router };
  },
};

/** Levanta la app en un puerto libre y devuelve una funcion para pedirle cosas. */
async function levantar(modulos) {
  const { app, montados } = crearApp(modulos);
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  return {
    montados,
    base,
    pedir: (ruta, opciones) => fetch(`${base}${ruta}`, opciones),
    cerrar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

test('el factory monta los modulos en su basePath', async (t) => {
  const app = await levantar([moduloDePrueba, moduloAbierto]);
  t.after(() => app.cerrar());

  assert.deepEqual(app.montados, [
    { nombre: 'prueba', basePath: '/api/prueba', protegido: true },
    { nombre: 'abierto', basePath: '/api/abierto', protegido: false },
  ]);
});

test('un modulo sin register() no se monta en silencio', () => {
  assert.throws(
    () => crearApp([{ name: 'roto', basePath: '/api/roto' }]),
    /no exporta register/,
  );
});

test('un modulo con requiresAuth rechaza sin token', async (t) => {
  const app = await levantar([moduloDePrueba]);
  t.after(() => app.cerrar());

  const res = await app.pedir('/api/prueba/ping');
  assert.equal(res.status, 401);

  const cuerpo = await res.json();
  assert.equal(cuerpo.success, false);
  assert.equal(cuerpo.message, 'Token de acceso requerido');
});

test('un modulo con requiresAuth rechaza un token con firma invalida', async (t) => {
  const app = await levantar([moduloDePrueba]);
  t.after(() => app.cerrar());

  const res = await app.pedir('/api/prueba/ping', {
    headers: { Authorization: 'Bearer no.es.un.token' },
  });

  assert.equal(res.status, 401);
  assert.equal((await res.json()).message, 'Token invalido');
});

test('un modulo sin requiresAuth responde sin token', async (t) => {
  const app = await levantar([moduloAbierto]);
  t.after(() => app.cerrar());

  const res = await app.pedir('/api/abierto/ping');
  assert.equal(res.status, 200);
});

test('una ruta /api inexistente devuelve 404 en JSON, no el index del cliente', async (t) => {
  const app = await levantar([moduloAbierto]);
  t.after(() => app.cerrar());

  const res = await app.pedir('/api/no-existe');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal((await res.json()).message, 'Endpoint no encontrado');
});

test('/health responde 503 cuando la base no esta disponible', async (t) => {
  const app = await levantar([]);
  t.after(() => app.cerrar());

  const res = await app.pedir('/health');
  assert.equal(res.status, 503);

  const cuerpo = await res.json();
  assert.equal(cuerpo.status, 'DEGRADED');
  assert.equal(cuerpo.db.conectada, false);
  assert.equal(typeof cuerpo.uptime, 'number');
});

test('el token conserva el formato que emitia auth-service', () => {
  const { token, jti } = jwtHelper.firmar({
    id: 7,
    username: 'fiscal01',
    rol_nombre: 'relevador',
    permisos: ['padron.view', 'padron.edit'],
  });

  const claims = jwtHelper.verificar(token);

  assert.equal(claims.id, 7);
  assert.equal(claims.username, 'fiscal01');
  assert.equal(claims.rol, 'relevador');
  assert.deepEqual(claims.permisos, ['padron.view', 'padron.edit']);
  assert.equal(claims.jti, jti);
  assert.equal(claims.iss, 'auth-service');
  assert.equal(claims.aud, 'electoral-system');
});

test('un token firmado con otro secreto no se acepta', () => {
  const jwt = require('jsonwebtoken');
  const ajeno = jwt.sign({ id: 1 }, 'otro-secreto', { issuer: 'auth-service', audience: 'electoral-system' });

  assert.throws(() => jwtHelper.verificar(ajeno), /Token invalido/);
});

test('un token vencido se distingue de uno invalido', () => {
  const jwt = require('jsonwebtoken');
  const vencido = jwt.sign(
    { id: 1 },
    process.env.JWT_SECRET,
    { issuer: 'auth-service', audience: 'electoral-system', expiresIn: -10 },
  );

  assert.throws(() => jwtHelper.verificar(vencido), /Token expirado/);
});

test('requirePermission deja pasar con el permiso y corta sin el', () => {
  const correr = (usuario, middleware) => new Promise((resolve) => {
    middleware({ user: usuario }, {}, (error) => resolve(error));
  });

  const conPermiso = { permisos: ['padron.view'] };
  const sinPermiso = { permisos: ['resultados.view'] };

  return Promise.all([
    correr(conPermiso, requirePermission('padron.view')).then((e) => assert.equal(e, undefined)),
    correr(sinPermiso, requirePermission('padron.view')).then((e) => {
      assert.equal(e.status, 403);
      assert.equal(e.codigo, 'INSUFFICIENT_PERMISSIONS');
    }),
    // Varios permisos: alcanza con tener uno.
    correr(sinPermiso, requirePermission('padron.view', 'resultados.view')).then((e) => assert.equal(e, undefined)),
    correr({}, requireRol('administrador')).then((e) => assert.equal(e.status, 403)),
  ]);
});

test('el manejador de errores traduce codigos de PostgreSQL a HTTP', () => {
  const casos = [
    [{ code: '23505' }, 409],
    [{ code: '23503' }, 400],
    [{ code: '22P02' }, 400],
    [{ code: '57014' }, 503],
    [{ code: 'ECONNREFUSED' }, 503],
    [errores.noEncontrado(), 404],
    [new Error('bug inesperado'), 500],
  ];

  for (const [error, esperado] of casos) {
    let status;
    let cuerpo;
    const res = {
      status(s) { status = s; return this; },
      json(c) { cuerpo = c; },
    };

    manejadorErrores(error, { method: 'GET', originalUrl: '/x' }, res, () => {});

    assert.equal(status, esperado, `codigo ${error.code || error.message}`);
    assert.equal(cuerpo.success, false);
    assert.equal(typeof cuerpo.message, 'string');
  }
});
