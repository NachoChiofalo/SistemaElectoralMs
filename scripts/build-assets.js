#!/usr/bin/env node
/**
 * Genera los assets locales del frontend: iconos y tipografia.
 *
 * Antes `public/` pedia Font Awesome completo y Google Fonts a dos CDN externos: unos
 * 300 KB de terceros para usar 79 iconos de los ~2000 que traia el paquete, con la
 * tipografia colgando de un `@import` anidado que bloquea el render hasta tres saltos.
 * Este script reemplaza las dos cosas por archivos servidos desde el mismo proceso.
 *
 * Los iconos son de Lucide, de trazo fino, y NO se emiten como sprite SVG: se emiten
 * como reglas CSS con `mask-image`. La diferencia importa porque el markup no cambia
 * —`<i class="fas fa-user">` sigue siendo valido— y los iconos que se arman en runtime
 * (`class="fas ${op.icon}"` en AuditoriaComponent y NavbarComponent) siguen funcionando
 * sin tocarlos. La equivalencia entre un nombre `fa-*` y su dibujo de Lucide esta en
 * `scripts/iconos-lucide.js`. El color sale de `currentColor`, asi que los iconos
 * heredan igual que cuando eran una fuente.
 *
 * Ademas prepara los assets para servirlos barato, que es lo que importa en un VPS
 * chico: estampa un `?v=<hash>` en las referencias del HTML para poder cachearlas un
 * año, y deja cada archivo de texto precomprimido en Brotli y gzip para que el proceso
 * no gaste CPU comprimiendo lo mismo en cada visita.
 *
 * Es idempotente y offline: las fuentes son devDependencies. Correrlo despues de tocar
 * cualquier cosa en `public/`; si un icono referenciado no tiene entrada en el mapa, el
 * script falla en vez de emitir un CSS con un hueco silencioso. Hay tests que fallan si
 * la salida quedo desactualizada respecto de las fuentes.
 *
 *   npm run build:assets
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const RAIZ = path.join(__dirname, '..');
const DIR_PUBLICO = path.join(RAIZ, 'public');
const DIR_ESTILOS = path.join(DIR_PUBLICO, 'src', 'styles');
const DIR_FUENTES = path.join(DIR_PUBLICO, 'assets', 'fonts');

const SVGS_LUCIDE = path.join(RAIZ, 'node_modules', 'lucide-static', 'icons');
const MAPA_ICONOS = require('./iconos-lucide');
const FILES_INTER = path.join(RAIZ, 'node_modules', '@fontsource', 'inter', 'files');

// Pesos que el frontend usa de verdad. Google Fonts servia seis; las hojas de estilo
// declaran 400/500/600/700 y dos casos sueltos de 800/900 que el navegador sintetiza
// desde 700. Cada peso es un archivo aparte y el navegador baja solo los que renderiza.
const PESOS = [400, 500, 600, 700];

// Iconos que no aparecen literales en el codigo porque se arman por concatenacion.
// `fa-sort-${direccion}` en PadronComponent y `fa-${tipo}-circle` en ResultadosComponent.
const EXTRAS = ['sort-up', 'sort-down', 'check-circle', 'times-circle', 'info-circle'];

// Fragmentos que el escaneo captura pero no son iconos: prefijos truncados de una
// interpolacion y el modificador de animacion.
const NO_SON_ICONOS = new Set(['', 'sort-', 'spin']);

// Los archivos que emite este script no se escanean: son salida, no fuente. Ademas
// `icons.css` se auto-envenena si se lee, porque la propiedad `--fa-icono` de cada
// regla matchea el patron de nombre y aparece como un icono llamado "icono".
const GENERADOS = new Set(['icons.css', 'fonts.css']);

/**
 * Recorre `public/` y devuelve sus archivos de texto.
 *
 * Por defecto omite los generados, que es lo que necesita el relevamiento de iconos.
 * `precomprimir()` pasa `incluirGenerados` porque a esos tambien hay que comprimirlos.
 */
function archivosDeFrontend(dir, { incluirGenerados = false } = {}) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'assets') continue;
      salida.push(...archivosDeFrontend(completo, { incluirGenerados }));
    } else if (/\.(html|js|css)$/.test(entrada.name) && (incluirGenerados || !GENERADOS.has(entrada.name))) {
      salida.push(completo);
    }
  }
  return salida;
}

/**
 * Junta los nombres de icono referenciados en el frontend.
 *
 * Se escanea en vez de mantener una lista a mano para que agregar un icono al HTML y
 * correr el build alcance: una lista manual se desincroniza en el primer olvido.
 */
