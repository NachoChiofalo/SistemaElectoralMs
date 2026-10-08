/**
 * Tests de scripts/medir-geocodificacion.js (018, factibilidad): la parte que no necesita red
 * ni base. Se arma una calle de este a oeste con dos cuadras y manzanas a cada lado, y se
 * comprueba que cada domicilio caiga del lado correcto aunque la linea este dibujada al revés
 * de la numeracion, que es lo que pasa en el callejero real.
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  repararMojibake, tokens, partirDomicilio, esRural, candidatas, puntoEnPoligono,
  construirIndice, resolver, inferirLocalidad,
} = require('../scripts/medir-geocodificacion');

// Metros -> grados, en la latitud de Alcira.
const LAT0 = -32.75;
const LON0 = -64.33;
const M_LAT = 111320;
const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
const pt = (x, y) => [LON0 + x / M_LON, LAT0 + y / M_LAT];
const caja = (x0, y0, x1, y1) => [[pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)]];

/**
 * GRL PAZ: dos cuadras sobre y = 0, de este a oeste en numeracion creciente (101-199 y 201-299),
 * pero la LINEA de cada tramo esta dibujada de este a oeste, al reves. Al crecer la numeracion
 * (hacia el este) la izquierda es el norte: los impares van al norte y los pares al sur.
 */
function indiceDePrueba() {
  const tramos = [
    { nombre: 'GRL PAZ', aii: 101, afi: 199, aid: 102, afd: 200, camino: [pt(100, 0), pt(0, 0)] },
    { nombre: 'GRL PAZ', aii: 201, afi: 299, aid: 202, afd: 300, camino: [pt(200, 0), pt(100, 0)] },
    // Una calle de una sola cuadra: no hay vecino que diga para donde crece la numeracion.
    { nombre: 'PJE SOLO', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 300), pt(100, 300)] },
    // Dos calles que terminan igual, para el caso del nombre ambiguo.
    { nombre: 'SAN MARTIN', aii: 1, afi: 199, aid: 2, afd: 200, camino: [pt(0, 500), pt(100, 500)] },
    { nombre: 'SAN MARTIN', aii: 201, afi: 399, aid: 202, afd: 400, camino: [pt(100, 500), pt(200, 500)] },
    { nombre: 'MARTIN FIERRO', aii: 1, afi: 199, aid: 2, afd: 200, camino: [pt(0, 700), pt(100, 700)] },
    { nombre: 'MARTIN FIERRO', aii: 201, afi: 399, aid: 202, afd: 400, camino: [pt(100, 700), pt(200, 700)] },
  ];
  const manzanas = [
    { id: 'N_A', anillos: caja(5, 10, 95, 90) },
    { id: 'S_A', anillos: caja(5, -90, 95, -10) },
    { id: 'N_B', anillos: caja(105, 10, 195, 90) },
    { id: 'S_B', anillos: caja(105, -90, 195, -10) },
  ];
  return construirIndice(tramos, manzanas);
}

test('partirDomicilio separa la calle del numero, con o sin numeros en el nombre', () => {
  assert.deepEqual(partirDomicilio('ESTEBAN PIACENZA 596'), { calle: 'ESTEBAN PIACENZA', numero: 596 });
  assert.deepEqual(partirDomicilio('25 DE MAYO 450'), { calle: '25 DE MAYO', numero: 450 });
  assert.deepEqual(partirDomicilio('M MORENO 556'), { calle: 'M MORENO', numero: 556 });
  assert.deepEqual(partirDomicilio('CALLE 5 N° 456'), { calle: 'CALLE 5', numero: 456 });
  assert.deepEqual(partirDomicilio('GRAL PAZ 353 DPTO 4'), { calle: 'GRAL PAZ', numero: 353 });
  assert.equal(partirDomicilio('RUTA 36 S/N'), null);
  // Texto despues del numero: el barrio no es parte del domicilio.
  assert.deepEqual(partirDomicilio('LUTGARDIS RIVEROS GIGENA 274 CENTRO'), { calle: 'LUTGARDIS RIVEROS GIGENA', numero: 274 });
  assert.deepEqual(partirDomicilio('ENTRE RIOS 625 BELLA VISTA'), { calle: 'ENTRE RIOS', numero: 625 });
  assert.deepEqual(partirDomicilio('BVARD ROCA 323 PA'), { calle: 'BVARD ROCA', numero: 323 });
  assert.deepEqual(partirDomicilio('RIO NEGRO 0'), { calle: 'RIO NEGRO', numero: 0 }, 'el 0 es "sin numero" en el padron');
  // Un caracter roto en el propio padron (la enie de PEÑA llega como "Ã‘").
  assert.deepEqual(partirDomicilio('SAENZ PEÃ‘A 150'), { calle: 'SAENZ PENA', numero: 150 });
  assert.equal(partirDomicilio('BARRIO SUR'), null);
  assert.equal(partirDomicilio(''), null);
});

