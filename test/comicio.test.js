/**
 * Tests de comicios (item 015): el service con un repositorio falso (no necesita
 * base) y las rutas reales detras de un usuario fijo (mismo patron que
 * permisos.test.js y listas.test.js).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { manejadorErrores, manejadorNoEncontrado } = require('../src/core/errors');
const { ComicioService } = require('../src/modules/comicio/service');
const construirRutas = require('../src/modules/comicio/routes');

const VOTANTES = {
  '10000001': { dni: '10000001', apellido: 'Aguirre', nombre: 'Ana' },
  '10000002': { dni: '10000002', apellido: 'Diaz', nombre: 'Beto' },
  '10000003': { dni: '10000003', apellido: 'Gomez', nombre: 'Carla' },
  '10000004': { dni: '10000004', apellido: 'Lopez', nombre: 'Dario' },
  '10000005': { dni: '10000005', apellido: 'Perez', nombre: 'Elena' },
};

function repoFalso() {
  let comicio = null;
  let mesas = [];
  let siguienteMesaId = 1;
  const listas = [{ id: 1, nombre: 'Lista A' }, { id: 2, nombre: 'Lista B' }];
  const auditoriaLlamadas = [];

  const dentroDe = (v, desde, hasta) => {
    const clave = (x) => `${x.apellido}|${x.nombre}|${x.dni}`;
    return clave(v) >= clave(desde) && clave(v) <= clave(hasta);
  };

  const repo = {
    async votante(dni) {
      return VOTANTES[dni] || null;
    },
    async listasExistentes(ids) {
      return listas.filter((l) => ids.includes(l.id)).map((l) => l.id);
    },
    async listasDeComicio() {
      return comicio ? listas.filter((l) => comicio.listaIds.includes(l.id)) : [];
    },
    async crearComicio(datos, listaIds) {
      comicio = { id: 1, ...datos, listaIds };
      return { id: 1, ...datos, created_at: new Date().toISOString() };
    },
    async porIdComicio(id) {
      if (!comicio || comicio.id !== id) return null;
      return { ...comicio, listas: listas.filter((l) => comicio.listaIds.includes(l.id)), mesas };
    },
    async listarComicios({ page, limit }) {
      return { registros: comicio ? [comicio] : [], total: comicio ? 1 : 0, page, limit };
    },
    async actualizarComicio(id, datos, listaIds) {
      comicio = { ...comicio, ...datos, listaIds };
      return comicio;
    },
    async eliminarComicio(id) {
      const existia = comicio && comicio.id === id;
      if (existia) comicio = null;
      return !!existia;
    },
    async contarVotantesEnRango(desde, hasta) {
      return Object.values(VOTANTES).filter((v) => dentroDe(v, desde, hasta)).length;
    },
    async mesasSolapadas(comicioId, desde, hasta, excluirMesaId) {
      const clave = (x) => `${x.apellido}|${x.nombre}|${x.dni}`;
      return mesas
        .filter((m) => m.id !== excluirMesaId)
        .filter((m) => {
          // Solapan si NOT (hasta < m.desde OR m.hasta < desde)
          const antes = clave(hasta) < clave(m._desde);
          const despues = clave(m._hasta) < clave(desde);
          return !(antes || despues);
        });
    },
    async crearMesa(comicioId, { numero, desdeDni, hastaDni }) {
      const mesa = {
        id: siguienteMesaId++,
        comicio_id: comicioId,
        numero,
        padron_desde_dni: desdeDni,
        padron_hasta_dni: hastaDni,
        votos_blancos: null,
        votos_nulos: null,
        _desde: VOTANTES[desdeDni],
        _hasta: VOTANTES[hastaDni],
      };
      mesas.push(mesa);
      return mesa;
    },
    async mesaPorId(mesaId) {
      return mesas.find((m) => m.id === mesaId) || null;
    },
    async actualizarMesa(mesaId, { numero, desdeDni, hastaDni }) {
      const mesa = mesas.find((m) => m.id === mesaId);
      Object.assign(mesa, { numero, padron_desde_dni: desdeDni, padron_hasta_dni: hastaDni, _desde: VOTANTES[desdeDni], _hasta: VOTANTES[hastaDni] });
      return mesa;
    },
    async eliminarMesa(mesaId) {
      const antes = mesas.length;
      mesas = mesas.filter((m) => m.id !== mesaId);
      return mesas.length < antes;
    },
    async reemplazarVotos(mesaId, { blancos, nulos, porLista }) {
      const mesa = mesas.find((m) => m.id === mesaId);
      mesa.votos_blancos = blancos;
      mesa.votos_nulos = nulos;
      mesa._porLista = porLista;
      return this.votosDeMesa(mesaId);
    },
    async votosDeMesa(mesaId) {
      const mesa = mesas.find((m) => m.id === mesaId);
      return {
        blancos: mesa.votos_blancos,
        nulos: mesa.votos_nulos,
        porLista: (mesa._porLista || []).map((v) => ({ ...v, lista_nombre: listas.find((l) => l.id === v.listaId)?.nombre })),
      };
    },
    async metricas(comicioId) {
      return { porLista: [], blancos: 0, nulos: 0, emitidos: 0, mesasConVotos: 0, mesasTotal: mesas.length, votantesAsignados: 0, participacion: null };
    },
  };

  const auditoria = {
    async registrarDeRequest(req, datos) {
      auditoriaLlamadas.push(datos);
    },
  };

  return { repo, auditoria, llamadas: () => auditoriaLlamadas };
}

const DATOS_COMICIO = { nombre: 'Comicio Test', tipoEleccion: 'municipal' };

// ---- service.js ----

test('crear un comicio valido', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  const comicio = await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  assert.equal(comicio.nombre, 'Comicio Test');
  assert.equal(comicio.listas.length, 2);
});

test('crear un comicio sin listas da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.crearComicio({}, DATOS_COMICIO, []), (e) => e.status === 400);
});

test('crear un comicio con una lista inexistente da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.crearComicio({}, DATOS_COMICIO, [999]), (e) => e.status === 400);
});

test('tipoEleccion invalido da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(
    servicio.crearComicio({}, { ...DATOS_COMICIO, tipoEleccion: 'departamental' }, [1]),
    (e) => e.status === 400,
  );
});

test('crear una mesa con rango valido', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);

  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  assert.equal(mesa.cantidad_votantes, 3);
});

test('mesa con DNI inexistente da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  await assert.rejects(
    servicio.crearMesa({}, 1, { numero: 1, desdeDni: '99999999', hastaDni: '10000003' }),
    (e) => e.status === 400,
  );
});

test('mesa con hasta antes que desde da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  await assert.rejects(
    servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000003', hastaDni: '10000001' }),
    (e) => e.status === 400,
  );
});

test('dos mesas con rangos que se solapan: la segunda da 409', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await assert.rejects(
    servicio.crearMesa({}, 1, { numero: 2, desdeDni: '10000003', hastaDni: '10000005' }),
    (e) => e.status === 409,
  );
});

test('dos mesas con rangos contiguos, sin solapar, no chocan', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000002' });
  const mesa2 = await servicio.crearMesa({}, 1, { numero: 2, desdeDni: '10000003', hastaDni: '10000005' });
  assert.equal(mesa2.numero, 2);
});

test('cargar votos de una lista que no participa del comicio da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await assert.rejects(
    servicio.cargarVotos({}, 1, mesa.id, { blancos: 0, nulos: 0, porLista: [{ listaId: 2, cantidad: 5 }] }),
    (e) => e.status === 400,
  );
});

test('cargar votos negativos da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await assert.rejects(
    servicio.cargarVotos({}, 1, mesa.id, { blancos: -1, nulos: 0, porLista: [] }),
    (e) => e.status === 400,
  );
});

test('cargar votos validos y releerlos', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });

  await servicio.cargarVotos({}, 1, mesa.id, {
    blancos: 2, nulos: 1, porLista: [{ listaId: 1, cantidad: 10 }, { listaId: 2, cantidad: 8 }],
  });

  const votos = await servicio.votosDeMesa(1, mesa.id);
  assert.equal(votos.blancos, 2);
  assert.equal(votos.porLista.length, 2);
});

test('recargar votos reemplaza el set anterior, no lo acumula', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });

  await servicio.cargarVotos({}, 1, mesa.id, { blancos: 2, nulos: 1, porLista: [{ listaId: 1, cantidad: 10 }] });
  await servicio.cargarVotos({}, 1, mesa.id, { blancos: 3, nulos: 0, porLista: [{ listaId: 2, cantidad: 5 }] });

  const votos = await servicio.votosDeMesa(1, mesa.id);
  assert.equal(votos.blancos, 3);
  assert.equal(votos.porLista.length, 1);
  assert.equal(votos.porLista[0].listaId, 2);
});

test('eliminar un comicio inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.eliminarComicio({}, 999), (e) => e.status === 404);
});

test('auditoria registra alta de comicio, mesa y votos', async () => {
  const { repo, auditoria, llamadas } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await servicio.cargarVotos({}, 1, mesa.id, { blancos: 0, nulos: 0, porLista: [] });

  const entidades = llamadas().map((l) => l.entidad);
  assert.deepEqual(entidades, ['comicio', 'mesa', 'votos_mesa']);
});

// ---- routes.js ----

function appConUsuario(servicio, permisos) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'test', nombre_completo: 'Test', permisos };
    next();
  });
  app.use('/api/comicio', construirRutas(servicio));
  app.use(manejadorNoEncontrado);
  app.use(manejadorErrores);
  return app;
}

function servicioReal() {
  const { repo, auditoria } = repoFalso();
  return new ComicioService(repo, auditoria);
}

test('GET /api/comicio sin comicio.view da 403', async () => {
  const app = appConUsuario(servicioReal(), []);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/comicio`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/comicio con solo comicio.view da 403', async () => {
  const app = appConUsuario(servicioReal(), ['comicio.view']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/comicio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DATOS_COMICIO, listaIds: [1] }),
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/comicio con comicio.edit crea y responde 201', async () => {
  const app = appConUsuario(servicioReal(), ['comicio.edit']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/comicio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DATOS_COMICIO, listaIds: [1, 2] }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.data.listas.length, 2);
  } finally {
    server.close();
  }
});

test('GET /api/comicio/:id inexistente da 404', async () => {
  const app = appConUsuario(servicioReal(), ['comicio.view']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/comicio/999`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
