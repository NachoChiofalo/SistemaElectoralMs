/**
 * Descarga y normalizacion de las capas territoriales de una localidad (018).
 *
 * Fuente: el portal de datos geograficos de la Direccion General de Estadistica y Censos de Cordoba
 * (ArcGIS, publico). Tres capas:
 *   - Visualizador_de_calles  un tramo por cuadra, con la altura inicial y final de cada lado.
 *   - Manzanas_callejero      el poligono de cada manzana.
 *   - Radios2022              los radios censales del INDEC con datos del Censo 2022. En la etapa 1 son el
 *                             nivel "barrio" (ver la tarea 022 del backlog).
 *
 * Esto NO corre en el servidor web: lo usa el script de carga, que corre a mano el dueno del sistema. Ninguna
 * ruta consulta esta API: las capas se copian a la base de cada instancia (el portal tuvo caidas). Y nunca se
 * envia nada del padron: solo se piden capas publicas por nombre de localidad y por envolvente.
 *
 * `fetch` se recibe por parametro para poder probar todo esto sin red.
 */

const { repararMojibake, quitarAcentos, puntoEnPoligono, cajaDe } = require('./ubicacion');

const BASE = 'https://services6.arcgis.com/iv0BLxm1Ob5oB8rs/arcgis/rest/services';
const TAMANO_PAGINA = 1000;
// Margen alrededor de las calles para traer las manzanas y radios del borde (~200 m).
const MARGEN_GRADOS = 0.002;
// Coordenadas a 7 decimales (~1 cm): el portal manda 15 y solo agregan peso.
const r7 = (n) => Math.round(n * 1e7) / 1e7;
const redondear = (puntos) => puntos.map(([x, y]) => [r7(x), r7(y)]);

/** Una consulta a una capa, con reintentos. Un error del servicio llega como JSON con `error`. */
async function pedir(servicio, parametros, { fetch: fetchFn = globalThis.fetch, pausaMs = 1500, intentos = 3 } = {}) {
  const url = `${BASE}/${encodeURIComponent(servicio)}/FeatureServer/0/query?${new URLSearchParams({
    f: 'json', outSR: '4326', resultRecordCount: String(TAMANO_PAGINA), ...parametros,
  })}`;
  let ultimo = null;
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      const respuesta = await fetchFn(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'sistema-electoral-territorio/1.0' } });
      const cuerpo = await respuesta.json();
      if (cuerpo.error) throw new Error(cuerpo.error.message || JSON.stringify(cuerpo.error));
      return cuerpo;
    } catch (error) {
      ultimo = error;
      if (intento < intentos && pausaMs > 0) await new Promise((res) => setTimeout(res, pausaMs * intento));
    }
  }
  throw new Error(`No se pudo consultar la capa ${servicio} del portal de Estadistica de Cordoba: ${ultimo.message}`);
}

/** Todas las filas de una consulta, pagina por pagina, mientras el servicio diga que hay mas. */
async function paginado(servicio, parametros, opciones) {
  const filas = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const pagina = await pedir(servicio, { ...parametros, resultOffset: String(desde) }, opciones);
    filas.push(...(pagina.features || []));
    if (!pagina.exceededTransferLimit) break;
  }
  return filas;
}

