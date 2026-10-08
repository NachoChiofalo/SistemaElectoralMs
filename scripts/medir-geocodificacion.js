#!/usr/bin/env node
/**
 * Mide que porcentaje del padron se puede ubicar en una manzana (018, factibilidad).
 *
 *   node scripts/medir-geocodificacion.js                       usa DATABASE_URL del .env
 *   node scripts/medir-geocodificacion.js --localidad ALCIRA     fuerza la localidad
 *   node scripts/medir-geocodificacion.js --detalle pendientes.csv
 *   node scripts/medir-geocodificacion.js --localidad ALCIRA --probar "GRAL PAZ 353" --probar "RIVADAVIA 586"
 *
 * SOLO LECTURA. Contra la base lee unicamente `domicilio` y `circuito` (agrupados, sin DNI ni
 * nombres) con la transaccion en modo lectura. Lo unico que sale de la maquina son dos
 * consultas a una API publica de la Direccion de Estadistica y Censos de Cordoba para bajar el
 * callejero y las manzanas de la localidad. **Ningun domicilio del padron se envia a nadie**: la
 * comparacion se hace aca.
 *
 * Como funciona, porque es lo que se esta midiendo:
 *   1. El eje de calles trae un tramo por cuadra, con la altura inicial y final de cada lado
 *      (izquierdo = impares, derecho = pares). Se busca el tramo cuyo rango contiene el numero.
 *   2. Las lineas del eje NO estan dibujadas en el sentido de la numeracion, asi que se deduce
 *      encadenando las cuadras vecinas de la misma calle.
 *   3. Se interpola el punto sobre la cuadra y se corre `offset` metros hacia el lado que le toca
 *      (impares a la izquierda al crecer la numeracion, como en toda la Argentina).
 *   4. Se ve en que poligono de manzana cae ese punto.
 * Lo que no se puede resolver queda como PENDIENTE con su motivo; nunca se inventa un punto.
 *
 * Las calles "parecidas" (mismo apellido, otro nombre) NO se ubican por defecto: salen como pendientes con la
 * sugerencia, para que las revises. `--aceptar-parecidas` las incluye.
 *
 * Verificar a mano el lado de la calle: `--probar` imprime las coordenadas, que se pegan en
 * Google Maps. Si caen en la vereda de enfrente, se corre con `--invertir-lado`.
 */

// La logica vive en el modulo territorio (018); este script solo la usa para medir.
const {
  resolver, construirIndice, ESTADOS, ALTURA_MIN,
} = require('../src/modules/territorio/ubicacion');
const { descargarLocalidad } = require('../src/modules/territorio/capas');

// ------------------------------------------------------------------ programa

function argumentos(argv) {
  const a = { probar: [], offset: 14 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--localidad') a.localidad = argv[++i];
    else if (k === '--departamento') a.departamento = argv[++i];
    else if (k === '--offset') a.offset = Number(argv[++i]);
    else if (k === '--invertir-lado') a.invertirLado = true;
    else if (k === '--aceptar-parecidas') a.aceptarParecidas = true;
    else if (k === '--sin-sentido-estimado') a.sinSentidoEstimado = true;
    else if (k === '--detalle') a.detalle = argv[++i];
    else if (k === '--probar') a.probar.push(argv[++i]);
    else if (k === '--ayuda' || k === '-h') a.ayuda = true;
    else throw new Error(`Argumento desconocido: ${k}`);
  }
  return a;
}

const pct = (n, total) => (total ? `${((100 * n) / total).toFixed(1)}%` : '-');
const num = (n) => Number(n).toLocaleString('es-AR');

async function leerPadron() {
  require('dotenv').config();
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (en el .env o en el entorno)');

  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const cliente = await pool.connect();
  try {
    await cliente.query('SET default_transaction_read_only = on');
    // Agrupado: no se lee ni un DNI ni un nombre.
    const r = await cliente.query('SELECT domicilio, circuito, COUNT(*)::int AS votantes FROM padron.votantes GROUP BY domicilio, circuito');
    return r.rows;
  } finally {
    cliente.release();
    await pool.end();
  }
}

function inferirLocalidad(filas) {
  const cuenta = new Map();
  for (const f of filas) {
    const m = String(f.circuito || '').match(/-\s*(.+)$/);
    if (m) cuenta.set(m[1].trim(), (cuenta.get(m[1].trim()) || 0) + f.votantes);
  }
  const orden = [...cuenta].sort((a, b) => b[1] - a[1]);
  return { elegida: orden[0]?.[0] || null, todas: orden };
}

