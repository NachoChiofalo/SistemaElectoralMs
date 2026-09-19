/**
 * Tests del modulo padron: transformacion del CSV, formato del CSV exportado,
 * normalizacion del detalle y cache de resultados.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');

const { importarCsv, filaATsv, escaparCopy, LOCK_IMPORTACION } = require('../src/modules/padron/importer');
const { escapar, aLinea, ENCABEZADOS } = require('../src/modules/padron/exporter');
const { PadronService, normalizarCondiciones, aDetalle } = require('../src/modules/padron/service');

const ANIO = 2026;

// ------------------------------------------------------------- importador

/** Cliente falso que anota las consultas y responde lo que le digan al advisory lock. */
function clienteFalso({ lockObtenido }) {
  const consultas = [];
  const cliente = {
    async query(texto) {
      consultas.push(String(texto).replace(/\s+/g, ' ').trim());
      if (String(texto).includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ obtenido: lockObtenido }] };
      }
      return { rows: [{ insertadas: 0, actualizadas: 0 }] };
    },
    release() { cliente.liberado = true; },
    liberado: false,
  };
  return { db: { conexion: async () => cliente }, cliente, consultas };
}

test('si ya hay una importacion en curso, la segunda responde 409 y no copia nada', async () => {
  const { db, cliente, consultas } = clienteFalso({ lockObtenido: false });

  const error = await importarCsv(db, __filename).catch((e) => e);

  assert.equal(error.status, 409);
  // Lo que importa: no llego a crear la temporal ni a tocar padron.votantes.
  assert.ok(!consultas.some((c) => c.includes('CREATE TEMP TABLE')));
  assert.ok(consultas.includes('ROLLBACK'));
  // Y soltó la conexión: sin esto, unas cuantas importaciones rechazadas secan el pool.
  assert.equal(cliente.liberado, true);
});

test('el lock se pide dentro de la transaccion, para que se suelte solo', async () => {
  const { db, consultas } = clienteFalso({ lockObtenido: false });

  await importarCsv(db, __filename).catch(() => {});

  // xact_lock se libera al terminar la transaccion, incluido un ROLLBACK o una caida
  // del proceso. Pedido fuera de una transaccion habria que soltarlo a mano.
  assert.equal(consultas[0], 'BEGIN');
  assert.ok(consultas[1].includes('pg_try_advisory_xact_lock'));
});

test('la clave del advisory lock es fija: dos procesos tienen que pedir la misma', () => {
  assert.equal(typeof LOCK_IMPORTACION, 'number');
  assert.ok(Number.isInteger(LOCK_IMPORTACION));
});


test('una fila del CSV oficial se convierte a TSV con la edad calculada', () => {
  const fila = {
    DNI: '16194886',
    'AÑO NAC': '1963',
    APELLIDO: 'ABATANEO',
    NOMBRE: 'ALICIA GRACIELA',
    DOMICILIO: 'ESTEBAN PIACENZA 596',
    TIPO_EJEMPL: 'DNI-EA',
    CIRCUITO: '162 - ALCIRA',
    S: 'F',
  };

  const campos = filaATsv(fila, ANIO).split('\t');

  assert.deepEqual(campos, [
    '16194886', '1963', 'ABATANEO', 'ALICIA GRACIELA',
    'ESTEBAN PIACENZA 596', 'DNI-EA', '162 - ALCIRA', 'F', String(ANIO - 1963),
  ]);
});

test('acepta tambien los encabezados internos, como hacia el importador viejo', () => {
  const fila = { dni: '30111222', anio_nac: '1983', apellido: 'PEREZ', nombre: 'JUAN', sexo: 'M' };

  const campos = filaATsv(fila, ANIO).split('\t');

  assert.equal(campos[0], '30111222');
  assert.equal(campos[1], '1983');
  assert.equal(campos[7], 'M');
});

test('descarta las filas que no se pueden cargar en vez de romper el COPY', () => {
  const invalidas = [
    { 'AÑO NAC': '1980', APELLIDO: 'X', NOMBRE: 'Y' },                       // sin DNI
    { DNI: '1', 'AÑO NAC': 'ochenta', APELLIDO: 'X', NOMBRE: 'Y' },          // anio no numerico
    { DNI: '2', 'AÑO NAC': '1980', NOMBRE: 'Y' },                            // sin apellido
    { DNI: '3', 'AÑO NAC': '1980', APELLIDO: 'X' },                          // sin nombre
    { DNI: '', 'AÑO NAC': '1980', APELLIDO: 'X', NOMBRE: 'Y' },              // DNI vacio
  ];

  for (const fila of invalidas) {
    assert.equal(filaATsv(fila, ANIO), null, JSON.stringify(fila));
  }
});