function relevarIconos() {
  const nombres = new Set(EXTRAS);

  for (const archivo of archivosDeFrontend(DIR_PUBLICO)) {
    const contenido = fs.readFileSync(archivo, 'utf8');
    for (const [, nombre] of contenido.matchAll(/\bfa-([a-z0-9-]*)/g)) {
      if (!NO_SON_ICONOS.has(nombre)) nombres.add(nombre);
    }
  }

  return [...nombres].sort();
}

/**
 * Convierte un SVG de Lucide en los datos que necesita una regla CSS.
 *
 * Lucide dibuja con trazo, no con relleno: cada icono es un puñado de `<path>`,
 * `<circle>`, `<rect>`, `<line>` y `<polyline>` sin `fill`, sobre una grilla de 24x24.
 * Eso cambia dos cosas respecto de un set solido:
 *
 * 1. Hay que conservar todas las primitivas, no solo los `<path>`.
 * 2. El `stroke="currentColor"` del original no sirve. La imagen de una mascara se
 *    rinde aislada, fuera del arbol del documento, asi que `currentColor` no tiene
 *    contra que resolver y el trazo saldria transparente: el icono no se veria. Se fija
 *    un color opaco, que para una mascara da igual cual sea — solo cuenta el alfa.
 */
function leerIcono(nombre) {
  if (!nombre) return null;
  const archivo = path.join(SVGS_LUCIDE, `${nombre}.svg`);
  if (!fs.existsSync(archivo)) return null;

  const crudo = fs.readFileSync(archivo, 'utf8');
  const viewBox = crudo.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) return null;

  // El contenido entre la etiqueta de apertura y el cierre: son las primitivas.
  const cuerpo = crudo
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cuerpo) return null;

  const [, , ancho, alto] = viewBox.split(/\s+/).map(Number);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" ` +
    `stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</svg>`;

  return { viewBox, relacion: ancho / alto, dataUri: aDataUri(svg) };
}

/**
 * Codifica el SVG para `url()`.
 *
 * `encodeURIComponent` entero encarece mucho el CSS: escapa las comas y los espacios de
 * cada `d=`, que es casi todo el contenido. Alcanza con escapar lo que rompe un `url()`
 * entre comillas dobles, y el resultado pesa cerca de un tercio menos.
 */
function aDataUri(svg) {
  const escapado = svg
    .replace(/%/g, '%25')
    .replace(/"/g, "'")
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/\s+/g, ' ');
  return `data:image/svg+xml,${escapado}`;
}

function generarIconos() {
  const nombres = relevarIconos();
  const reglas = [];
  const faltantes = [];

  for (const nombre of nombres) {
    // La regla se emite con el nombre que usa el markup y el dibujo se busca por el
    // nombre de Lucide, segun `iconos-lucide.js`. Asi el frontend conserva sus 181
    // usos de `fa-*` sin migrar nada.
    const icono = leerIcono(MAPA_ICONOS[nombre]);
    if (!icono) {
      faltantes.push(nombre);
      continue;
    }

    // Lucide dibuja todo sobre una grilla cuadrada de 24x24, asi que la relacion es
    // siempre 1 y no hace falta corregir el ancho por icono como con Font Awesome.
    const ancho = icono.relacion === 1 ? '' : `\n  width: ${icono.relacion.toFixed(4).replace(/0+$/, '')}em;`;
    reglas.push(`.fa-${nombre} {\n  --fa-icono: url("${icono.dataUri}");${ancho}\n}`);
  }

  if (faltantes.length > 0) {
    throw new Error(
      `Iconos usados en public/ sin dibujo de Lucide: ${faltantes.join(', ')}.\n` +
      'Agregalos a scripts/iconos-lucide.js apuntando a un icono de lucide-static.'
    );
  }

  const css = `/* ==========================================================================
   ICONOS — generado por scripts/build-assets.js. No editar a mano.

   Iconos de Lucide (trazo fino). El markup no cambia: <i class="fas fa-user">
   sigue andando, pero el glifo ahora es una mascara CSS y el color sale de
   currentColor, asi que hereda igual que antes.

   Para agregar un icono: usalo en public/ y corre \`npm run build:assets\`.
   ========================================================================== */

.fas {
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask-image: var(--fa-icono);
  mask-image: var(--fa-icono);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  flex-shrink: 0;
}

/* Un <i class="fas"> sin icono resuelto no deja un cuadrado de color a la deriva. */
.fas:not([class*=" fa-"]):not([class^="fa-"]) {
  background-color: transparent;
}

.fa-spin {
  animation: fa-spin 1s linear infinite;
}

@keyframes fa-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .fa-spin { animation: none; }
}

${reglas.join('\n\n')}
`;

  fs.writeFileSync(path.join(DIR_ESTILOS, 'icons.css'), css);
  return { cantidad: reglas.length, bytes: Buffer.byteLength(css) };
}