test('esRural reconoce las formas de "zona rural"', () => {
  for (const d of ['zona rural', 'ZONA RURAL', 'Rural', 'CAMPO LA ESPERANZA']) assert.ok(esRural(d), d);
  assert.ok(!esRural('RURALES 123'));
  assert.ok(!esRural('RIVADAVIA 586'));
});

test('el nombre de una calle coincide aunque venga abreviado o con el nombre completo', () => {
  const nombres = ['GRL PAZ', 'MARIANO MORENO', 'DR M SUCARIA', 'GRL SAN MARTIN', 'E ECHEVERRIA'].map((n) => [n, tokens(n)]);
  const mejor = (calle) => candidatas(calle, nombres)[0]?.nombre;

  assert.equal(mejor('GRAL PAZ'), 'GRL PAZ');
  assert.equal(mejor('GRAL JOSE MARIA PAZ'), 'GRL PAZ');
  assert.equal(mejor('M MORENO'), 'MARIANO MORENO');
  assert.equal(mejor('DOCTOR MIGUEL SUCARIA'), 'DR M SUCARIA');
  assert.equal(mejor('GENERAL SAN MARTIN'), 'GRL SAN MARTIN');
  assert.equal(mejor('ESTEBAN ECHEVERRIA'), 'E ECHEVERRIA');
  assert.equal(mejor('AV GRAL PAZ'), 'GRL PAZ', 'el tipo de via no cuenta');
  assert.equal(mejor('INEXISTENTE'), undefined);
});

test('repararMojibake deshace UTF-8 leido como cp1252, una o varias veces', () => {
  assert.equal(repararMojibake('DR ACUÃ‘A'), 'DR ACUÑA');
  assert.equal(repararMojibake('DR ACUÃƒâ€˜A'), 'DR ACUÑA');
  assert.equal(repararMojibake('SAN MARTIN'), 'SAN MARTIN', 'un texto sano no se toca');
  assert.equal(repararMojibake('NUÑEZ'), 'NUÑEZ', 'una enie correcta tampoco');
  assert.equal(tokens('DR ACUÃƒâ€˜A').join(' '), 'DR ACUNA');
});

test('puntoEnPoligono distingue dentro de fuera', () => {
  const anillos = caja(0, 0, 10, 10);
  assert.ok(puntoEnPoligono(pt(5, 5), anillos));
  assert.ok(!puntoEnPoligono(pt(15, 5), anillos));
  assert.ok(!puntoEnPoligono(pt(5, -1), anillos));
});

test('los impares caen al norte y los pares al sur, aunque la linea este dibujada al reves', () => {
  const indice = indiceDePrueba();

  const impar = resolver(indice, 'GRAL PAZ 153');
  assert.equal(impar.estado, 'ok');
  assert.equal(impar.manzana, 'N_A');
  assert.ok(impar.lat > LAT0, 'al norte del eje');
  // 153 esta a 52/98 del camino entre el 101 y el 199: x = 53 m desde el extremo oeste.
  assert.ok(Math.abs((impar.lon - LON0) * M_LON - (100 * 52) / 98) < 1, 'interpolado sobre la cuadra');

  const par = resolver(indice, 'GRAL PAZ 154');
  assert.equal(par.manzana, 'S_A');
  assert.ok(par.lat < LAT0, 'al sur del eje');

  assert.equal(resolver(indice, 'GRAL PAZ 253').manzana, 'N_B', 'la segunda cuadra');
  assert.equal(resolver(indice, 'GRAL PAZ 254').manzana, 'S_B');
});

