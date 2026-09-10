/**
 * Runner de migraciones.
 *
 * Antes el esquema se creaba en cada arranque con CREATE TABLE IF NOT EXISTS y ALTER
 * TABLE ... ADD COLUMN IF NOT EXISTS. Eso costaba decenas de round-trips a Supabase en
 * cada boot y no dejaba registro de que version del esquema estaba aplicada.
 *
 * Ahora cada modulo trae una carpeta migrations/ con archivos SQL numerados que corren
 * una sola vez, dentro de una transaccion, y quedan registrados en schema_migrations.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { logger } = require('./logger');

const TABLA = 'public.schema_migrations';

async function asegurarTabla() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      modulo      VARCHAR(64)  NOT NULL,
      nombre      VARCHAR(255) NOT NULL,
      checksum    CHAR(64)     NOT NULL,
      aplicada_en TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      PRIMARY KEY (modulo, nombre)
    )
  `);
}

function leerMigraciones(directorio) {
  if (!directorio || !fs.existsSync(directorio)) return [];

  return fs.readdirSync(directorio)
    .filter((archivo) => archivo.endsWith('.sql'))
    .sort() // el prefijo numerico define el orden: 001_, 002_, ...
    .map((archivo) => {
      const sql = fs.readFileSync(path.join(directorio, archivo), 'utf8');
      return {
        nombre: archivo,
        sql,
        checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex'),
      };
    });
}

/**
 * Aplica las migraciones pendientes de un modulo.
 *
 * @param {boolean} opciones.marcarSinAplicar  Registra las migraciones como aplicadas
 *   sin ejecutarlas. Es el modo de adopcion para una base que ya tiene el esquema
 *   creado por el codigo viejo.
 */
async function migrarModulo(modulo, directorio, opciones = {}) {
  const migraciones = leerMigraciones(directorio);
  if (migraciones.length === 0) return { aplicadas: 0, pendientes: 0 };

  const yaAplicadas = await db.filas(
    `SELECT nombre, checksum FROM ${TABLA} WHERE modulo = $1`,
    [modulo],
  );
  const porNombre = new Map(yaAplicadas.map((f) => [f.nombre, f.checksum]));

  let aplicadas = 0;

  for (const migracion of migraciones) {
    const checksumPrevio = porNombre.get(migracion.nombre);

    if (checksumPrevio) {
      // Una migracion ya aplicada no se vuelve a correr, pero si cambio en disco es un
      // error de proceso: alguien edito historia en lugar de agregar una migracion nueva.
      if (checksumPrevio !== migracion.checksum) {
        logger.warn('Una migracion ya aplicada cambio en disco', { modulo, migracion: migracion.nombre });
      }
      continue;
    }

    if (opciones.marcarSinAplicar) {
      await db.query(
        `INSERT INTO ${TABLA} (modulo, nombre, checksum) VALUES ($1, $2, $3)`,
        [modulo, migracion.nombre, migracion.checksum],
      );
      logger.info('Migracion marcada como aplicada (adopcion)', { modulo, migracion: migracion.nombre });
      aplicadas += 1;
      continue;
    }

    // El SQL y su registro van en la misma transaccion: no puede quedar aplicada a
    // medias ni aplicada sin registrar.
    await db.transaccion(async (cliente) => {
      await cliente.query(migracion.sql);
      await cliente.query(
        `INSERT INTO ${TABLA} (modulo, nombre, checksum) VALUES ($1, $2, $3)`,
        [modulo, migracion.nombre, migracion.checksum],
      );
    });

    logger.info('Migracion aplicada', { modulo, migracion: migracion.nombre });
    aplicadas += 1;
  }

  return { aplicadas, pendientes: migraciones.length - porNombre.size - aplicadas };
}

/** Cuantas migraciones quedan sin aplicar, sin aplicar ninguna. Lo usa el arranque. */
async function contarPendientes(modulos) {
  await asegurarTabla();
  let pendientes = 0;

  for (const modulo of modulos) {
    if (!modulo.migrations) continue;
    const migraciones = leerMigraciones(modulo.migrations);
    if (migraciones.length === 0) continue;

    const aplicadas = await db.filas(`SELECT nombre FROM ${TABLA} WHERE modulo = $1`, [modulo.name]);
    const nombres = new Set(aplicadas.map((f) => f.nombre));
    pendientes += migraciones.filter((m) => !nombres.has(m.nombre)).length;
  }

  return pendientes;
}

/** Aplica las migraciones de todos los modulos, en el orden en que estan registrados. */
async function migrarTodo(modulos, opciones = {}) {
  await asegurarTabla();
  let total = 0;

  for (const modulo of modulos) {
    if (!modulo.migrations) continue;
    const { aplicadas } = await migrarModulo(modulo.name, modulo.migrations, opciones);
    total += aplicadas;
  }

  if (total === 0) logger.info('Sin migraciones pendientes');
  else logger.info(`${total} migracion(es) aplicadas`);

  return total;
}

module.exports = { migrarTodo, migrarModulo, contarPendientes, asegurarTabla, TABLA };
