#!/usr/bin/env node
/**
 * Carga las capas territoriales de la localidad de esta instancia y ubica al padron (018).
 *
 *   npm run territorio:cargar -- ALCIRA                             muestra que cargaria, sin escribir
 *   npm run territorio:cargar -- ALCIRA si                          carga y ubica (en cualquier consola)
 *   node scripts/territorio-cargar.js --localidad ALCIRA --departamento "RIO CUARTO" --si
 *
 * Lo corre el dueno del sistema, a mano, una vez por localidad (como seed:usuarios). Usa la DATABASE_URL
 * del entorno: SIN --si no escribe nada y muestra a que base apunta, para no cargar en la equivocada.
 *
 * Descarga del portal publico de la Direccion de Estadistica y Censos de Cordoba el callejero con alturas,
 * las manzanas y los radios censales 2022, y los copia a la base (esquema territorio). No envia nada del
 * padron. Despues ubica a todos los votantes. Recargar reemplaza las capas conservando los ids de manzana.
 *
 * Pendiente (tarea 023 del backlog): licencia de uso de esos datos, y cada cuanto refrescarlos.
 */

const db = require('../src/core/db');
const { logger } = require('../src/core/logger');
const { descargarLocalidad, asignarSectores } = require('../src/modules/territorio/capas');
const { TerritorioRepository } = require('../src/modules/territorio/repository');
const { TerritorioService } = require('../src/modules/territorio/service');
const { ALTURA_MIN } = require('../src/modules/territorio/ubicacion');

const FUENTE = 'Direccion General de Estadistica y Censos de Cordoba (Visualizador_de_calles, Manzanas_callejero, Radios2022)';

/**
 * Lee los argumentos. En PowerShell, `npm run territorio:cargar -- --localidad ALCIRA --si` NO llega asi:
 * PowerShell se come el `--` y npm se queda con todo lo que empieza con guiones como configuracion propia. Al
 * script solo le llegan las palabras sueltas (`ALCIRA`), y el `--si` se pierde sin aviso (comprobado en
 * produccion: quedo en modo prueba, que es el comportamiento seguro). Por eso la localidad y la confirmacion
 * se aceptan tambien como palabras sueltas: `npm run territorio:cargar -- ALCIRA si` funciona en cualquier
 * consola. Algunas versiones de npm dejan las opciones en npm_config_*; se aprovechan si estan.
 */
function argumentos(argv, entorno = process.env) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--localidad') a.localidad = argv[++i];
    else if (k === '--departamento') a.departamento = argv[++i];
    else if (k === '--si' || /^s[ií]$/i.test(k)) a.si = true;
    else if (k === '--ayuda' || k === '-h') a.ayuda = true;
    else if (!k.startsWith('-') && !a.localidad) a.localidad = k;
    else throw new Error(`Argumento desconocido: ${k}`);
  }
  if (!a.localidad && entorno.npm_config_localidad) a.localidad = entorno.npm_config_localidad;
  if (!a.departamento && entorno.npm_config_departamento) a.departamento = entorno.npm_config_departamento;
  if (entorno.npm_config_si === 'true') a.si = true;
  return a;
}

const num = (n) => Number(n).toLocaleString('es-AR');

async function main() {
  const args = argumentos(process.argv.slice(2));
  if (args.ayuda || !args.localidad) {
    console.log('Uso: npm run territorio:cargar -- NOMBRE [si]   (o: node scripts/territorio-cargar.js --localidad NOMBRE [--departamento NOMBRE] [--si])');
    if (!args.ayuda) process.exitCode = 1;
    return;
  }

  console.log(`Base de destino: ${db.descripcion}`);
  console.log(`Descargando calles, manzanas y radios censales de "${args.localidad}" (datos publicos)...`);
  const capas = await descargarLocalidad(args.localidad, { departamento: args.departamento });
  const asignacion = asignarSectores(capas.manzanas, capas.sectores);
  // Un radio sin ninguna manzana es campo: no aporta al mapa urbano y solo agranda el dibujo.
  const usados = new Set([...asignacion.values()].filter(Boolean));
  const descartados = capas.sectores.length - usados.size;
  capas.sectores = capas.sectores.filter((s) => usados.has(s.codigo));
  const conBarrio = [...asignacion.values()].filter(Boolean).length;
  const conNumeracion = capas.tramos.filter((t) => ALTURA_MIN(t) < Infinity).length;

  console.log(`Localidad en el callejero: ${capas.localidades.join(', ')}`);
  console.log(`  tramos de calle: ${num(capas.tramos.length)} (con numeracion: ${num(conNumeracion)})`);
  console.log(`  manzanas: ${num(capas.manzanas.length)} (dentro de un radio: ${num(conBarrio)})`);
  console.log(`  radios censales: ${num(capas.sectores.length)} con manzanas (se descartan ${num(descartados)} sin ninguna, que son campo)`);
  if (capas.localidades.length > 1) {
    console.log('  AVISO: el nombre coincide con mas de una localidad; acotalo con --departamento.');
  }

  if (!args.si) {
    console.log('\nModo prueba: no se escribio nada. Si la base y los conteos son los correctos, repeti confirmando:');
    console.log(`  npm run territorio:cargar -- ${args.localidad} si`);
    console.log(`  (o: node scripts/territorio-cargar.js --localidad ${args.localidad} --si)`);
    return;
  }

  const repo = new TerritorioRepository(db);
  await db.transaccion((cliente) => repo.reemplazarCapas(cliente, {
    ...capas,
    asignacion,
    configuracion: { localidad: args.localidad, departamento: args.departamento, fuente: FUENTE },
  }));
  console.log('\nCapas cargadas. Ubicando al padron...');

  const servicio = new TerritorioService(repo, { db, logger });
  const r = await servicio.reubicar();
  console.log(`Votantes: ${num(r.total)} | ubicados en una manzana: ${num(r.ubicados)} (${r.total ? ((100 * r.ubicados) / r.total).toFixed(1) : 0} %) | ${r.duracionMs} ms`);
  for (const [estado, n] of Object.entries(r.porEstado).sort((a, b) => b[1] - a[1])) {
    if (estado !== 'ok') console.log(`  ${estado.padEnd(22)} ${num(n)}`);
  }
}

if (require.main === module) {
  main()
    // Un error de conexion de Node puede venir sin mensaje (AggregateError): se muestra el codigo.
    .catch((error) => { console.error(`\nError: ${error.message || error.code || String(error)}`); process.exitCode = 1; })
    .finally(() => db.cerrar());
}

module.exports = { argumentos };