test('el mismo domicilio escrito de dos maneras da la misma manzana', () => {
  const indice = indiceDePrueba();
  const a = resolver(indice, 'GRAL PAZ 153');
  const b = resolver(indice, 'GRAL JOSE MARIA PAZ 153');
  const c = resolver(indice, 'AV. GRAL. PAZ 153 DPTO 2');
  assert.deepEqual([b.manzana, c.manzana], [a.manzana, a.manzana]);
});

test('invertirLado cambia de vereda; el desplazamiento corta el punto fuera de toda manzana', () => {
  const indice = indiceDePrueba();
  assert.equal(resolver(indice, 'GRAL PAZ 153', { invertirLado: true }).manzana, 'S_A');
  // 5 m del eje sigue siendo calle: no hay manzana ahi.
  assert.equal(resolver(indice, 'GRAL PAZ 153', { offsetM: 5, reintentar: false }).estado, 'sin_manzana');
  // ...pero por defecto se prueba mas lejos (bulevares anchos): 5, 7, 10, 15 m.
  assert.equal(resolver(indice, 'GRAL PAZ 153', { offsetM: 5 }).manzana, 'N_A');
});

test('un numero en la esquina de la cuadra no cae en la calle transversal', () => {
  const indice = indiceDePrueba();
  // 199 es el ultimo de la cuadra (x = 100 m): sin acotar, el punto caeria fuera de la manzana (que llega a 95).
  assert.equal(resolver(indice, 'GRAL PAZ 199').manzana, 'N_A');
  assert.equal(resolver(indice, 'GRAL PAZ 101').manzana, 'N_A');
  assert.equal(resolver(indice, 'GRAL PAZ 200').manzana, 'S_A');
  assert.equal(resolver(indice, 'GRAL PAZ 299').manzana, 'N_B');
});

test('el sentido de la numeracion se deduce aunque las cuadras no se toquen', () => {
  // Hueco de 30 m entre las dos cuadras, y las dos dibujadas al reves.
  const indice = construirIndice([
    { nombre: 'CON HUECO', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(100, 0), pt(0, 0)] },
    { nombre: 'CON HUECO', aii: 101, afi: 199, aid: 102, afd: 200, camino: [pt(230, 0), pt(130, 0)] },
  ], [
    { id: 'N_1', anillos: caja(5, 10, 95, 90) }, { id: 'S_1', anillos: caja(5, -90, 95, -10) },
    { id: 'N_2', anillos: caja(135, 10, 225, 90) }, { id: 'S_2', anillos: caja(135, -90, 225, -10) },
  ]);
  assert.equal(resolver(indice, 'CON HUECO 51').manzana, 'N_1');
  assert.equal(resolver(indice, 'CON HUECO 52').manzana, 'S_1');
  assert.equal(resolver(indice, 'CON HUECO 151').manzana, 'N_2');
  assert.equal(resolver(indice, 'CON HUECO 152').manzana, 'S_2');
});

