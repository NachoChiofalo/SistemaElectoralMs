/**
 * Tests de listas electorales (item 017): el service con un repositorio falso (no
 * necesita base) y las rutas reales detras de un usuario fijo (mismo patron que
 * permisos.test.js), para confirmar que el permiso correcto gatea cada verbo.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { manejadorErrores, manejadorNoEncontrado } = require('../src/core/errors');
const { ListasService, TOPE_CANDIDATOS } = require('../src/modules/listas/service');
const construirRutas = require('../src/modules/listas/routes');

const DATOS_VALIDOS = { nombre: 'Lista 1', tipoEleccion: 'municipal', cantidadLugares: 5 };
const CANDIDATOS_VALIDOS = [
  { nombre: 'Ana', orden: 1 },
  { nombre: 'Beto', orden: 2 },
];

function repoFalso(inicial = null) {
  let guardada = inicial;
  let auditoriaLlamadas = [];

  const repo = {
    async crear(datos, candidatos) {
      guardada = { id: 1, ...datos, candidatos: [...candidatos].sort((a, b) => a.orden - b.orden) };
      return guardada;
    },
    async porId(id) {
      return guardada && guardada.id === id ? guardada : null;
    },
    async listar({ page, limit }) {
      const registros = guardada
        ? [{ ...guardada, candidatos_count: guardada.candidatos.length, candidatos: undefined }]
        : [];
      return { registros, total: guardada ? 1 : 0, page, limit };
    },
    async actualizarDatos(id, datos) {
      guardada = { ...guardada, ...datos, id };
      return guardada;
    },
    async reemplazarCandidatos(id, candidatos) {
      const ordenados = [...candidatos].sort((a, b) => a.orden - b.orden);
      guardada = { ...guardada, candidatos: ordenados };
      return ordenados;
    },
    async eliminar(id) {
      const existia = guardada && guardada.id === id;
      if (existia) guardada = null;
      return existia;
    },
  };

  const auditoria = {
    async registrarDeRequest(req, datos) {
      auditoriaLlamadas.push(datos);
    },
  };

  return { repo, auditoria, llamadas: () => auditoriaLlamadas };
}

// ---- service.js, sin base ----

test('crear una lista valida devuelve los candidatos ordenados', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  const lista = await servicio.crear({}, DATOS_VALIDOS, CANDIDATOS_VALIDOS);

  assert.equal(lista.nombre, 'Lista 1');
  assert.deepEqual(lista.candidatos.map((c) => c.nombre), ['Ana', 'Beto']);
});

test('crear audita la operacion', async () => {
  const { repo, auditoria, llamadas } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await servicio.crear({}, DATOS_VALIDOS, CANDIDATOS_VALIDOS);

  assert.equal(llamadas().length, 1);
  assert.equal(llamadas()[0].operacion, 'CREAR');
  assert.equal(llamadas()[0].entidad, 'lista');
});

test('tipoEleccion fuera de la lista blanca da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await assert.rejects(
    servicio.crear({}, { ...DATOS_VALIDOS, tipoEleccion: 'departamental' }, CANDIDATOS_VALIDOS),
    (error) => error.status === 400,
  );
});

test('cantidadLugares invalida da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  for (const cantidadLugares of [0, -1, 1.5, NaN]) {
    await assert.rejects(
      servicio.crear({}, { ...DATOS_VALIDOS, cantidadLugares }, CANDIDATOS_VALIDOS),
      (error) => error.status === 400,
      `cantidadLugares=${cantidadLugares} deberia dar 400`,
    );
  }
});

test('sin candidatos da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await assert.rejects(servicio.crear({}, DATOS_VALIDOS, []), (error) => error.status === 400);
});

test('orden duplicado da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await assert.rejects(
    servicio.crear({}, DATOS_VALIDOS, [{ nombre: 'Ana', orden: 1 }, { nombre: 'Beto', orden: 1 }]),
    (error) => error.status === 400,
  );
});

test('un hueco en la secuencia de orden da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await assert.rejects(
    servicio.crear({}, DATOS_VALIDOS, [{ nombre: 'Ana', orden: 1 }, { nombre: 'Beto', orden: 3 }]),
    (error) => error.status === 400,
  );
});

test(`mas de ${TOPE_CANDIDATOS} candidatos da 400 y no se trunca`, async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);
  const candidatos = Array.from({ length: TOPE_CANDIDATOS + 1 }, (_, i) => ({ nombre: `C${i}`, orden: i + 1 }));

  await assert.rejects(servicio.crear({}, DATOS_VALIDOS, candidatos), (error) => error.status === 400);
});

test('actualizar una lista inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await assert.rejects(
    servicio.actualizar({}, 999, DATOS_VALIDOS, CANDIDATOS_VALIDOS),
    (error) => error.status === 404,
  );
});

test('eliminar una lista inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  await assert.rejects(servicio.eliminar({}, 999), (error) => error.status === 404);
});

test('listar aplica el techo de 100 aunque se pida mas', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ListasService(repo, auditoria);

  const resultado = await servicio.listar({ page: 1, limit: 100000 });
  assert.equal(resultado.limit, 100);
});

// ---- routes.js, con las rutas reales y un usuario fijo (sin auth real ni DB) ----

function appConUsuario(servicio, permisos) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'test', nombre_completo: 'Test', permisos };
    next();
  });
  app.use('/api/listas', construirRutas(servicio));
  app.use(manejadorNoEncontrado);
  app.use(manejadorErrores);
  return app;
}

function servicioReal() {
  const { repo, auditoria } = repoFalso();
  return new ListasService(repo, auditoria);
}

test('GET /api/listas sin listas.view da 403', async () => {
  const app = appConUsuario(servicioReal(), []);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/listas`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/listas con solo listas.view da 403', async () => {
  const app = appConUsuario(servicioReal(), ['listas.view']);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/listas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DATOS_VALIDOS, candidatos: CANDIDATOS_VALIDOS }),
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/listas con listas.edit crea y responde 201 con los candidatos en orden', async () => {
  const app = appConUsuario(servicioReal(), ['listas.edit']);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/listas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DATOS_VALIDOS, candidatos: CANDIDATOS_VALIDOS }),
    });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.deepEqual(body.data.candidatos.map((c) => c.orden), [1, 2]);
  } finally {
    server.close();
  }
});

test('GET /api/listas/:id inexistente da 404', async () => {
  const app = appConUsuario(servicioReal(), ['listas.view']);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/listas/999`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('GET /api/listas respeta el techo del limite', async () => {
  const app = appConUsuario(servicioReal(), ['listas.view']);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/listas?limite=100000`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.paginacion.registrosPorPagina, 100);
  } finally {
    server.close();
  }
});
