/**
 * La CSP tiene que frenar de verdad la ejecucion de script inline, no solo
 * declararlo. Este test lee el header tal como lo sirve la app, no el
 * archivo de config: si algun dia vuelve 'unsafe-inline' por error, esto
 * falla sin depender de que alguien lo note a ojo.
 *
 *   node --test test/
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');

const { crearApp } = require('../src/core/app');

async function levantar() {
  const { app } = crearApp([]);
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  return {
    pedir: (ruta) => fetch(`${base}${ruta}`),
    cerrar: () => new Promise((resolve) => servidor.close(resolve)),
  };
}

test('CSP sin unsafe-inline', async (t) => {
  const { pedir, cerrar } = await levantar();
  t.after(cerrar);

  await t.test('script-src no lleva unsafe-inline', async () => {
    const respuesta = await pedir('/index.html');
    const csp = respuesta.headers.get('content-security-policy');

    assert.ok(csp, 'la respuesta no trae header Content-Security-Policy');

    const directivaScript = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    assert.ok(directivaScript, 'la CSP no declara script-src');
    assert.ok(
      !directivaScript.includes("'unsafe-inline'"),
      `script-src todavia permite unsafe-inline: "${directivaScript}"`,
    );
    assert.ok(directivaScript.includes("'self'"), `script-src deberia seguir permitiendo 'self': "${directivaScript}"`);
  });
});
