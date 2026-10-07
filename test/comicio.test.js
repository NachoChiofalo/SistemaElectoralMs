/**
 * Tests de comicios (item 015, ampliado con fuerzas y rango de mesa opcional): el
 * service con un repositorio falso (no necesita base) y las rutas reales detras de un
 * usuario fijo (mismo patron que permisos.test.js y listas.test.js).
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
  const asignadas = new Set(); // ids de mesa con algun fiscal asignado
  let siguienteMesaId = 1;
  const fuerzas = [{ id: 1, nombre: 'Fuerza A', color: 1 }, { id: 2, nombre: 'Fuerza B', color: 2 }];
  const auditoriaLlamadas = [];

  const dentroDe = (v, desde, hasta) => {
    const clave = (x) => `${x.apellido}|${x.nombre}|${x.dni}`;
    return clave(v) >= clave(desde) && clave(v) <= clave(hasta);
  };

  let siguienteFuerzaId = 3;

  const repo = {
    // El repo en memoria no necesita una conexion real: transaccion() corre la
    // funcion directamente, sin abrir nada, y el "cliente" que le pasa nunca se usa
    // (votante/mesasSolapadas del fake ignoran el ejecutor, siempre leen del closure).
    db: { transaccion: (fn) => fn({}) },
    async lockComicio() {},
    async votante(dni) {
      return VOTANTES[dni] || null;
    },
    async crearFuerza({ nombre, sigla, color }) {
      const fuerza = { id: siguienteFuerzaId++, nombre, sigla: sigla || null, color, lista_id: null, created_at: new Date().toISOString() };
      fuerzas.push(fuerza);
      return fuerza;
    },
    async listarFuerzas() {
      return fuerzas;
    },
    async fuerzaPorId(id) {
      return fuerzas.find((f) => f.id === id) || null;
    },
    async actualizarFuerza(id, { nombre, sigla, color }) {
      const fuerza = fuerzas.find((f) => f.id === id);
      Object.assign(fuerza, { nombre, sigla: sigla || null, color });
      return fuerza;
    },
    async eliminarFuerza(id) {
      const antes = fuerzas.length;
      const idx = fuerzas.findIndex((f) => f.id === id);
      if (idx >= 0) fuerzas.splice(idx, 1);
      return fuerzas.length < antes;
    },
    async fuerzasExistentes(ids) {
      return fuerzas.filter((f) => ids.includes(f.id)).map((f) => f.id);
    },
    async fuerzasDeComicio() {
      return comicio ? fuerzas.filter((f) => comicio.fuerzaIds.includes(f.id)) : [];
    },
    async crearComicio(datos, fuerzaIds) {
      comicio = { id: 1, ...datos, fuerzaIds };
      return { id: 1, ...datos, created_at: new Date().toISOString() };
    },
    async porIdComicio(id) {
      if (!comicio || comicio.id !== id) return null;
      return { ...comicio, fuerzas: fuerzas.filter((f) => comicio.fuerzaIds.includes(f.id)), mesas };
    },
    async listarComicios({ page, limit }) {
      return { registros: comicio ? [comicio] : [], total: comicio ? 1 : 0, page, limit };
    },
    async actualizarComicio(id, datos, fuerzaIds) {
      comicio = { ...comicio, ...datos, fuerzaIds };
      return comicio;
    },
    async contarMesasConVotos() {
      return mesas.filter((m) => m.votos_blancos != null || m.votos_nulos != null).length;
    },
    async contarMesasConAsignaciones() { return asignadas.size ? 1 : 0; },
    async contarAsignacionesDeMesa(mesaId) { return asignadas.has(mesaId) ? 1 : 0; },
    async mesaTieneVotos(mesaId) {
      const m = mesas.find((x) => x.id === mesaId);
      return Boolean(m && (m.votos_blancos != null || m.votos_nulos != null));
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
        .filter((m) => m._desde && m._hasta) // mesas sin rango nunca se solapan
        .filter((m) => {
          const antes = clave(hasta) < clave(m._desde);
          const despues = clave(m._hasta) < clave(desde);
          return !(antes || despues);
        });
    },
    async crearMesa(cliente, comicioId, { numero, desdeDni, hastaDni }) {
      const mesa = {
        id: siguienteMesaId++,
        comicio_id: comicioId,
        numero,
        padron_desde_dni: desdeDni || null,
        padron_hasta_dni: hastaDni || null,
        votos_blancos: null,
        votos_nulos: null,
        _desde: desdeDni ? VOTANTES[desdeDni] : null,
        _hasta: hastaDni ? VOTANTES[hastaDni] : null,
      };
      mesas.push(mesa);
      return mesa;
    },
    async mesaPorId(mesaId) {
      return mesas.find((m) => m.id === mesaId) || null;
    },
    async actualizarMesa(cliente, mesaId, { numero, desdeDni, hastaDni }) {
      const mesa = mesas.find((m) => m.id === mesaId);
      Object.assign(mesa, {
        numero,
        padron_desde_dni: desdeDni || null,
        padron_hasta_dni: hastaDni || null,
        _desde: desdeDni ? VOTANTES[desdeDni] : null,
        _hasta: hastaDni ? VOTANTES[hastaDni] : null,
      });
      return mesa;
    },
    async eliminarMesa(mesaId) {
      const antes = mesas.length;
      mesas = mesas.filter((m) => m.id !== mesaId);
      return mesas.length < antes;
    },
    async reemplazarVotos(mesaId, { blancos, nulos, porFuerza }) {
      const mesa = mesas.find((m) => m.id === mesaId);
      mesa.votos_blancos = blancos;
      mesa.votos_nulos = nulos;
      mesa._porFuerza = porFuerza;
      return this.votosDeMesa(mesaId);
    },
    async votosDeMesa(mesaId) {
      const mesa = mesas.find((m) => m.id === mesaId);
      return {
        blancos: mesa.votos_blancos,
        nulos: mesa.votos_nulos,
        porFuerza: (mesa._porFuerza || []).map((v) => ({ ...v, fuerza_nombre: fuerzas.find((f) => f.id === v.fuerzaId)?.nombre })),
      };
    },
    async metricas(comicioId) {
      return { porFuerza: [], blancos: 0, nulos: 0, emitidos: 0, mesasConVotos: 0, mesasTotal: mesas.length, votantesAsignados: 0, participacion: null };
    },
  };

  const auditoria = {
    async registrarDeRequest(req, datos) {
      auditoriaLlamadas.push(datos);
    },
  };

  return { repo, auditoria, asignadas, llamadas: () => auditoriaLlamadas };
}

const DATOS_COMICIO = { nombre: 'Comicio Test', tipoEleccion: 'municipal' };

// ---- service.js ----

test('crear un comicio valido', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  const comicio = await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  assert.equal(comicio.nombre, 'Comicio Test');
  assert.equal(comicio.fuerzas.length, 2);
});

test('crear un comicio sin fuerzas da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.crearComicio({}, DATOS_COMICIO, []), (e) => e.status === 400);
});

test('crear un comicio con una fuerza inexistente da 400', async () => {
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

test('crear una mesa sin rango no exige DNI y no calcula votantes', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);

  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: null, hastaDni: null });
  assert.equal(mesa.cantidad_votantes, null);
  assert.equal(mesa.padron_desde_dni, null);
});

test('mandar solo uno de los dos DNI del rango da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  await assert.rejects(
    servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: null }),
    (e) => e.status === 400,
  );
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
    // El mensaje detallado (con el numero de la mesa en conflicto) tiene que
    // sobrevivir intacto al haber movido la validacion adentro de una transaccion
    // con lock (G1) -- lo que cambio es bajo que conexion corre, no lo que dice.
    (e) => e.status === 409 && /se solapa con la mesa 1/.test(e.message),
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

test('una mesa sin rango no choca con ninguna otra', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000005' });
  const mesa2 = await servicio.crearMesa({}, 1, { numero: 2, desdeDni: null, hastaDni: null });
  assert.equal(mesa2.numero, 2);
});

test('cargar votos de una fuerza que no participa del comicio da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await assert.rejects(
    servicio.cargarVotos({}, 1, mesa.id, { blancos: 0, nulos: 0, porFuerza: [{ fuerzaId: 2, cantidad: 5 }] }),
    (e) => e.status === 400,
  );
});

test('cargar votos negativos da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await assert.rejects(
    servicio.cargarVotos({}, 1, mesa.id, { blancos: -1, nulos: 0, porFuerza: [] }),
    (e) => e.status === 400,
  );
});

test('cargar votos validos y releerlos', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });

  await servicio.cargarVotos({}, 1, mesa.id, {
    blancos: 2, nulos: 1, porFuerza: [{ fuerzaId: 1, cantidad: 10 }, { fuerzaId: 2, cantidad: 8 }],
  });

  const votos = await servicio.votosDeMesa(1, mesa.id);
  assert.equal(votos.blancos, 2);
  assert.equal(votos.porFuerza.length, 2);
});

test('recargar votos reemplaza el set anterior, no lo acumula', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });

  await servicio.cargarVotos({}, 1, mesa.id, { blancos: 2, nulos: 1, porFuerza: [{ fuerzaId: 1, cantidad: 10 }] });
  await servicio.cargarVotos({}, 1, mesa.id, { blancos: 3, nulos: 0, porFuerza: [{ fuerzaId: 2, cantidad: 5 }] });

  const votos = await servicio.votosDeMesa(1, mesa.id);
  assert.equal(votos.blancos, 3);
  assert.equal(votos.porFuerza.length, 1);
  assert.equal(votos.porFuerza[0].fuerzaId, 2);
});

test('eliminar un comicio inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.eliminarComicio({}, 999), (e) => e.status === 404);
});

test('no se puede borrar una mesa ni un comicio con votos cargados (G2)', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  const req = {};
  const comicio = await servicio.crearComicio(req, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa(req, comicio.id, { numero: 1 });

  await assert.doesNotReject(servicio.eliminarMesa({}, comicio.id, (await servicio.crearMesa(req, comicio.id, { numero: 2 })).id));

  await servicio.cargarVotos(req, comicio.id, mesa.id, { blancos: 2, nulos: 1, porFuerza: [] });

  await assert.rejects(servicio.eliminarMesa(req, comicio.id, mesa.id), (e) => e.status === 409);
  await assert.rejects(servicio.eliminarComicio(req, comicio.id), (e) => e.status === 409);
});

test('no se puede borrar una mesa ni un comicio con fiscales asignados (G2)', async () => {
  const { repo, auditoria, asignadas } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  const req = {};
  const comicio = await servicio.crearComicio(req, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa(req, comicio.id, { numero: 1 });

  asignadas.add(mesa.id);
  await assert.rejects(servicio.eliminarMesa(req, comicio.id, mesa.id), (e) => e.status === 409 && /fiscal/.test(e.message));
  await assert.rejects(servicio.eliminarComicio(req, comicio.id), (e) => e.status === 409 && /fiscal/.test(e.message));

  asignadas.clear(); // desasignados: ahora se puede
  await assert.doesNotReject(servicio.eliminarMesa(req, comicio.id, mesa.id));
});

test('auditoria registra alta de comicio, mesa y votos', async () => {
  const { repo, auditoria, llamadas } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await servicio.crearComicio({}, DATOS_COMICIO, [1, 2]);
  const mesa = await servicio.crearMesa({}, 1, { numero: 1, desdeDni: '10000001', hastaDni: '10000003' });
  await servicio.cargarVotos({}, 1, mesa.id, { blancos: 0, nulos: 0, porFuerza: [] });

  const entidades = llamadas().map((l) => l.entidad);
  assert.deepEqual(entidades, ['comicio', 'mesa', 'votos_mesa']);
});

// ---- Fuerzas ----

test('crear una fuerza valida', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  const fuerza = await servicio.crearFuerza({}, { nombre: 'Fuerza Nueva', sigla: 'FN', color: 3 });
  assert.equal(fuerza.nombre, 'Fuerza Nueva');
  assert.equal(fuerza.color, 3);
});

test('crear una fuerza sin nombre da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.crearFuerza({}, { nombre: '', color: 1 }), (e) => e.status === 400);
});

test('crear una fuerza con color fuera de rango da 400', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.crearFuerza({}, { nombre: 'X', color: 9 }), (e) => e.status === 400);
  await assert.rejects(servicio.crearFuerza({}, { nombre: 'X', color: 0 }), (e) => e.status === 400);
});

test('actualizar una fuerza inexistente da 404', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.actualizarFuerza({}, 999, { nombre: 'X', color: 1 }), (e) => e.status === 404);
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
      body: JSON.stringify({ ...DATOS_COMICIO, fuerzaIds: [1] }),
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
      body: JSON.stringify({ ...DATOS_COMICIO, fuerzaIds: [1, 2] }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.data.fuerzas.length, 2);
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

test('GET /api/comicio/fuerzas sin comicio.view da 403', async () => {
  const app = appConUsuario(servicioReal(), []);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/comicio/fuerzas`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/comicio/fuerzas con comicio.edit crea y responde 201', async () => {
  const app = appConUsuario(servicioReal(), ['comicio.edit']);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/comicio/fuerzas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Fuerza C' }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.data.nombre, 'Fuerza C');
  } finally {
    server.close();
  }
});

test('un color no numerico es 400, no se corrige en silencio a 1 (BE-048)', async () => {
  const { repo, auditoria } = repoFalso();
  const servicio = new ComicioService(repo, auditoria);
  await assert.rejects(servicio.crearFuerza({}, { nombre: 'X', color: NaN }), (e) => e.status === 400);
});
