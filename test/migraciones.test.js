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
    // territorio (018) depende de padron: se borra primero para no dejar tablas huerfanas.
    await db.query('DROP SCHEMA IF EXISTS territorio CASCADE');
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

  await t.test('sembraron los roles y los 17 permisos esperados', async () => {
    const roles = await db.filas('SELECT nombre FROM roles ORDER BY nombre');
    assert.deepEqual(roles.map((r) => r.nombre), ['administrador', 'consultor', 'encargado_relevamiento']);

    const { total } = await db.unaFila('SELECT COUNT(*)::int AS total FROM permisos');
    assert.equal(total, 17, '16 + territorio.view (018)');

    const { total: totalAdmin } = await db.unaFila(`
      SELECT COUNT(*)::int AS total FROM rol_permisos rp
      JOIN roles r ON r.id = rp.rol_id
      WHERE r.nombre = 'administrador'
    `);
    assert.equal(totalAdmin, 17, 'el administrador tiene que tener los 17 permisos');
  });

  await t.test('territorio (018): el mapa es solo del administrador', async () => {
    const conPermiso = await db.filas(`
      SELECT r.nombre FROM rol_permisos rp
      JOIN roles r ON r.id = rp.rol_id JOIN permisos p ON p.id = rp.permiso_id
      WHERE p.codigo = 'territorio.view' ORDER BY r.nombre`);
    assert.deepEqual(conPermiso.map((r) => r.nombre), ['administrador']);
  });

  await t.test('territorio (018): esquema, configuracion por defecto y la regla ubicado <=> manzana', async () => {
    const conf = await db.unaFila('SELECT umbral_privacidad, etiqueta_barrio FROM territorio.configuracion');
    assert.deepEqual(conf, { umbral_privacidad: 10, etiqueta_barrio: 'Radio censal' });

    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('39000001', 1980, 'MAPA', 'UNO')");
    await db.query("INSERT INTO territorio.manzanas (id, anillos) VALUES (1, '[]')");
    // Un pendiente con manzana, o un ubicado sin manzana, los rechaza la base.
    await assert.rejects(
      db.query("INSERT INTO territorio.ubicaciones (dni, estado, manzana_id) VALUES ('39000001', 'sin_tramo', 1)"),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      db.query("INSERT INTO territorio.ubicaciones (dni, estado) VALUES ('39000001', 'ok')"),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      db.query("INSERT INTO territorio.ubicaciones (dni, estado) VALUES ('39000001', 'otro_estado')"),
      (e) => e.code === '23514',
    );
    await db.query("INSERT INTO territorio.ubicaciones (dni, estado, manzana_id) VALUES ('39000001', 'ok', 1)");

    // Borrar al votante borra su ubicacion; recargar una manzana la invalida.
    await db.query("DELETE FROM territorio.manzanas WHERE id = 1");
    assert.equal((await db.unaFila("SELECT COUNT(*)::int AS n FROM territorio.ubicaciones WHERE dni = '39000001'")).n, 0);
    await db.query("INSERT INTO territorio.ubicaciones (dni, estado) VALUES ('39000001', 'sin_domicilio')");
    await db.query("DELETE FROM padron.votantes WHERE dni = '39000001'");
    assert.equal((await db.unaFila("SELECT COUNT(*)::int AS n FROM territorio.ubicaciones WHERE dni = '39000001'")).n, 0);
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

    const { familias, resumen } = await repo.estadisticasPorFamilia(2, 100, ['PJ', 'UCR', 'Indeciso']);
    const x = familias.find((f) => f.apellido === 'FAMILIAX');
    const y = familias.find((f) => f.apellido === 'FAMILIAY');

    assert.equal(Number(x.total_votantes), 3);
    assert.equal(Number(x.total_relevados), 2);
    assert.equal(x.votos.PJ, 1);
    assert.equal(x.votos.UCR, 1);
    assert.equal(x.votos.Indeciso, 0);
    assert.equal(x.porcentajes.PJ, 50);
    assert.equal(Number(y.total_votantes), 2);
    assert.ok(!familias.some((f) => f.apellido === 'SOLITARIO'), 'un apellido de una sola persona no es una familia');
    assert.ok(familias.indexOf(x) < familias.indexOf(y), 'ordenadas por integrantes, de mas a menos');
    assert.ok(resumen.apellidos >= 2 && resumen.personas >= 5);

    const acotado = await repo.estadisticasPorFamilia(2, 1, ['PJ', 'UCR', 'Indeciso']);
    assert.equal(acotado.familias.length, 1, 'el LIMIT lo aplica Postgres');
  });

  await t.test('opciones politicas (021): se siembran y reemplazan al CHECK de la columna', async () => {
    const filas = await db.filas('SELECT codigo, color, es_neutra FROM padron.opciones_politicas ORDER BY orden');
    assert.deepEqual(filas.map((f) => f.codigo), ['PJ', 'UCR', 'Indeciso']);
    assert.equal(filas.filter((f) => f.es_neutra).length, 1, 'hay exactamente una opcion neutra');
    assert.equal(filas.find((f) => f.es_neutra).color, null, 'la neutra no lleva color');

    const checks = await db.filas(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'padron.relevamientos'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%opcion_politica%'`,
    );
    assert.equal(checks.length, 0, 'el CHECK con las tres opciones escritas ya no existe');

    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('30800001', 1980, 'FK', 'PRUEBA')");
    await assert.rejects(
      db.query("INSERT INTO padron.relevamientos (dni, opcion_politica) VALUES ('30800001', 'NO-EXISTE')"),
      (e) => e.code === '23503',
      'una opcion inexistente la rechaza la clave foranea',
    );
  });

  await t.test('opciones politicas (021): una instancia con otras opciones funciona de punta a punta', async () => {
    const { PadronService } = require('../src/modules/padron/service');
    const { PadronRepository } = require('../src/modules/padron/repository');
    const auditoria = { eventos: [], async registrarDeRequest(req, e) { this.eventos.push(e); } };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const servicio = new PadronService(new PadronRepository(db), auditoria, logger, { ttlCacheMs: 60_000 });
    const req = { user: { id: 1, username: 'admin' }, headers: {} };

    // Un codigo con espacio y tilde: viaja como clave de un objeto JSON y como parametro SQL.
    const creada = await servicio.opciones.crear({ codigo: 'Frente Cívico', etiqueta: 'Frente Cívico', color: 3 }, req);
    assert.equal(creada.color, 3);
    assert.equal(creada.orden, 4, 'va al final');
    assert.ok(auditoria.eventos.some((e) => e.entidad === 'opcion_politica' && e.operacion === 'CREAR'));

    await assert.rejects(
      servicio.opciones.crear({ codigo: 'frente cívico', etiqueta: 'otra', color: 4 }, req),
      (e) => e.status === 409,
      'dos codigos que solo difieren en mayusculas son la misma opcion',
    );

    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('30800002', 1980, 'OPCION', 'NUEVA')");
    const antes = await servicio.estadisticasAvanzadas();
    assert.ok('Frente Cívico' in antes.votos, 'la opcion nueva aparece en el resultado aunque no tenga votos');

    await servicio.actualizarRelevamiento('30800002', { opcionPolitica: 'Frente Cívico', version: 0 }, req);
    const despues = await servicio.estadisticasAvanzadas();
    assert.equal(despues.votos['Frente Cívico'], 1);
    assert.equal(Number(despues.total_relevados), Number(antes.total_relevados) + 1, 'cache invalidado al escribir');
    assert.ok(despues.porcentajes['Frente Cívico'] > 0);

    const basicas = await servicio.estadisticas();
    assert.deepEqual(Object.keys(basicas.estadisticasPoliticas), ['PJ', 'UCR', 'Indeciso', 'Frente Cívico']);
    assert.equal(basicas.estadisticasPoliticas['Frente Cívico'], 1);

    // Las demas agregaciones tambien traen una clave por opcion.
    for (const f of await servicio.estadisticasPorSexo()) assert.ok('Frente Cívico' in f.votos);
    for (const f of await servicio.estadisticasPorCircuito()) assert.ok('Frente Cívico' in f.votos);
    const rangos = await servicio.estadisticasPorRangoEtario();
    assert.ok(rangos.length > 0 && rangos.every((f) => 'Frente Cívico' in f.votos));
    const cond = await servicio.estadisticasCondicionesDetalladas();
    for (const clave of ['empleados_por_opcion', 'ayuda_social_por_opcion', 'nuevos_por_opcion', 'fallecidos_por_opcion']) {
      assert.deepEqual(Object.keys(cond[clave]).sort(), ['Frente Cívico', 'Indeciso', 'PJ', 'UCR']);
    }

    // Un votante sin relevamiento previo queda en la opcion neutra al cargar solo un telefono.
    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('30800003', 1980, 'SOLO', 'TELEFONO')");
    const nuevo = await servicio.actualizarRelevamiento('30800003', { telefono: '3511234', version: 0 }, req);
    assert.equal(nuevo.opcion_politica, 'Indeciso');

    // Un relevamiento con una opcion invalida es un 400, no un 500 de la base.
    await assert.rejects(
      servicio.actualizarRelevamiento('30800002', { opcionPolitica: 'OTRA', version: 2 }, req),
      (e) => e.status === 400 && /Frente Cívico/.test(e.message),
    );
  });

  await t.test('opciones politicas (021): editar, y los borrados que no se permiten', async () => {
    const { PadronService } = require('../src/modules/padron/service');
    const { PadronRepository } = require('../src/modules/padron/repository');
    const auditoria = { async registrarDeRequest() {} };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const servicio = new PadronService(new PadronRepository(db), auditoria, logger, { ttlCacheMs: 60_000 });
    const req = { user: { id: 1, username: 'admin' }, headers: {} };

    const editada = await servicio.opciones.actualizar('Frente Cívico', { etiqueta: 'Frente Cívico 2027', color: 5 }, req);
    assert.deepEqual([editada.etiqueta, editada.color], ['Frente Cívico 2027', 5]);
    assert.equal(editada.codigo, 'Frente Cívico', 'el codigo no cambia');

    await assert.rejects(servicio.opciones.actualizar('Frente Cívico', { codigo: 'otro' }, req), (e) => e.status === 400);
    await assert.rejects(servicio.opciones.actualizar('Indeciso', { color: 4 }, req), (e) => e.status === 400, 'la neutra no lleva color');
    await assert.rejects(servicio.opciones.actualizar('no-existe', { etiqueta: 'x' }, req), (e) => e.status === 404);

    await assert.rejects(servicio.opciones.eliminar('Indeciso', req), (e) => e.status === 409, 'la neutra no se borra');
    await assert.rejects(
      servicio.opciones.eliminar('Frente Cívico', req),
      (e) => e.status === 409 && /1 relevamiento/.test(e.message),
      'una opcion con relevamientos no se borra',
    );

    // Sin relevamientos, si.
    await servicio.opciones.crear({ codigo: 'Temporal', etiqueta: 'Temporal', color: 6 }, req);
    await servicio.opciones.eliminar('Temporal', req);
    assert.ok(!(await servicio.opciones.codigos()).includes('Temporal'));

    // La clave foranea es la red de seguridad si algo se saltea el servicio.
    await assert.rejects(
      db.query("DELETE FROM padron.opciones_politicas WHERE codigo = 'Frente Cívico'"),
      (e) => e.code === '23503',
    );
  });

  await t.test('opciones politicas (021): padron/009 es idempotente y respeta lo que ya hay', async () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '../src/modules/padron/migrations/009_opciones_politicas.sql'), 'utf8',
    );
    await db.query("UPDATE padron.opciones_politicas SET etiqueta = 'Editada a mano' WHERE codigo = 'PJ'");
    await db.query(sql);
    await db.query(sql);
    const pj = await db.unaFila("SELECT etiqueta FROM padron.opciones_politicas WHERE codigo = 'PJ'");
    assert.equal(pj.etiqueta, 'Editada a mano', 'volver a correrla no pisa la configuracion de la instancia');
    await db.query("UPDATE padron.opciones_politicas SET etiqueta = 'PJ' WHERE codigo = 'PJ'");
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

  await t.test('el username no distingue mayusculas ni espacios, y el indice impide duplicados (BE-040)', async () => {
    const AuthRepository = require('../src/modules/auth/repository');
    const repo = new AuthRepository(db);
    const rol = await repo.rolPorNombre('consultor');

    await repo.crearUsuario({ username: 'DaianaPrueba', passwordHash: 'x', nombre_completo: 'D', email: null, rolId: rol.id });

    assert.ok(await repo.porUsername('daianaprueba'), 'el login encuentra la cuenta en minusculas');
    assert.ok(await repo.existeUsername('DAIANAPRUEBA'), 'existeUsername ignora las mayusculas');
    assert.equal((await repo.porUsername('daianaprueba')).username, 'DaianaPrueba', 'se conserva el nombre guardado');

    await assert.rejects(
      () => repo.crearUsuario({ username: 'daianaprueba', passwordHash: 'x', nombre_completo: 'D2', email: null, rolId: rol.id }),
      (error) => error.code === '23505',
      'el indice unico sobre LOWER(username) debe rechazar la variante',
    );
  });

  await t.test('exportar el padron es solo del administrador: el encargado ya no tiene padron.export (BE-024)', async () => {
    const tiene = async (rol) => (await db.unaFila(
      `SELECT COUNT(*)::int AS n FROM rol_permisos rp
         JOIN roles r ON r.id = rp.rol_id JOIN permisos p ON p.id = rp.permiso_id
        WHERE r.nombre = $1 AND p.codigo = 'padron.export'`, [rol],
    )).n;
    assert.equal(await tiene('encargado_relevamiento'), 0);
    assert.equal(await tiene('administrador'), 1);
  });

  await t.test('las fechas de auth y padron son TIMESTAMPTZ y el rol del usuario es obligatorio (DB-004, DB-018)', async () => {
    const sinZona = await db.filas(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS col
         FROM information_schema.columns
        WHERE data_type = 'timestamp without time zone'
          AND table_schema IN ('public', 'padron')`,
    );
    assert.deepEqual(sinZona.map((f) => f.col), [], 'no deberia quedar ningun TIMESTAMP sin zona en auth ni padron');

    await assert.rejects(
      () => db.query("INSERT INTO usuarios (username, password_hash, nombre_completo) VALUES ('sin-rol', 'x', 'Sin Rol')"),
      (error) => error.code === '23502',
      'un usuario sin rol deberia violar el NOT NULL',
    );
  });

  await t.test('los rangos etarios salen de anio_nac, no de la edad guardada en el archivo (DB-005)', async () => {
    const { PadronRepository } = require('../src/modules/padron/repository');
    const repo = new PadronRepository(db);
    const anioActual = new Date().getFullYear();

    const contar = async () => {
      const por = {};
      for (const f of await repo.estadisticasPorRangoEtario(['PJ', 'UCR', 'Indeciso'])) por[f.rango_etario] = Number(f.total_votantes);
      return por;
    };
    const antes = await contar();

    // edad = 99 es la que "dice el archivo"; por anio_nac tiene 40 y cae en 31-45, no en 60+.
    await db.query(
      `INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre, edad)
       VALUES ('90000001', $1, 'EdadVieja', 'Prueba', 99)`, [anioActual - 40],
    );
    const despues = await contar();
    await db.query("DELETE FROM padron.votantes WHERE dni = '90000001'");

    assert.equal((despues['31-45'] || 0) - (antes['31-45'] || 0), 1, 'debe sumar al rango 31-45');
    assert.equal((despues['60+'] || 0) - (antes['60+'] || 0), 0, 'no debe sumar a 60+ por la edad guardada');
  });

  await t.test('borrar una mesa o un votante con datos asociados falla en la base (G2)', async () => {
    const { ComicioRepository } = require('../src/modules/comicio/repository');
    const repo = new ComicioRepository(db);

    const comicio = await db.unaFila("INSERT INTO elecciones.comicios (nombre, tipo_eleccion) VALUES ('g2', 'municipal') RETURNING id");
    const fuerza = await db.unaFila("INSERT INTO elecciones.fuerzas (nombre) VALUES ('Fuerza G2') RETURNING id");
    const conVotos = await db.unaFila('INSERT INTO elecciones.mesas (comicio_id, numero) VALUES ($1, 1) RETURNING id', [comicio.id]);
    const vacia = await db.unaFila('INSERT INTO elecciones.mesas (comicio_id, numero) VALUES ($1, 2) RETURNING id', [comicio.id]);
    await db.query('INSERT INTO elecciones.votos_fuerza (mesa_id, fuerza_id, cantidad) VALUES ($1, $2, 10)', [conVotos.id, fuerza.id]);

    assert.equal(await repo.mesaTieneVotos(conVotos.id), true);
    assert.equal(await repo.mesaTieneVotos(vacia.id), false);
    assert.equal(await repo.contarMesasConVotos(comicio.id), 1);

    await assert.rejects(
      () => db.query('DELETE FROM elecciones.mesas WHERE id = $1', [conVotos.id]),
      (error) => error.code === '23503' && /still referenced/.test(error.detail),
      'RESTRICT: la base no deja borrar una mesa con votos',
    );
    await db.query('DELETE FROM elecciones.mesas WHERE id = $1', [vacia.id]); // sin votos se borra

    // Reemplazar los votos sigue andando: es un DELETE de las propias filas.
    await repo.reemplazarVotos(conVotos.id, { blancos: 0, nulos: 0, porFuerza: [{ fuerzaId: fuerza.id, cantidad: 5 }] });

    // Fiscales asignados: la mesa tampoco se borra.
    const fiscal = await db.unaFila("INSERT INTO elecciones.fiscales (nombre) VALUES ('Fiscal G2') RETURNING id");
    await db.query("INSERT INTO elecciones.fiscal_asignaciones (mesa_id, fiscal_id, desde, hasta) VALUES ($1, $2, '08:00', '12:00')", [conVotos.id, fiscal.id]);
    assert.equal(await repo.contarAsignacionesDeMesa(conVotos.id), 1);
    assert.equal(await repo.contarMesasConAsignaciones(comicio.id), 1);
    const sinVotos = await db.unaFila('INSERT INTO elecciones.mesas (comicio_id, numero) VALUES ($1, 3) RETURNING id', [comicio.id]);
    await db.query("INSERT INTO elecciones.fiscal_asignaciones (mesa_id, fiscal_id, desde, hasta) VALUES ($1, $2, '13:00', '15:00')", [sinVotos.id, fiscal.id]);
    await assert.rejects(
      () => db.query('DELETE FROM elecciones.mesas WHERE id = $1', [sinVotos.id]),
      (error) => error.code === '23503' && /still referenced/.test(error.detail),
      'RESTRICT: la base no deja borrar una mesa con fiscales asignados',
    );

    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre) VALUES ('90000077', 1980, 'G2', 'Prueba')");
    await db.query("INSERT INTO padron.relevamientos (dni, opcion_politica) VALUES ('90000077', 'PJ')");
    await assert.rejects(
      () => db.query("DELETE FROM padron.votantes WHERE dni = '90000077'"),
      (error) => error.code === '23503' && /still referenced/.test(error.detail),
      'RESTRICT: no se borra un votante con relevamiento',
    );
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

  // ------------------------------------------------------------ territorio (018)
  // Una calle de dos cuadras (GRL PAZ, dibujada al reves de la numeracion) con una manzana a cada lado de
  // cada cuadra, y dos radios: R1 al oeste, R2 al este. Coordenadas en metros alrededor de Alcira.
  const territorio = (() => {
    const LAT0 = -32.75; const LON0 = -64.33; const M = 111320;
    const pt = (x, y) => [LON0 + x / (M * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + y / M];
    const caja = (x0, y0, x1, y1) => [[pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)]];
    return {
      tramos: [
        { nombre: 'GRL PAZ', aii: 101, afi: 199, aid: 102, afd: 200, camino: [pt(100, 0), pt(0, 0)] },
        { nombre: 'GRL PAZ', aii: 201, afi: 299, aid: 202, afd: 300, camino: [pt(200, 0), pt(100, 0)] },
      ],
      manzanas: [
        { id: 9001, anillos: caja(5, 10, 95, 90) }, { id: 9002, anillos: caja(5, -90, 95, -10) },
        { id: 9003, anillos: caja(105, 10, 195, 90) }, { id: 9004, anillos: caja(105, -90, 195, -10) },
      ],
      sectores: [
        { codigo: 'R1', nombre: 'Radio 1.1', anillos: caja(0, -100, 100, 100), poblacion: 50, viviendas: 20 },
        { codigo: 'R2', nombre: 'Radio 1.2', anillos: caja(100, -100, 200, 100), poblacion: 40, viviendas: 15 },
      ],
    };
  })();
  const territorioDeps = () => {
    const { TerritorioRepository } = require('../src/modules/territorio/repository');
    const { TerritorioService } = require('../src/modules/territorio/service');
    const { asignarSectores } = require('../src/modules/territorio/capas');
    const repo = new TerritorioRepository(db);
    return { repo, asignarSectores, TerritorioService };
  };
  const cargarTerritorio = async () => {
    const { repo, asignarSectores } = territorioDeps();
    await db.transaccion((cliente) => repo.reemplazarCapas(cliente, {
      ...territorio, asignacion: asignarSectores(territorio.manzanas, territorio.sectores),
      configuracion: { localidad: 'PRUEBA', fuente: 'test' },
    }));
  };

  await t.test('territorio (018): cargar las capas dos veces deja exactamente lo mismo, con los ids de origen', async () => {
    await cargarTerritorio();
    const foto = async () => db.unaFila(`
      SELECT (SELECT COUNT(*)::int FROM territorio.calles_tramos) AS tramos,
             (SELECT string_agg(m.id || ':' || s.codigo, ',' ORDER BY m.id) FROM territorio.manzanas m
                JOIN territorio.sectores s ON s.id = m.sector_id) AS manzanas,
             (SELECT localidad FROM territorio.configuracion) AS localidad`);
    const primera = await foto();
    await cargarTerritorio();
    assert.deepEqual(await foto(), primera);
    assert.deepEqual(primera, { tramos: 2, manzanas: '9001:R1,9002:R1,9003:R2,9004:R2', localidad: 'PRUEBA' });
  });

  await t.test('territorio (018): reubicar ubica, explica los pendientes, es idempotente y no pierde a nadie', async () => {
    const { repo, TerritorioService } = territorioDeps();
    const servicio = new TerritorioService(repo, { db, logger: null });

    // 2.500 votantes sinteticos: tres lotes de guardado.
    await db.query(`
      INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre, domicilio, sexo)
      SELECT (77000000 + g)::text, 1980, 'MAPA', 'N' || g,
             CASE g % 5 WHEN 0 THEN 'GRAL PAZ 153' WHEN 1 THEN 'GRAL PAZ 154' WHEN 2 THEN 'GRL PAZ 253'
                        WHEN 3 THEN 'zona rural' ELSE 'GRAL PAZ 0' END,
             CASE WHEN g % 2 = 0 THEN 'F' ELSE 'M' END
      FROM generate_series(1, 2500) g`);

    const r = await servicio.reubicar();
    const { n: totalVotantes } = await db.unaFila('SELECT COUNT(*)::int AS n FROM padron.votantes');
    const { n: totalUbicaciones } = await db.unaFila('SELECT COUNT(*)::int AS n FROM territorio.ubicaciones');
    assert.equal(r.total, totalVotantes);
    assert.equal(totalUbicaciones, totalVotantes, 'ninguno perdido ni repetido');

    const de = async (dni) => db.unaFila('SELECT estado, manzana_id, detalle, lat, calle, numero FROM territorio.ubicaciones WHERE dni = $1', [dni]);
    const impar = await de('77000005');
    assert.deepEqual([impar.estado, impar.manzana_id, impar.detalle, impar.calle, impar.numero], ['ok', '9001', null, 'GRL PAZ', 153]);
    assert.ok(impar.lat > -32.75, 'con coordenadas, al norte del eje (latitud mayor)');
    assert.equal((await de('77000001')).manzana_id, '9002', 'el par, enfrente');
    assert.equal((await de('77000002')).manzana_id, '9003', 'la segunda cuadra');
    const rural = await de('77000003');
    assert.deepEqual([rural.estado, rural.manzana_id, rural.lat], ['sin_domicilio', null, null], 'un pendiente no tiene punto');
    assert.deepEqual([(await de('77000004')).estado, (await de('77000004')).detalle], ['sin_altura', 'GRL PAZ']);

    const huella = async () => (await db.unaFila(
      "SELECT md5(string_agg(dni || estado || COALESCE(manzana_id::text, ''), ',' ORDER BY dni)) AS h FROM territorio.ubicaciones",
    )).h;
    const antes = await huella();
    await servicio.reubicar();
    assert.equal(await huella(), antes, 'idempotente');

    const [a, b] = await Promise.all([servicio.reubicar(), servicio.reubicar()]);
    assert.equal(a.ubicados, b.ubicados, 'dos simultaneas no se pisan');
  });

  await t.test('territorio (018): un votante nuevo queda sin calcular, e importar un CSV lo ubica solo', async () => {
    const fsx = require('fs');
    const os = require('os');
    const path = require('path');
    const { repo, TerritorioService } = territorioDeps();
    const { PadronService } = require('../src/modules/padron/service');
    const { PadronRepository } = require('../src/modules/padron/repository');
    const auditoria = { async registrarDeRequest() {} };
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const padron = new PadronService(new PadronRepository(db), auditoria, logger, { ttlCacheMs: 60_000 });
    const territorioServicio = new TerritorioService(repo, { db, padron, auditoria, logger });
    // Lo mismo que hace module.js al registrarse.
    padron.alCambiar((tipo) => { territorioServicio.invalidarCache(); if (tipo === 'importacion') territorioServicio.reubicarEnSegundoPlano(); });

    await db.query("INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre, domicilio) VALUES ('77900001', 1980, 'A', 'MANO', 'GRAL PAZ 155')");
    const estados = async () => Object.fromEntries((await repo.resumenUbicacion()).map((x) => [x.estado, x.votantes]));
    assert.equal((await estados()).sin_calcular, 1);

    const archivo = path.join(os.tmpdir(), `territorio-${Date.now()}.csv`);
    fsx.writeFileSync(archivo, 'DNI,ANO NAC,APELLIDO,NOMBRE,DOMICILIO\n77900002,1980,B,CSV,GRAL PAZ 157\n');
    try {
      await padron.importar(archivo, 'territorio.csv', { headers: {} });
    } finally {
      fsx.unlinkSync(archivo);
    }
    await territorioServicio.enCurso;
    const nuevo = await db.unaFila("SELECT estado, manzana_id FROM territorio.ubicaciones WHERE dni = '77900002'");
    assert.deepEqual(nuevo, { estado: 'ok', manzana_id: '9001' });
    assert.equal((await estados()).sin_calcular, undefined, 'el recalculo alcanzo tambien al cargado a mano');
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