test('una cuadra aislada de numeracion alta toma el sentido de la cercania al centro', () => {
  const tramos = [
    { nombre: 'GRL PAZ', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 0), pt(100, 0)] },
    { nombre: 'GRL PAZ', aii: 101, afi: 199, aid: 102, afd: 200, camino: [pt(100, 0), pt(200, 0)] },
    // Lejos del centro y sin vecinas: dibujada de lejos hacia cerca. El numero menor esta del lado del centro.
    { nombre: 'LEJOS', aii: 601, afi: 699, aid: 602, afd: 700, camino: [pt(1100, 0), pt(1000, 0)] },
    // Una cuadra baja aislada NO se estima: la regla no es confiable ahi.
    { nombre: 'BAJA', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 400), pt(100, 400)] },
  ];
  const manzanas = [{ id: 'N_L', anillos: caja(1005, 10, 1095, 90) }, { id: 'S_L', anillos: caja(1005, -90, 1095, -10) }];

  const con = construirIndice(tramos, manzanas);
  const impar = resolver(con, 'LEJOS 651');
  assert.equal(impar.manzana, 'N_L', 'creciendo hacia el este, los impares quedan al norte');
  assert.equal(impar.estimado, true, 'queda marcado como estimado');
  assert.equal(resolver(con, 'LEJOS 652').manzana, 'S_L');
  assert.equal(resolver(con, 'BAJA 51').estado, 'sentido_ambiguo');

  const sin = construirIndice(tramos, manzanas, { estimarSentido: false });
  assert.equal(resolver(sin, 'LEJOS 651').estado, 'sentido_ambiguo');
});

test('los nombres reales del padron de Alcira coinciden con el callejero', () => {
  const nombres = ['SAENZ PENA', 'SANTIAGO DEL ESTERO', 'ASTOR PIAZZOLA', 'MARTIN DE GUEMES', 'GIGENA RIVEROS', 'DR ACUNA',
    'MTRA DIAZ PEREZ', 'BV ROCA', 'ENTRE RIOS', 'JUAN JOSE PASO', 'GRL PAZ'].map((n) => [n, tokens(n)]);
  const mejor = (calle) => candidatas(calle, nombres)[0];

  assert.equal(mejor('SAENZ PEÃ‘A').nombre, 'SAENZ PENA', 'la enie rota en el padron');
  assert.equal(mejor('SGO DEL ESTERO').nombre, 'SANTIAGO DEL ESTERO');
  assert.equal(mejor('STGO DEL ESTERO').nombre, 'SANTIAGO DEL ESTERO');
  assert.equal(mejor('ASTOR PIAZOLA').nombre, 'ASTOR PIAZZOLA', 'una letra de menos');
  assert.equal(mejor('INTENDENTE ACUÃ‘A').nombre, 'DR ACUNA', 'el titulo no cuenta');
  assert.equal(mejor('INTENDENTE DR ACUNA').nombre, 'DR ACUNA');
  assert.equal(mejor('MAESTRA DIAZ DE PEREZ').nombre, 'MTRA DIAZ PEREZ');
  assert.equal(mejor('BVARD ROCA').nombre, 'BV ROCA');

  assert.equal(mejor('GRAL PAZ').aproximada, false);

  // Parecidas por el apellido: por defecto NO se ofrecen (podrian ser otra calle)...
  for (const calle of ['M MIGUEL DE GUEMES', 'LUTGARDIS RIVEROS', 'JUAN PEREZ']) assert.deepEqual(candidatas(calle, nombres), [], calle);
  // ...y pedidas expresamente salen marcadas.
  const aprox = (calle) => candidatas(calle, nombres, true)[0];
  assert.deepEqual([aprox('M MIGUEL DE GUEMES').nombre, aprox('M MIGUEL DE GUEMES').aproximada], ['MARTIN DE GUEMES', true]);
  assert.deepEqual([aprox('LUTGARDIS RIVEROS').nombre, aprox('LUTGARDIS RIVEROS').aproximada], ['GIGENA RIVEROS', true]);
  // Un nombre de pila en comun no alcanza.
  assert.deepEqual(candidatas('JUAN MARTINEZ', nombres, true), []);
});