test('un sexo fuera de M/F entra como NULL y no viola el CHECK de la columna', () => {
  const base = { DNI: '9', 'AÑO NAC': '1990', APELLIDO: 'X', NOMBRE: 'Y' };

  assert.equal(filaATsv({ ...base, S: 'X' }, ANIO).split('\t')[7], '\\N');
  assert.equal(filaATsv({ ...base, S: '' }, ANIO).split('\t')[7], '\\N');
  assert.equal(filaATsv({ ...base, S: 'F' }, ANIO).split('\t')[7], 'F');
});

test('los caracteres de control se escapan para el formato COPY', () => {
  // Sin escapar, un tab o un salto de linea en el domicilio correrian las columnas.
  assert.equal(escaparCopy('CALLE\tFALSA'), 'CALLE\\tFALSA');
  assert.equal(escaparCopy('linea1\nlinea2'), 'linea1\\nlinea2');
  assert.equal(escaparCopy('c:\\ruta'), 'c:\\\\ruta');
  assert.equal(escaparCopy(null), '\\N');
  assert.equal(escaparCopy(''), '\\N');
});

test('un domicilio con tab no desplaza las columnas del TSV', () => {
  const fila = {
    DNI: '5', 'AÑO NAC': '1970', APELLIDO: 'X', NOMBRE: 'Y',
    DOMICILIO: 'SAN\tMARTIN 100', S: 'M',
  };

  const campos = filaATsv(fila, ANIO).split('\t');

  assert.equal(campos.length, 9);
  assert.equal(campos[4], 'SAN\\tMARTIN 100');
  assert.equal(campos[7], 'M');
});

// -------------------------------------------------------------- exportador

test('el CSV exportado escapa comas, comillas y saltos de linea', () => {
  assert.equal(escapar('ALCIRA, CORDOBA'), '"ALCIRA, CORDOBA"');
  assert.equal(escapar('dijo "si"'), '"dijo ""si"""');
  assert.equal(escapar('linea1\nlinea2'), '"linea1\nlinea2"');
  assert.equal(escapar('ABATANEO'), 'ABATANEO');
  assert.equal(escapar(null), '');
  assert.equal(escapar(0), '0');
});

test('cada linea exportada tiene tantos campos como encabezados', () => {
  const fila = {
    dni: '16194886', apellido: 'ABATANEO', nombre: 'ALICIA', anio_nac: 1963,
    domicilio: 'PIACENZA 596', tipo_ejemplar: 'DNI-EA', circuito: '162 - ALCIRA',
    sexo: 'F', edad: 63, opcion_politica: 'PJ', observacion: 'sin novedad',
    fecha_relevamiento: '2026-03-01T10:00:00Z', fecha_modificacion: null,
    es_nuevo_votante: false, esta_fallecido: false, es_empleado_municipal: true,
    recibe_ayuda_social: false, observaciones_detalle: '', fecha_detalle: null,
    telefono: '3512345678',
  };

  const campos = aLinea(fila).split(',');

  assert.equal(campos.length, ENCABEZADOS.length);
  assert.equal(campos[15], 'Si');  // es empleado municipal
  assert.equal(campos[14], 'No');  // no esta fallecido
  assert.equal(campos[12], '');    // fecha_modificacion nula
});

// ----------------------------------------------------- detalle de votante

test('las condiciones se aceptan en camelCase y en snake_case', () => {
  assert.deepEqual(
    normalizarCondiciones({ esNuevoVotante: true, recibe_ayuda_social: true }),
    {
      esNuevoVotante: true,
      estaFallecido: false,
      esEmpleadoMunicipal: false,
      recibeAyudaSocial: true,
      observacionesDetalle: '',
    },
  );
});

test('las condiciones ausentes quedan en false, no en undefined', () => {
  const normalizadas = normalizarCondiciones({});
  assert.deepEqual(Object.values(normalizadas), [false, false, false, false, '']);
});

