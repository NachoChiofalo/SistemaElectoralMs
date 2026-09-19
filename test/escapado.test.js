/**
 * Tests del escapado de datos de usuario en el frontend (item 001 del backlog).
 *
 * El padron se carga a mano y por importacion de CSV, asi que el contenido de una
 * observacion es dato de usuario. Interpolado sin escapar en una plantilla que termina
 * en `innerHTML`, una observacion con `</textarea><script>` se ejecuta en el navegador
 * de cualquiera que abra la pagina — y quien escribe el dato no es necesariamente quien
 * lo mira. Con varias personas cargando, es una ejecutando codigo en la sesion de otra.
 *
 * Estos tests corren sin navegador y sin base, como el resto de la suite: cargan
 * `escapar.js` con un `window` falso y leen el markup de los componentes como texto.
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR_PUBLICO = path.join(__dirname, '..', 'public');
const COMPONENTES = path.join(DIR_PUBLICO, 'src', 'components');

const leer = (...partes) => fs.readFileSync(path.join(...partes), 'utf8');

/** Carga public/src/lib/escapar.js y devuelve la funcion que publica en window. */
function cargarEscapar() {
  const contexto = { window: {} };
  vm.createContext(contexto);
  vm.runInContext(leer(DIR_PUBLICO, 'src', 'lib', 'escapar.js'), contexto);
  return contexto.window.escaparHtml;
}

const escaparHtml = cargarEscapar();

// ---------------------------------------------------------------- la funcion

test('escapa los cinco caracteres que pueden romper el markup', () => {
  assert.equal(
    escaparHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
  );
});

test('escapa las comillas, que es lo que hace falta dentro de un atributo', () => {
  // El truco habitual —textContent/innerHTML— NO escapa comillas. Con `value="${tel}"`,
  // un telefono que empiece con comilla se sale del atributo y agrega el suyo.
  assert.equal(escaparHtml('" onfocus="alert(1)'), '&quot; onfocus=&quot;alert(1)');
  assert.equal(escaparHtml("') + alert(1) + ('"), '&#39;) + alert(1) + (&#39;');
});

test('el ampersand se escapa primero, sin escapar dos veces lo ya escapado', () => {
  assert.equal(escaparHtml('a & b'), 'a &amp; b');
  assert.equal(escaparHtml('&lt;'), '&amp;lt;');
});

test('null, undefined y 0 no rompen ni se vuelven "null"', () => {
  assert.equal(escaparHtml(null), '');
  assert.equal(escaparHtml(undefined), '');
  assert.equal(escaparHtml(0), '0');
  assert.equal(escaparHtml(false), 'false');
});

test('una observacion con </textarea> deja de poder cerrar el campo', () => {
  const ataque = '</textarea><script>alert(1)</script>';
  const escapada = escaparHtml(ataque);

  // Es el caso exacto del backlog: el panel pone la observacion dentro de un <textarea>.
  assert.ok(!escapada.includes('</textarea>'));
  assert.ok(!escapada.includes('<script>'));
});

// ------------------------------------------------- los usos en los componentes

/**
 * Datos de votante y de usuario que NO pueden entrar crudos a una plantilla.
 * Cada entrada es [archivo, expresion tal como aparecia sin escapar].
 */
const INTERPOLACIONES_PROHIBIDAS = [
  ['PadronComponent.js', '${votante.dni}'],
  ['PadronComponent.js', '${votante.apellido}'],
  ['PadronComponent.js', '${votante.nombre}'],
  ['PadronComponent.js', '${votante.circuito}'],
  ['PadronComponent.js', "${relevamiento?.telefono || ''}"],
  ['PadronComponent.js', "${relevamiento?.observacion || ''}"],
  ['DetalleVotanteComponent.js', '${votante.dni}'],
  ['DetalleVotanteComponent.js', '${votante.circuito}'],
  ['NavbarComponent.js', '${username}'],
];

for (const [archivo, expresion] of INTERPOLACIONES_PROHIBIDAS) {
  test(`${archivo} no interpola ${expresion} sin escapar`, () => {
    // Se miran solo las plantillas que terminan en innerHTML. `setAttribute` y
    // `textContent` reciben el valor como texto —el DOM no parsea HTML ahi— y ademas
    // escaparlos estaria MAL: un apellido con "&" mostraria "&amp;" en pantalla.
    const fuente = leer(COMPONENTES, archivo)
      .split('\n')
      .filter((linea) => !/\.(setAttribute|textContent|title)\s*[=(]/.test(linea))
      .join('\n');

    assert.ok(
      !fuente.includes(expresion),
      `${archivo} interpola ${expresion} crudo. Pasalo por escaparHtml().`,
    );
  });
}

test('todas las paginas cargan el helper de escapado', () => {
  const paginas = fs.readdirSync(DIR_PUBLICO)
    .filter((archivo) => archivo.endsWith('.html') && archivo !== 'root-redirect.html');

  const sinHelper = paginas.filter((pagina) => !leer(DIR_PUBLICO, pagina).includes('src/lib/escapar.js'));

  // Una pagina que se olvide del helper falla recien cuando alguien abre un dato con
  // un `<`: es exactamente el tipo de hueco que este test existe para no dejar.
  assert.deepEqual(sinHelper, [], `Paginas sin escapar.js: ${sinHelper.join(', ')}`);
});

test('el helper se carga antes que los componentes que lo usan', () => {
  const html = leer(DIR_PUBLICO, 'index.html');

  // Si se cargara despues, escaparHtml seria undefined en el primer render.
  assert.ok(html.indexOf('src/lib/escapar.js') < html.indexOf('src/components/PadronComponent.js'));
});

test('los componentes delegan en un solo escapador', () => {
  // Habia dos copias del mismo helper, las dos con el agujero de las comillas. Que cada
  // uno tenga la suya es como se arregla un caso y se olvidan los otros.
  for (const archivo of ['UsuariosComponent.js', 'AuditoriaComponent.js']) {
    const fuente = leer(COMPONENTES, archivo);
    assert.ok(
      !fuente.includes('div.textContent = text'),
      `${archivo} todavia tiene su propia copia del escapador`,
    );
  }
});