function generarFuentes() {
  fs.mkdirSync(DIR_FUENTES, { recursive: true });

  const caras = [];
  let bytes = 0;

  for (const peso of PESOS) {
    const archivo = `inter-latin-${peso}-normal.woff2`;
    const origen = path.join(FILES_INTER, archivo);
    if (!fs.existsSync(origen)) throw new Error(`Falta ${origen}. Corre npm install.`);

    const destino = path.join(DIR_FUENTES, archivo);
    fs.copyFileSync(origen, destino);
    bytes += fs.statSync(origen).size;

    // El mismo hash que `estampar()` le pone al <link rel="preload"> del HTML. Si las
    // dos URL no coincidieran, el navegador bajaria la fuente dos veces: una por el
    // preload y otra por la @font-face.
    caras.push(`@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${peso};
  font-display: swap;
  src: url('/assets/fonts/${archivo}?v=${hashDe(destino)}') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191,
    U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}`);
  }

  const css = `/* ==========================================================================
   TIPOGRAFIA — generado por scripts/build-assets.js. No editar a mano.

   Inter servida desde el mismo origen. Antes era un @import a Google Fonts dentro de
   design-system.css: el navegador tenia que bajar y parsear esa hoja para recien
   enterarse de que existia otra hoja, y recien despues pedir las fuentes. Tres saltos
   encadenados bloqueando el primer render, contra cero ahora.

   Subset latin, que cubre castellano completo. font-display: swap muestra el texto con
   la fuente de sistema mientras baja Inter, en vez de dejar la pagina en blanco.
   ========================================================================== */

${caras.join('\n\n')}
`;

  fs.writeFileSync(path.join(DIR_ESTILOS, 'fonts.css'), css);
  return { cantidad: PESOS.length, bytes };
}

// ---- versionado de referencias -------------------------------------------

/** Ocho caracteres de sha256 alcanzan de sobra para distinguir versiones de un archivo. */
function hashDe(rutaAbsoluta) {
  return crypto.createHash('sha256').update(fs.readFileSync(rutaAbsoluta)).digest('hex').slice(0, 8);
}

/** Extensiones que se versionan: las que el HTML referencia y conviene cachear un año. */
const VERSIONABLES = new Set(['.css', '.js', '.woff2']);

/**
 * Resuelve el destino de un href/src del HTML a una ruta en disco.
 *
 * Devuelve null para lo que no hay que tocar: URL absolutas, anclas, `data:` y
 * cualquier cosa que apunte fuera de `public/`.
 */