test('el detalle mantiene la forma que consume el frontend', () => {
  const detalle = aDetalle({
    dni: '123', es_nuevo_votante: true, esta_fallecido: null,
    es_empleado_municipal: false, recibe_ayuda_social: 't',
    observaciones_detalle: null, fecha_detalle: '2026-05-01T00:00:00Z',
  });

  assert.deepEqual(detalle, {
    dni: '123',
    esNuevoVotante: true,
    estaFallecido: false,
    esEmpleadoMunicipal: false,
    recibeAyudaSocial: true,
    observacionesDetalle: '',
    fechaCreacion: '2026-05-01T00:00:00Z',
    fechaModificacion: '2026-05-01T00:00:00Z',
  });
});

// ------------------------------------------------------ cache y validacion

function servicioDePrueba(repo = {}) {
  const auditoria = { eventos: [], async registrarDeRequest(req, e) { this.eventos.push(e); } };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  return { servicio: new PadronService(repo, auditoria, logger, { ttlCacheMs: 10_000 }), auditoria };
}

test('las estadisticas se calculan una sola vez mientras el cache este vigente', async () => {
  let llamadas = 0;
  const { servicio } = servicioDePrueba({
    async estadisticasBasicas() {
      llamadas += 1;
      return { total_votantes: '5512', total_relevados: '1200', votos_pj: '600', votos_ucr: '400', votos_indeciso: '200' };
    },
  });

  const primera = await servicio.estadisticas();
  const segunda = await servicio.estadisticas();

  assert.equal(llamadas, 1, 'la segunda lectura tiene que salir del cache');
  assert.deepEqual(primera, segunda);
  assert.equal(primera.totalVotantes, 5512);
  assert.equal(primera.porcentajeRelevados, 21.77);
  assert.equal(primera.sinRelevar, 4312);
  assert.deepEqual(primera.estadisticasPoliticas, { PJ: 600, UCR: 400, Indeciso: 200 });
});

test('guardar un relevamiento invalida el cache de resultados', async () => {
  let llamadas = 0;
  const { servicio } = servicioDePrueba({
    async estadisticasBasicas() {
      llamadas += 1;
      return { total_votantes: '10', total_relevados: '1' };
    },
    async votantePorDni() { return { dni: '1' }; },
    async upsertRelevamiento() { return { dni: '1', opcion_politica: 'PJ' }; },
  });

  await servicio.estadisticas();
  await servicio.actualizarRelevamiento('1', { opcionPolitica: 'PJ', version: 1 }, { ip: '::1', headers: {} });
  await servicio.estadisticas();

  // Sin invalidacion, un relevador guardaria un dato y no lo veria reflejado.
  assert.equal(llamadas, 2);
});

// ------------------------------------------------- escritura parcial (012)

/** Un repo falso que solo recuerda con que campos lo llamaron. */
function repoQueRecuerda(extra = {}) {
  const visto = {};
  const repo = {
    async votantePorDni() { return { dni: '1' }; },
    async upsertRelevamiento(dni, campos) {
      visto.dni = dni;
      visto.campos = campos;
      return { dni, ...campos };
    },
    ...extra,
  };
  return { repo, visto };
}

test('un campo ausente viaja como null, para que la base no lo toque', async () => {
  const { repo, visto } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento('1', { telefono: '3511234', version: 1 }, { ip: '::1', headers: {} });

  // opcion_politica y observacion en null es lo que el COALESCE del upsert lee como
  // "dejar como esta". Si viajaran como '' se vaciarian los campos de otra persona.
  assert.equal(visto.campos.opcion_politica, null);
  assert.equal(visto.campos.observacion, null);
  assert.equal(visto.campos.telefono, '3511234');
});

test('una cadena vacia vacia el campo; la clave ausente no lo toca', async () => {
  const { repo, visto } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento('1', { observacion: '', version: 1 }, { ip: '::1', headers: {} });

  // Esta es la distincion que sostiene toda la escritura parcial: son dos intenciones
  // distintas y no pueden colapsar en el mismo valor.
  assert.equal(visto.campos.observacion, '');
  assert.equal(visto.campos.telefono, null);
});

test('se puede guardar telefono y observacion en una sola escritura', async () => {
  const { repo, visto } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento(
    '1',
    { telefono: '3511234', observacion: 'no estaba', version: 1 },
    { ip: '::1', headers: {} },
  );

  // El panel mandaba estos dos campos como dos escrituras en paralelo, cada una con el
  // valor viejo del otro: una pisaba a la otra.
  assert.equal(visto.campos.telefono, '3511234');
  assert.equal(visto.campos.observacion, 'no estaba');
  assert.equal(visto.campos.opcion_politica, null);
});

