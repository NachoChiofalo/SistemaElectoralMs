# 002 — Tareas

Cada paso se verifica solo. El orden de las secciones **no es negociable**: sacar la
bandera de la CSP antes de terminar de migrar el markup rompe el sitio entero.

---

## Paso 1 — Mover los 8 `<script>` inline a `public/src/pages/`

Cortar y pegar, sin tocar lógica. Cada uno se auto-arranca con
`document.addEventListener('DOMContentLoaded', ...)` al final del archivo, igual que
`app.js`.

- [x] **1.1** `public/comicio.html` → `public/src/pages/comicio.js` (trivial: init de navbar).
      *Verifica:* cargar `comicio.html`, la navbar aparece, consola sin errores nuevos.
      **Verificado por HTTP** (200, el script se sirve). Sin navegador conectado no se
      confirmó visualmente — ver nota en el paso 4.2.
- [x] **1.2** `public/fiscales.html` → `public/src/pages/fiscales.js` (trivial).
      *Verifica:* igual que 1.1.
- [x] **1.3** `public/index.html` → `public/src/pages/index.js` (init de navbar, sobrante
      — `app.js` ya se auto-arranca solo).
      *Verifica:* cargar `index.html`, login funciona, navbar aparece tras autenticar.
- [x] **1.4** `public/root-redirect.html` → `public/src/pages/root-redirect.js`
      (`window.location.replace('dashboard.html')`).
      *Verifica:* abrir la página redirige de inmediato a `dashboard.html`.
- [x] **1.5** `public/auditoria.html` → `public/src/pages/auditoria.js`, sin tocar la
      lógica de verificación de administrador.
      *Verifica:* entrar como administrador carga la auditoría; entrar con otro rol
      redirige a `dashboard.html` con el alert de acceso denegado.
- [x] **1.6** `public/usuarios.html` → `public/src/pages/usuarios.js`, mismo patrón que 1.5.
      *Verifica:* igual que 1.5, sobre la pantalla de usuarios.
- [x] **1.7** `public/dashboard.html` → `public/src/pages/dashboard.js` (el bloque grande:
      `MODULES_CONFIG`, `loadDashboard`, `loadQuickStats`, `cargarPorCircuito`, etc.).
      *Verifica:* el dashboard carga igual para los tres roles (administrador, encargado
      de relevamiento, consultor), las estadísticas y el avance por circuito aparecen.
- [x] **1.8** `public/resultados.html` → `public/src/pages/resultados.js`.
      *Verifica:* resultados carga con un usuario con `resultados.view`; sin ese permiso
      muestra el bloque de acceso denegado.
- [x] **1.9** `grep -rn "<script>" public/*.html` no devuelve ningún bloque — sólo
      `<script src=`.
      *Verifica:* el propio grep, cero resultados de `<script>` a secas.
- [x] **1.10** `npm run build:assets`: los 8 archivos nuevos quedan versionados con `?v=`.
      *Verifica:* el build no deja el árbol sucio (`git status` limpio tras correrlo).

---

## Paso 2 — Sacar los 25 `onclick=`, un grupo a la vez

Mismo patrón en todos: `onclick="x.metodo(args)"` → `data-action="metodo"` (+ `data-*`
para lo dinámico) + un listener delegado en `init()` que hace
`event.target.closest('[data-action]')` y despacha.

> **Encontrado al implementar, fuera de lo que contaba la spec**: además de los 25
> `onclick=`, `PadronComponent.js` tenía un `onsubmit="return false;"` (línea 296, el
> formulario de nuevo votante) y un `onchange="padronComponent.cambiarOpcionPolitica(...)"`
> (línea 1065, el radio de opción política). Ambos son manejadores inline igual de
> bloqueados por `script-src` sin `unsafe-inline`, así que quedan resueltos acá con el
> mismo mecanismo — el `onsubmit` con un `on('form-nuevo-votante', 'submit', ...)` fijo
> (iba a un elemento con id conocido, no hacía falta delegación), el `onchange` con un
> segundo listener delegado en `document` para el evento `change`.

### `PadronComponent.js`

- [x] **2.1** Modal de importar CSV (`cerrarModalImportar`, el botón que dispara el click
      nativo sobre `#archivo-csv`).
      *Verifica:* abrir el modal, elegir archivo, cerrar con la X — sin usar `onclick`.
