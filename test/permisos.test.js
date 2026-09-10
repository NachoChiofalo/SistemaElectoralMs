/**
 * Verifica que las rutas de padron y auditoria exijan el permiso correcto.
 *
 * Antes de esto, /api/padron solo exigia estar autenticado: el gateway importaba
 * requirePermission pero nunca lo aplicaba a ninguna ruta, y auditoria no tenia
 * ningun control mas alla de requireAuth. Cualquier usuario logueado, sin importar
 * el rol, podia leer y editar el padron completo y ver el registro de auditoria.
 *
 * Estos tests montan las rutas REALES (las mismas que sirve el servidor) detras de
 * un middleware que inyecta req.user directo, sin pasar por requireAuth ni por la
 * base de datos: sessions.validar() necesita DB incluso con un JWT valido, y estos
 * tests son justamente los que corren sin ella. El servicio que reciben las rutas es
 * un stub minimo: alcanza para confirmar si el handler se ejecuto o no.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { manejadorErrores, manejadorNoEncontrado } = require('../src/core/errors');
const construirRutasPadron = require('../src/modules/padron/routes');
const construirRutasAuditoria = require('../src/modules/auditoria/routes');

/** Monta un router detras de un usuario fijo, sin auth real ni base de datos. */
function appConUsuario(router, permisos) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'test', rol: 'test', permisos };
    next();
  });
  app.use('/api', router);
  app.use(manejadorNoEncontrado);
  app.use(manejadorErrores);
  return app;
}

/** Stub del servicio de padron: alcanza con no tirar si el handler llega a usarlo. */
function padronStub() {
  return {
    votantesPaginados: async () => ({ votantes: [], total: 0, pagina: 1, limite: 50, totalPaginas: 0 }),
    votantePorDni: async () => ({ dni: '1' }),
    crearVotante: async () => ({ dni: '1' }),
    relevamientoPorDni: async () => ({}),
    actualizarRelevamiento: async () => ({}),
    estado: async () => ({}),
    configuracion: () => ({}),
    filtrosDisponibles: async () => ({}),
    estadisticas: async () => ({}),
    estadisticasAvanzadas: async () => ({}),
    estadisticasPorSexo: async () => ([]),
    estadisticasPorRangoEtario: async () => ([]),
    estadisticasPorCircuito: async () => ([]),
    estadisticasCondicionesDetalladas: async () => ({}),
    guardarDetalle: async () => ({}),
    detallePorDni: async () => null,
    eliminarDetalle: async () => {},
    votantesConCondicionesEspeciales: async () => ([]),
    estadisticasCondicionesEspeciales: async () => ({}),
    importar: async () => ({ leidas: 0, descartadas: 0, insertadas: 0, actualizadas: 0 }),
    auditoria: { registrarDeRequest: async () => {} },
  };
}