async function main() {
  const args = argumentos(process.argv.slice(2));
  if (args.ayuda) {
    console.log('Uso: node scripts/medir-geocodificacion.js [--localidad NOMBRE] [--departamento NOMBRE] [--offset 14] [--invertir-lado] [--aceptar-parecidas] [--sin-sentido-estimado] [--detalle archivo.csv] [--probar "CALLE 123"]...');
    return;
  }

  let filas = [];
  let localidad = args.localidad;
  if (!args.probar.length) {
    filas = await leerPadron();
    if (!localidad) {
      const { elegida, todas } = inferirLocalidad(filas);
      if (!elegida) throw new Error('No pude deducir la localidad desde el circuito: pasala con --localidad');
      localidad = elegida;
      if (todas.length > 1) console.log(`Aviso: el padron tiene circuitos de varias localidades (${todas.map(([n, v]) => `${n}: ${num(v)}`).join(', ')}); se mide ${localidad}.`);
    }
  } else if (!localidad) {
    throw new Error('Con --probar hace falta --localidad');
  }

  console.log(`Descargando el callejero y las manzanas de "${localidad}" (datos publicos; no se envia nada del padron)...`);
  const { tramos, manzanas, localidades } = await descargarLocalidad(localidad, { departamento: args.departamento });
  const indice = construirIndice(tramos, manzanas, { estimarSentido: !args.sinSentidoEstimado });
  const conNumeracion = tramos.filter((t) => ALTURA_MIN(t) < Infinity).length;
  const orientados = [...indice.porCalle.values()].flat().filter((t) => t.bajo === 0 || t.bajo === 1).length;
  console.log(`Localidad del callejero: ${localidades.join(', ')} | tramos: ${num(tramos.length)} (con numeracion: ${num(conNumeracion)}, orientados: ${num(orientados)}) | manzanas: ${num(manzanas.length)}\n`);

  const opciones = { offsetM: args.offset, invertirLado: Boolean(args.invertirLado), aceptarParecidas: Boolean(args.aceptarParecidas) };

  if (args.probar.length) {
    for (const dom of args.probar) {
      const r = resolver(indice, dom, opciones);
      const donde = r.estado === 'ok' || r.estado === 'sin_manzana' ? ` | ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)} | ${r.calle}` : '';
      console.log(`${dom.padEnd(30)} -> ${r.estado === 'ok' ? `manzana ${r.manzana}` : `PENDIENTE: ${ESTADOS[r.estado]}`}${donde}`);
    }
    console.log('\nPegá las coordenadas en Google Maps: si caen en la vereda de enfrente, repetí con --invertir-lado.');
    return;
  }

  const total = filas.reduce((s, f) => s + f.votantes, 0);
  const cuentas = {}; const pendientes = {}; const porManzana = new Map(); const detalle = []; const aproximadas = new Map(); let estimados = 0;
  for (const f of filas) {
    const r = resolver(indice, f.domicilio, opciones);
    cuentas[r.estado] = (cuentas[r.estado] || 0) + f.votantes;
    if (r.estado === 'ok') {
      porManzana.set(r.manzana, (porManzana.get(r.manzana) || 0) + f.votantes);
      if (r.estimado) estimados += f.votantes;
      if (r.aproximada) { const par = `${r.buscada}  ->  ${r.calle}`; aproximadas.set(par, (aproximadas.get(par) || 0) + f.votantes); }
    }
    else {
      const grupo = (pendientes[r.estado] ||= new Map());
      grupo.set(r.clave, (grupo.get(r.clave) || 0) + f.votantes);
      detalle.push([f.domicilio ?? '', r.estado, f.votantes]);
    }
  }

  console.log(`Votantes en el padron: ${num(total)}\n`);
  for (const [estado, descripcion] of Object.entries(ESTADOS)) {
    const n = cuentas[estado] || 0;
    console.log(`  ${descripcion.padEnd(58)} ${num(n).padStart(8)}  ${pct(n, total).padStart(6)}`);
  }

  if (estimados) console.log(`\nDe los ubicados, ${num(estimados)} (${pct(estimados, total)}) usan un sentido de numeracion ESTIMADO por cercania al centro (cuadras de 600 o mas; acierta ~99 %).`);

  const conteos = [...porManzana.values()].sort((a, b) => a - b);
  console.log(`\nManzanas con al menos un votante: ${num(porManzana.size)} de ${num(manzanas.length)}` +
    (conteos.length ? ` | votantes por manzana: minimo ${conteos[0]}, mediana ${conteos[Math.floor(conteos.length / 2)]}, maximo ${conteos[conteos.length - 1]}` : ''));

  if (aproximadas.size) {
    const total = [...aproximadas.values()].reduce((a, b) => a + b, 0);
    console.log(`\nUbicados por coincidencia APROXIMADA del nombre (--aceptar-parecidas): ${num(total)} votantes. Revisar que sean la misma calle:`);
    for (const [par, n] of [...aproximadas].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${par}`);
  }

  for (const estado of Object.keys(pendientes)) {
    if (estado === 'sin_domicilio') continue;
    const top = [...pendientes[estado]].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`\nPendientes: ${ESTADOS[estado]} (los 10 mas frecuentes, por calle)`);
    for (const [clave, n] of top) console.log(`  ${String(n).padStart(5)}  ${clave}`);
  }

  if (args.detalle) {
    const fs = require('fs');
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    fs.writeFileSync(args.detalle, ['domicilio,motivo,votantes', ...detalle.map(([d, e, n]) => `${esc(d)},${esc(ESTADOS[e])},${n}`)].join('\n'), 'utf8');
    console.log(`\nDetalle de los pendientes escrito en ${args.detalle} (contiene domicilios: guardalo solo en tu maquina).`);
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(`\nError: ${error.message}`); process.exit(1); });
}

module.exports = { inferirLocalidad };