- [x] **2.2** Modal de nuevo votante, incluido el cierre por click en el overlay
      (`cerrarModalNuevoVotanteOverlay`, que hoy recibe `event`).
      *Verifica:* abrir el modal, cerrarlo con la X, con "Cancelar" y clickeando fuera del
      contenido (el overlay) — las tres formas cierran.
- [x] **2.3** Guardar nuevo votante.
      *Verifica:* cargar un votante nuevo desde el modal y confirmar que aparece en la
      tabla.
- [x] **2.4** Abrir panel de ficha desde la fila (`abrirPanel('${dni}')`, el caso con DNI
      interpolado). Como el panel se cuelga de `document.body` y no de `this.container`,
      necesita su propio listener delegado, no el del paso 2.1-2.3.
      *Verifica:* clickear distintas filas abre la ficha del DNI correcto — probar al
      menos tres filas distintas, no sólo la primera.
- [x] **2.5** Panel de ficha: cerrar, guardar y descartar cambios (`cerrarPanel` × 2,
      `guardarPanel` × 2, `descartarMisCambios`).
      *Verifica:* cargar teléfono y observación, guardar, reabrir y confirmar que
      quedaron; abrir, cambiar algo, descartar, reabrir y confirmar que no quedó.
- [x] **2.6** Paginación completa: primera, anterior, página `${i}` interpolada,
      siguiente, última.
      *Verifica:* con más de una página, saltar a una página intermedia por número, y
      confirmar que la tabla muestra esa página exacta — no la contigua.

### `DetalleVotanteComponent.js`

- [x] **2.7** Modal de detalle: cerrar (× 2), eliminar detalle, guardar detalle.
      *Verifica:* abrir el modal de condiciones especiales de un votante, guardar un
      cambio, reabrir y confirmar que quedó; eliminar un detalle y confirmar que
      desapareció.

### `dashboard.js` y `resultados.js` (movidos en el paso 1)

- [x] **2.8** Tarjetas "próximamente" del dashboard: el `onclick` condicional que hace
      `return false` se reemplaza por un chequeo de `.disabled` en un listener delegado
      sobre `document`.
      *Verifica:* clickear una tarjeta disponible navega; clickear una "próximamente" no
      navega a ningún lado.
- [x] **2.9** Botón "volver" de `resultados.html` y los dos botones del bloque de error
      (acceso denegado, reintentar).
      *Verifica:* provocar cada estado (sin permiso, error fatal) y confirmar que los
      botones funcionan.
- [x] **2.10** `grep -rn "onclick=" public/` no devuelve resultados (fuera del comentario
      de ejemplo en `escapar.js`, que no es código).
      *Verifica:* el propio grep — confirmado, y extendido a `onchange=`/`onsubmit=`
      (ver nota arriba), también en cero.

**2.1 a 2.10: el código está escrito y revisado (sintaxis validada con `node --check`,
métodos despachados confirmados uno por uno contra la clase), pero la interacción real
—clicks, paginación, guardar— no se ejecutó en un navegador. Ver paso 4.2.**

---

## Paso 3 — Test de la CSP

- [x] **3.1** `test/csp.test.js`: pide una página servida y verifica que
      `Content-Security-Policy` trae `script-src 'self'` sin `'unsafe-inline'`.
      *Verifica:* corrido contra el estado actual (todavía con la bandera), **el test
      falla**. Confirma que mide lo que dice medir antes de arreglar lo que mide.
      **Hecho**: corrido antes del paso 4.1, falló como se esperaba.

---

## Paso 4 — Sacar `'unsafe-inline'` de `script-src`

- [x] **4.1** `src/core/app.js`: `'script-src': ["'self'"]`.
      *Verifica:* `test/csp.test.js` pasa. **Hecho, pasa.**