test('la opcion politica ya no es obligatoria para escribir un relevamiento', async () => {
  const { repo } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  // Antes esto era un 400: cargar un telefono obligaba a leer y reenviar la opcion.
  const relevamiento = await servicio.actualizarRelevamiento(
    '1', { telefono: '3511234', version: 1 }, { ip: '::1', headers: {} },
  );

  assert.equal(relevamiento.telefono, '3511234');
});

test('un cuerpo sin ningun campo conocido es 400 y no escribe nada', async () => {
  let escrituras = 0;
  const { repo } = repoQueRecuerda({
    async upsertRelevamiento() { escrituras += 1; return {}; },
  });
  const { servicio } = servicioDePrueba(repo);

  const error = await servicio
    .actualizarRelevamiento('1', {}, { ip: '::1', headers: {} })
    .catch((e) => e);

  // Un PUT vacio es un error del cliente, no un no-op silencioso.
  assert.equal(error.status, 400);
  assert.equal(escrituras, 0);
});

test('la auditoria registra que campos se tocaron, no el valor de uno solo', async () => {
  const { repo } = repoQueRecuerda();
  const { servicio, auditoria } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento('1', { telefono: '351', version: 1 }, { ip: '::1', headers: {} });

  const evento = auditoria.eventos.at(-1);
  assert.equal(evento.operacion, 'ACTUALIZAR_RELEVAMIENTO');
  assert.match(evento.detalles, /telefono/);
  assert.doesNotMatch(evento.detalles, /undefined/);
});

// ------------------------------------------------- autoria y cambios (012 fase 2)

test('la firma del autor sale del request y llega al repositorio', async () => {
  const { repo, visto } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento(
    '1',
    { telefono: '351', version: 1 },
    { ip: '::1', headers: {}, user: { id: 7, username: 'jperez' } },
  );

  // El repositorio no conoce req: la traduccion a columnas pasa una sola vez, aca.
  assert.equal(visto.campos.actualizado_por, 7);
  assert.equal(visto.campos.actualizado_por_username, 'jperez');
});

test('sin usuario en el request la firma queda en null, no en un nombre inventado', async () => {
  const { repo, visto } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento('1', { telefono: '351', version: 1 }, { ip: '::1', headers: {} });

  assert.equal(visto.campos.actualizado_por, null);
  assert.equal(visto.campos.actualizado_por_username, null);
});

test('la firma no cuenta como campo: un cuerpo vacio sigue siendo 400', async () => {
  const { repo } = repoQueRecuerda();
  const { servicio } = servicioDePrueba(repo);

  const error = await servicio
    .actualizarRelevamiento('1', {}, { ip: '::1', headers: {}, user: { id: 7, username: 'jperez' } })
    .catch((e) => e);

  assert.equal(error.status, 400);
});

test('el relevamiento incluye quien lo edito por ultima vez', async () => {
  const { servicio } = servicioDePrueba({
    async votantePorDni() {
      return {
        dni: '1', opcion_politica: 'PJ', observacion: 'x', telefono: '351',
        actualizado_por: 7, actualizado_por_username: 'jperez',
      };
    },
  });

  const relevamiento = await servicio.relevamientoPorDni('1');

  // Es lo que el panel muestra al abrirse: quien va a cargar ve primero que alguien
  // ya toco esta ficha.
  assert.equal(relevamiento.actualizadoPor, 'jperez');
});

test('cambiosDesde devuelve los DNIs tocados, con su autor', async () => {
  let recibido;
  const { servicio } = servicioDePrueba({
    async dnisModificadosDesde(desde) {
      recibido = desde;
      return [{ dni: '1', cambiado_en: '2026-09-18T10:00:00Z', actualizado_por_username: 'jperez' }];
    },
  });

  const resultado = await servicio.cambiosDesde('2026-09-18T09:00:00.000Z');

  assert.ok(recibido instanceof Date);
  assert.deepEqual(resultado.cambios, [
    { dni: '1', cambiadoEn: '2026-09-18T10:00:00Z', actualizadoPor: 'jperez' },
  ]);
  assert.equal(resultado.desde, '2026-09-18T09:00:00.000Z');
});

test('un desde invalido es 400 y no llega a consultar la base', async () => {
  let consultas = 0;
  const { servicio } = servicioDePrueba({
    async dnisModificadosDesde() { consultas += 1; return []; },
  });

  const error = await servicio.cambiosDesde('ayer').catch((e) => e);

  assert.equal(error.status, 400);
  assert.equal(consultas, 0);
});