function auditoriaStub() {
  return {
    consultar: async () => ({ registros: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
    estadisticas: async () => ({}),
    porId: async () => null,
  };
}

// ------------------------------------------------------- rutas de padron

const RUTAS_PADRON = [
  { metodo: 'get', ruta: '/votantes', permiso: 'padron.view' },
  { metodo: 'post', ruta: '/votantes', permiso: 'padron.edit', body: { dni: '1', nombre: 'x', apellido: 'y' } },
  { metodo: 'get', ruta: '/votantes/1', permiso: 'padron.view' },
  { metodo: 'get', ruta: '/relevamientos/1', permiso: 'padron.view' },
  { metodo: 'put', ruta: '/relevamientos/1', permiso: 'padron.relevamiento', body: { opcionPolitica: 'PJ' } },
  { metodo: 'get', ruta: '/estado', permiso: 'padron.view' },
  { metodo: 'get', ruta: '/health', permiso: 'padron.view' },
  { metodo: 'get', ruta: '/configuracion', permiso: 'padron.view' },
  { metodo: 'get', ruta: '/filtros', permiso: 'padron.view' },
  { metodo: 'get', ruta: '/estadisticas', permiso: 'padron.view' },
  { metodo: 'get', ruta: '/resultados/estadisticas-avanzadas', permiso: 'resultados.view' },
  { metodo: 'get', ruta: '/resultados/por-sexo', permiso: 'resultados.view' },
  { metodo: 'get', ruta: '/resultados/por-rango-etario', permiso: 'resultados.view' },
  { metodo: 'get', ruta: '/resultados/por-circuito', permiso: 'resultados.view' },
  { metodo: 'get', ruta: '/resultados/condiciones-detalladas', permiso: 'resultados.view' },
  { metodo: 'post', ruta: '/detalle-votante', permiso: 'padron.edit', body: { dni: '1', condiciones: {} } },
  { metodo: 'get', ruta: '/detalle-votante/1', permiso: 'padron.view' },
  { metodo: 'delete', ruta: '/detalle-votante/1', permiso: 'padron.edit' },
  { metodo: 'get', ruta: '/condiciones-especiales', permiso: 'padron.view' },
];

for (const caso of RUTAS_PADRON) {
  test(`${caso.metodo.toUpperCase()} /api/padron${caso.ruta} exige ${caso.permiso}`, async () => {
    const router = express.Router();
    router.use('/padron', construirRutasPadron(padronStub(), {}));

    const conElPermiso = appConUsuario(router, [caso.permiso]);
    const sinNingunPermiso = appConUsuario(router, ['un.permiso.cualquiera.que.no.aplica']);

    const pedir = (app) => new Promise((resolve) => {
      const servidor = app.listen(0, () => {
        const base = `http://127.0.0.1:${servidor.address().port}`;
        fetch(`${base}/api/padron${caso.ruta}`, {
          method: caso.metodo,
          headers: caso.body ? { 'Content-Type': 'application/json' } : undefined,
          body: caso.body ? JSON.stringify(caso.body) : undefined,
        }).then((res) => {
          servidor.close();
          resolve(res.status);
        });
      });
    });

    const statusConPermiso = await pedir(conElPermiso);
    const statusSinPermiso = await pedir(sinNingunPermiso);

    assert.notEqual(statusConPermiso, 403, `con ${caso.permiso} no deberia dar 403 (dio ${statusConPermiso})`);
    assert.equal(statusSinPermiso, 403, `sin ${caso.permiso} deberia dar 403 (dio ${statusSinPermiso})`);
  });
}

test('estadisticas-condiciones-especiales acepta padron.view O resultados.view', async () => {
  const router = express.Router();
  router.use('/padron', construirRutasPadron(padronStub(), {}));
  const ruta = '/api/padron/estadisticas-condiciones-especiales';

  for (const permiso of ['padron.view', 'resultados.view']) {
    const app = appConUsuario(router, [permiso]);
    const servidor = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${servidor.address().port}`;

    const res = await fetch(`${base}${ruta}`);
    await new Promise((resolve) => servidor.close(resolve));

    assert.notEqual(res.status, 403, `con ${permiso} no deberia dar 403`);
  }

  const appSinPermiso = appConUsuario(router, ['fiscales.view']);
  const servidor = await new Promise((resolve) => { const s = appSinPermiso.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const res = await fetch(`${base}${ruta}`);
  await new Promise((resolve) => servidor.close(resolve));

  assert.equal(res.status, 403);
});

test('exportar-padron y exportar-relevamientos siguen exigiendo rol administrador, no un permiso', async () => {
  const router = express.Router();
  router.use('/padron', construirRutasPadron(padronStub(), {}));

  for (const ruta of ['/exportar-padron', '/exportar-relevamientos']) {
    const app = express();
    app.use((req, res, next) => {
      // Con todos los permisos de padron pero sin el rol de administrador.
      req.user = { id: 1, username: 'test', rol: 'encargado_relevamiento', permisos: ['padron.view', 'padron.edit', 'padron.export'] };
      next();
    });
    app.use('/api', router);
    app.use(manejadorNoEncontrado);
    app.use(manejadorErrores);

    const servidor = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const res = await fetch(`${base}/api/padron${ruta}`);
    await new Promise((resolve) => servidor.close(resolve));

    assert.equal(res.status, 403, `${ruta} deberia rechazar a un no-administrador aunque tenga los permisos de padron`);
  }
});

// ------------------------------------------------------ rutas de auditoria

const RUTAS_AUDITORIA = ['/', '/estadisticas', '/1'];

for (const ruta of RUTAS_AUDITORIA) {
  test(`GET /api/auditoria${ruta} exige admin.system`, async () => {
    const router = express.Router();
    router.use('/auditoria', construirRutasAuditoria(auditoriaStub()));

    const conPermiso = appConUsuario(router, ['admin.system']);
    const sinPermiso = appConUsuario(router, ['padron.view', 'resultados.view']);

    const pedir = (app) => new Promise((resolve) => {
      const servidor = app.listen(0, () => {
        const base = `http://127.0.0.1:${servidor.address().port}`;
        fetch(`${base}/api/auditoria${ruta}`).then((res) => { servidor.close(); resolve(res.status); });
      });
    });

    assert.notEqual(await pedir(conPermiso), 403);
    assert.equal(await pedir(sinPermiso), 403);
  });
}