- [ ] **4.2** Smoke manual de las 8 páginas con la consola del navegador abierta: login,
      padrón (filtrar, abrir ficha, guardar, paginar), dashboard (los tres roles),
      resultados, auditoría, usuarios, comicio, fiscales, root-redirect.
      *Verifica:* cero errores de CSP en consola (`Refused to execute inline script...`)
      y cada acción responde igual que antes del paso 4.1.

      **En curso, pausado a mitad — retoma el usuario.** Con un usuario de prueba
      (`smoke_002_test`, creado y borrado en esta sesión) se probó, con la extensión de
      Chrome:
      - [x] Login, dashboard (stats, avance por circuito, tarjeta "próximamente" bloqueada).
      - [x] Padrón: paginación completa (primera/anterior/`${i}`/siguiente), abrir ficha
            por DNI en dos filas distintas, guardar panel (teléfono + observación juntos).
      - [x] Radio de opción política.
      - [x] Modal "Nuevo Votante": X, overlay (clic afuera cierra, adentro no), Cancelar.
      - [x] Modal "Importar CSV": abrir (invocado por JS, el botón que lo dispara no
            está visible para este rol — revisar por qué), `abrirSelectorArchivo`, cerrar
            con X.
      - [ ] `cerrarModalImportar` después de un archivo real (sólo se probó la X).
      - [ ] `DetalleVotanteComponent` (modal de condiciones especiales): cerrar, guardar,
            eliminar.
      - [ ] Auditoría, Usuarios, Comicio, Fiscales, root-redirect: sólo verificados por
            HTTP (200 + script servido), falta la prueba interactiva.
      - [ ] Resultados: botón volver, bloque de error/reintentar.
      - [ ] Logout.
      - [ ] **Evitar el botón "Exportar"**: al probarlo se puso la pantalla en negro
            unos segundos (probablemente un diálogo nativo de descarga bloqueando el
            screenshot) — no es parte de este ítem (ya usaba `addEventListener`, no
            `onclick`) así que no se investigó a fondo, pero convendría confirmar que
            es sólo eso y no algo que este cambio rompió.

      **Dos bugs reales encontrados y corregidos en el camino** (no eran visibles por
      revisión de código, sólo probando clicks reales):
      1. El radio de opción política mandaba **dos requests** (una vacía, 400, y la
         correcta, 200): el click y el change delegados chocaban porque el radio matchea
         `[data-action]` para ambos listeners. Fix: el listener de `click` ignora
         explícitamente `cambiarOpcionPolitica`, que sólo despacha por `change`.
      2. El cierre del modal "Nuevo Votante" al clickear el overlay no cerraba nunca:
         `cerrarModalNuevoVotanteOverlay(event)` comparaba `event.target ===
         event.currentTarget`, y con el listener delegado en `document`,
         `currentTarget` es siempre `document`, no el overlay. Fix: se borró ese método
         wrapper y el dispatcher chequea `e.target === el` directamente, sólo cuando
         `el` es el propio overlay (`el.classList.contains('modal-overlay')`) — los
         botones X/Cancelar, que comparten el mismo `data-action`, no llevan esa
         restricción.

      Ambos arreglados, `npm run build:assets` y `npm test` corridos después de cada
      uno (131/131 en verde).
- [x] **4.3** `npm test` completo en verde.
      *Verifica:* 131 pass, 1 skip (el mismo que ya se salteaba antes de este trabajo,
      necesita Postgres real).
- [ ] **4.4** `node scripts/api-snapshot.js` antes y después: sin diferencias — este
      cambio no toca ningún endpoint.
      **No se pudo hacer**: el script pide login (`--user`/`--pass` o
      `SNAPSHOT_USER`/`SNAPSHOT_PASS`) y esta sesión no tiene credenciales del sistema.
      Se intentó tomar el snapshot "antes" con `git stash` sobre el código previo, pero
      falló en el login (403) antes de llegar a comparar nada — no se guardó ningún
      snapshot parcial. Como este cambio no toca ninguna ruta de `/api` (sólo un header
      y el frontend), el riesgo real que este paso cubre es bajo, pero queda pendiente
      correrlo con credenciales válidas para cerrar el criterio tal como está escrito.

---

## Cierre

- [ ] Actualizar `docs/BACKLOG.md`: 002 a ⬛. **No hecho todavía** — recién corresponde
      después de cerrar 4.2 y 4.4.
- [ ] `CLAUDE.md`: sacar la nota de `app.js:79-83` que hoy explica por qué
      `'unsafe-inline'` sigue ahí — ya no aplica — y, si corresponde, dejar una línea en
      las reglas que no se rompen sobre no reintroducir `onclick=` ni `<script>` inline.
      **No hecho todavía.**
