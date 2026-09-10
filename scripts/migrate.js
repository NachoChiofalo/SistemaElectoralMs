#!/usr/bin/env node
/**
 * CLI de migraciones.
 *
 *   npm run migrate           aplica las migraciones pendientes de todos los modulos
 *   npm run migrate:status    muestra que hay aplicado y que falta, sin tocar nada
 *   npm run migrate:adopt     marca las migraciones como aplicadas SIN ejecutarlas
 *
 * `adopt` es el modo de transicion: la base de Supabase ya tiene el esquema creado por
 * el codigo viejo (los CREATE TABLE IF NOT EXISTS del arranque), asi que la primera
 * migracion de cada modulo describe un estado que ya existe. Se corre UNA vez, contra
 * la base existente, antes del primer deploy del monolito.
 */

const path = require('path');
const fs = require('fs');
const db = require('../src/core/db');
const { logger } = require('../src/core/logger');
const { migrarTodo, asegurarTabla, TABLA } = require('../src/core/migrations');
const modulos = require('../src/modules');

async function estado() {
  await asegurarTabla();

  for (const modulo of modulos) {
    if (!modulo.migrations || !fs.existsSync(modulo.migrations)) continue;

    const enDisco = fs.readdirSync(modulo.migrations).filter((f) => f.endsWith('.sql')).sort();
    const aplicadas = new Set(
      (await db.filas(`SELECT nombre FROM ${TABLA} WHERE modulo = $1`, [modulo.name])).map((f) => f.nombre),
    );

    console.log(`\n${modulo.name}`);
    for (const archivo of enDisco) {
      console.log(`  ${aplicadas.has(archivo) ? '[x]' : '[ ]'} ${archivo}`);
    }
    if (enDisco.length === 0) console.log('  (sin migraciones)');
  }
  console.log('');
}

async function main() {
  const comando = process.argv[2] || 'up';

  if (comando === 'status') {
    await estado();
    return;
  }

  if (comando === 'adopt') {
    console.log('Marcando migraciones como aplicadas SIN ejecutarlas.');
    console.log('Usar solo contra una base que ya tiene el esquema creado.\n');
    await migrarTodo(modulos, { marcarSinAplicar: true });
    await estado();
    return;
  }

  if (comando === 'up') {
    await migrarTodo(modulos);
    return;
  }

  console.error(`Comando desconocido: ${comando}. Usa: up | status | adopt`);
  process.exitCode = 1;
}

main()
  .catch((error) => {
    logger.error('Fallo la migracion', error);
    process.exitCode = 1;
  })
  .finally(() => db.cerrar().catch(() => {}));
