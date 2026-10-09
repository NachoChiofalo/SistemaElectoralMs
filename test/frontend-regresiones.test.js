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

test('el importador de CSV del padron se retiro a proposito: no vuelve el boton ni el modal', () => {
  // Se retiro por decision del producto (el boton "importar" ya no estaba en la pantalla y el
  // modal quedo inalcanzable). Sin esto, el codigo muerto vuelve a entrar sin que nadie recuerde
  // que no tiene punto de entrada. El endpoint del backend no se toca.
  const componente = leer('src', 'components', 'PadronComponent.js');
  const api = leer('src', 'services', 'ApiService.js');
  assert.doesNotMatch(componente, /modal-importar|archivo-csv|abrirModalImportar|manejarArchivoCSV/);
  assert.doesNotMatch(api, /importarCSV/);
});

test('el error de login se anuncia a lectores de pantalla (FE-022)', () => {
  assert.match(leer('src', 'components', 'LoginComponent.js'), /id="loginError"[^>]*role="alert"/);
});

test('ninguna pagina conserva el indigo de la identidad anterior (FE-023)', () => {
  for (const pagina of fs.readdirSync(PUBLICO).filter((f) => f.endsWith('.html'))) {
    assert.ok(!leer(pagina).includes('99, 102, 241'), `${pagina} trae el indigo viejo`);
  }
});

