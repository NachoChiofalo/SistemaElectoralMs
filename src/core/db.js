/**
 * Acceso a PostgreSQL (Supabase). Un unico pool para todo el proceso.
 *
 * Antes habia tres pools independientes — auth con max 20 y padron con el default de
 * 10 — que podian sumar 30 conexiones contra el mismo proyecto de Supabase. Ahora hay
 * uno solo, dimensionado en config.db.max.
 */

const { Pool } = require('pg');
const { config } = require('./config');
const { logger } = require('./logger');

const { descripcion, ...opcionesPool } = config.db;

const pool = new Pool(opcionesPool);

// Un error en una conexion ociosa no debe tumbar el proceso: pg la descarta y abre otra.
pool.on('error', (error) => {
  logger.error('Error en una conexion ociosa del pool', error);
});

/** Consultas que superan este umbral se loguean para poder perseguirlas. */
const UMBRAL_LENTA_MS = 500;

/**
 * Ejecuta una consulta tomando y devolviendo una conexion del pool.
 * Para varias consultas que deben compartir conexion, usar transaccion() o conexion().
 */
async function query(texto, params) {
  const inicio = process.hrtime.bigint();
  try {
    return await pool.query(texto, params);
  } finally {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    if (ms > UMBRAL_LENTA_MS) {
      logger.warn('Consulta lenta', { ms: Math.round(ms), sql: texto.replace(/\s+/g, ' ').trim().slice(0, 140) });
    }
  }
}

/** Primera fila o null. Evita el `result.rows[0]` repetido por todos lados. */
async function unaFila(texto, params) {
  const { rows } = await query(texto, params);
  return rows[0] ?? null;
}

/** Filas directamente, para los casos en que el resto del result no aporta. */
async function filas(texto, params) {
  const { rows } = await query(texto, params);
  return rows;
}

/**
 * Corre fn dentro de una transaccion, con commit o rollback automatico.
 * fn recibe el cliente: hay que usar ese cliente, no query(), para que participe.
 */
async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('ROLLBACK');
    } catch (errorRollback) {
      logger.error('Fallo el ROLLBACK', errorRollback);
    }
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Conexion cruda del pool, para lo que no encaja en transaccion() — como el stream de
 * COPY del importador de padron. Quien la pide es responsable de liberarla.
 */
function conexion() {
  return pool.connect();
}

/** Verifica que la base responda. Lo usa el arranque y el health check. */
async function verificar() {
  const inicio = process.hrtime.bigint();
  await pool.query('SELECT 1');
  return Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
}

async function cerrar() {
  await pool.end();
  logger.info('Pool de base de datos cerrado');
}

/** Estado del pool, para el health check. */
function estado() {
  return { total: pool.totalCount, ociosas: pool.idleCount, esperando: pool.waitingCount, max: config.db.max };
}

module.exports = { pool, query, unaFila, filas, transaccion, conexion, verificar, cerrar, estado, descripcion };
