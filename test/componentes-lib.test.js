/**
 * Tests de las librerías de componentes del frontend (public/src/lib).
 *
 * `estados.js` y `paginacion.js` son código puro —devuelven markup— y se prueban acá, sin
 * navegador. El comportamiento que necesita DOM (foco atrapado en el diálogo, regiones
 * vivas de los avisos, teclado de las pestañas) lo cubre scripts/verificar-componentes.js
 * contra un navegador real: no hay jsdom en el proyecto y no se agrega solo para esto.
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR_PUBLICO = path.join(__dirname, '..', 'public');
const leer = (...partes) => fs.readFileSync(path.join(DIR_PUBLICO, ...partes), 'utf8');

// Las librerías toman `escaparHtml` del global, igual que en el navegador.
const contexto = { window: {} };
vm.createContext(contexto);
vm.runInContext(leer('src', 'lib', 'escapar.js'), contexto);
globalThis.escaparHtml = contexto.window.escaparHtml;

const estados = require('../public/src/lib/estados');
const paginacion = require('../public/src/lib/paginacion');

// ---------------------------------------------------------------- estados

test('cargando se anuncia con role="status" y esconde el spinner', () => {
  const html = estados.cargando('Cargando usuarios…');
  assert.match(html, /role="status"/);
  assert.match(html, /class="spinner" aria-hidden="true"/);
  assert.match(html, /Cargando usuarios…/);
});

test('error se anuncia con role="alert" y ofrece reintentar', () => {
  const html = estados.error({ texto: 'Sin conexión', reintentar: 'recargar' });
  assert.match(html, /role="alert"/);
  assert.match(html, /data-action="recargar"/);
  assert.match(html, /Reintentar/);
});

test('error sin `reintentar` no dibuja un botón que no hace nada', () => {
  assert.doesNotMatch(estados.error({ texto: 'x' }), /<button/);
});

test('los textos de los estados se escapan: un mensaje de error del servidor no ejecuta markup', () => {
  const veneno = '<img src=x onerror="alert(1)">';
  for (const html of [
    estados.error({ titulo: veneno, texto: veneno }),
    estados.vacio({ titulo: veneno, texto: veneno, accion: { texto: veneno, accion: veneno } }),
    estados.cargando(veneno),
  ]) {
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  }
});

test('vacio muestra la acción solo si se la pasan', () => {
  assert.doesNotMatch(estados.vacio({ titulo: 'Sin datos' }), /<button/);
  assert.match(estados.vacio({ titulo: 'Sin datos', accion: { texto: 'Crear', accion: 'nuevo' } }), /data-action="nuevo"/);
});

test('el esqueleto de tabla tiene la forma pedida y se lee como una sola carga', () => {
  const html = estados.esqueletoTabla(3, 5);
  assert.equal((html.match(/<tr>/g) || []).length, 3);
  assert.equal((html.match(/class="skeleton"/g) || []).length, 15);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /class="sr-only"/);
});

// ---------------------------------------------------------------- paginación

test('ventana: primera, última y alrededor de la actual, con huecos marcados', () => {
  assert.deepEqual(paginacion.ventana(6, 12), [1, null, 5, 6, 7, null, 12]);
  assert.deepEqual(paginacion.ventana(1, 12), [1, 2, null, 12]);
  assert.deepEqual(paginacion.ventana(12, 12), [1, null, 11, 12]);
});

test('ventana: un hueco de una sola página se escribe en vez de poner "…"', () => {
  // "…" ocuparía el mismo lugar que el número 3, así que se muestra el 3.
  assert.deepEqual(paginacion.ventana(4, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(paginacion.ventana(1, 3), [1, 2, 3]);
});

test('una sola página no dibuja paginador', () => {
  assert.equal(paginacion.render({ pagina: 1, totalPaginas: 1 }), '');
  assert.equal(paginacion.render({ pagina: 1, totalPaginas: 0 }), '');
});

test('el paginador es un <nav> con nombre y marca la página actual', () => {
  const html = paginacion.render({ pagina: 3, totalPaginas: 8, etiqueta: 'Paginación del padrón' });
  assert.match(html, /<nav class="paginacion" aria-label="Paginación del padrón">/);
  assert.match(html, /aria-label="Página 3" aria-current="page"/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
});

test('anterior y siguiente tienen nombre accesible y se deshabilitan en los extremos', () => {
  const primera = paginacion.render({ pagina: 1, totalPaginas: 5 });
  assert.match(primera, /aria-label="Página anterior"[^>]*disabled/);
  assert.doesNotMatch(primera, /aria-label="Página siguiente"[^>]*disabled/);

  const ultima = paginacion.render({ pagina: 5, totalPaginas: 5 });
  assert.match(ultima, /aria-label="Página siguiente"[^>]*disabled/);
});

test('los botones de página traen su destino en data-pagina', () => {
  const html = paginacion.render({ pagina: 2, totalPaginas: 4 });
  assert.match(html, /data-action="ir-pagina" data-pagina="3"/);
  assert.match(html, /data-pagina="1"/); // anterior
});

test('una página fuera de rango se acota en vez de dibujar un paginador roto', () => {
  const html = paginacion.render({ pagina: 99, totalPaginas: 4 });
  assert.match(html, /aria-label="Página 4" aria-current="page"/);
});

test('la etiqueta del paginador se escapa', () => {
  const html = paginacion.render({ pagina: 1, totalPaginas: 3, etiqueta: '"><script>' });
  assert.doesNotMatch(html, /<script>/);
});

// ---------------------------------------------------------------- carga en las páginas

const PAGINAS = ['index', 'dashboard', 'resultados', 'mapa', 'listas', 'comicio', 'usuarios', 'auditoria', 'configuracion'];

test('todas las páginas cargan dialogo.js y avisos.js antes de la barra de navegación', () => {
  // La barra pide confirmación con dialogo.confirmar(): si el script llegara después,
  // `dialogo` sería undefined la primera vez que alguien toque "salir".
  for (const pagina of PAGINAS) {
    const html = leer(`${pagina}.html`);
    const iDialogo = html.indexOf('src/lib/dialogo.js');
    const iAvisos = html.indexOf('src/lib/avisos.js');
    const iNavbar = html.indexOf('src/components/NavbarComponent.js');
    assert.ok(iDialogo > -1 && iAvisos > -1, `${pagina}.html no carga dialogo.js / avisos.js`);
    assert.ok(iDialogo < iNavbar && iAvisos < iNavbar, `${pagina}.html carga la barra antes que dialogo/avisos`);
  }
});

test('ni los avisos ni los diálogos interpolan texto como HTML', () => {
  // Título, mensaje y botones entran por textContent. Un innerHTML acá reabriría el
  // agujero que escapar.js cerró.
  for (const archivo of ['dialogo.js', 'avisos.js']) {
    const fuente = leer('src', 'lib', archivo).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(fuente, /innerHTML|insertAdjacentHTML|outerHTML/, `${archivo} usa innerHTML`);
  }
});

test('la barra y los avisos de sesión no vuelven a confirm() / alert() del navegador', () => {
  // confirm() y alert() bloquean el hilo, no siguen el tema y no son un diálogo para el
  // lector de pantalla. La barra y AuthService ya migraron a dialogo.js; el resto de las
  // pantallas migra en las fases siguientes y se suma a esta lista a medida que lo hace.
  for (const archivo of [['src', 'components', 'NavbarComponent.js'], ['src', 'services', 'AuthService.js']]) {
    const fuente = leer(...archivo).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(fuente, /(^|[^.\w])(confirm|alert)\s*\(/m, `${archivo.at(-1)} usa confirm()/alert()`);
  }
});

test('la barra de navegación expone nombre, página actual y salto al contenido', () => {
  const fuente = leer('src', 'components', 'NavbarComponent.js');
  assert.match(fuente, /class="skip-link" href="#contenido"/);
  assert.match(fuente, /aria-label="Principal"/);
  assert.match(fuente, /aria-current="page"/);
  assert.match(fuente, /aria-controls="navbar-collapse"/);
  // Barra lateral: destinos agrupados y colapso persistente con estado accesible.
  assert.match(fuente, /role="group" aria-labelledby/);
  assert.match(fuente, /aria-controls="navbar-collapse" aria-expanded/);

  // El salto apunta a #contenido: cada página tiene que tener ese destino.
  for (const pagina of PAGINAS) {
    assert.match(leer(`${pagina}.html`), /<main[^>]*id="contenido"[^>]*tabindex="-1"/, `${pagina}.html sin <main id="contenido">`);
  }
});

test('un estado puede ofrecer un enlace para navegar, que es un <a> y no un botón', () => {
  const html = estados.error({ titulo: 'Acceso denegado', icono: 'fa-lock', enlace: { texto: 'Volver al inicio', href: 'dashboard.html' } });
  assert.match(html, /<a class="btn btn-secondary" href="dashboard.html">Volver al inicio<\/a>/);
  assert.match(html, /fa-lock/);
  assert.doesNotMatch(html, /<button/);
  // el destino también se escapa
  assert.doesNotMatch(estados.vacio({ enlace: { texto: 'x', href: '"><script>' } }), /<script>/);
});

test('el design system define los componentes base del rediseño (panel, KPI, cabecera, segmentadas, punto)', () => {
  const css = leer('src', 'styles', 'design-system.css');
  for (const clase of ['.panel', '.kpi-valor', '.pagina-cabecera', '.pestanas--segmentadas', '.punto', '.btn-lg', '.tabla--compacta']) {
    assert.ok(css.includes(clase), `design-system.css no define ${clase}`);
  }
  // La cifra de un KPI va en la mono: se compara en columna.
  assert.match(css, /\.kpi-valor\s*\{[^}]*font-family:\s*var\(--ds-font-mono\)/);
});
