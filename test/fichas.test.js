const test = require('node:test');
const assert = require('node:assert/strict');
const { crear } = require('../public/src/lib/fichas');

const esperar = ms => new Promise(r => setTimeout(r, ms));

test('la version desconocida es 0 y solo se registran enteros >= 0', () => {
  const f = crear();
  assert.equal(f.version('1'), 0);
  f.recordar('1', 3);
  f.recordar(1, 'basura');
  f.recordar(1, -2);
  assert.equal(f.version(1), 3, 'el DNI como numero o texto es la misma ficha');
});

test('dos escrituras sobre el mismo DNI no se solapan y la segunda sale con la version de la primera', async () => {
  const f = crear();
  f.recordar('10', 1);
  let enVuelo = 0, maximo = 0;
  const enviadas = [];

  const escribir = () => f.enCola('10', async () => {
    enviadas.push(f.version('10'));
    enVuelo++; maximo = Math.max(maximo, enVuelo);
    await esperar(20);
    enVuelo--;
    f.recordar('10', f.version('10') + 1);
  });

  await Promise.all([escribir(), escribir(), escribir()]);
  assert.equal(maximo, 1);
  assert.deepEqual(enviadas, [1, 2, 3]);
  assert.equal(f.ocupado('10'), false);
});

test('DNIs distintos no se esperan entre si', async () => {
  const f = crear();
  let enVuelo = 0, maximo = 0;
  const tarea = () => async () => { enVuelo++; maximo = Math.max(maximo, enVuelo); await esperar(20); enVuelo--; };
  await Promise.all([f.enCola('1', tarea()), f.enCola('2', tarea())]);
  assert.equal(maximo, 2);
});

test('una escritura que falla no traba las siguientes de esa ficha', async () => {
  const f = crear();
  const primera = f.enCola('5', async () => { throw new Error('timeout'); });
  const segunda = f.enCola('5', async () => 'ok');
  await assert.rejects(primera, /timeout/);
  assert.equal(await segunda, 'ok');
  assert.equal(f.ocupado('5'), false);
});
