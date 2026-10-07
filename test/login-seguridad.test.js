/**
 * Endurecimiento del login: limite propio por IP + usuario (BE-004/BE-006), tiempos
 * parejos entre "usuario inexistente" y "clave incorrecta" (BE-007) y conversion de
 * TRUST_PROXY (BE-003). No necesitan base.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_LOGIN_MAX = '3';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const bcrypt = require('bcryptjs');

const { crearApp } = require('../src/core/app');
const modulos = require('../src/modules');
const { AuthService } = require('../src/modules/auth/service');

test('el login corta con 429 despues de N intentos fallidos del mismo usuario', async () => {
  const { app } = crearApp(modulos);
  const servidor = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const login = (username) => fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'incorrecta' }),
  });

  try {
    for (let i = 0; i < 3; i += 1) {
      const r = await login('victima');
      assert.notEqual(r.status, 429, `el intento ${i + 1} todavia no deberia estar limitado`);
    }
    assert.equal((await login('victima')).status, 429, 'el cuarto intento deberia estar limitado');
    // Otro usuario desde la misma IP tiene su propio contador.
    assert.notEqual((await login('otra-persona')).status, 429);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});

test('un usuario inexistente tambien gasta una comparacion bcrypt (BE-007)', async () => {
  const original = bcrypt.compare;
  let comparaciones = 0;
  bcrypt.compare = async (...args) => { comparaciones += 1; return original(...args); };

  const auditoria = { async registrar() {} };
  const repo = { async porUsername() { return null; } };
  const servicio = new AuthService(repo, auditoria, { warn() {}, error() {}, info() {} });

  try {
    await assert.rejects(() => servicio.login('no-existe', 'cualquiera', { ip: '127.0.0.1', headers: {} }));
    assert.equal(comparaciones, 1, 'sin la comparacion falsa, el tiempo delata que la cuenta no existe');
  } finally {
    bcrypt.compare = original;
  }
});

test('TRUST_PROXY numerico llega como numero, no como string (BE-003)', () => {
  const leer = (valor) => {
    const env = { ...process.env, JWT_SECRET: process.env.JWT_SECRET };
    if (valor === undefined) delete env.TRUST_PROXY; else env.TRUST_PROXY = valor;
    const salida = execFileSync(process.execPath, ['-e',
      "console.log(JSON.stringify(require('./src/core/config').config.http.trustProxy))"],
    { env, cwd: require('node:path').join(__dirname, '..') });
    return JSON.parse(salida.toString());
  };

  assert.equal(leer(undefined), 1);
  assert.equal(leer('2'), 2);
  assert.equal(leer('true'), true);
  assert.equal(leer('loopback'), 'loopback');
});

test('el body de las rutas de auth tiene un tope chico, no los 10 MB globales (BE-036)', async () => {
  const { app } = crearApp(modulos);
  const servidor = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${servidor.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'a'.repeat(40_000) }),
    });
    assert.equal(res.status, 413);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});
