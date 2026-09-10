/**
 * Arma la aplicacion con los modulos REALES y comprueba el cableado completo.
 *
 * No necesita base: verifica que los tres modulos se registren, que sus rutas queden
 * montadas donde el frontend las busca y que la proteccion sea la correcta. Un fallo
 * aca es un error de wiring, no de logica.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { crearApp } = require('../src/core/app');
const modulos = require('../src/modules');

let servidor;
let base;

test.before(async () => {
  const { app } = crearApp(modulos);
  servidor = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(() => new Promise((resolve) => servidor.close(resolve)));

const pedir = (ruta, opciones) => fetch(`${base}${ruta}`, opciones);

test('los tres modulos se registran en el orden declarado', () => {
  assert.deepEqual(modulos.map((m) => m.name), ['auditoria', 'auth', 'padron']);
});

test('auditoria se monta antes que padron para capturar su prefijo', () => {
  const auditoria = modulos.findIndex((m) => m.basePath === '/api/padron/auditoria');
  const padron = modulos.findIndex((m) => m.basePath === '/api/padron');

  // Si padron se montara primero, /api/padron/auditoria caeria en padron y daria 404.
  assert.ok(auditoria < padron, 'auditoria tiene que ir antes que padron');
});

test('cada modulo declara migraciones que existen en disco', () => {
  for (const modulo of modulos) {
    assert.ok(modulo.migrations, `${modulo.name} no declara migraciones`);
    assert.ok(fs.existsSync(modulo.migrations), `no existe ${modulo.migrations}`);

    const archivos = fs.readdirSync(modulo.migrations).filter((f) => f.endsWith('.sql'));
    assert.ok(archivos.length > 0, `${modulo.name} no tiene ningun .sql`);

    // El prefijo numerico es lo que define el orden de aplicacion.
    for (const archivo of archivos) {
      assert.match(archivo, /^\d{3}_/, `${modulo.name}/${archivo} sin prefijo numerico`);
    }
  }
});

test('los permisos que declaran los modulos existen en la migracion de permisos', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'auth', 'migrations', '002_roles_y_permisos.sql'),
    'utf8',
  );

  for (const modulo of modulos) {
    for (const permiso of modulo.permissions || []) {
      assert.ok(sql.includes(`'${permiso}'`), `el permiso ${permiso} (${modulo.name}) no esta en la migracion`);
    }
  }
});

test('el login es publico y valida que vengan las credenciales', async () => {
  const res = await pedir('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  // 400 y no 401: el endpoint es alcanzable sin token, que es lo que se comprueba.
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, 'Username y password son requeridos');
});

test('todas las rutas de datos exigen token', async () => {
  const protegidas = [
    ['GET', '/api/padron/votantes'],
    ['GET', '/api/padron/estadisticas'],
    ['GET', '/api/padron/resultados/por-sexo'],
    ['GET', '/api/padron/exportar-padron'],
    ['GET', '/api/padron/auditoria'],
    ['GET', '/api/padron/auditoria/estadisticas'],
    ['GET', '/api/users'],
    ['GET', '/api/users/profile'],
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/verify'],
    ['POST', '/api/padron/detalle-votante'],
    ['DELETE', '/api/padron/detalle-votante/123'],
  ];

  for (const [method, ruta] of protegidas) {
    const res = await pedir(ruta, { method });
    assert.equal(res.status, 401, `${method} ${ruta} deberia exigir token`);
  }
});

test('el logout acepta un token vencido, porque cerrar sesion siempre debe funcionar', async () => {
  const sinToken = await pedir('/api/auth/logout', { method: 'POST' });
  assert.equal(sinToken.status, 401);

  // Con un token cualquiera no explota: responde exitoso igual.
  const conBasura = await pedir('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer basura' },
  });
  assert.equal(conBasura.status, 200);
  assert.equal((await conBasura.json()).success, true);
});

test('una ruta de API inexistente da 404 JSON aunque exista el frontend', async () => {
  const res = await pedir('/api/padron/inventado');

  assert.equal(res.status, 401); // primero pide token, que es lo correcto
  assert.match(res.headers.get('content-type'), /application\/json/);

  const fueraDeModulo = await pedir('/api/inventado');
  assert.equal(fueraDeModulo.status, 404);
  assert.match(fueraDeModulo.headers.get('content-type'), /application\/json/);
});

test('el frontend se sirve desde el mismo proceso', async () => {
  const raiz = await pedir('/');

  assert.equal(raiz.status, 200);
  assert.match(raiz.headers.get('content-type'), /text\/html/);
  assert.match(await raiz.text(), /<html/i);
});

test('una ruta del cliente devuelve el index en lugar de 404', async () => {
  const res = await pedir('/resultados');

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});

test('el HTML se revalida siempre y los assets se pueden cachear', async () => {
  const html = await pedir('/index.html');
  assert.equal(html.headers.get('cache-control'), 'no-cache');

  const js = await pedir('/src/services/ApiService.js');
  assert.equal(js.status, 200);
  // ETag habilitado: el navegador revalida barato en lugar de re-descargar.
  assert.ok(js.headers.get('etag'), 'los estaticos deberian llevar ETag');
});

test('no queda ninguna referencia a los servicios viejos', () => {
  const raiz = path.join(__dirname, '..');
  for (const carpeta of ['services', 'clients', 'shared']) {
    assert.equal(fs.existsSync(path.join(raiz, carpeta)), false, `${carpeta}/ deberia estar eliminada`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
  for (const paquete of ['axios', 'http-proxy-middleware', 'morgan', 'serve', 'live-server', 'uuid']) {
    assert.equal(pkg.dependencies[paquete], undefined, `${paquete} ya no deberia ser dependencia`);
  }
});
