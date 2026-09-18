/**
 * Tests de los assets generados del frontend.
 *
 * `public/` no tiene build ni bundler, asi que nada verifica sus referencias: un
 * `<i class="fas fa-loquesea">` mal escrito antes se veia como un hueco en la pagina y
 * no rompia nada. Desde que los iconos salen de `scripts/build-assets.js` en vez del
 * CDN de Font Awesome, hay un modo de falla nuevo y silencioso: agregar un icono al
 * markup y olvidarse de correr el build deja ese icono invisible en produccion.
 *
 * Estos tests cierran ese hueco. Corren sin base de datos, como el resto de la suite.
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  relevarIconos, hashDe, resolverReferencia, archivosDeFrontend,
  COMPRIMIBLES, MINIMO_A_COMPRIMIR,
} = require('../scripts/build-assets');

const DIR_PUBLICO = path.join(__dirname, '..', 'public');
const ICONS_CSS = path.join(DIR_PUBLICO, 'src', 'styles', 'icons.css');
const FONTS_CSS = path.join(DIR_PUBLICO, 'src', 'styles', 'fonts.css');

const leer = ruta => fs.readFileSync(ruta, 'utf8');

test('icons.css cubre todos los iconos que usa el frontend', () => {
  const css = leer(ICONS_CSS);
  const sinRegla = relevarIconos().filter(nombre => !css.includes(`.fa-${nombre} {`));

  assert.deepEqual(
    sinRegla, [],
    `Iconos usados en public/ sin regla en icons.css: ${sinRegla.join(', ')}. Corre npm run build:assets.`
  );
});

test('cada regla de icono trae su dibujo', () => {
  // `fa-spin` es la unica clase con prefijo fa- que no dibuja nada: anima al icono que
  // la acompaña. El resto sin --fa-icono seria un hueco invisible en la pagina.
  const UTILIDADES = new Set(['spin']);

  const css = leer(ICONS_CSS);
  const reglas = [...css.matchAll(/\.fa-([a-z0-9-]+) \{([^}]*)\}/g)]
    .filter(([, nombre]) => !UTILIDADES.has(nombre));

  assert.ok(reglas.length > 50, `Se esperaban decenas de iconos, hay ${reglas.length}`);

  for (const [, nombre, cuerpo] of reglas) {
    assert.match(
      cuerpo, /--fa-icono: url\("data:image\/svg\+xml,%3Csvg/,
      `La regla .fa-${nombre} no define un SVG`
    );
  }
});

test('las fuentes declaradas en fonts.css existen y estan bien versionadas', () => {
  const css = leer(FONTS_CSS);
  const referencias = [...css.matchAll(/url\('\/assets\/([^'?]+)\?v=([a-f0-9]+)'\)/g)];

  assert.ok(referencias.length > 0, 'fonts.css no declara ninguna fuente versionada');

  for (const [, referencia, version] of referencias) {
    const archivo = path.join(DIR_PUBLICO, 'assets', referencia);
    assert.ok(fs.existsSync(archivo), `fonts.css apunta a ${referencia}, que no existe`);
    assert.equal(
      version, hashDe(archivo),
      `fonts.css versiona ${referencia} con un hash que no es el de su contenido`
    );
  }
});

test('el frontend no depende de ningun origen externo', () => {
  // El punto de generar iconos y fuentes localmente es que la pagina cargue sin pedirle
  // nada a un tercero: son bytes que no controlamos, una conexion TLS extra y un punto
  // de falla fuera del VPS. Un <link> nuevo a un CDN lo revierte sin que se note.
  const CDN = /https?:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)/;
  const culpables = [];

  for (const archivo of archivosDeFrontend(DIR_PUBLICO)) {
    if (CDN.test(leer(archivo))) culpables.push(path.relative(DIR_PUBLICO, archivo));
  }

  assert.deepEqual(culpables, [], `Referencias a CDN externos en: ${culpables.join(', ')}`);
});

test('el ?v= del HTML coincide con el contenido de cada asset', () => {
  // Este es el test que sostiene el cacheo `immutable`. Un asset versionado se cachea
  // un año: si alguien edita un CSS y no corre el build, el `?v=` queda viejo y los
  // navegadores que ya lo tienen siguen usando la version anterior durante un año, sin
  // forma practica de invalidarla. El error tiene que aparecer aca, no en produccion.
  const desactualizadas = [];

  for (const archivo of archivosDeFrontend(DIR_PUBLICO)) {
    if (path.extname(archivo) !== '.html') continue;

    for (const [, referencia] of leer(archivo).matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const destino = resolverReferencia(referencia);
      if (!destino) continue;

      const version = referencia.split('?v=')[1];
      const esperado = hashDe(destino);

      if (version !== esperado) {
        desactualizadas.push(`${path.basename(archivo)} -> ${referencia} (deberia ser ?v=${esperado})`);
      }
    }
  }

  assert.deepEqual(
    desactualizadas, [],
    `Referencias sin versionar o con version vieja:\n  ${desactualizadas.join('\n  ')}\nCorre npm run build:assets.`
  );
});

test('los precomprimidos estan al dia respecto de sus fuentes', () => {
  // `core/estaticos.js` descarta en runtime todo comprimido mas viejo que su fuente, asi
  // que esto nunca sirve contenido incorrecto. Pero degradar a comprimir en vivo es
  // justamente el costo que la fase buscaba sacarse de encima, y en silencio no se nota.
  const problemas = [];

  for (const archivo of archivosDeFrontend(DIR_PUBLICO, { incluirGenerados: true })) {
    if (!COMPRIMIBLES.has(path.extname(archivo))) continue;
    if (fs.statSync(archivo).size < MINIMO_A_COMPRIMIR) continue;

    const modificado = fs.statSync(archivo).mtimeMs;

    for (const extension of ['br', 'gz']) {
      const comprimido = `${archivo}.${extension}`;
      const relativa = path.relative(DIR_PUBLICO, comprimido);

      if (!fs.existsSync(comprimido)) problemas.push(`falta ${relativa}`);
      else if (fs.statSync(comprimido).mtimeMs + 1000 < modificado) problemas.push(`${relativa} es mas viejo que su fuente`);
    }
  }

  assert.deepEqual(problemas, [], `Precomprimidos desactualizados:\n  ${problemas.join('\n  ')}\nCorre npm run build:assets.`);
});

test('no quedan precomprimidos huerfanos', () => {
  const huerfanos = [];

  const recorrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (/\.(br|gz)$/.test(entrada.name) && !fs.existsSync(completo.replace(/\.(br|gz)$/, ''))) {
        huerfanos.push(path.relative(DIR_PUBLICO, completo));
      }
    }
  };
  recorrer(DIR_PUBLICO);

  assert.deepEqual(huerfanos, [], `Comprimidos cuya fuente ya no existe: ${huerfanos.join(', ')}`);
});

test('los estilos usan tokens y no colores sueltos', () => {
  // Lo que hace posible el modo oscuro es que ningun consumidor lleve su propio color:
  // redefinir los tokens alcanza para cambiar la aplicacion entera. Un `background:
  // white` nuevo no rompe nada visible en claro, y por eso se cuela — pero deja una
  // tarjeta encandilante sobre fondo oscuro. Este test lo caza cuando entra.
  //
  // design-system.css queda afuera porque ahi los literales SON la definicion de los
  // tokens. root-redirect.html y las paginas de desarrollo (debug, test-*) no cargan
  // ninguna hoja a proposito, asi que un var(--ds-*) ahi no resolveria a nada.
  const EXENTOS = /design-system\.css|icons\.css|fonts\.css|root-redirect\.html|debug\.html|test-[a-z]+\.html/;

  // Un color dentro de rgba() translucida o de una sombra es un efecto, no identidad.
  const sinEfectos = css => css
    .replace(/rgba\([^)]*\)/g, '')
    .replace(/\b(box-shadow|text-shadow|filter|drop-shadow)\s*:[^;]*;/g, '');

  const culpables = [];

  for (const archivo of archivosDeFrontend(DIR_PUBLICO)) {
    if (EXENTOS.test(archivo) || archivo.endsWith('.js')) continue;

    const relativa = path.relative(DIR_PUBLICO, archivo);
    const encontrados = [...sinEfectos(leer(archivo)).matchAll(/(#[0-9a-fA-F]{3,6}\b|:\s*white\b)/g)]
      .map(m => m[1]);

    if (encontrados.length > 0) {
      culpables.push(`${relativa}: ${[...new Set(encontrados)].join(', ')}`);
    }
  }

  assert.deepEqual(
    culpables, [],
    `Colores sueltos fuera del design system:\n  ${culpables.join('\n  ')}\n` +
    'Usa un token --ds-*. Si de verdad tiene que ser un literal, agregalo a EXENTOS con el motivo.'
  );
});

test('ninguna pagina quedo pidiendo Chart.js', () => {
  // microchart expone window.Chart con la misma firma. Si alguien vuelve a sumar el
  // <script> del CDN, el global se pisa y el reemplazo deja de usarse en silencio.
  const culpables = archivosDeFrontend(DIR_PUBLICO)
    .filter(archivo => /chart\.umd\.js|chart\.min\.js/.test(leer(archivo)))
    .map(archivo => path.relative(DIR_PUBLICO, archivo));

  assert.deepEqual(culpables, [], `Todavia cargan Chart.js: ${culpables.join(', ')}`);
});
