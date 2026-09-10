/**
 * Tests de migraciones contra una base real.
 *
 * Se saltan automaticamente si no hay DATABASE_URL_TEST — no hacen falta para
 * `npm test` en CI ni en el dia a dia, que corren sin base. Sirven para verificar,
 * contra un Postgres real, dos propiedades que no se pueden probar con mocks:
 *
 *   1. Que las migraciones son idempotentes: correrlas contra una base que ya tiene
 *      el esquema y datos del sistema anterior no los toca, y siembra lo que falta.
 *      Esto es lo que permite recomendar `npm run migrate` directo en produccion,
 *      en lugar del modo `adopt` (mas complejo y que se probo mas arriesgado: salta
 *      migraciones idempotentes sin ejecutarlas).
 *   2. Que correr las migraciones dos veces seguidas es un no-op la segunda vez.
 *
 * Para correrlos localmente:
 *   docker run -d --name pg-test -p 55432:5432 \
 *     -e POSTGRES_DB=test_migraciones -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
 *     postgres:15-alpine
 *   DATABASE_URL_TEST=postgresql://test:test@localhost:55432/test_migraciones npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const SKIP = !process.env.DATABASE_URL_TEST;

test('migraciones contra Postgres real', { skip: SKIP && 'requiere DATABASE_URL_TEST' }, async (t) => {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
  process.env.LOG_LEVEL = 'error';

  const db = require('../src/core/db');
  const { migrarTodo, contarPendientes } = require('../src/core/migrations');
  const modulos = require('../src/modules');

  t.after(() => db.cerrar());

  await t.test('limpia el esquema de una corrida anterior', async () => {
    await db.query('DROP SCHEMA IF EXISTS padron CASCADE');
    await db.query(`
      DROP TABLE IF EXISTS
        public.schema_migrations, public.active_sessions, public.token_blacklist,
        public.refresh_tokens, public.rol_permisos, public.usuarios,
        public.permisos, public.roles
      CASCADE
    `);
  });

  await t.test('correr las migraciones sobre una base vacia no falla', async () => {
    const aplicadas = await migrarTodo(modulos);
    assert.ok(aplicadas > 0);
    assert.equal(await contarPendientes(modulos), 0);
  });

  await t.test('correrlas de nuevo es un no-op', async () => {
    const aplicadas = await migrarTodo(modulos);
    assert.equal(aplicadas, 0);
  });

  await t.test('sembraron los roles y los 14 permisos esperados', async () => {
    const roles = await db.filas('SELECT nombre FROM roles ORDER BY nombre');
    assert.deepEqual(roles.map((r) => r.nombre), ['administrador', 'consultor', 'encargado_relevamiento']);

    const { total } = await db.unaFila('SELECT COUNT(*)::int AS total FROM permisos');
    assert.equal(total, 14);

    const { total: totalAdmin } = await db.unaFila(`
      SELECT COUNT(*)::int AS total FROM rol_permisos rp
      JOIN roles r ON r.id = rp.rol_id
      WHERE r.nombre = 'administrador'
    `);
    assert.equal(totalAdmin, 14, 'el administrador tiene que tener los 14 permisos');
  });

  await t.test('pg_trgm quedo instalada para la busqueda del padron', async () => {
    const extension = await db.unaFila("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    assert.ok(extension, 'pg_trgm deberia estar instalada');
  });

  await t.test('correr migrate sobre datos preexistentes no los pisa', async () => {
    // Simula la base de produccion: tablas ya creadas por el sistema anterior, con
    // un usuario que YA existe antes de que corran las migraciones de este proyecto.
    await db.query(`
      INSERT INTO usuarios (username, password_hash, nombre_completo, rol_id)
      SELECT 'ya-existia', 'hash-preexistente', 'Usuario De Produccion', id
      FROM roles WHERE nombre = 'administrador'
      ON CONFLICT (username) DO NOTHING
    `);

    await migrarTodo(modulos); // no-op esperado: no hay migraciones nuevas

    const usuario = await db.unaFila(
      "SELECT nombre_completo, password_hash FROM usuarios WHERE username = 'ya-existia'",
    );
    assert.equal(usuario.nombre_completo, 'Usuario De Produccion');
    assert.equal(usuario.password_hash, 'hash-preexistente');
  });

  await t.test('la app arranca (migraciones + servidor) contra esta base', async () => {
    const { crearApp } = require('../src/core/app');
    const { app } = crearApp(modulos);

    const servidor = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

    try {
      const res = await fetch(`http://127.0.0.1:${servidor.address().port}/health`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.db.conectada, true);
    } finally {
      await new Promise((resolve) => servidor.close(resolve));
    }
  });
});