// ------------------------------------------ concurrencia optimista (012 fase 1)

/**
 * Repo falso con una fila de relevamiento en memoria que se comporta como el upsert
 * real: chequea la version, no escribe si nada cambia, e incrementa al aplicar.
 */
function repoConVersion(fila = { dni: '1', opcion_politica: 'Indeciso', observacion: '', telefono: '', version: 1 }) {
  const estado = { ...fila };

  const repo = {
    async votantePorDni() { return { ...estado }; },
    async relevamientoCrudo() { return { ...estado }; },
    async upsertRelevamiento(dni, campos) {
      const { version_esperada } = campos;
      if (version_esperada !== null && version_esperada !== undefined
          && Number(version_esperada) !== Number(estado.version)) {
        return null;
      }

      const propuesto = {
        opcion_politica: campos.opcion_politica ?? estado.opcion_politica,
        observacion: campos.observacion ?? estado.observacion,
        telefono: campos.telefono ?? estado.telefono,
      };

      const cambia = Object.entries(propuesto).some(([k, v]) => v !== estado[k]);
      if (!cambia) return null;

      Object.assign(estado, propuesto, {
        version: estado.version + 1,
        actualizado_por_username: campos.actualizado_por_username ?? null,
      });
      return { ...estado };
    },
  };

  return { repo, estado };
}

const REQ = (username) => ({ ip: '::1', headers: {}, user: { id: 1, username } });

test('con la version correcta la escritura se aplica y la version sube en uno', async () => {
  const { repo, estado } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  const guardado = await servicio.actualizarRelevamiento(
    '1', { observacion: 'la mia', version: 1 }, REQ('ana'),
  );

  assert.equal(guardado.version, 2);
  assert.equal(estado.observacion, 'la mia');
});

test('con una version vieja la escritura NO se aplica y sale 409', async () => {
  const { repo, estado } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  // Alguien ya escribio: la fila quedo en la version 2.
  await servicio.actualizarRelevamiento('1', { observacion: 'de ana', version: 1 }, REQ('ana'));

  const error = await servicio
    .actualizarRelevamiento('1', { observacion: 'de juan', version: 1 }, REQ('juan'))
    .catch((e) => e);

  assert.equal(error.status, 409);
  // Lo que importa tanto como el 409: la observacion de ana sigue ahi.
  assert.equal(estado.observacion, 'de ana');
});

test('el 409 trae el estado del servidor, con la misma forma que una lectura', async () => {
  const { repo } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento('1', { observacion: 'de ana', version: 1 }, REQ('ana'));

  const error = await servicio
    .actualizarRelevamiento('1', { observacion: 'de juan', version: 1 }, REQ('juan'))
    .catch((e) => e);

  // Sin esto la UI no puede mostrar contra que se choco, y la persona solo ve un error.
  assert.equal(error.detalles.actual.observacion, 'de ana');
  assert.equal(error.detalles.actual.actualizadoPor, 'ana');
  assert.equal(error.detalles.actual.version, 2);
});

test('dos escrituras con la misma version: una entra, la otra es 409', async () => {
  const { repo } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  // Sin await entre una y otra. Ojo con lo que este test prueba y lo que no: verifica
  // que el SERVICE resuelve bien las dos respuestas, con un repo falso que imita el
  // WHERE del upsert. Que Postgres serialice de verdad dos ON CONFLICT DO UPDATE sobre
  // la misma fila solo se puede probar contra una base real — es la tarea 1.6, que
  // espera al item 003 (tests de integracion).
  const resultados = await Promise.allSettled([
    servicio.actualizarRelevamiento('1', { observacion: 'de ana', version: 1 }, REQ('ana')),
    servicio.actualizarRelevamiento('1', { observacion: 'de juan', version: 1 }, REQ('juan')),
  ]);

  const ok = resultados.filter((r) => r.status === 'fulfilled');
  const conflictos = resultados.filter((r) => r.status === 'rejected' && r.reason.status === 409);

  assert.equal(ok.length, 1);
  assert.equal(conflictos.length, 1);
});

test('guardar lo mismo dos veces no mueve la version ni cuenta como conflicto', async () => {
  const { repo, estado } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  await servicio.actualizarRelevamiento('1', { observacion: 'igual', version: 1 }, REQ('ana'));
  const segunda = await servicio.actualizarRelevamiento('1', { observacion: 'igual', version: 2 }, REQ('ana'));

  // Un guardado sin cambios no es una edicion: no mueve la firma ni le marca la fila
  // como novedad a los demas.
  assert.equal(segunda.version, 2);
  assert.equal(estado.version, 2);
});

