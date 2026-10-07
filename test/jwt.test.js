/**
 * Tests de los helpers de core/security/jwt.js agregados para specs/G3-sesion-jwt.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const jwtHelper = require('../src/core/security/jwt');
const { config } = require('../src/core/config');

test('hashRefreshToken es deterministico y no reversible a simple vista', () => {
  const a = jwtHelper.hashRefreshToken('token-de-prueba');
  const b = jwtHelper.hashRefreshToken('token-de-prueba');
  const c = jwtHelper.hashRefreshToken('otro-token');

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, 'token-de-prueba');
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('verificarIgnorandoExpiracion rechaza firma invalida', () => {
  const forjado = jwt.sign(
    { id: 1, jti: 'x' },
    'secreto-equivocado',
    { issuer: 'auth-service', audience: 'electoral-system', expiresIn: '1h' },
  );

  assert.throws(() => jwtHelper.verificarIgnorandoExpiracion(forjado), (error) => error.status === 401);
});

test('verificarIgnorandoExpiracion acepta un token vencido de firma valida', () => {
  const { token } = jwtHelper.firmar({ id: 1, username: 'admin', rol: 'administrador', permisos: [] });
  const claims = jwt.decode(token);

  const vencido = jwt.sign(
    { id: claims.id, username: claims.username, jti: claims.jti },
    config.jwt.secreto,
    { issuer: 'auth-service', audience: 'electoral-system', expiresIn: -1 },
  );

  const resultado = jwtHelper.verificarIgnorandoExpiracion(vencido);
  assert.equal(resultado.id, 1);
  assert.equal(resultado.jti, claims.jti);
});
