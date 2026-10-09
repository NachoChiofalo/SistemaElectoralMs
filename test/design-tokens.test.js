/**
 * Tests de los tokens del design system (docs/DESIGN.md).
 *
 * El contraste es una propiedad de pares de valores, no de una regla: un token que se
 * aclara "un poquito" rompe el 4,5:1 de cada pantalla a la vez y ningún otro test lo ve.
 * Estos tests leen los valores reales de design-system.css y los miden.
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { archivosDeFrontend } = require('../scripts/build-assets');

const DIR_PUBLICO = path.join(__dirname, '..', 'public');
const CSS = fs.readFileSync(path.join(DIR_PUBLICO, 'src', 'styles', 'design-system.css'), 'utf8');

/** Primer valor hexadecimal declarado para un token (el del bloque que lo define). */
function valorDe(token) {
  const m = CSS.match(new RegExp(`${token.replace(/[-]/g, '\\-')}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`));
  assert.ok(m, `No se encontró ${token} en design-system.css`);
  return m[1];
}

function luminancia(hex) {
  const canal = (i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const TEMAS = {
  claro: (t) => valorDe(`--ds-${t}`),
  oscuro: (t) => valorDe(`--modo-oscuro-${t}`),
};

// Superficies donde de verdad se escribe texto corrido. bg-muted es la de las pastillas
// y los encabezados de tabla: se mide aparte con un piso más bajo (ver abajo).
const SUPERFICIES = ['bg-page', 'bg-card', 'bg-elevated', 'bg-subtle'];

for (const [tema, token] of Object.entries(TEMAS)) {
  test(`el texto cumple 4,5:1 (AA) sobre las superficies del tema ${tema}`, () => {
    const fallas = [];
    for (const texto of ['text-primary', 'text-secondary', 'text-muted']) {
      for (const superficie of SUPERFICIES) {
        const r = contraste(token(texto), token(superficie));
        if (r < 4.5) fallas.push(`${texto} ${token(texto)} sobre ${superficie} ${token(superficie)} = ${r.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(fallas, [], `Contraste insuficiente (WCAG AA 4,5:1):\n  ${fallas.join('\n  ')}`);
  });

  test(`el texto primario y secundario cumplen 4,5:1 sobre bg-muted en el tema ${tema}`, () => {
    for (const texto of ['text-primary', 'text-secondary']) {
      const r = contraste(token(texto), token('bg-muted'));
      assert.ok(r >= 4.5, `${texto} sobre bg-muted = ${r.toFixed(2)}:1`);
    }
  });
}

test('el texto del botón primario cumple 4,5:1 sobre el acento en los dos temas', () => {
  const claro = contraste(valorDe('--ds-on-primary'), valorDe('--ds-primary-600'));
  const oscuro = contraste(valorDe('--modo-oscuro-on-primary'), valorDe('--modo-oscuro-primary-600'));
  assert.ok(claro >= 4.5, `claro: ${claro.toFixed(2)}:1`);
  assert.ok(oscuro >= 4.5, `oscuro: ${oscuro.toFixed(2)}:1`);
});

test('el texto sobre tinte (estado) cumple 4,5:1 sobre su fondo en los dos temas', () => {
  const fallas = [];
  for (const estado of ['success', 'warning', 'danger', 'info']) {
    const claro = contraste(valorDe(`--ds-${estado}-on-tint`), valorDe(`--ds-${estado}-100`));
    const oscuro = contraste(valorDe(`--modo-oscuro-${estado}-on-tint`), valorDe(`--modo-oscuro-${estado}-100`));
    if (claro < 4.5) fallas.push(`${estado} claro: ${claro.toFixed(2)}:1`);
    if (oscuro < 4.5) fallas.push(`${estado} oscuro: ${oscuro.toFixed(2)}:1`);
  }
  assert.deepEqual(fallas, [], `Texto sobre tinte bajo AA:\n  ${fallas.join('\n  ')}`);
});

test('ninguna hoja ni página anima con `transition: all`', () => {
  // `all` anima también width, height, padding... y dispara layout en cada cuadro; y
  // anima propiedades que nadie pensó animar. Se listan las que de verdad cambian.
  const culpables = archivosDeFrontend(DIR_PUBLICO)
    .filter((f) => /\.(css|html)$/.test(f))
    .filter((f) => /transition:\s*all\b/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(DIR_PUBLICO, f));
  assert.deepEqual(culpables, [], `Usan transition: all: ${culpables.join(', ')}`);
});

test('el foco visible no depende de un halo translúcido', () => {
  // El anillo de antes era rgba(…, .18): casi invisible, y las hojas que sacaban el
  // outline dejaban al teclado sin indicador. Tiene que ser un trazo sólido.
  const claro = CSS.match(/--ds-shadow-focus:\s*([^;]+);/)[1];
  assert.doesNotMatch(claro, /rgba/, `--ds-shadow-focus no debe ser translúcido: ${claro}`);
});

test('el texto de cada píldora de opción cumple 4,5:1 sobre su relleno en los dos temas', () => {
  // La píldora seleccionada pinta el relleno con --opcion-color y escribe encima en 11px.
  // Blanco fijo no sirve: sobre el verde, el ámbar y el cian de claro da menos de 4,5:1, y
  // en oscuro los rellenos son pasteles. Cada fuerza trae su texto (--ds-on-fuerza-N).
  const fallas = [];
  for (let n = 1; n <= 8; n++) {
    const claro = contraste(valorDe(`--ds-on-fuerza-${n}`), valorDe(`--ds-fuerza-${n}`));
    const oscuro = contraste(valorDe('--modo-oscuro-on-fuerza'), valorDe(`--modo-oscuro-fuerza-${n}`));
    if (claro < 4.5) fallas.push(`fuerza ${n} claro: ${claro.toFixed(2)}:1`);
    if (oscuro < 4.5) fallas.push(`fuerza ${n} oscuro: ${oscuro.toFixed(2)}:1`);
  }
  const neutraClaro = contraste(valorDe('--ds-on-party-indeciso'), valorDe('--ds-party-indeciso'));
  const neutraOscuro = contraste(valorDe('--modo-oscuro-on-fuerza'), valorDe('--modo-oscuro-party-indeciso'));
  if (neutraClaro < 4.5) fallas.push(`neutra claro: ${neutraClaro.toFixed(2)}:1`);
  if (neutraOscuro < 4.5) fallas.push(`neutra oscuro: ${neutraOscuro.toFixed(2)}:1`);
  assert.deepEqual(fallas, [], `Píldoras bajo AA:\n  ${fallas.join('\n  ')}`);
});
