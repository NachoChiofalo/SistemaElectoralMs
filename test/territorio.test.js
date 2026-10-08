/**
 * Tests del modulo territorio (018) que no necesitan base ni red: descarga de capas con un `fetch`
 * falso, asignacion de manzanas a radios censales, umbral de privacidad y contrato del servicio.
 * La logica de ubicacion de un domicilio tiene su propio archivo (geocodificacion.test.js).
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { descargarLocalidad, asignarSectores, centroide, pedir } = require('../src/modules/territorio/capas');

const cuadrado = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];

/**
 * Un portal falso: responde segun la capa pedida y el offset. Registra cada URL para poder comprobar
 * que se pidio lo que se tenia que pedir (y nada del padron).
 */
function portalFalso(respuestas, { fallasPrevias = 0 } = {}) {
  const urls = [];
  let fallas = fallasPrevias;
  const fetch = async (url) => {
    urls.push(url);
    if (fallas > 0) { fallas -= 1; throw new Error('timeout simulado'); }
    const capa = decodeURIComponent(url.match(/services\/([^/]+)\/FeatureServer/)[1]);
    const offset = Number(new URL(url).searchParams.get('resultOffset') || 0);
    const r = respuestas[capa];
    const cuerpo = typeof r === 'function' ? r(offset) : r;
    return { json: async () => cuerpo };
  };
  return { fetch, urls };
}

const tramo = (nombre, aii, afi, aid, afd, paths) => ({ attributes: { NAM: nombre, NAM_LC: 'ALCIRA', NAM_DE: 'RIO CUARTO', AII: aii, AFI: afi, AID: aid, AFD: afd }, geometry: { paths } });

function portalDeAlcira() {
  return portalFalso({
    // Dos paginas de calles: el servicio avisa que hay mas con exceededTransferLimit.
    Visualizador_de_calles: (offset) => (offset === 0
      ? { features: [tramo('GRL PAZ', 101, 199, 102, 200, [[[-64.34, -32.75], [-64.339, -32.75]]])], exceededTransferLimit: true }
      : { features: [tramo('DR ACUÃ‘A', 1, 99, 2, 100, [[[-64.338, -32.751], [-64.337, -32.751]]])] }),
    Manzanas_callejero: { features: [
      { attributes: { ID: 58600 }, geometry: { rings: cuadrado(-64.3399, -32.7499, -64.3391, -32.7491) } },
      { attributes: { ID: 'no-es-numero' }, geometry: { rings: cuadrado(0, 0, 1, 1) } },
    ] },
    Radios2022: { features: [
      { attributes: { LINK: '140980302', CFN: 3, CRO: 2, POB_2022: 412, VIVIENDAS: 170 }, geometry: { rings: cuadrado(-64.35, -32.76, -64.33, -32.74) } },
    ] },
  });
}

test('descargarLocalidad junta las paginas, repara los nombres y normaliza las tres capas', async () => {
  const { fetch, urls } = portalDeAlcira();
  const capas = await descargarLocalidad('Alcira', { fetch, pausaMs: 0 });

  assert.deepEqual(capas.tramos.map((t) => t.nombre), ['GRL PAZ', 'DR ACUÑA'], 'las dos paginas, con la enie reparada');
  assert.equal(capas.tramos[0].aii, 101);
  assert.equal(capas.tramos[0].camino.length, 2);

  assert.deepEqual(capas.manzanas.map((m) => m.id), [58600], 'el id es numerico; uno invalido se descarta');
  assert.equal(capas.sectores.length, 1);
  assert.deepEqual(
    { codigo: capas.sectores[0].codigo, nombre: capas.sectores[0].nombre, poblacion: capas.sectores[0].poblacion },
    { codigo: '140980302', nombre: 'Radio 3.2', poblacion: 412 },
  );
  assert.deepEqual(capas.localidades, ['ALCIRA (RIO CUARTO)']);

  // Se pidio por nombre de localidad (sin acentos, en mayusculas) y despues por envolvente.
  const calles = urls.filter((u) => u.includes('Visualizador_de_calles'));
  assert.equal(calles.length, 2, 'una consulta por pagina');
  assert.match(decodeURIComponent(calles[0]).replace(/\+/g, ' '), /NAM_LC LIKE '%ALCIRA%'/);
  assert.ok(urls.some((u) => u.includes('Manzanas_callejero') && u.includes('esriGeometryEnvelope')));
  assert.ok(urls.every((u) => u.includes('outSR=4326')), 'coordenadas en grados');
});

test('el nombre de la localidad no puede romper la consulta', async () => {
  const { fetch, urls } = portalDeAlcira();
  await descargarLocalidad("D'Alcira Ñandú", { fetch, pausaMs: 0, departamento: 'Río Cuarto' });
  const where = decodeURIComponent(urls[0]).match(/where=([^&]*)/)[1].replace(/\+/g, ' ');
  assert.match(where, /NAM_LC LIKE '%D''ALCIRA NANDU%'/, 'comilla escapada, sin acentos');
  assert.match(where, /NAM_DE LIKE '%RIO CUARTO%'/);
});

test('una localidad sin calles da un error que dice que hacer', async () => {
  const { fetch } = portalFalso({ Visualizador_de_calles: { features: [] } });
  await assert.rejects(descargarLocalidad('Inexistente', { fetch, pausaMs: 0 }), /No hay calles para la localidad "Inexistente"/);
});

test('pedir reintenta ante una falla de red y ante un error del servicio, y despues avisa', async () => {
  const conRed = portalFalso({ Manzanas_callejero: { features: [] } }, { fallasPrevias: 2 });
  const ok = await pedir('Manzanas_callejero', {}, { fetch: conRed.fetch, pausaMs: 0 });
  assert.deepEqual(ok.features, []);
  assert.equal(conRed.urls.length, 3, 'dos fallas y un acierto');

  const caido = portalFalso({ Manzanas_callejero: { error: { message: 'Service unavailable' } } });
  await assert.rejects(
    pedir('Manzanas_callejero', {}, { fetch: caido.fetch, pausaMs: 0 }),
    /No se pudo consultar la capa Manzanas_callejero.*Service unavailable/,
  );
  assert.equal(caido.urls.length, 3);
});

test('cada manzana va al radio que contiene su centroide; si ninguno, queda sin barrio', () => {
  const sectores = [
    { codigo: 'A', anillos: cuadrado(0, 0, 10, 10) },
    { codigo: 'B', anillos: cuadrado(10, 0, 20, 10) },
  ];
  const manzanas = [
    { id: 1, anillos: cuadrado(1, 1, 4, 4) },
    { id: 2, anillos: cuadrado(12, 1, 15, 4) },
    // Cruza el limite: cuenta donde cae su centroide (x = 10.5 -> B).
    { id: 3, anillos: cuadrado(9, 1, 12, 4) },
    { id: 4, anillos: cuadrado(30, 30, 31, 31) },
  ];
  const r = asignarSectores(manzanas, sectores);
  assert.deepEqual([...r.entries()], [[1, 'A'], [2, 'B'], [3, 'B'], [4, null]]);
});

test('centroide de area, y el promedio si el poligono no tiene area', () => {
  assert.deepEqual(centroide(cuadrado(0, 0, 4, 2)), [2, 1]);
  assert.deepEqual(centroide([[[1, 1], [3, 1], [1, 1]]]), [5 / 3, 1]);
});
