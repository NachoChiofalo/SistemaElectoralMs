# 002 — Plan

> Se escribe después de aprobar `spec.md`.

## Enfoque

Dos problemas independientes, cada uno con su propio mecanismo, y un tercer paso que los
junta:

1. **Los 25 `onclick=`** se reemplazan por **delegación de eventos**: el atributo
   `onclick="componente.metodo(args)"` se cambia por `data-action="metodo"` (+ `data-*`
   para los argumentos dinámicos, como `data-dni` o `data-pagina`), y cada componente o
   página agrega **un solo** listener de `click` en `init()` que lee
   `event.target.closest('[data-action]')` y despacha según ese valor. No es una técnica
   nueva para este repo: `PadronComponent` ya usa `data-dni` en las filas de la tabla
   (`tr[data-dni="${dni}"]`) para encontrarlas después; esto extiende el mismo patrón a
   los `onclick`.

2. **Los 8 bloques `<script>` inline** se mueven, **tal cual**, a un archivo propio bajo
   `public/src/pages/<pagina>.js`, cargado con `<script src="...">`. Es el mismo patrón
   que ya usa `public/src/app.js`: una clase o función que se auto-inicializa con
   `document.addEventListener('DOMContentLoaded', ...)` al final del archivo. No hay que
   inventar un mecanismo de arranque — ya existe.

3. **Sacar `'unsafe-inline'` de `script-src`** es el último paso, no el primero: se hace
   sólo cuando 1 y 2 ya están verificados y no queda ningún `onclick=` ni `<script>` sin
   `src` en `public/`. Invertir el orden tira el sitio entero.

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `src/core/app.js` | Saca `'unsafe-inline'` de `script-src` (último commit de la serie) |
| `public/src/components/PadronComponent.js` | 17 `onclick=` → `data-action`/`data-*` + listener delegado en `init()` |
| `public/src/components/DetalleVotanteComponent.js` | 4 `onclick=` → mismo patrón |
| `public/dashboard.html` | Bloque `<script>` (~300 líneas, incluye `MODULES_CONFIG` y la lógica del panel) sale a `public/src/pages/dashboard.js`. El `onclick="${status==='coming-soon' ? 'return false;' : ''}"` de las tarjetas pasa a un `if (tarjeta.classList.contains('disabled')) event.preventDefault()` delegado sobre `#modules-grid` |
| `public/resultados.html` | Bloque `<script>` sale a `public/src/pages/resultados.js`. El `onclick=` estático del botón "volver" y los 2 que arma el HTML de error (`window.location.href`, `location.reload()`) pasan a `data-action` |
| `public/auditoria.html` | Bloque `<script>` sale a `public/src/pages/auditoria.js`, sin tocar su lógica |
| `public/usuarios.html` | Bloque `<script>` sale a `public/src/pages/usuarios.js`, sin tocar su lógica |
| `public/comicio.html` | Bloque `<script>` (trivial: init de navbar) sale a `public/src/pages/comicio.js` |
| `public/fiscales.html` | Bloque `<script>` (trivial) sale a `public/src/pages/fiscales.js` |
| `public/index.html` | Bloque `<script>` (init de navbar, sobrante — `app.js` ya se auto-arranca) sale a `public/src/pages/index.js` |
| `public/root-redirect.html` | Bloque `<script>` (un `window.location.replace`) sale a `public/src/pages/root-redirect.js` |
| `test/csp.test.js` (nuevo) | Pide una página servida y verifica que `Content-Security-Policy` trae `script-src 'self'` sin `'unsafe-inline'` |

Cada `.js` nuevo bajo `public/src/pages/` entra solo por tener extensión `.js`: el
versionado `?v=<hash>` de `build-assets.js` recorre `public/` completo y no necesita una
lista aparte (`VERSIONABLES` ya incluye `.js`).

## Orden de trabajo

1. **Mover los 8 bloques `<script>` a `public/src/pages/`, sin cambiar una línea de su
   lógica** — sólo cortar, pegar, envolver en el patrón de auto-arranque y agregar el
   `<script src="src/pages/X.js">` antes de `</body>`. Se verifica cargando cada página y
   mirando la consola: mismo comportamiento, cero errores nuevos.
2. **Reemplazar los 25 `onclick=` por `data-action`/`data-*` + listener delegado**, un
   archivo a la vez (`PadronComponent.js`, `DetalleVotanteComponent.js`, y los dos casos
   sueltos que quedaron en `dashboard.js` y `resultados.js` tras el paso 1). Se verifica a
   mano, acción por acción: abrir/cerrar los dos modales del padrón, guardar el panel,
   paginar (incluida la página con `${i}` interpolado y los DNI dinámicos de
   `abrirPanel`), las tarjetas "próximamente" del dashboard, y los botones del estado de
   error de resultados.
3. **Agregar `test/csp.test.js`.** Se verifica corriendo `npm test`: el test falla contra
   el header actual (todavía con `'unsafe-inline'`) y eso confirma que mide lo que dice
   medir, antes de sacar la bandera en el paso 4.
4. **Sacar `'unsafe-inline'` de `script-src`.** Se verifica con el mismo
   `test/csp.test.js`, que ahora pasa, y con un smoke manual de las 8 páginas: si quedó
   algún `onclick` o `<script>` inline sin migrar, la página se rompe en el acto y sin
   ambigüedad — es la prueba de que el orden importa.
5. **`npm run build:assets`** para que los `.js` nuevos entren al versionado `?v=`, y
   confirmar que el build no deja el árbol sucio.

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Nonce o hash por `<script>` en vez de sacar el inline | Resuelve los 8 bloques `<script>`, pero no los `onclick=`: esos necesitarían además `'unsafe-hashes'`, que reintroduce buena parte de la superficie que se quiere cerrar. Y un nonce por response exige generarlo en cada request — el HTML ya se sirve `no-cache`, así que sería viable, pero es más pieza nueva para el mismo resultado que sacar el inline directamente. |
| Reescribir `dashboard.html` y `resultados.html` como componentes de clase, igual que el resto | Prolijo, pero es un cambio de forma que no hace falta para sacar `unsafe-inline`: el criterio es que el código no sea inline, no dónde vive. Se anota como deuda posible, no entra acá. |
| Delegar sobre `document` en vez de un contenedor por componente | Se usa igual donde hace falta — el panel del padrón se cuelga de `document.body`, no de `this.container` — pero delegar *todo* sobre `document` mezclaría los `data-action` de componentes distintos en un solo espacio de nombres. Se prefiere un listener por componente/página, salvo el panel, que por vivir fuera del contenedor necesita el suyo propio igual. |

## Cómo se verifica el conjunto

```bash
npm test                          # incluye test/csp.test.js
npm run build:assets              # versiona los .js nuevos, árbol debe quedar limpio
node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before.json
```

Más la prueba manual del paso 2 y 4: las 8 páginas, cada acción que antes disparaba un
`onclick`, con la consola del navegador abierta.
