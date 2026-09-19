/**
 * Tests de fiscales (item 016): service con repositorio falso (no necesita base) y
 * rutas reales detras de un usuario fijo (mismo patron que comicio.test.js).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { manejadorErrores, manejadorNoEncontrado } = require('../src/core/errors');
const { FiscalesService } = require('../src/modules/fiscales/service');
const construirRutas = require('../src/modules/fiscales/routes');

function repoFalso() {
  const mesas = { 1: { id: 1, comicio_id: 1, numero: 1 }, 2: { id: 2, comicio_id: 1, numero: 2 } };
  let fiscales = {};
  let siguienteFiscalId = 1;
  let asignaciones = {};
  let siguienteAsignacionId = 1;
  const auditoriaLlamadas = [];

  const seSolapan = (a, b) => a.desde < b.hasta && b.desde < a.hasta;

  const repo = {
    async crear({ nombre, dni, telefono }) {
      const fiscal = { id: siguienteFiscalId++, nombre, dni: dni ?? null, telefono: telefono ?? null, created_at: new Date().toISOString() };
      fiscales[fiscal.id] = fiscal;
      return fiscal;
    },
    async porId(id) {
      return fiscales[id] || null;
    },
    async listar({ page, limit }) {
      const registros = Object.values(fiscales);
      return { registros, total: registros.length, page, limit };
    },
    async actualizar(id, { nombre, dni, telefono }) {
      fiscales[id] = { ...fiscales[id], nombre, dni: dni ?? null, telefono: telefono ?? null };
      return fiscales[id];
    },
    async eliminar(id) {
      const existia = !!fiscales[id];
      delete fiscales[id];
      return existia;
    },
    async mesa(mesaId) {
      return mesas[mesaId] || null;
    },
    async solapaConMesa(mesaId, desde, hasta, excluirId) {
      return Object.values(asignaciones)
        .filter((a) => a.mesa_id === mesaId && a.id !== excluirId)
        .filter((a) => seSolapan(a, { desde, hasta }))
        .map((a) => ({ ...a, fiscal_nombre: fiscales[a.fiscal_id]?.nombre }));
    },
    async solapaConFiscal(fiscalId, desde, hasta, excluirId) {
      return Object.values(asignaciones)
        .filter((a) => a.fiscal_id === fiscalId && a.id !== excluirId)
        .filter((a) => seSolapan(a, { desde, hasta }))
        .map((a) => ({ ...a, mesa_numero: mesas[a.mesa_id]?.numero }));
    },
    async crearAsignacion({ mesaId, fiscalId, desde, hasta }) {
      const asignacion = { id: siguienteAsignacionId++, mesa_id: mesaId, fiscal_id: fiscalId, desde, hasta };
      asignaciones[asignacion.id] = asignacion;
      return asignacion;
    },
    async asignacionPorId(id) {
      return asignaciones[id] || null;
    },
    async asignacionesDeMesa(mesaId) {
      return Object.values(asignaciones).filter((a) => a.mesa_id === mesaId);
    },
    async actualizarAsignacion(id, { fiscalId, desde, hasta }) {
      asignaciones[id] = { ...asignaciones[id], fiscal_id: fiscalId, desde, hasta };
      return asignaciones[id];
    },
    async eliminarAsignacion(id) {
      const existia = !!asignaciones[id];
      delete asignaciones[id];
      return existia;
    },
    async agendaDeComicio(comicioId, hora) {
      return Object.values(mesas)
        .filter((m) => m.comicio_id === comicioId)
        .map((m) => {
          const activa = Object.values(asignaciones).find((a) => a.mesa_id === m.id && a.desde <= hora && a.hasta > hora);
          return {
            mesa_id: m.id,
            mesa_numero: m.numero,
            fiscal_id: activa ? activa.fiscal_id : null,
            fiscal_nombre: activa ? fiscales[activa.fiscal_id]?.nombre : null,
          };
        });
    },
  };

  const auditoria = {
    async registrarDeRequest(req, datos) {
      auditoriaLlamadas.push(datos);
    },
  };

  return { repo, auditoria, llamadas: () => auditoriaLlamadas };
}

// ---- service.js ----

test('crear un fiscal valido', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  assert.equal(fiscal.nombre, 'Ana Lopez');
});

test('crear un fiscal sin nombre da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  await assert.rejects(servicio.crear({}, { nombre: '' }), (e) => e.status === 400);
});

test('crear una asignacion valida', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  const asignacion = await servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '08:00', hasta: '12:00' });
  assert.equal(asignacion.mesa_id, 1);
});

test('asignacion con mesa inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  await assert.rejects(
    servicio.crearAsignacion({}, 999, { fiscalId: fiscal.id, desde: '08:00', hasta: '12:00' }),
    (e) => e.status === 404,
  );
});

test('asignacion con fiscal inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  await assert.rejects(
    servicio.crearAsignacion({}, 1, { fiscalId: 999, desde: '08:00', hasta: '12:00' }),
    (e) => e.status === 404,
  );
});

test('franja fuera de 08:00-18:00 da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  await assert.rejects(
    servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '07:00', hasta: '12:00' }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '08:00', hasta: '19:00' }),
    (e) => e.status === 400,
  );
});

test('hasta menor o igual a desde da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  await assert.rejects(
    servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '12:00', hasta: '12:00' }),
    (e) => e.status === 400,
  );
});

test('dos fiscales solapados en la misma mesa: el segundo da 409', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const f1 = await servicio.crear({}, { nombre: 'Ana Lopez' });
  const f2 = await servicio.crear({}, { nombre: 'Beto Diaz' });
  await servicio.crearAsignacion({}, 1, { fiscalId: f1.id, desde: '08:00', hasta: '12:00' });
  await assert.rejects(
    servicio.crearAsignacion({}, 1, { fiscalId: f2.id, desde: '10:00', hasta: '14:00' }),
    (e) => e.status === 409,
  );
});

test('el mismo fiscal en dos mesas con horario cruzado da 409', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  await servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '08:00', hasta: '12:00' });
  await assert.rejects(
    servicio.crearAsignacion({}, 2, { fiscalId: fiscal.id, desde: '10:00', hasta: '14:00' }),
    (e) => e.status === 409,
  );
});

test('franjas contiguas no chocan, ni por mesa ni por fiscal', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const f1 = await servicio.crear({}, { nombre: 'Ana Lopez' });
  const f2 = await servicio.crear({}, { nombre: 'Beto Diaz' });
  await servicio.crearAsignacion({}, 1, { fiscalId: f1.id, desde: '08:00', hasta: '12:00' });
  // misma mesa, contigua
  const a2 = await servicio.crearAsignacion({}, 1, { fiscalId: f2.id, desde: '12:00', hasta: '16:00' });
  assert.equal(a2.desde, '12:00');
  // mismo fiscal (f1), otra mesa, contigua a su propia franja
  const a3 = await servicio.crearAsignacion({}, 2, { fiscalId: f1.id, desde: '12:00', hasta: '16:00' });
  assert.equal(a3.mesa_id, 2);
});

test('agenda de comicio devuelve el fiscal presente a esa hora', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  await servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '08:00', hasta: '12:00' });

  const agenda = await servicio.agendaDeComicio(1, '09:00');
  const mesa1 = agenda.find((m) => m.mesa_id === 1);
  const mesa2 = agenda.find((m) => m.mesa_id === 2);
  assert.equal(mesa1.fiscal_nombre, 'Ana Lopez');
  assert.equal(mesa2.fiscal_id, null);
});

test('auditoria registra alta de fiscal y de asignacion', async () => {
  const { repo, auditoria, llamadas } = repoFalso();
  const servicio = new FiscalesService(repo, auditoria);
  const fiscal = await servicio.crear({}, { nombre: 'Ana Lopez' });
  await servicio.crearAsignacion({}, 1, { fiscalId: fiscal.id, desde: '08:00', hasta: '12:00' });

  assert.deepEqual(llamadas().map((l) => l.entidad), ['fiscal', 'fiscal_asignacion']);
});

// ---- routes.js ----

function appConUsuario(servicio, permisos) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'test', nombre_completo: 'Test', permisos };
    next();
  });
  app.use('/api/fiscales', construirRutas(servicio));
  app.use(manejadorNoEncontrado);
  app.use(manejadorErrores);
  return app;
}

function servicioReal() {
  const { repo, auditoria } = repoFalso();
  return new FiscalesService(repo, auditoria);
}

test('GET /api/fiscales sin fiscales.view da 403', async () => {
  const app = appConUsuario(servicioReal(), []);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/fiscales`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/fiscales/mesas/1/asignaciones con solo fiscales.view da 403', async () => {
  const app = appConUsuario(servicioReal(), ['fiscales.view']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/fiscales/mesas/1/asignaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiscalId: 1, desde: '08:00', hasta: '12:00' }),
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/fiscales crea y responde 201', async () => {
  const app = appConUsuario(servicioReal(), ['fiscales.edit']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/fiscales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Ana Lopez' }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.data.nombre, 'Ana Lopez');
  } finally {
    server.close();
  }
});

test('GET /api/fiscales/comicio/1/agenda responde 200', async () => {
  const app = appConUsuario(servicioReal(), ['fiscales.view']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/fiscales/comicio/1/agenda?hora=09:00`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});