function resolverReferencia(referencia) {
  if (/^([a-z]+:|\/\/|#|\?)/i.test(referencia)) return null;

  const sinConsulta = referencia.split('?')[0];
  if (!VERSIONABLES.has(path.extname(sinConsulta))) return null;

  const absoluta = path.join(DIR_PUBLICO, sinConsulta.replace(/^\//, ''));
  if (!absoluta.startsWith(DIR_PUBLICO)) return null;

  return fs.existsSync(absoluta) ? absoluta : null;
}

/**
 * Reescribe las referencias del HTML a `archivo.css?v=<hash del contenido>`.
 *
 * Esto es lo que habilita cachear los assets un año con `immutable`: la URL cambia
 * sola cuando cambia el contenido, asi que un deploy llega al navegador sin que haya
 * que revalidar nada. Antes cada visita repetida disparaba una condicional por archivo
 * —dieciseis viajes de ida y vuelta para recibir dieciseis 304— y bajar el TTL para
 * que los deploys llegaran solo empeoraba eso.
 *
 * El HTML se sigue sirviendo con `no-cache`, que es lo que hace que el `?v=` nuevo se
 * vea enseguida. Es tambien la razon por la que no hace falta renombrar los archivos:
 * el nombre en disco no cambia y el codigo se sigue leyendo igual.
 */
function estampar() {
  let referencias = 0;
  const paginas = [];

  for (const archivo of archivosDeFrontend(DIR_PUBLICO)) {
    if (path.extname(archivo) !== '.html') continue;

    const antes = fs.readFileSync(archivo, 'utf8');
    const despues = antes.replace(/(\b(?:href|src)=")([^"]+)(")/g, (completo, apertura, referencia, cierre) => {
      const destino = resolverReferencia(referencia);
      if (!destino) return completo;

      referencias++;
      const limpia = referencia.split('?')[0];
      return `${apertura}${limpia}?v=${hashDe(destino)}${cierre}`;
    });

    if (antes !== despues) {
      fs.writeFileSync(archivo, despues);
      paginas.push(path.basename(archivo));
    }
  }

  return { referencias, paginas };
}

// ---- precompresion --------------------------------------------------------

/**
 * Tipos que vale la pena precomprimir. Quedan afuera los woff2, que ya vienen
 * comprimidos: volver a pasarlos por Brotli los agranda.
 */
const COMPRIMIBLES = new Set(['.html', '.css', '.js', '.svg', '.json']);

// Por debajo de esto el ahorro no paga ni el archivo extra en disco.
const MINIMO_A_COMPRIMIR = 512;

/**
 * Deja un `.br` y un `.gz` al lado de cada archivo de texto de `public/`.
 *
 * `compression()` sigue montado para las respuestas de la API, que son dinamicas y hay
 * que comprimir en el momento. Pero los estaticos no cambian entre pedidos, y gzipear
 * los 43 KB de padron-styles.css en cada visita es CPU que en un VPS chico se le resta
 * a atender requests. Se comprime una vez, aca, con Brotli al maximo —que offline sale
 * gratis y comprime bastante mejor que lo que se puede pagar en caliente—.
 *
 * `core/estaticos.js` los sirve solo si son mas nuevos que su fuente, asi que olvidarse
 * de correr el build degrada a comprimir en vivo, no a servir contenido viejo.
 */
function precomprimir() {
  let archivos = 0;
  let original = 0;
  let brotli = 0;

  const vigentes = new Set();

  for (const archivo of archivosDeFrontend(DIR_PUBLICO, { incluirGenerados: true })) {
    if (!COMPRIMIBLES.has(path.extname(archivo))) continue;

    const contenido = fs.readFileSync(archivo);
    if (contenido.length < MINIMO_A_COMPRIMIR) continue;

    const comprimidoBr = zlib.brotliCompressSync(contenido, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: contenido.length,
      },
    });
    const comprimidoGz = zlib.gzipSync(contenido, { level: 9 });

    fs.writeFileSync(`${archivo}.br`, comprimidoBr);
    fs.writeFileSync(`${archivo}.gz`, comprimidoGz);
    vigentes.add(`${archivo}.br`);
    vigentes.add(`${archivo}.gz`);

    archivos++;
    original += contenido.length;
    brotli += comprimidoBr.length;
  }

  // Un .br cuya fuente ya no existe nunca se serviria, pero queda en la imagen y
  // confunde: si alguien borra una pagina, su comprimido se va con ella.
  let huerfanos = 0;
  for (const archivo of archivosComprimidos(DIR_PUBLICO)) {
    if (!vigentes.has(archivo)) {
      fs.unlinkSync(archivo);
      huerfanos++;
    }
  }

  return { archivos, original, brotli, huerfanos };
}

/** Los `.br`/`.gz` que hay hoy en disco, para detectar los que sobran. */
function archivosComprimidos(dir) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosComprimidos(completo));
    else if (/\.(br|gz)$/.test(entrada.name)) salida.push(completo);
  }
  return salida;
}

function main() {
  const iconos = generarIconos();
  const fuentes = generarFuentes();

  // El orden no es casual: primero se generan los assets, despues se los estampa en el
  // HTML —el hash tiene que ser el del archivo final— y recien al final se comprime,
  // para que el .br del HTML incluya los `?v=` recien puestos.
  const estampado = estampar();
  const comprimido = precomprimir();

  const kb = n => `${(n / 1024).toFixed(1)} KB`;
  console.log(`icons.css   ${iconos.cantidad} iconos, ${kb(iconos.bytes)}`);
  console.log(`fonts.css   ${fuentes.cantidad} pesos, ${kb(fuentes.bytes)} en woff2`);
  console.log(`versionado  ${estampado.referencias} referencias` +
    (estampado.paginas.length ? `, cambiaron ${estampado.paginas.length}: ${estampado.paginas.join(', ')}` : ', sin cambios'));
  console.log(`brotli      ${comprimido.archivos} archivos, ${kb(comprimido.original)} -> ${kb(comprimido.brotli)}` +
    (comprimido.huerfanos ? ` (${comprimido.huerfanos} huerfanos borrados)` : ''));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\nbuild-assets fallo: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  relevarIconos, generarIconos, generarFuentes, estampar, precomprimir,
  hashDe, resolverReferencia, archivosDeFrontend, COMPRIMIBLES, MINIMO_A_COMPRIMIR,
  DIR_PUBLICO,
};
