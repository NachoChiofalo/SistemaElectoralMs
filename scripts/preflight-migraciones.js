#!/usr/bin/env node
/**
 * Chequeo previo al deploy, SOLO LECTURA: cuenta las filas que violarian cada CHECK nuevo
 * y verifica que las migraciones pendientes no tropiecen con los datos actuales.
 *
 *   DATABASE_URL=... node scripts/preflight-migraciones.js
 *
 * Los CHECK van NOT VALID, asi que una fila mala no impide el arranque, pero esa fila
 * fallaria al modificarse. Todas las consultas son SELECT.
 */
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL'); process.exit(1); }

const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });

const CHEQUEOS = [
  ['comicio/005 votos_blancos < 0', 'SELECT COUNT(*) FROM elecciones.mesas WHERE votos_blancos < 0'],
  ['comicio/005 votos_nulos < 0', 'SELECT COUNT(*) FROM elecciones.mesas WHERE votos_nulos < 0'],
  ['comicio/005 numero de mesa <= 0', 'SELECT COUNT(*) FROM elecciones.mesas WHERE numero <= 0'],
  ['comicio/006 color de fuerza fuera de 1-8', 'SELECT COUNT(*) FROM elecciones.fuerzas WHERE color NOT BETWEEN 1 AND 8 OR color IS NULL'],
  ['comicio/006 tipo_eleccion invalido', "SELECT COUNT(*) FROM elecciones.comicios WHERE tipo_eleccion IS NULL OR tipo_eleccion NOT IN ('provincial','municipal','nacional')"],
  ['listas/004 tipo_eleccion invalido', "SELECT COUNT(*) FROM elecciones.listas WHERE tipo_eleccion IS NULL OR tipo_eleccion NOT IN ('provincial','municipal','nacional')"],
  ['listas/005 cantidad_lugares < 1', 'SELECT COUNT(*) FROM elecciones.listas WHERE cantidad_lugares < 1'],
  ['listas/005 candidatos.orden < 1', 'SELECT COUNT(*) FROM elecciones.candidatos WHERE orden < 1'],
  ['listas/005 suplentes.orden < 1', 'SELECT COUNT(*) FROM elecciones.suplentes WHERE orden < 1'],
  ['padron/006 anio_nac fuera de 1900-2100', 'SELECT COUNT(*) FROM padron.votantes WHERE anio_nac NOT BETWEEN 1900 AND 2100'],
  ['padron/006 edad fuera de 0-130', 'SELECT COUNT(*) FROM padron.votantes WHERE edad NOT BETWEEN 0 AND 130'],
  // Estos dos SI frenan el arranque: un EXCLUDE no admite NOT VALID y escanea las filas existentes.
  ['fiscales/002 [BLOQUEA] pares de asignaciones solapadas en una misma mesa', `SELECT COUNT(*) FROM elecciones.fiscal_asignaciones a JOIN elecciones.fiscal_asignaciones b ON a.id < b.id AND a.mesa_id = b.mesa_id AND a.desde < b.hasta AND b.desde < a.hasta`],
  ['fiscales/002 [BLOQUEA] pares de asignaciones solapadas de un mismo fiscal', `SELECT COUNT(*) FROM elecciones.fiscal_asignaciones a JOIN elecciones.fiscal_asignaciones b ON a.id < b.id AND a.fiscal_id = b.fiscal_id AND a.desde < b.hasta AND b.desde < a.hasta`],
  ['fiscales/002 [BLOQUEA] extension btree_gist no disponible', "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN 0 ELSE 1 END AS count"],
  ['(info) refresh tokens que auth/004 va a borrar (esas sesiones deberan volver a loguearse)', 'SELECT COUNT(*) FROM refresh_tokens'],
  ['(info) usernames con mayusculas', "SELECT COUNT(*) FROM usuarios WHERE username <> LOWER(username)"],
];

(async () => {
  let malas = 0;
  const cliente = await pool.connect();
  try {
    await cliente.query('SET default_transaction_read_only = on');
    for (const [nombre, sql] of CHEQUEOS) {
      try {
        const n = Number((await cliente.query(sql)).rows[0].count);
        const info = nombre.startsWith('(info)');
        console.log(`${n === 0 || info ? 'OK   ' : 'MAL  '} ${nombre}: ${n}`);
        if (n > 0 && !info) malas += 1;
      } catch (e) {
        console.log(`SKIP  ${nombre}: ${e.message}`);
      }
    }
    const tam = await cliente.query("SELECT COUNT(*) FROM padron.votantes");
    console.log(`\nVotantes: ${tam.rows[0].count} (padron/005 crea un indice; con decenas de miles sigue siendo rapido)`);
  } finally {
    cliente.release();
    await pool.end();
  }
  console.log(malas ? `\n${malas} chequeo(s) con filas que violarian el CHECK (no impiden el arranque; revisar).` : '\nSin conflictos con los datos actuales.');
})().catch((e) => { console.error(e.message); process.exit(1); });
