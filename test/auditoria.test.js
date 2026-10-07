/**
 * Tests del modulo de auditoria. No tenia ninguno (permisos.test.js sólo cubre que las
 * rutas exijan admin.system) -- este archivo cubre el service con un repositorio falso,
 * mismo patron que el resto de los modulos.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-test-suficientemente-largo-para-validar';
process.env.LOG_LEVEL = 'error';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');

const { AuditoriaService } = require('../src/modules/auditoria/service');

function loggerFalso() {
  const errores = [];
  return { logger: { error: (msg, meta) => errores.push({ msg, meta }) }, errores };
}

function repoFalso() {
  const insertados = [];
  return {
    async insertar(registro) { insertados.push(registro); },
    async listar(opciones) { return { registros: [], total: 0, ...opciones }; },
    async estadisticas() {
      return { totalOperaciones: 0, porUsuario: [], porTipo: [], porDia: [], usuariosActivos: 0 };
    },
    async porId(id) { return id === 1 ? { id: 1 } : null; },
    insertados,
  };
}

test('registrar inserta el evento tal cual', async () => {
  const repo = repoFalso();
  const { logger } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  await servicio.registrar({ operacion: 'CREAR', entidad: 'lista', usuario_id: 5 });

  assert.equal(repo.insertados.length, 1);
  assert.equal(repo.insertados[0].operacion, 'CREAR');
});

test('registrar nunca lanza: un fallo al auditar no vuelca la operacion auditada', async () => {
  const repo = { async insertar() { throw new Error('DB caida'); } };
  const { logger, errores } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  await servicio.registrar({ operacion: 'CREAR', entidad: 'lista' });

  assert.equal(errores.length, 1);
  assert.match(errores[0].msg, /No se pudo registrar/);
});

test('registrarDeRequest toma usuario e ip de la request', async () => {
  const repo = repoFalso();
  const { logger } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  const req = {
    user: { id: 7, nombre_completo: 'Ana Perez', username: 'aperez' },
    ip: '10.0.0.5',
  };
  await servicio.registrarDeRequest(req, { operacion: 'EDITAR', entidad: 'comicio', entidad_id: 3 });

  const evento = repo.insertados[0];
  assert.equal(evento.usuario_id, 7);
  assert.equal(evento.usuario_nombre, 'Ana Perez');
  assert.equal(evento.usuario_username, 'aperez');
  assert.equal(evento.ip_address, '10.0.0.5');
  assert.equal(evento.entidad_id, 3);
});

test('registrarDeRequest sin req.user cae en "Sistema", no revienta', async () => {
  const repo = repoFalso();
  const { logger } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  await servicio.registrarDeRequest({}, { operacion: 'LOGIN', entidad: 'sesion' });

  const evento = repo.insertados[0];
  assert.equal(evento.usuario_id, 0);
  assert.equal(evento.usuario_nombre, 'Sistema');
  assert.equal(evento.usuario_username, 'sistema');
});

test('registrarDeRequest usa x-forwarded-for cuando no hay req.ip', async () => {
  const repo = repoFalso();
  const { logger } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  const req = {
    user: { id: 1 },
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    socket: {},
  };
  await servicio.registrarDeRequest(req, { operacion: 'LOGIN', entidad: 'sesion' });

  assert.equal(repo.insertados[0].ip_address, '203.0.113.9');
});

test('estadisticas devuelve usuariosActivos (sesiones con actividad reciente, no historico)', async () => {
  const repo = repoFalso();
  const { logger } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  const stats = await servicio.estadisticas({});
  assert.equal(stats.usuariosActivos, 0);
  assert.ok(Array.isArray(stats.porUsuario));
});

test('porId devuelve null si no existe', async () => {
  const repo = repoFalso();
  const { logger } = loggerFalso();
  const servicio = new AuditoriaService(repo, logger);

  assert.equal(await servicio.porId(999), null);
  assert.deepEqual(await servicio.porId(1), { id: 1 });
});