test('sin version no se escribe nada: es 400, no una escritura a ciegas', async () => {
  const { repo, estado } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  const error = await servicio
    .actualizarRelevamiento('1', { observacion: 'a ciegas' }, REQ('ana'))
    .catch((e) => e);

  // El riesgo que cubre este test es un no-op silencioso: con `WHERE version = NULL`
  // la escritura no matchea nunca, asi que sin esta validacion la respuesta seria 200
  // y no se habria guardado nada.
  assert.equal(error.status, 400);
  assert.equal(estado.observacion, '');
});

test('una version que no es entero se rechaza', async () => {
  const { repo } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  const error = await servicio
    .actualizarRelevamiento('1', { observacion: 'x', version: 'dos' }, REQ('ana'))
    .catch((e) => e);

  assert.equal(error.status, 400);
});

test('version 0 significa "lei que no habia relevamiento" y choca si alguien lo creo', async () => {
  const { repo } = repoConVersion();
  const { servicio } = servicioDePrueba(repo);

  // La fila ya existe en version 1: alguien la creo mientras esta persona miraba la
  // tabla, donde figuraba sin relevamiento.
  const error = await servicio
    .actualizarRelevamiento('1', { observacion: 'de juan', version: 0 }, REQ('juan'))
    .catch((e) => e);

  assert.equal(error.status, 409);
});

test('el conflicto se loguea: es el dato con el que se decide el item 014', async () => {
  const { repo } = repoConVersion();
  const registros = [];
  const auditoria = { eventos: [], async registrarDeRequest(req, e) { this.eventos.push(e); } };
  const logger = { info(msg, datos) { registros.push({ msg, datos }); }, warn() {}, error() {}, debug() {} };
  const servicio = new PadronService(repo, auditoria, logger, { ttlCacheMs: 10_000 });

  await servicio.actualizarRelevamiento('1', { observacion: 'de ana', version: 1 }, REQ('ana'));
  await servicio
    .actualizarRelevamiento('1', { observacion: 'de juan', version: 1 }, REQ('juan'))
    .catch(() => {});

  const conflicto = registros.find((r) => r.msg.includes('Conflicto de edicion'));
  assert.ok(conflicto);
  assert.equal(conflicto.datos.usuario, 'juan');
  assert.equal(conflicto.datos.ultimaEdicionDe, 'ana');
});

test('una opcion politica fuera de la lista se rechaza con 400', async () => {
  const { servicio } = servicioDePrueba({});

  const error = await servicio
    .actualizarRelevamiento('1', { opcionPolitica: 'OTRO', version: 1 }, { ip: '::1', headers: {} })
    .catch((e) => e);

  // La columna tiene un CHECK: sin esta validacion el error llegaba como 500 de la base.
  assert.equal(error.status, 400);
  assert.match(error.message, /PJ, UCR, Indeciso/);
});

test('un relevamiento sobre un DNI inexistente devuelve 404', async () => {
  const { servicio } = servicioDePrueba({ async votantePorDni() { return null; } });

  const error = await servicio
    .actualizarRelevamiento('00000000', { opcionPolitica: 'PJ', version: 1 }, { ip: '::1', headers: {} })
    .catch((e) => e);

  assert.equal(error.status, 404);
});

test('el estado deduce csvCargado de la base y no de una variable en memoria', async () => {
  const { servicio } = servicioDePrueba({
    async contarVotantes() { return 5512; },
    async estadisticasBasicas() { return { total_relevados: '1200' }; },
  });

  const estado = await servicio.estado();

  // Antes era un flag de instancia que volvia a false en cada reinicio del proceso.
  assert.equal(estado.csvCargado, true);
  assert.equal(estado.votantesCargados, 5512);
  assert.equal(estado.relevamientosRegistrados, 1200);
});

test('el limite por pagina tiene un techo', async () => {
  let limiteRecibido;
  const { servicio } = servicioDePrueba({
    async votantesPaginados(pagina, limite) {
      limiteRecibido = limite;
      return { votantes: [], total: 0, pagina, limite, totalPaginas: 0 };
    },
  });

  await servicio.votantesPaginados(1, { limite: 1_000_000 });

  // Sin techo, ?limite=1000000 traeria el padron entero a memoria en cada request.
  assert.equal(limiteRecibido, 500);
});
