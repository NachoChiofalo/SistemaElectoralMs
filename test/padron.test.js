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

const { filaATsv, escaparCopy } = require('../src/modules/padron/importer');
const { escapar, aLinea, ENCABEZADOS } = require('../src/modules/padron/exporter');
const { PadronService, normalizarCondiciones, aDetalle } = require('../src/modules/padron/service');

const ANIO = 2026;

// ------------------------------------------------------------- importador

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
  await servicio.actualizarRelevamiento('1', { opcionPolitica: 'PJ' }, { ip: '::1', headers: {} });
  await servicio.estadisticas();

  // Sin invalidacion, un relevador guardaria un dato y no lo veria reflejado.
  assert.equal(llamadas, 2);
});

test('una opcion politica fuera de la lista se rechaza con 400', async () => {
  const { servicio } = servicioDePrueba({});

  const error = await servicio
    .actualizarRelevamiento('1', { opcionPolitica: 'OTRO' }, { ip: '::1', headers: {} })
    .catch((e) => e);

  // La columna tiene un CHECK: sin esta validacion el error llegaba como 500 de la base.
  assert.equal(error.status, 400);
  assert.match(error.message, /PJ, UCR, Indeciso/);
});

test('un relevamiento sobre un DNI inexistente devuelve 404', async () => {
  const { servicio } = servicioDePrueba({ async votantePorDni() { return null; } });

  const error = await servicio
    .actualizarRelevamiento('00000000', { opcionPolitica: 'PJ' }, { ip: '::1', headers: {} })
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