test('los modales de fiscales solo se tocan si existen, y Escape lo maneja cada <dialog> (FE-018, FE-010)', () => {
  // El modal de fiscal solo esta en el DOM con fiscalesView (FE-010): los listeners se enganchan
  // detras de esa guarda. Y ya no hay un listener global de Escape que cierre los seis modales
  // existan o no (FE-018): cada <dialog> nativo cierra el suyo.
  const fuente = leer('src', 'components', 'ComicioComponent.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(fuente.includes('this.permisos.fiscalesEdit && this.permisos.fiscalesView'));
  assert.doesNotMatch(fuente, /key\s*!==?\s*'Escape'/);
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

test('un 401 del login no se trata como sesion vencida (no recarga la pagina)', () => {
  // Escribir mal la contrasena devuelve 401. Si ApiService lo trata como "token expirado"
  // llama a logout(), que redirige: el formulario se vacia y la persona nunca lee el motivo.
  // El login es el unico endpoint donde 401 significa "credenciales invalidas".
  const fuente = leer('src', 'services', 'ApiService.js');
  assert.match(fuente, /response\.status === 401 && !endpoint\.includes\('\/api\/auth\/login'\)/);
});

test('el login es un <main> con su <h1> y no borra el error solo', () => {
  const fuente = leer('src', 'components', 'LoginComponent.js');
  assert.match(fuente, /<main class="login-container"/);
  assert.match(fuente, /<h1 class="login-titulo">/);
  // El auto-ocultado a los 5 s dejaba sin mensaje a quien usa lector de pantalla.
  assert.doesNotMatch(fuente.replace(/\/\*[\s\S]*?\*\//g, ''), /setTimeout\([^)]*hideError/);
});

test('ninguna hoja pone en mayuscula cada palabra de un texto en espanol', () => {
  // `text-transform: capitalize` convierte "9 de octubre de 2026" en "9 De Octubre De 2026".
  // En espanol los dias, los meses y las preposiciones van en minuscula; la fecha del inicio
  // lo mostraba mal aunque el texto del DOM estuviera bien (el CSS lo pisaba).
  const estilos = path.join(PUBLICO, 'src', 'styles');
  const culpables = fs.readdirSync(estilos)
    .filter(f => f.endsWith('.css'))
    .filter(f => /text-transform:\s*capitalize/.test(fs.readFileSync(path.join(estilos, f), 'utf8')));
  assert.deepEqual(culpables, [], `capitalize en: ${culpables.join(', ')}`);
});

test('el padron usa los componentes compartidos y no vuelve a lo hecho a mano', () => {
  const fuente = leer('src', 'components', 'PadronComponent.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Paginacion: <nav> con nombre y aria-current, de lib/paginacion.js (no botones "<" ">" sueltos).
  assert.match(fuente, /window\.paginacion\.render\(/);
  assert.doesNotMatch(fuente, /btn-paginacion/);

  // Encabezados ordenables: <button> dentro del <th>, con aria-sort (antes eran <th> con clic).
  assert.match(fuente, /class="th-orden"/);
  assert.match(fuente, /aria-sort=/);

  // Avisos: lib/avisos.js, no un toast propio.
  assert.match(fuente, /window\.avisos\.mostrar\(/);
  assert.doesNotMatch(fuente, /notification-content|createElement\('div'\);\s*notification/);

  // El modal de nuevo votante es un <dialog> nativo; nada de display:none a mano.
  assert.match(fuente, /<dialog id="modal-nuevo-votante"/);
  assert.doesNotMatch(fuente, /style="display:\s*none/);
  assert.doesNotMatch(fuente, /onclick=/);
});

test('la ficha del padron pregunta antes de descartar cambios y devuelve el foco', () => {
  const fuente = leer('src', 'components', 'PadronComponent.js');
  assert.match(fuente, /confirmarDescarte\(\)/);
  assert.match(fuente, /enfocarFila\(/);
  // El Escape que abre el dialogo de descartar se consume: si no, el navegador se lo aplica
  // al dialogo recien abierto y lo cierra al instante (la confirmacion nunca se veia).
  assert.match(fuente, /evento\.preventDefault\(\);\s*this\.pedirCerrarPanel\(\)/);
});

test('el formulario de nuevo votante pide el anio de nacimiento, como el servidor', () => {
  // service.js lo exige (la columna es NOT NULL) y lo acota a 1900..anio actual. El formulario
  // lo presentaba como opcional y el error llegaba recien al enviar.
  const fuente = leer('src', 'components', 'PadronComponent.js');
  assert.match(fuente, /id="nuevo-anio-nac"[^>]*required/);
  assert.match(fuente, /anio < 1900 \|\| anio > anioActual/);
});

test('app.js no inventa permisos cuando falla /api/auth/me', () => {
  // Antes asumia padron.view/edit/relevamiento/export: una llamada caida mostraba los botones
  // de edicion a cualquiera. Un fallo es un estado de error con "Reintentar".
  const fuente = leer('src', 'app.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(fuente, /userPermissions\s*=\s*\['padron/);
  assert.doesNotMatch(fuente, /setTimeout/);
});

test('comicio usa los componentes compartidos y no vuelve a lo hecho a mano', () => {
  const fuente = leer('src', 'components', 'ComicioComponent.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Los seis modales son <dialog> nativos (foco atrapado, Escape, fondo inerte).
  assert.equal((fuente.match(/<dialog id="\$\{id\}"/g) || []).length, 1, 'un unico generador de <dialog>');
  assert.doesNotMatch(fuente, /modal-overlay|modal-content/);

  // Sin confirm() del navegador, sin toast propio, sin display:none a mano.
  assert.doesNotMatch(fuente, /(^|[^.\w])(confirm|alert)\s*\(/m);
  assert.doesNotMatch(fuente, /toast-container|toast-visible/);
  assert.doesNotMatch(fuente, /style="display:\s*none|\.style\.display\s*=/);
  assert.match(fuente, /window\.avisos\.mostrar\(/);

  // Pestañas WAI-ARIA con lib/pestanas.js (antes: botones con una clase "activa").
  assert.match(fuente, /window\.pestanas\.iniciar\(/);
  assert.match(fuente, /role="tabpanel"/);
});

test('los botones de ícono de comicio llevan nombre accesible, no solo title', () => {
  const fuente = leer('src', 'components', 'ComicioComponent.js');
  const iconos = fuente.match(/<button[^>]*class="btn-accion[^"]*"[^>]*>/g) || [];
  assert.ok(iconos.length >= 10, 'se esperaban los botones de acción de las tablas');
  for (const b of iconos) assert.match(b, /aria-label=/, `sin aria-label: ${b.slice(0, 90)}`);
});

test('una edicion de franja rechazada no deja el boton "Guardando…" para siempre', () => {
  // Antes el texto del boton solo se restauraba fuera del modo edicion: si fallaba una EDICION
  // (p. ej. por solaparse con otra franja) quedaba con el spinner. Ahora es aria-busy.
  const fuente = leer('src', 'components', 'ComicioComponent.js');
  const cuerpo = fuente
    .slice(fuente.indexOf('async guardarAsignacion()'), fuente.indexOf('async eliminarAsignacion'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(cuerpo, /removeAttribute\('aria-busy'\)/);
  assert.doesNotMatch(cuerpo, /Guardando/);
});