test('una calle parecida queda pendiente con la sugerencia, salvo que se acepte', () => {
  const indice = construirIndice([
    { nombre: 'MTRA DIAZ PEREZ', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 0), pt(100, 0)] },
    { nombre: 'MTRA DIAZ PEREZ', aii: 101, afi: 199, aid: 102, afd: 200, camino: [pt(100, 0), pt(200, 0)] },
  ], []);

  const r = resolver(indice, 'JUAN PEREZ 50');
  assert.equal(r.estado, 'calle_parecida');
  assert.match(r.clave, /JUAN PEREZ\s+->\s+MTRA DIAZ PEREZ/);
  assert.equal(r.lat, undefined, 'no se inventa un punto');

  assert.notEqual(resolver(indice, 'JUAN PEREZ 50', { aceptarParecidas: true }).estado, 'calle_parecida');
  assert.equal(resolver(indice, 'OTRA COSA 50').estado, 'calle_no_encontrada', 'sin ningun parecido sigue siendo no encontrada');
});

test('esquinas y numero 0 no se tratan como un punto de una cuadra', () => {
  const indice = construirIndice([
    { nombre: 'LIBERTAD', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 0), pt(100, 0)] },
    { nombre: 'AVELLANEDA', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 200), pt(100, 200)] },
    { nombre: 'RIO NEGRO', aii: 1, afi: 99, aid: 2, afd: 100, camino: [pt(0, 400), pt(100, 400)] },
  ], []);
  const estado = (d) => resolver(indice, d).estado;

  assert.equal(estado('LIBERTAD Y AVELLANEDA'), 'esquina');
  assert.equal(estado('LIBERTAD/AVELLANEDA'), 'esquina');
  assert.equal(estado('LIBERTAD Y AVELLANEDA S/N CENTRO'), 'esquina');
  assert.equal(estado('RIO NEGRO 0'), 'sin_altura');
  assert.equal(estado('RIO NEGRO S/N'), 'sin_numero');
  // Una calle de una sola cuadra no tiene vecina que diga para donde crece la numeracion.
  assert.equal(estado('LIBERTAD 50'), 'sentido_ambiguo', 'una calle normal sigue su camino');
});

test('lo que no se puede resolver queda pendiente con su motivo, sin inventar un punto', () => {
  const indice = indiceDePrueba();
  const estado = (d) => resolver(indice, d).estado;

  assert.equal(estado('zona rural'), 'sin_domicilio');
  assert.equal(estado(''), 'sin_domicilio');
  assert.equal(estado(null), 'sin_domicilio');
  assert.equal(estado('BARRIO SUR'), 'sin_numero');
  assert.equal(estado('RIVADAVIA 586'), 'calle_no_encontrada');
  assert.equal(estado('GRAL PAZ 999'), 'sin_tramo');
  assert.equal(estado('PJE SOLO 50'), 'sentido_ambiguo');
  assert.equal(estado('MARTIN 100'), 'calle_ambigua', 'SAN MARTIN y MARTIN FIERRO por igual');

  for (const d of ['zona rural', 'RIVADAVIA 586', 'GRAL PAZ 999', 'PJE SOLO 50']) {
    assert.equal(resolver(indice, d).lat, undefined, `${d} no devuelve coordenadas`);
  }
});

test('una calle con nombre completo no se confunde con otra que lo contiene', () => {
  const indice = indiceDePrueba();
  // En esta prueba no hay manzanas junto a estas calles: lo que importa es QUE calle se eligio.
  assert.equal(resolver(indice, 'SAN MARTIN 100').calle, 'SAN MARTIN');
  assert.equal(resolver(indice, 'MARTIN FIERRO 100').calle, 'MARTIN FIERRO');
  assert.equal(resolver(indice, 'GENERAL SAN MARTIN 100').calle, 'SAN MARTIN', 'el titulo no impide la coincidencia');
});

test('inferirLocalidad toma la mas frecuente de los circuitos', () => {
  const r = inferirLocalidad([
    { circuito: '162 - ALCIRA', votantes: 40 },
    { circuito: '163 - ALCIRA', votantes: 10 },
    { circuito: '170 - BERROTARAN', votantes: 5 },
    { circuito: null, votantes: 3 },
  ]);
  assert.equal(r.elegida, 'ALCIRA');
  assert.deepEqual(r.todas.map(([n]) => n), ['ALCIRA', 'BERROTARAN']);
  assert.equal(inferirLocalidad([{ circuito: 'sin guion', votantes: 1 }]).elegida, null);
});
