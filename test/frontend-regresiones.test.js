/**
 * Guardas estaticas sobre el frontend: public/ es JS plano sin tests de UI, asi que lo que
 * se corrigio y es facil de reintroducir queda fijado leyendo el codigo, como ya hace
 * escapado.test.js.
 */

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLICO = path.join(__dirname, '..', 'public');
const leer = (...partes) => fs.readFileSync(path.join(PUBLICO, ...partes), 'utf8');

test('ningun componente del frontend nombra una opcion politica concreta (021)', () => {
  // Las opciones las define cada instancia: un literal 'PJ' o 'UCR' en un componente haria que
  // otro cliente viera partidos que no son los suyos. Se leen de window.opcionesPoliticas.
  const archivos = [
    ['src', 'components', 'PadronComponent.js'],
    ['src', 'components', 'ResultadosComponent.js'],
    ['src', 'pages', 'dashboard.js'],
  ];
  for (const partes of archivos) {
    const sinComentarios = leer(...partes).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/['"`>]\s*(PJ|UCR)\s*['"`<]|votos_(pj|ucr)|porcentaje_(pj|ucr)/.test(sinComentarios),
      `${partes.join('/')} tiene una opcion politica escrita a mano`);
  }
});

test('las paginas que dibujan opciones politicas cargan src/lib/opciones.js (021)', () => {
  for (const pagina of ['index.html', 'resultados.html', 'dashboard.html']) {
    assert.match(leer(pagina), /src\/lib\/opciones\.js/, `${pagina} necesita opciones.js`);
  }
});

test('ApiService aplica el timeout con un AbortController (FE-027)', () => {
  const fuente = leer('src', 'services', 'ApiService.js');
  assert.ok(fuente.includes('new AbortController()'));
  assert.ok(fuente.includes('clearTimeout('));
  assert.ok(!/^\s*timeout: this\.timeout\s*$/m.test(fuente), 'timeout no es una opcion de fetch');
});

test('importar CSV sube el timeout propio: un padron entero tarda mas que 10 s', () => {
  const fuente = leer('src', 'services', 'ApiService.js');
  assert.match(fuente, /importar-csv[\s\S]{0,200}timeout:\s*\d{6,}/);
});

test('el error de login se anuncia a lectores de pantalla (FE-022)', () => {
  assert.match(leer('src', 'components', 'LoginComponent.js'), /id="loginError"[^>]*role="alert"/);
});

test('ninguna pagina conserva el indigo de la identidad anterior (FE-023)', () => {
  for (const pagina of fs.readdirSync(PUBLICO).filter((f) => f.endsWith('.html'))) {
    assert.ok(!leer(pagina).includes('99, 102, 241'), `${pagina} trae el indigo viejo`);
  }
});

test('Escape no toca los modales de fiscales si no estan en el DOM (FE-018, FE-010)', () => {
  const fuente = leer('src', 'components', 'ComicioComponent.js');
  assert.ok(fuente.includes("if (document.getElementById('modal-fiscal')) this.cerrarModalFiscal();"));
  assert.ok(fuente.includes('this.permisos.fiscalesEdit && this.permisos.fiscalesView'));
});

test('la tabla del padron avisa que esta ocupada mientras carga (FE-025)', () => {
  assert.ok(leer('src', 'components', 'PadronComponent.js').includes("setAttribute('aria-busy'"));
});

test('el comparador de barras no inventa un 1 cuando no hay relevados (FE-019)', () => {
  const fuente = leer('src', 'components', 'ResultadosComponent.js');
  const i = fuente.indexOf('mostrarComparadorBarras()');
  assert.ok(!fuente.slice(i, i + 400).includes('total_relevados) || 1'));
});

test('ninguna pagina carga dos hojas que definan la misma tarjeta .stat-card (005)', () => {
  // resultados.html cargaba padron-styles.css y resultados-styles.css, y las dos definian
  // `.stat-card` con medidas distintas: el resultado visible era la mezcla de ambas, y
  // quitar una de las dos lo cambiaba sin avisar. Una definicion base por pagina.
  const definidas = (hoja) => /^\.stat-card\s*\{/m.test(leer('src', 'styles', hoja));

  for (const pagina of fs.readdirSync(PUBLICO).filter((f) => f.endsWith('.html'))) {
    const hojas = [...leer(pagina).matchAll(/href="src\/styles\/([a-z-]+\.css)/g)].map((m) => m[1]);
    const conTarjeta = hojas.filter(definidas);
    assert.ok(conTarjeta.length <= 1, `${pagina} carga ${conTarjeta.join(' y ')}, que definen .stat-card las dos`);
  }
});