const textoSql = (s) => quitarAcentos(String(s)).toUpperCase().replace(/'/g, "''");

function envolvente(puntos, margen = MARGEN_GRADOS) {
  const xs = puntos.map((p) => p[0]);
  const ys = puntos.map((p) => p[1]);
  return [Math.min(...xs) - margen, Math.min(...ys) - margen, Math.max(...xs) + margen, Math.max(...ys) + margen];
}

const porEnvolvente = (caja) => ({
  where: '1=1', geometry: caja.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
});

/**
 * Descarga las tres capas de una localidad. `localidad` se busca por nombre en el callejero (en Alcira
 * Gigena el callejero dice "ALCIRA"); `departamento` desambigua si hay dos con el mismo nombre.
 */
async function descargarLocalidad(localidad, { departamento, ...opciones } = {}) {
  let donde = `NAM_LC LIKE '%${textoSql(localidad)}%'`;
  if (departamento) donde += ` AND NAM_DE LIKE '%${textoSql(departamento)}%'`;

  const filas = await paginado('Visualizador_de_calles', { where: donde, outFields: 'NAM,NAM_LC,NAM_DE,AII,AFI,AID,AFD', returnGeometry: 'true' }, opciones);
  const tramos = filas.map((f) => ({
    nombre: repararMojibake(f.attributes.NAM || '').trim(),
    aii: f.attributes.AII, afi: f.attributes.AFI, aid: f.attributes.AID, afd: f.attributes.AFD,
    camino: redondear((f.geometry?.paths || []).flat()),
  })).filter((t) => t.camino.length >= 2);
  if (!tramos.length) throw new Error(`No hay calles para la localidad "${localidad}" en el callejero. Probá con otro nombre (sin acentos) o con --departamento.`);

  const localidades = [...new Set(filas.map((f) => `${f.attributes.NAM_LC} (${f.attributes.NAM_DE})`))];
  const caja = envolvente(tramos.flatMap((t) => t.camino));

  const bloques = await paginado('Manzanas_callejero', { ...porEnvolvente(caja), outFields: 'ID', returnGeometry: 'true' }, opciones);
  const manzanas = bloques
    .map((b) => ({ id: Number(b.attributes.ID), anillos: (b.geometry?.rings || []).map(redondear) }))
    .filter((m) => Number.isFinite(m.id) && m.anillos.length);

  const radios = await paginado('Radios2022', { ...porEnvolvente(caja), outFields: 'LINK,CFN,CRO,POB_2022,VIVIENDAS', returnGeometry: 'true' }, opciones);
  const sectores = radios
    .map((r) => ({
      codigo: String(r.attributes.LINK),
      nombre: `Radio ${r.attributes.CFN}.${r.attributes.CRO}`,
      anillos: (r.geometry?.rings || []).map(redondear),
      poblacion: Number.isFinite(r.attributes.POB_2022) ? r.attributes.POB_2022 : null,
      viviendas: Number.isFinite(r.attributes.VIVIENDAS) ? r.attributes.VIVIENDAS : null,
    }))
    .filter((s) => s.anillos.length);

  return { tramos, manzanas, sectores, localidades, caja };
}

/** Centroide de area del anillo exterior (shoelace); si el area es nula, el promedio de los vertices. */
function centroide(anillos) {
  const anillo = anillos[0] || [];
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i, i += 1) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    const f = xj * yi - xi * yj;
    area += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
  }
  if (Math.abs(area) < 1e-15) {
    const n = anillo.length || 1;
    return [anillo.reduce((a, p) => a + p[0], 0) / n, anillo.reduce((a, p) => a + p[1], 0) / n];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/**
 * A que sector (radio censal) pertenece cada manzana: al que contiene su centroide. Devuelve un Map
 * id de manzana -> codigo de sector, o null si no cae en ninguno ("sin barrio").
 */
function asignarSectores(manzanas, sectores) {
  const conCaja = sectores.map((s) => ({ ...s, caja: cajaDe(s.anillos) }));
  const asignacion = new Map();
  for (const m of manzanas) {
    const c = centroide(m.anillos);
    const s = conCaja.find((x) => c[0] >= x.caja[0] && c[0] <= x.caja[2] && c[1] >= x.caja[1] && c[1] <= x.caja[3]
      && puntoEnPoligono(c, x.anillos));
    asignacion.set(m.id, s ? s.codigo : null);
  }
  return asignacion;
}

module.exports = { BASE, pedir, paginado, descargarLocalidad, asignarSectores, centroide, envolvente };
