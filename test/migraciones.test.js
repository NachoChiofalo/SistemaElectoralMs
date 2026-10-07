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

// Igual que en el resto de los tests: evita que config.js cargue un .env local (que
// podria tener una DATABASE_URL real) antes de que este archivo fije la suya propia.
process.env.NODE_ENV = 'test';

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

  await t.test('sembraron los roles y los 16 permisos esperados', async () => {
    const roles = await db.filas('SELECT nombre FROM roles ORDER BY nombre');
    assert.deepEqual(roles.map((r) => r.nombre), ['administrador', 'consultor', 'encargado_relevamiento']);

    const { total } = await db.unaFila('SELECT COUNT(*)::int AS total FROM permisos');
    assert.equal(total, 16);

    const { total: totalAdmin } = await db.unaFila(`
      SELECT COUNT(*)::int AS total FROM rol_permisos rp
      JOIN roles r ON r.id = rp.rol_id
      WHERE r.nombre = 'administrador'
    `);
    assert.equal(totalAdmin, 16, 'el administrador tiene que tener los 16 permisos');
  });

  await t.test('pg_trgm quedo instalada para la busqueda del padron', async () => {
    const extension = await db.unaFila("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    assert.ok(extension, 'pg_trgm deberia estar instalada');
  });

  await t.test('fiscal_asignaciones rechaza un solapamiento por SQL directo (G1)', async () => {
    // La validacion de aplicacion (_validarSinSolapamiento) no llega a ejercitarse
    // aca: esto prueba que la garantia la sostiene la base, insertando por SQL puro
    // como haria un caller que se salteara el service.
    const comicio = await db.unaFila(
      "INSERT INTO elecciones.comicios (nombre, tipo_eleccion) VALUES ('Test G1', 'nacional') RETURNING id",
    );
    const mesaA = await db.unaFila(
      'INSERT INTO elecciones.mesas (comicio_id, numero) VALUES ($1, 1) RETURNING id',
      [comicio.id],
    );
    const mesaB = await db.unaFila(
      'INSERT INTO elecciones.mesas (comicio_id, numero) VALUES ($1, 2) RETURNING id',
      [comicio.id],
    );
    const fiscalA = await db.unaFila("INSERT INTO elecciones.fiscales (nombre) VALUES ('Fiscal A') RETURNING id");
    const fiscalB = await db.unaFila("INSERT INTO elecciones.fiscales (nombre) VALUES ('Fiscal B') RETURNING id");

    await db.query(
      "INSERT INTO elecciones.fiscal_asignaciones (mesa_id, fiscal_id, desde, hasta) VALUES ($1, $2, '09:00', '10:00')",
      [mesaA.id, fiscalA.id],
    );

    await assert.rejects(
      () => db.query(
        "INSERT INTO elecciones.fiscal_asignaciones (mesa_id, fiscal_id, desde, hasta) VALUES ($1, $2, '09:30', '10:30')",
        [mesaA.id, fiscalB.id],
      ),
      (error) => error.code === '23P01',
      'la misma mesa con otro fiscal en horario cruzado deberia fallar con exclusion_violation',
    );

    await assert.rejects(
      () => db.query(
        "INSERT INTO elecciones.fiscal_asignaciones (mesa_id, fiscal_id, desde, hasta) VALUES ($1, $2, '09:30', '10:30')",
        [mesaB.id, fiscalA.id],
      ),
      (error) => error.code === '23P01',
      'el mismo fiscal en otra mesa con horario cruzado deberia fallar con exclusion_violation',
    );
  });

  await t.test('padron.auditoria rechaza UPDATE y DELETE por SQL directo (G6)', async () => {
    // Mismo espiritu que el test de fiscal_asignaciones: esto se salta el repository
    // (que solo expone insertar/listar) para probar que la garantia la sostiene el
    // motor -- un trigger + REVOKE, no una convencion de codigo (DB-003).
    const fila = await db.unaFila(
      "INSERT INTO padron.auditoria (operacion, entidad) VALUES ('LOGIN', 'SESION') RETURNING id",
    );

    await assert.rejects(
      () => db.query('UPDATE padron.auditoria SET detalles = $1 WHERE id = $2', ['manipulado', fila.id]),
      'un UPDATE directo sobre auditoria deberia rechazar',
    );

    await assert.rejects(
      () => db.query('DELETE FROM padron.auditoria WHERE id = $1', [fila.id]),
      'un DELETE directo sobre auditoria deberia rechazar',
    );

    const sigueAhi = await db.unaFila('SELECT detalles FROM padron.auditoria WHERE id = $1', [fila.id]);
    assert.equal(sigueAhi.detalles, null, 'la fila no debe haberse tocado');
  });

  await t.test('padron.auditoria acepta el vocabulario real: operacion en mayusculas, entidad en minusculas', async () => {
    // Es lo que escriben comicio, fiscales, listas y padron. Un CHECK de mayusculas haria que
    // `registrar` perdiera esos eventos en silencio (DB-033, descartado a proposito).
    const fila = await db.unaFila(
      "INSERT INTO padron.auditoria (operacion, entidad, entidad_id) VALUES ('CREATE', 'votante', '1') RETURNING id",
    );
    assert.ok(fila.id);
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

  await t.test('insertarVotante no pisa a un votante que ya existe (BE-005)', async () => {
    const { PadronRepository } = require('../src/modules/padron/repository');
    const repo = new PadronRepository(db);
    const base = {
      dni: '30999001', anio_nac: 1980, apellido: 'ORIGINAL', nombre: 'UNO', domicilio: 'Calle 1',
      tipo_ejemplar: 'A', circuito: '0100', sexo: 'M', edad: 46,
    };

    const primero = await repo.insertarVotante(base);
    assert.equal(primero.dni, '30999001');

    const segundo = await repo.insertarVotante({ ...base, apellido: 'PISADO', domicilio: '', circuito: '' });
    assert.equal(segundo, null, 'un DNI repetido no devuelve fila: el service lo convierte en 409');

    const guardado = await db.unaFila('SELECT apellido, domicilio, circuito FROM padron.votantes WHERE dni = $1', ['30999001']);
    assert.deepEqual(guardado, { apellido: 'ORIGINAL', domicilio: 'Calle 1', circuito: '0100' });
  });

  await t.test('importar un CSV en Windows-1252 conserva acentos y descarta filas demasiado largas (BE-025, BE-023)', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { importarCsv } = require('../src/modules/padron/importer');

    const ruta = path.join(os.tmpdir(), `padron-latin1-${process.pid}.csv`);
    // Muñoz / José en Windows-1252: bytes que no son UTF-8 valido. La tercera fila trae
    // un apellido de 101 caracteres, que antes volteaba el COPY entero.
    const lineas = [
      'DNI,AÑO NAC,APELLIDO,NOMBRE',
      '30777001,1980,Muñoz,José',
      '30777002,1975,Gómez,Ana',
      `30777003,1990,${'A'.repeat(101)},Largo`,
    ];
    fs.writeFileSync(ruta, Buffer.from(lineas.join(String.fromCharCode(10)) + String.fromCharCode(10), 'latin1'));

    try {
      const resumen = await importarCsv(db, ruta);
      assert.equal(resumen.descartadas, 1, 'la fila con apellido de 101 caracteres se descarta');
    } finally {
      fs.unlinkSync(ruta);
    }

    const filas = await db.filas("SELECT dni, apellido, nombre FROM padron.votantes WHERE dni LIKE '3077700%' ORDER BY dni");
    assert.deepEqual(filas, [
      { dni: '30777001', apellido: 'Muñoz', nombre: 'José' },
      { dni: '30777002', apellido: 'Gómez', nombre: 'Ana' },
    ]);
  });

  await t.test('dos migrarTodo simultaneos no aplican nada dos veces (BE-014)', async () => {
    const [a, b] = await Promise.all([migrarTodo(modulos), migrarTodo(modulos)]);
    assert.equal(a + b, 0, 'todo ya estaba aplicado: ninguna de las dos tiene nada que hacer');
    assert.equal(await contarPendientes(modulos), 0);
  });

  await t.test('los CHECK nuevos rechazan valores fuera de dominio (DB-013, DB-020, DB-024)', async () => {
    await assert.rejects(
      () => db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('30888001', 1800, 'A', 'B')"),
      'anio_nac fuera de rango',
    );
    await assert.rejects(
      () => db.query("INSERT INTO elecciones.listas (nombre, tipo_eleccion, cantidad_lugares) VALUES ('x', 'municipal', 0)"),
      'cantidad_lugares menor a 1 (DB-039)',
    );
    await assert.rejects(
      () => db.query("INSERT INTO elecciones.listas (nombre, tipo_eleccion, cantidad_lugares) VALUES ('x', 'galactica', 1)"),
      'tipo_eleccion fuera del dominio',
    );
    await assert.rejects(
      () => db.query("INSERT INTO elecciones.comicios (nombre, tipo_eleccion) VALUES ('x', 'galactica')"),
      'tipo_eleccion de comicio fuera del dominio',
    );
    await assert.rejects(
      () => db.query("INSERT INTO elecciones.fuerzas (nombre, color) VALUES ('f', 9)"),
      'color fuera de 1-8',
    );
  });

  await t.test('editar una mesa mueve su updated_at (DB-023)', async () => {
    const { ComicioRepository } = require('../src/modules/comicio/repository');
    const repo = new ComicioRepository(db);
    const comicio = await db.unaFila("INSERT INTO elecciones.comicios (nombre, tipo_eleccion) VALUES ('t', 'municipal') RETURNING id");
    const mesa = await db.unaFila('INSERT INTO elecciones.mesas (comicio_id, numero) VALUES ($1, 1) RETURNING id, updated_at', [comicio.id]);

    await new Promise((r) => setTimeout(r, 20));
    await db.transaccion((cliente) => repo.actualizarMesa(cliente, mesa.id, { numero: 2 }));

    const despues = await db.unaFila('SELECT updated_at FROM elecciones.mesas WHERE id = $1', [mesa.id]);
    assert.ok(despues.updated_at > mesa.updated_at);
  });

  await t.test('por-familia agrupa por apellido y desglosa lo relevado (019)', async () => {
    const { PadronRepository } = require('../src/modules/padron/repository');
    const repo = new PadronRepository(db);
    const filas = [
      ['30555001', 'FAMILIAX', 'A'], ['30555002', 'FAMILIAX', 'B'], ['30555003', 'FAMILIAX', 'C'],
      ['30555004', 'FAMILIAY', 'A'], ['30555005', 'FAMILIAY', 'B'], ['30555006', 'SOLITARIO', 'A'],
    ];
    for (const [dni, apellido, nombre] of filas) {
      await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ($1, 1980, $2, $3)", [dni, apellido, nombre]);
    }
    await db.query("INSERT INTO padron.relevamientos (dni, opcion_politica) VALUES ('30555001', 'PJ'), ('30555002', 'UCR')");

    const { familias, resumen } = await repo.estadisticasPorFamilia(2, 100);
    const x = familias.find((f) => f.apellido === 'FAMILIAX');
    const y = familias.find((f) => f.apellido === 'FAMILIAY');

    assert.equal(Number(x.total_votantes), 3);
    assert.equal(Number(x.total_relevados), 2);
    assert.equal(Number(x.votos_pj), 1);
    assert.equal(Number(x.votos_ucr), 1);
    assert.equal(Number(y.total_votantes), 2);
    assert.ok(!familias.some((f) => f.apellido === 'SOLITARIO'), 'un apellido de una sola persona no es una familia');
    assert.ok(familias.indexOf(x) < familias.indexOf(y), 'ordenadas por integrantes, de mas a menos');
    assert.ok(resumen.apellidos >= 2 && resumen.personas >= 5);

    const acotado = await repo.estadisticasPorFamilia(2, 1);
    assert.equal(acotado.familias.length, 1, 'el LIMIT lo aplica Postgres');
  });

  await t.test('el exportador recorre todos los lotes por keyset, sin repetir ni saltear filas (003)', async () => {
    const { exportar } = require('../src/modules/padron/exporter');

    // Mas que TAMANO_LOTE (2000) para que haya al menos tres lotes.
    await db.query(`
      INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre)
      SELECT (40000000 + g)::text, 1980, 'EXPORT' || lpad((g % 7)::text, 2, '0'), 'N' || g
      FROM generate_series(1, 4500) g
    `);

    const partes = [];
    const res = { write(c) { partes.push(String(c)); return true; }, end() {}, destroy() {} };
    const escritas = await exportar(db, res, false);

    const lineas = partes.join('').split('\n').filter(Boolean);
    const dnis = lineas.slice(1).map((l) => l.split(',')[0]).filter((d) => d.startsWith('40'));
    assert.equal(new Set(dnis).size, 4500, 'cada fila exportada una sola vez');
    assert.ok(escritas >= 4500);

    const total = (await db.unaFila('SELECT COUNT(*)::int AS n FROM padron.votantes')).n;
    assert.equal(lineas.length - 1, total, 'lo exportado es exactamente lo que hay en la tabla');
    const orden = lineas.slice(1).map((l) => l.split(',').slice(1, 3).join('|'));
    assert.deepEqual(orden, [...orden].sort(), 'sale ordenado por apellido, nombre');
  });

  await t.test('una escritura de relevamiento invalida el cache de resultados (003)', async () => {
    const { PadronService } = require('../src/modules/padron/service');
    const { PadronRepository } = require('../src/modules/padron/repository');
    const auditoria = { async registrarDeRequest() {} };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const servicio = new PadronService(new PadronRepository(db), auditoria, logger, { ttlCacheMs: 60_000 });

    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('30666001', 1970, 'CACHEADO', 'UNO')");
    const antes = await servicio.estadisticasPorCircuito();
    // Una segunda lectura sale del cache, aunque la base cambie por afuera del servicio.
    await db.query("INSERT INTO padron.relevamientos (dni, opcion_politica) VALUES ('30666001', 'PJ')");
    assert.deepEqual(await servicio.estadisticasPorCircuito(), antes, 'dentro del TTL se sirve el cache');

    // Escribir a traves del servicio tiene que invalidarlo.
    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('30666002', 1970, 'CACHEADO', 'DOS')");
    await servicio.actualizarRelevamiento('30666002', { opcionPolitica: 'UCR', version: 0 }, { user: { id: 1 }, headers: {} });
    const despues = await servicio.estadisticasPorCircuito();
    const suma = (filas, campo) => filas.reduce((a, f) => a + Number(f[campo]), 0);
    assert.ok(suma(despues, 'total_relevados') > suma(antes, 'total_relevados'), 'el cache se invalido y refleja lo nuevo');
  });

  await t.test('dos importaciones simultaneas: una corre y la otra recibe 409 (003)', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { importarCsv } = require('../src/modules/padron/importer');

    const ruta = path.join(os.tmpdir(), `padron-concurrente-${process.pid}.csv`);
    const lineas = ['DNI,AÑO NAC,APELLIDO,NOMBRE'];
    for (let i = 0; i < 3000; i += 1) lineas.push(`${41000000 + i},1980,CONCURRENTE,N${i}`);
    fs.writeFileSync(ruta, lineas.join(String.fromCharCode(10)) + String.fromCharCode(10));

    try {
      const resultados = await Promise.allSettled([importarCsv(db, ruta), importarCsv(db, ruta)]);
      const ok = resultados.filter((r) => r.status === 'fulfilled');
      const rechazadas = resultados.filter((r) => r.status === 'rejected');

      assert.equal(ok.length + rechazadas.length, 2);
      assert.ok(ok.length >= 1, 'al menos una importacion termina');
      for (const r of rechazadas) assert.equal(r.reason.status, 409, 'la que pierde recibe 409, no un error de base');
    } finally {
      fs.unlinkSync(ruta);
    }
    const { n } = await db.unaFila("SELECT COUNT(*)::int AS n FROM padron.votantes WHERE apellido = 'CONCURRENTE'");
    assert.equal(n, 3000, 'sin duplicados ni filas perdidas');
  });

  await t.test('sesion unica: un login nuevo invalida el refresh token anterior y se guarda hasheado (G3, 003)', async () => {
    const bcrypt = require('bcryptjs');
    const AuthRepository = require('../src/modules/auth/repository');
    const { AuthService } = require('../src/modules/auth/service');
    const jwtHelper = require('../src/core/security/jwt');

    const repo = new AuthRepository(db);
    const eventos = [];
    const auditoria = { async registrar(e) { eventos.push(e); } };
    const servicio = new AuthService(repo, auditoria, { info() {}, warn() {}, error() {}, debug() {} });

    const rol = await repo.rolPorNombre('consultor');
    await repo.crearUsuario({
      username: 'sesion-unica', passwordHash: await bcrypt.hash('clave-de-prueba-1', 4),
      nombre_completo: 'Sesion Unica', email: null, rolId: rol.id,
    });
    const req = { ip: '127.0.0.1', headers: {} };

    const primera = await servicio.login('sesion-unica', 'clave-de-prueba-1', req);
    const segunda = await servicio.login('sesion-unica', 'clave-de-prueba-1', req);

    await assert.rejects(() => servicio.renovar(primera.refreshToken, req), (e) => e.status === 401,
      'el refresh token de la sesion reemplazada no puede revivirla');

    const guardados = await db.filas(
      'SELECT token FROM refresh_tokens WHERE user_id = (SELECT id FROM usuarios WHERE username = $1)', ['sesion-unica'],
    );
    assert.equal(guardados.length, 1, 'un solo refresh token vivo por usuario');
    assert.notEqual(guardados[0].token, segunda.refreshToken, 'no se guarda el valor crudo');
    assert.equal(guardados[0].token, jwtHelper.hashRefreshToken(segunda.refreshToken));

    await servicio.renovar(segunda.refreshToken, req);
    assert.ok(eventos.some((e) => e.operacion === 'REFRESH'), 'renovar deja el evento REFRESH');
  });

  await t.test('PUT de lista es atomico: si fallan los candidatos, la metadata no cambia (BE-011)', async () => {
    const { ListasRepository } = require('../src/modules/listas/repository');
    const repo = new ListasRepository(db);

    const lista = await repo.crear(
      { nombre: 'Original', tipoEleccion: 'municipal', cantidadLugares: 3 },
      [{ nombre: 'Ana', orden: 1 }, { nombre: 'Beto', orden: 2 }],
    );

    // Dos candidatos con el mismo `orden` violan UNIQUE (lista_id, orden) recien en el
    // INSERT de candidatos, que es despues del UPDATE de la metadata.
    await assert.rejects(() => repo.actualizarCompleta(
      lista.id,
      { nombre: 'Cambiada', tipoEleccion: 'municipal', cantidadLugares: 9 },
      [{ nombre: 'X', orden: 1 }, { nombre: 'Y', orden: 1 }],
    ));

    const despues = await repo.porId(lista.id);
    assert.equal(despues.nombre, 'Original');
    assert.equal(despues.cantidad_lugares, 3);
    assert.deepEqual(despues.candidatos.map((c) => c.nombre), ['Ana', 'Beto']);

    const ok = await repo.actualizarCompleta(
      lista.id,
      { nombre: 'Nueva', tipoEleccion: 'municipal', cantidadLugares: 5 },
      [{ nombre: 'Carla', orden: 1 }],
    );
    assert.equal(ok.lista.nombre, 'Nueva');
    assert.deepEqual(ok.candidatos.map((c) => c.nombre), ['Carla']);
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
