# Backlog de auditoría de FRONTEND

Auditoría exhaustiva de `public/` (frontend vanilla JS sin framework) hecha antes de un
release. Es **diagnóstico**: nada de lo listado acá fue corregido todavía.

Alcance cubierto: los 9 componentes de `public/src/components/`, los 8 scripts de
`public/src/pages/`, `AuthService.js`, `ApiService.js`, `escapar.js`, `microchart.js`,
`tema.js`, las 8 páginas `public/*.html` y las hojas de `public/src/styles/`.

No se repiten acá los puntos que `docs/FRONTEND.md` y `CLAUDE.md` ya documentan como
deuda conocida y vigente: la interpolación sin escapar de `PadronComponent.renderizarTabla`
(`${votante.apellido}`, `${observacion}`, `value="${telefono}"`), la CSP con
`'unsafe-inline'` en `script-src`, la falta de encabezado fijo en la tabla del padrón, y
la paginación con `OFFSET`. Sí se agregan hallazgos **nuevos** que comparten patrón con
esos (por ejemplo, otras interpolaciones sin escapar en otros componentes).

Un hallazgo (FE-050) señala que parte de esa deuda documentada (páginas de debug
públicas) ya no está vigente — se verificó que los archivos no existen en el repo.

---

## Hallazgos

### FE-001 — Los votos de una mesa pueden guardarse en la mesa equivocada

- **Categoría:** Bug (integridad de datos electorales)
- **Severidad:** Crítica
- **Ubicación:** `public/src/components/ComicioComponent.js:1498-1529` (`abrirModalVotos`), `:1535-1564` (`guardarVotos`)
- **Descripción:** `abrirModalVotos(mesaId)` fija el título y el campo oculto `form-votos-mesa-id` de forma síncrona, pero blancos/nulos/votos por fuerza se completan recién después de `await window.apiService.obtenerVotosMesa(...)`, sin comprobar si mientras tanto el usuario abrió el modal de otra mesa. Si se abre la mesa A y, antes de que resuelva ese fetch, se abre la mesa B (cuyo fetch resuelve antes), y luego resuelve el de A, los valores de A sobrescriben el formulario que muestra "Mesa B".
- **Impacto:** El usuario puede guardar los votos de una mesa en el registro de otra sin darse cuenta, en un sistema que registra resultados electorales.
- **Sugerencia de solución:** Capturar `mesaId` en variable local al invocar, y al recibir la respuesta comprobar `if (this.mesaEnEdicionVotos !== mesaId) return;` antes de aplicar los valores al formulario.

---

### FE-002 — Token de sesión y datos de rol en `localStorage`, agravado por el XSS ya conocido

- **Categoría:** Seguridad
- **Severidad:** Crítica
- **Ubicación:** `public/src/services/AuthService.js:7-8, 151-152, 188-189, 247-248`; consumido en `public/src/services/ApiService.js:33-36, 244-247, 270-273` (header `Authorization: Bearer` armado en cliente, sin `credentials: 'include'` ni dependencia de cookie)
- **Descripción:** `authToken` y `userData` (incluye rol y permisos) se guardan en `localStorage`, legible por cualquier script que corra en la página. El proyecto ya tiene XSS inline documentado (CSP con `unsafe-inline`) y, según FE-013/FE-014, hay rutas de XSS adicionales sin documentar. Cualquiera de esas inyecciones puede leer `localStorage.getItem('authToken')` y exfiltrar el JWT completo, incluido el de un administrador.
- **Impacto:** Un solo punto de inyección XSS en cualquier página (todas cargan estos scripts) permite robar la sesión completa sin interacción adicional del atacante.
- **Sugerencia de solución:** Migrar a cookie `httpOnly; Secure; SameSite=Strict` gestionada por el servidor, con un endpoint que devuelva sólo los datos de usuario no sensibles al cliente. Es un cambio coordinado backend+frontend (`ApiService.request` dejaría de armar el header `Authorization` a mano), no trivial, pero es el único mitigante real dado el XSS ya conocido.

---

### FE-003 — `<select>` de circuitos en filtros del padrón sin escapar (XSS)

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** `public/src/components/PadronComponent.js:1395-1398`
- **Descripción:** `circuitos.map(c => `<option value="${c}">${c}</option>`)` interpola sin `escaparHtml` un valor que viene de `apiService.obtenerFiltrosDisponibles()`, alimentado por el mismo dato de importación CSV que ya es un vector conocido en `renderizarTabla`. Esta ruta es independiente: se dispara apenas se abre el padrón, sin que nadie abra una ficha puntual.
- **Impacto:** XSS persistente disparado en la carga inicial de la pantalla más usada del sistema, alcanzable por importación de CSV.
- **Sugerencia de solución:** `circuitos.map(c => \`<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>\`)`.

---

### FE-004 — Segunda instancia del mismo dato de circuito sin escapar (modal "Nuevo Votante")

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** `public/src/components/PadronComponent.js:1443-1454`, en particular línea 1451
- **Descripción:** Al poblar el `<select id="nuevo-circuito">` copiando las opciones del select de filtros (FE-003), se reconstruye `<option value="${opt.value}">${opt.textContent}</option>` sin `escaparHtml(opt.value)`. Es una segunda puerta para el mismo dato contaminado.
- **Impacto:** Mismo que FE-003, con superficie duplicada en otro modal.
- **Sugerencia de solución:** `escaparHtml(opt.value)` en el atributo `value`.

---

### FE-005 — Campo `circuito` sin escapar en la tabla de "Resultados por circuito"

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** `public/src/components/ResultadosComponent.js:789` (`mostrarTablaCircuito`)
- **Descripción:** `'<td>' + c.circuito + '</td>'` interpola sin escapar un `VARCHAR(50)` poblado por importación CSV (mismo origen que FE-003/FE-004). `resultados.html` ya carga `escapar.js`, pero `ResultadosComponent.js` no lo usa en ningún punto del archivo (verificado). Por contraste, `rango_etario` y `sexo` sí son seguros porque se calculan con `CASE`/ternarios fijos, no se interpolan crudos.
- **Impacto:** Un `circuito` con `<img src=x onerror=...>` (cabe en 50 caracteres) se ejecuta para cualquier usuario que abra la sección "Por circuito".
- **Sugerencia de solución:** Envolver `c.circuito` con `escaparHtml()`.

---

### FE-006 — `resultados.js` interpola `error.message` sin `escaparHtml`

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** `public/src/pages/resultados.js:81`
- **Descripción:** `` <p>No se pudo cargar la aplicación: ${error.message}</p> `` dentro de un `innerHTML`, sin escapar. `error.message` puede originarse en `cuerpo.message`/`data.message` de la respuesta del servidor (`ApiService.js:108,118`), texto que en mensajes de validación puede citar el valor inválido enviado por el usuario. Las páginas hermanas (`listas.js:33`, `comicio.js:38`) sí usan `escaparHtml(error.message)` en el mismo punto — `resultados.js` es la única que no lo hace.
- **Impacto:** Vector de XSS si un mensaje de error del backend llega a incluir texto no saneado.
- **Sugerencia de solución:** `escaparHtml(error.message)`, igual que en `listas.js`/`comicio.js`.

---

### FE-007 — DNI interpolado crudo dentro de selectores CSS (`querySelector`)

- **Categoría:** Bug / Seguridad
- **Severidad:** Alta
- **Ubicación:** `public/src/components/PadronComponent.js:826, 971, 1240, 1248`
- **Descripción:** `document.querySelector(\`tr[data-dni="${dni}"]\`)` interpola el DNI (dato de CSV, según el propio comentario del código en línea 1102-1103) dentro de un selector de atributo CSS, contexto que `escaparHtml` no cubre. Un DNI con comilla o backslash rompe el selector con `DOMException: SyntaxError`. En la línea 826 (`abrirPanel`) la excepción no está cubierta por ningún try/catch, dejando el panel a medio abrir; en 1240/1248 (`cambiarOpcionPolitica`) se transforma en un "Error al actualizar relevamiento" engañoso sin haber llamado a la API; en 971 (`marcarFilaCambiada`, sin try/catch propio) corta en silencio el marcado del resto de cambios de esa ronda de polling.
- **Impacto:** Rotura funcional real y reproducible con datos de CSV en cuatro puntos, para votantes cuyo DNI tenga comillas o backslash.
- **Sugerencia de solución:** Usar `CSS.escape(dni)` en las cuatro interpolaciones, o comparar por `dataset.dni` en JS en vez de construir el selector con el valor.

---

### FE-008 — `actualizarTabla()` del padrón sin protección contra condiciones de carrera

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `public/src/components/PadronComponent.js:560-608` (`actualizarTabla`), llamadores en `1291-1294, 1299-1311, 1344-1355, 1375-1378`
- **Descripción:** Cambiar de página, ordenar, filtrar o cambiar registros por página disparan `await this.actualizarTabla()` sin ningún guard contra llamadas superpuestas (sin `AbortController`, sin id de petición, sin deshabilitar controles — ver FE-009). Si una petición anterior tarda más que una posterior, su respuesta llega después y sobreescribe la tabla con datos que ya no corresponden al filtro/orden/página vigente, sin aviso. El propio código sí resuelve este mismo patrón en `abrirPanel` con `this.fichaPedida`; `actualizarTabla` no tiene el equivalente.
- **Impacto:** La tabla puede mostrar resultados de un filtro/orden/página que ya no está seleccionado, en un caso de uso normal (doble clic, red lenta, filtros rápidos).
- **Sugerencia de solución:** Aplicar el mismo patrón que `fichaPedida` — token de "petición vigente" que descarta respuestas obsoletas, o `AbortController`.

---

### FE-009 — Asignaciones de fiscales por mesa pueden guardarse en la caché de otra mesa

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `public/src/components/ComicioComponent.js:1636-1646` (`abrirModalFiscalesMesa`), `:1652-1663` (`cargarAsignacionesMesa`)
- **Descripción:** `cargarAsignacionesMesa()` pide los datos de `this.mesaSeleccionadaFiscales`, pero al resolver el `await` vuelve a leer esa misma propiedad mutable para guardar el resultado (`asignacionesPorMesa.set(this.mesaSeleccionadaFiscales, response.data)`). Si el usuario cierra el modal de la mesa A y abre el de B antes de que resuelva la petición de A, el resultado de A se guarda bajo la clave de B cuando resuelve tarde.
- **Impacto:** El calendario y la tabla de asignaciones de la mesa B pueden mostrar fiscales que en realidad corresponden a la mesa A.
- **Sugerencia de solución:** Capturar `const mesaId = this.mesaSeleccionadaFiscales;` al inicio de la función y usarla en toda la resolución, con guard de "¿sigue siendo la mesa activa?" antes de re-renderizar.

---

### FE-010 — Crash total de la interfaz de Comicio con la combinación de permisos `fiscalesEdit` sin `fiscalesView`

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `public/src/components/ComicioComponent.js:81` (render condicional) vs. `:1043-1054` (wiring de eventos)
- **Descripción:** El modal de fiscal sólo se agrega al DOM cuando `comicioView && fiscalesView` (línea 81), pero `inicializarEventos()` intenta engancharle listeners guardado sólo por `if (this.permisos.fiscalesEdit)` (línea 1043), sin exigir también `fiscalesView`. Los permisos `fiscales.view` y `fiscales.edit` están sembrados como filas independientes (`auth/migrations/002_roles_y_permisos.sql:21-22`), así que un rol con sólo `fiscales.edit` es alcanzable. En ese caso `document.getElementById('btn-crear-fiscal')` es `null` y `.addEventListener` lanza `TypeError`, cortando `inicializarEventos()` a mitad de camino: ningún listener posterior (crear comicio, sub-tabs, mesas, votos) queda enganchado.
- **Impacto:** Toda la página de comicio queda inutilizable para ese perfil de permisos.
- **Sugerencia de solución:** Usar `this.permisos.fiscalesEdit && this.permisos.fiscalesView` en la línea 1043, espejando la condición de render de la línea 81.

---

### FE-011 — El gráfico de "Sin datos" queda roto permanentemente hasta recargar la página

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `public/src/components/ResultadosComponent.js:663-678` (`crearGraficoEmpleadosPolitica`), `:710-725` (`crearGraficoAyudaPolitica`)
- **Descripción:** Cuando no hay datos, el código reemplaza `canvas.parentElement.innerHTML` por un `<div class="no-data">`, eliminando el `<canvas>` del DOM. En el siguiente refresco, `document.getElementById('chart-...')` devuelve `null` y el guard `if (!canvas) return;` corta la ejecución en silencio — el gráfico no vuelve a aparecer nunca más aunque en un refresco posterior sí haya datos.
- **Impacto:** Un gráfico que mostró "Sin datos" una vez queda con un hueco vacío para siempre, sin error visible, hasta recargar la página completa.
- **Sugerencia de solución:** No reemplazar el `<canvas>`; usar un elemento hermano oculto/mostrado con `display`, o recrear el `<canvas>` con el mismo id al reintentar.

---

### FE-012 — Verificación periódica de token se duplica en cada login sin poder limpiarse

- **Categoría:** Bug / Performance
- **Severidad:** Alta
- **Ubicación:** `public/src/services/AuthService.js:12, 18-30, 35-40, 157-158`
- **Descripción:** El constructor llama `startTokenVerification()` incondicionalmente, creando un `setInterval`. `login()` vuelve a llamar `startTokenVerification()` sin llamar antes a `stopTokenVerification()`, y esa función no limpia ningún interval preexistente: sobreescribe la referencia perdiendo el anterior. Cualquier secuencia logout→login en la misma pestaña dispara un `setInterval` nuevo cada vez sin cancelar el previo.
- **Impacto:** Cada login adicional multiplica las llamadas a `/api/auth/verify` cada 5 minutos (2 logins = 2 llamadas simultáneas, 3 = 3, etc.), consumo de servidor redundante e innecesario. Un interval viejo puede además disparar `logout()` inesperadamente mientras hay una sesión más nueva válida.
- **Sugerencia de solución:** `startTokenVerification()` debe llamar `stopTokenVerification()` como primera línea; el constructor no debería arrancar el timer si no hay sesión activa.

---

### FE-013 — `resultados.html` carga dos hojas de CSS que colisionan en `.stat-card`/`.stat-icon`/`.stat-label`

- **Categoría:** Bug / Inconsistencia
- **Severidad:** Alta
- **Ubicación:** `public/resultados.html:23-24` (carga `padron-styles.css` y luego `resultados-styles.css`); definiciones colisionantes en `public/src/styles/padron-styles.css:396-451` vs `public/src/styles/resultados-styles.css:142-184,194-220`
- **Descripción:** Ambas hojas definen `.stat-card`, `.stat-icon`, `.stat-label` con propiedades distintas (padding, tamaño de icono, `gap` vs `margin-right`, `border` vs `border-left`+`box-shadow`, variables de color de partido distintas). `resultados-styles.css` gana en las propiedades que ambas declaran, pero conserva propiedades sueltas de `padron-styles.css` que no pisa — un híbrido no diseñado. Esto es exactamente el escenario que `docs/FRONTEND.md`/`CLAUDE.md` documentan como riesgo *futuro* ("hoy no choca porque ninguna página carga dos de esas hojas a la vez"), y ya está ocurriendo hoy.
- **Impacto:** Las tarjetas de estadísticas de Resultados pueden verse deformes (layout, tamaño de íconos y colores de partido mezclados de dos paletas).
- **Sugerencia de solución:** Consolidar las clases `.stat-*` compartidas en una hoja común (o en `design-system.css`) y dejar en cada hoja de módulo sólo los modificadores propios.

---

### FE-014 — `ApiService.request()` devuelve `undefined` en 401, rompiendo a todos los callers que asumen `response.success`

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `public/src/services/ApiService.js:45-55`; consumidores en `public/src/components/UsuariosComponent.js:248-249, 283-284, 466-471, 493-494, 516-517`
- **Descripción:** En 401, `request()` ejecuta `await window.authService.logout()` y `return;` (sin valor). Todos los métodos de `UsuariosComponent` hacen `if (response.success)` sin verificar que `response` exista, lanzando `TypeError: Cannot read properties of undefined (reading 'success')`.
- **Impacto:** El error es capturado por el `catch` circundante y muestra un mensaje engañoso ("Cannot read properties of undefined...") justo cuando la sesión expiró y se está redirigiendo — condición de carrera visual, y ensucia la consola con una excepción no relacionada al problema real.
- **Sugerencia de solución:** Que `request()` lance una excepción controlada en vez de devolver `undefined`, o que los consumidores usen `response?.success`.

---

### FE-015 — Patrón N+1: refetch completo de asignaciones de fiscales tras cada guardado de mesa/voto

- **Categoría:** Performance
- **Severidad:** Alta
- **Ubicación:** `public/src/components/ComicioComponent.js:1318-1340` (`entrarAComicio`), `:1568-1580` (`cargarAsignacionesDelComicio`)
- **Descripción:** `entrarAComicio(id, false)` se invoca tras cada `guardarMesa`, `eliminarMesa` y `guardarVotos`. Si hay permiso de fiscales, dispara `cargarAsignacionesDelComicio()`, que hace `Promise.all(mesas.map(m => apiService.asignacionesDeMesa(m.id)))` — una petición HTTP por cada mesa del comicio, sólo para refrescar el calendario.
- **Impacto:** En un comicio con decenas o cientos de mesas, cargar un solo voto dispara N peticiones simultáneas al servidor, todas redundantes salvo cuando cambió algo de fiscales — justo el tipo de costo de servidor que el proyecto prioriza evitar en toda feature nueva.
- **Sugerencia de solución:** Separar el refresco de mesas/votos del refresco del calendario de fiscales; sólo volver a pedir asignaciones cuando el sub-tab "Fiscales" esté activo o se edite específicamente una asignación.

---

### FE-016 — Interval global de "cerrar menú de exportar" acumulable sin remoción

- **Categoría:** Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `public/src/components/ResultadosComponent.js:237-240`
- **Descripción:** Se agrega un listener de `click` a `document` en `inicializarEventos()` sin guardar la referencia ni removerlo. Riesgo bajo hoy (una sola instancia por página), pero se acumularía si `crearInterfaz()` se invocara más de una vez sobre la misma instancia.
- **Impacto:** Ninguno comprobado hoy; trampa latente para reutilización futura del componente.
- **Sugerencia de solución:** Guardar la referencia del listener y removerla si el componente se reinicializa.

---

### FE-017 — Lost update: tildar varias fuerzas rápido en el mismo comicio puede perder una de las dos

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `public/src/components/ComicioComponent.js:684-709` (`toggleFuerzaEnComicio`)
- **Descripción:** Cada `change` de checkbox dispara un PUT completo calculado desde `this.comicioActual.fuerzas`, que sólo se actualiza cuando resuelve la respuesta anterior. Si se tildan dos fuerzas antes de que la primera petición resuelva, ambas parten del mismo estado base y compiten; la que resuelve último pisa a la otra.
- **Impacto:** Se pierde en el servidor un cambio que la UI mostró como aplicado.
- **Sugerencia de solución:** Deshabilitar los checkboxes mientras hay un guardado en curso, o encolar los cambios.

---

### FE-018 — Escape lanza excepción no controlada si `comicioView=true` y `fiscalesView=false`

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `public/src/components/ComicioComponent.js:1129-1137`
- **Descripción:** El listener global de Escape llama incondicionalmente a `cerrarModalFiscal()`/`cerrarModalFiscalesMesa()`, que hacen `document.getElementById('modal-fiscal').style.display = ...` sin chequeo de null. Esos modales sólo existen si `fiscalesView` es true. Con `comicioView=true` y `fiscalesView=false` (perfil "operador de mesa" plausible), Escape lanza `TypeError` en cualquier parte de la página.
- **Impacto:** Excepción silenciosa en consola que corta la función cada vez que se presiona Escape para ese perfil.
- **Sugerencia de solución:** Agregar guard `if (!document.getElementById('modal-fiscal')) return;`, patrón ya usado en otras funciones del mismo archivo.

---

### FE-019 — Comparador de barras sigue usando el patrón `|| 1` que el propio código ya documentó como bug en otro lugar

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `public/src/components/ResultadosComponent.js:420-435` (`mostrarComparadorBarras`), especialmente línea 423
- **Descripción:** `mostrarEstadisticasCondiciones` (líneas 367-372) documenta que `parseInt(x) || 1` "tapaba el dato faltante con un número absurdo" y fue reemplazado por un chequeo `totalRelevados > 0`. `mostrarComparadorBarras` sigue con el patrón viejo: con 0 votantes relevados, renderiza igual "PJ lidera con 0.0%" en vez de un estado vacío.
- **Impacto:** Sugiere un resultado real sobre datos que en verdad no existen (arranque del relevamiento).
- **Sugerencia de solución:** Replicar el chequeo `totalRelevados > 0` para ocultar/reemplazar el comparador cuando no hay relevamientos.

---

### FE-020 — `microchart.js`: `role="img"` sin `aria-label` contradice la afirmación de "legible para lector de pantalla"

- **Categoría:** Accesibilidad
- **Severidad:** Media
- **Ubicación:** `public/src/lib/microchart.js:162` (`role: 'img'` en el `<svg>` raíz)
- **Descripción:** El comentario del propio archivo (líneas 23-25) afirma que "el texto queda seleccionable y legible para un lector de pantalla". Lo de seleccionable es correcto, pero `role="img"` le dice al lector de pantalla que trate todo el subárbol como una imagen opaca; sin `aria-label`/`aria-labelledby` en ese `<svg>`, se anuncia "imagen" sin nombre, y los `<title>` de cada segmento/barra quedan fuera del árbol de accesibilidad. Además, la información de "pista" sólo se dispara con eventos de mouse (sin `tabindex`/`focus`), inaccesible por teclado.
- **Impacto:** Los gráficos no son realmente accesibles a pesar de lo documentado.
- **Sugerencia de solución:** Agregar `aria-label` descriptivo al `<svg>`, o usar `role="graphics-document"` con hijos `role="graphics-symbol"` con su propio `aria-label`.

---

### FE-021 — Validación de creación/edición de usuario visible sólo en frontend

- **Categoría:** Seguridad / Mantenibilidad
- **Severidad:** Media (incertidumbre alta: no se revisó el backend)
- **Ubicación:** `public/src/components/UsuariosComponent.js:436-457` (`guardarUsuario`); HTML con `required`/`minlength` en líneas 99, 104, 112, 120
- **Descripción:** `guardarUsuario()` valida en JS username ≥3, password ≥6, nombre y rol requeridos — únicas barreras visibles antes de llamar a la API. `required`/`minlength` del HTML son triviales de saltear con una request directa.
- **Impacto:** Si el backend (`src/modules/auth/`) no repite estas validaciones, un usuario con acceso al endpoint podría crear cuentas con contraseñas de 1 carácter o roles arbitrarios.
- **Sugerencia de solución:** Confirmar que `src/modules/auth/` repite estas validaciones server-side (fuera del alcance de este audit de frontend, pero a verificar).

---

### FE-022 — Mensajes de error/éxito del login sin `aria-live`/`role="alert"`

- **Categoría:** UX / Accesibilidad
- **Severidad:** Media
- **Ubicación:** `public/src/components/LoginComponent.js:61` (contenedor), usado en `showError`/`showSuccess` líneas 201-228
- **Descripción:** El contenedor de error/éxito se actualiza vía `textContent` y se des-oculta con `style.display`, sin `aria-live` ni `role="alert"`.
- **Impacto:** Un usuario con lector de pantalla no se entera de por qué falló el login sin navegar manualmente hasta el div.
- **Sugerencia de solución:** Agregar `role="alert"` (o `aria-live="assertive"`) al contenedor en el template.

---

### FE-023 — Sombra índigo hardcodeada, resabio de la identidad visual anterior al rediseño a grafito

- **Categoría:** Inconsistencia visual
- **Severidad:** Media
- **Ubicación:** `public/index.html:95,100` (`.padron-nav-btn-results`) y `public/resultados.html:57,62` (`.back-btn`) — `box-shadow` con `rgba(99, 102, 241, ...)`
- **Descripción:** `rgba(99,102,241,…)` es el índigo de Tailwind, acento del sistema *antes* del rediseño a escala neutra + grafito documentado en `CLAUDE.md`. El primary actual es `--ds-primary-500/600` (grises). El test de tokens no lo detecta porque excluye deliberadamente los colores dentro de `rgba()` (tratados como "efecto, no identidad"), pero acá sí es un resabio de marca, no un efecto neutro.
- **Impacto:** Dos botones muestran un resplandor púrpura que no corresponde a ningún acento vigente, rompiendo la regla "el acento es grafito, no un color".
- **Sugerencia de solución:** Cambiar el `rgba` a un derivado de `--ds-primary-600`.

---

### FE-024 — Biblioteca de componentes UI duplicada byte a byte entre `comicio-styles.css` y `fiscales-styles.css`, cargadas juntas

- **Categoría:** Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `public/comicio.html:22-23` carga ambas hojas; bloques idénticos: `.modal-overlay` (`comicio-styles.css:430-440` vs `fiscales-styles.css:212-222`), `.toast` y ~15 clases más (`.btn*`, `.form-*`, `.modal-*`, `.toast-*`)
- **Descripción:** Es el mismo patrón de riesgo que FE-013: dos copias de la misma UI compartida cargadas en la misma página. Hoy están sincronizadas, pero cada edición futura a un modal/toast/botón tiene que replicarse a mano en el otro archivo o diverge en silencio.
- **Impacto:** Bytes duplicados en cada carga de `comicio.html`, y trampa de mantenimiento activa (no potencial), porque ambas hojas ya conviven en la misma página.
- **Sugerencia de solución:** Extraer los componentes compartidos a una hoja común que ambos módulos importen.

---

### FE-025 — `PadronComponent.mostrarCargando()` es un stub sin efecto, sin indicador de carga real

- **Categoría:** UX / Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `public/src/components/PadronComponent.js:1748-1751`
- **Descripción:** Se llama desde `cargarDatos()`/`actualizarTabla()` pero sólo escribe una bandera que nadie lee para deshabilitar controles ni mostrar un spinner. El único texto "Cargando..." es estático y se pone una sola vez al crear la interfaz, nunca en refrescos posteriores.
- **Impacto:** UX pobre en cambios de filtro/página/orden, y habilita directamente la condición de carrera de FE-008 (nada impide, visual o funcionalmente, disparar una segunda petición mientras la primera sigue en vuelo).
- **Sugerencia de solución:** Usar el estado de carga para deshabilitar los controles mientras hay una petición en vuelo, y/o mostrar un indicador real.

---

### FE-026 — Validación de DNI inconsistente entre el helper visual y el submit real

- **Categoría:** Inconsistencia
- **Severidad:** Media
- **Ubicación:** `public/src/components/PadronComponent.js:1501-1507` (mensaje "mínimo 7") vs. `:1608-1614` (validación real, sólo `/^\d+$/`)
- **Descripción:** La validación en tiempo real exige visualmente 7 dígitos para marcar el campo como válido, pero el submit real (`guardarNuevoVotante`) sólo chequea que sean dígitos, sin mínimo de longitud. El backend tampoco valida longitud. Un DNI de 1 dígito pasa el submit aunque el helper nunca haya mostrado el campo como válido.
- **Impacto:** Confusión de UX y datos de longitud arbitraria pueden terminar en la base sin aviso real del frontend.
- **Sugerencia de solución:** Unificar la regla en los dos lugares (idealmente también server-side).

---

### FE-027 — `ApiService`: el `timeout` configurado nunca se aplica (no hay `AbortController`)

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `public/src/services/ApiService.js:8` (`this.timeout = 10000`), `request()` líneas 45-113
- **Descripción:** `fetch()` no soporta `timeout` nativamente y `request()` no implementa `AbortController`, así que el valor configurado es efectivamente un no-op. Una petición colgada nunca se cancela.
- **Impacto:** Si el backend no responde, el usuario puede quedar con el spinner de carga indefinidamente, sin timeout real.
- **Sugerencia de solución:** Implementar `AbortController` con el timeout configurado en cada `fetch`.

---

### FE-028 — Componente `ComicioComponent` mezcla al menos 7 responsabilidades en 1819 líneas

- **Categoría:** Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `public/src/components/ComicioComponent.js` (completo)
- **Descripción:** Una sola clase mezcla CRUD/estado/render de comicios, fuerzas globales, padrón de fiscales, mesas, carga de votos, resultados y gráficos, y calendario+asignaciones de fiscales por mesa. `ListasComponent` (574 líneas, una sola responsabilidad) es el contraejemplo directo dentro del mismo proyecto.
- **Impacto:** Dificulta el mantenimiento y aumenta el riesgo de bugs como FE-001/FE-009/FE-010/FE-017/FE-018, todos originados en este mismo archivo.
- **Sugerencia de solución:** Cuando se retome el trabajo en `comicio.html` (hoy "sin backend completo" según `CLAUDE.md`), partir en sub-componentes por sub-tab coordinados por un controlador liviano.

---

### FE-029 — Recreación de listeners por fila en cada render en vez de delegación (5 tablas de Comicio)

- **Categoría:** Inconsistencia / Performance
- **Severidad:** Media
- **Ubicación:** `public/src/components/ComicioComponent.js` — `renderizarComicios (1161-1207)`, `renderizarMesas (1352-1415)`, `renderizarFuerzasComicio (632-682)`, `renderizarFiscales (352-390)`, `renderizarAsignaciones (1665-1705)`. Contraste: `ListasComponent.js:81-103` ya usa delegación de eventos con comentario explícito.
- **Descripción:** Tras reescribir cada `tbody` con `innerHTML`, se hace `querySelectorAll('.btn-x').forEach(btn => addEventListener(...))` en al menos 5 lugares distintos, en vez de delegar sobre el contenedor padre como ya hace `ListasComponent`.
- **Impacto:** No es un memory leak real, pero es trabajo redundante en cada render (combinado con FE-015, se agrava) y código duplicado que el propio proyecto ya resolvió una vez en otro componente.
- **Sugerencia de solución:** Migrar las tablas de Comicio al mismo patrón de delegación que `ListasComponent`.

---

### FE-030 — Divisiones y tarjetas de estadísticas del padrón usan clases duplicadas entre hojas (mismo riesgo de FE-013, sin colisión activa aquí)

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** Deuda ya documentada en `docs/FRONTEND.md`/`CLAUDE.md`; incluido acá sólo como referencia cruzada a FE-013 y FE-024, que sí son colisiones activas.
- **Descripción:** Se confirma que el problema documentado ya se materializó dos veces en el código actual (FE-013 y FE-024), no sólo como riesgo teórico.
- **Impacto:** Ver FE-013 y FE-024.
- **Sugerencia de solución:** Priorizar la consolidación de clases `.stat-*` y de componentes UI compartidos (modal/toast/botón) como un solo trabajo, dado que ya rompió en dos lugares.

---

### FE-031 — `cambiarOpcionPolitica` no espera (`await`) su propio rollback

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `public/src/components/PadronComponent.js:1284`
- **Descripción:** Es la única invocación de `actualizarTabla()` en todo el archivo sin `await` (las otras 5 sí lo llevan). No rompe nada porque es la última instrucción de la función, pero es inconsistente y se relaciona con FE-008 (sin referencia, no se puede cancelar si el usuario ya disparó otra acción).
- **Sugerencia de solución:** `await this.actualizarTabla();` por consistencia.

---

### FE-032 — Fallback N+1 de `enriquecerConDetalles` sigue vivo como código de contingencia sin monitoreo

- **Categoría:** Mantenibilidad / Performance
- **Severidad:** Baja
- **Ubicación:** `public/src/components/PadronComponent.js:591-594, 1858-1902`
- **Descripción:** Si el backend responde `detallesIncluidos: false` (contingencia, no camino feliz), se cae a `enriquecerConDetalles`, que hace un `GET` por cada fila visible en lotes de 10 — hasta 5 rondas de 10 requests para una página de 50 registros. Sin log/métrica que avise si se activa en producción.
- **Impacto:** Si se activa silenciosamente, multiplica por ~50 la cantidad de requests por carga de página.
- **Sugerencia de solución:** Si el backend garantiza `includeDetalles: true` siempre, eliminar el fallback; si no, loggear un warning visible cuando se activa.

---

### FE-033 — Listeners de `document` en `PadronComponent.inicializarEventos()` se acumularían si `init()` se reejecutara

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `public/src/components/PadronComponent.js:469, 494, 507`
- **Descripción:** Tres listeners a nivel `document` sin remoción. Hoy no se manifiesta porque `init()` se llama una sola vez por carga de página, pero es una trampa para reutilización futura (SPA sin recarga, reintentos de init).
- **Sugerencia de solución:** Bandera `_eventosInicializados` para evitar doble registro, o un método `destruir()`.

---

### FE-034 — `<label>` sin `for` en el selector de "registros por página" del padrón

- **Categoría:** UX / Accesibilidad
- **Severidad:** Baja
- **Ubicación:** `public/src/components/PadronComponent.js:201, 208`
- **Descripción:** A diferencia de los filtros de arriba (que sí usan `for=` correctamente), estos dos `<label>` no asocian el `<select id="registros-por-pagina">`.
- **Sugerencia de solución:** `<label for="registros-por-pagina">Mostrar</label>`.

---

### FE-035 — `formatearTipo`/`mostrarToast` duplicados carácter por carácter entre `ComicioComponent` y `ListasComponent`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `ComicioComponent.js:1793-1796, 1804-1816`; `ListasComponent.js:554-557, 559-571`
- **Descripción:** Mismo diccionario, mismo markup de toast, mismos íconos, mismo timeout — lógica de UI genérica que no depende del estado de cada componente.
- **Sugerencia de solución:** Extraer a `public/src/lib/toast.js` y `formato.js`, mismo criterio que `escapar.js`.

---

### FE-036 — `ListasComponent` sin tope de candidatos/suplentes en el cliente

- **Categoría:** Inconsistencia (validación)
- **Severidad:** Baja
- **Ubicación:** `ListasComponent.js:416-422` (`agregarCandidato`), `:447-453` (`agregarSuplente`); backend `src/modules/listas/service.js:10-11` (`TOPE_CANDIDATOS=60`, `TOPE_SUPLENTES=10`)
- **Descripción:** El textarea de notas sí refleja `maxlength` igual al tope del backend, pero no hay control que impida agregar el candidato/suplente 61/11 — recién se entera al guardar, por un mensaje de error genérico.
- **Sugerencia de solución:** Deshabilitar el botón "Agregar" al llegar al tope.

---

### FE-037 — Pérdida de foco en `ListasComponent` tras mover/quitar candidatos o suplentes

- **Categoría:** UX
- **Severidad:** Baja
- **Ubicación:** `ListasComponent.js:424-431, 433-437, 439-443, 455-462, 464-468`
- **Descripción:** El código ya resuelve el refoco tras altas (`.focus()` explícito), pero mover/quitar/toggle-detalle reconstruyen todo el `innerHTML` sin restaurar el foco.
- **Impacto:** Un usuario navegando por teclado pierde la referencia al elemento activo en cada click.
- **Sugerencia de solución:** Aplicar el mismo patrón de refoco que ya existe para las altas.

---

### FE-038 — Código muerto: `mesaEnEdicionVotos` se escribe pero nunca se lee

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `ComicioComponent.js:36, 1499`
- **Descripción:** Se fija en `abrirModalVotos` pero ningún otro método lo lee; `guardarVotos()` obtiene el id de mesa del campo oculto del formulario. Sugiere una intención de guard (ver FE-001) que nunca se implementó.
- **Sugerencia de solución:** Eliminarlo, o usarlo para el guard de FE-001.

---

### FE-039 — `colorFuerzaVar` interpola el color de fuerza sin cast defensivo

- **Categoría:** Seguridad (defensa en profundidad)
- **Severidad:** Baja (incertidumbre marcada — hoy no explotable)
- **Ubicación:** `ComicioComponent.js:152-154`, usado en 655, 797, 813, 849, 1220, 1522, 1612
- **Descripción:** `var(--ds-fuerza-${color || 1})` sin `Number()` ni validación de rango, confiando en que el backend valida `1-8` antes de persistir (confirmado en `src/modules/comicio/service.js`). Es la única interpolación del archivo que no pasa por `escaparHtml` ni cast numérico.
- **Sugerencia de solución:** `Number(color) || 1` dentro de la propia función, para no depender implícitamente de una validación que vive en otra capa.

---

### FE-040 — Escape no cierra el modal de fiscal cuando el usuario no tiene `comicioView`

- **Categoría:** UX
- **Severidad:** Baja
- **Ubicación:** `ComicioComponent.js:1043-1054` (sin listener de teclado) vs. `:1129-1137` (listener global sólo si `comicioView`)
- **Descripción:** Con sólo `fiscales.view`, el modal se puede cerrar con X, "Cancelar" o clic fuera, pero no con Escape.
- **Sugerencia de solución:** Mover el registro del listener de Escape antes del `return` temprano de la línea 1056.

---

### FE-041 — Fallback `|| 0` faltante en el cálculo de "Sin Relevar" (posible `NaN%`)

- **Categoría:** Bug
- **Severidad:** Baja
- **Ubicación:** `public/src/components/ResultadosComponent.js:503`
- **Descripción:** Todos los demás usos de porcentajes en el archivo tienen `|| 0` como resguardo; esta línea no. Si `porcentaje_participacion` viene `null`/`undefined`, se muestra literalmente `"NaN%"`.
- **Sugerencia de solución:** `(100 - (parseFloat(data.porcentaje_participacion) || 0)).toFixed(2)`.

---

### FE-042 — `mostrarTablaSexo` asume orden de array en vez de leer el campo `sexo`

- **Categoría:** Bug / Inconsistencia
- **Severidad:** Baja (incertidumbre: depende de que el backend garantice el orden)
- **Ubicación:** `ResultadosComponent.js:806-807`
- **Descripción:** `pjPcts[0] > pjPcts[1] ? 'M' : 'F'` asume que el índice 0 es siempre "Masculino". Si el orden de agregación cambiara, el cartel indicaría el sexo equivocado sin que nada lo detecte.
- **Sugerencia de solución:** Comparar buscando el item con `sexo==='M'`/`sexo==='F'` en vez de por posición.

---

### FE-043 — Gráficos de barra sin estado "Sin datos" (a diferencia del doughnut)

- **Categoría:** UX / Inconsistencia
- **Severidad:** Baja
- **Ubicación:** `public/src/lib/microchart.js:345` (`dibujarBarras`, sólo `return` si no hay labels) vs. `:280` (`dibujarAnillo`, sí pinta "Sin datos")
- **Descripción:** Los gráficos de barra (sexo, edad, condiciones-general) dejan un área vacía sin explicación cuando todas las series están en cero.
- **Sugerencia de solución:** Aplicar el mismo `dibujarSinDatos` cuando corresponda.

---

### FE-044 — Mensaje de error desactualizado: sigue culpando a "Chart.js" tras el reemplazo por `microchart.js`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `ResultadosComponent.js:51-54`
- **Descripción:** El chequeo `if (typeof Chart === 'undefined')` en la práctica nunca falla si `microchart.js` cargó (expone `window.Chart`), pero si algún día fallara, el mensaje seguiría culpando a una dependencia que ya no existe en el proyecto.
- **Sugerencia de solución:** Actualizar el texto del mensaje.

---

### FE-045 — Inconsistencia de acceso a la API: un endpoint hardcodeado entre cuatro con método dedicado

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `ResultadosComponent.js:270` (`window.apiService.request('/api/padron/resultados/por-circuito')`) vs. `:266-269` (métodos dedicados)
- **Descripción:** El quinto endpoint de la misma `Promise.all` no tiene método propio en `ApiService`, dificultando manejo de errores/timeouts específico y cambios de ruta futuros.
- **Sugerencia de solución:** Agregar un método dedicado en `ApiService`, consistente con los otros cuatro.

---

### FE-046 — Redirección duplicada en el flujo de expiración de sesión (401)

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `ApiService.js:49-53` vs. `AuthService.js:196`
- **Descripción:** En 401, `request()` llama `authService.logout()` y además `window.location.href = '/'` explícito, pero `logout()` ya redirige al mismo destino en su bloque `finally`. Redundante e inocuo, pero confuso.
- **Sugerencia de solución:** Eliminar la redirección explícita en `ApiService.js`; que `logout()` sea la única responsable.

---

### FE-047 — Botones de icono sin texto accesible en los modales de Usuarios

- **Categoría:** UX / Accesibilidad
- **Severidad:** Baja
- **Ubicación:** `UsuariosComponent.js:93, 105-106, 140, 149-150`
- **Descripción:** Botones de cierre (`&times;`) sin `aria-label`; toggles de mostrar/ocultar contraseña sin `aria-label`/`aria-pressed`.
- **Sugerencia de solución:** Agregar `aria-label="Cerrar"` y `aria-label`/`aria-pressed` dinámico en los toggles.

---

### FE-048 — Modales de Usuarios sin `role="dialog"`/`aria-modal` ni focus trap

- **Categoría:** UX / Accesibilidad
- **Severidad:** Baja
- **Ubicación:** `UsuariosComponent.js:89-133, 136-163`
- **Descripción:** Los overlays no declaran `role="dialog"` ni `aria-modal="true"`, y el foco no queda atrapado dentro (Tab puede salir hacia el fondo). Sí hay manejo positivo de foco inicial y cierre con Escape.
- **Sugerencia de solución:** Agregar `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, y un focus trap simple (o `<dialog>` nativo).

---

### FE-049 — Duplicación de código en `ApiService` (export) y `UsuariosComponent` (poblar selects)

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `ApiService.js:241-262, 267-288` (bloques casi idénticos de descarga); `UsuariosComponent.js:260-266, 269-273` (mismo bucle sobre `this.roles` para dos `<select>`)
- **Sugerencia de solución:** Extraer un helper `_descargarBlob(...)` en `ApiService` y `poblarSelectRoles(selectEl)` en `UsuariosComponent`.

---

### FE-050 — `NavbarComponent` setea el username dos veces (código muerto funcional)

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `NavbarComponent.js:78` (ya interpolado en `renderNavbar`) y `:161-164` (vuelve a calcularlo y pisarlo sin cambio de valor)
- **Sugerencia de solución:** Eliminar el bloque de líneas 160-164.

---

### FE-051 — Campo de contraseña no se limpia tras un login fallido

- **Categoría:** UX
- **Severidad:** Baja
- **Ubicación:** `LoginComponent.js`, `handleLogin` (líneas 102-148)
- **Sugerencia de solución (opcional):** Limpiar `#password` en el `catch` para evitar reenvíos accidentales de una contraseña ya identificada como incorrecta.

---

### FE-052 — `MODULES_CONFIG` es código muerto: 92 líneas sin ninguna referencia

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `public/src/pages/dashboard.js:1-92`
- **Descripción:** `loadDashboard()`/`getModulesForUser()` construyen los módulos desde cero a partir de permisos, sin leer nunca esta constante (verificado por grep en todo el archivo).
- **Sugerencia de solución:** Eliminarla, o dejar un comentario explícito de por qué se conserva si documenta un contrato futuro.

---

### FE-053 — Tres/cuatro llamadas a la API independientes se ejecutan en serie en el dashboard

- **Categoría:** Performance
- **Severidad:** Baja
- **Ubicación:** `public/src/pages/dashboard.js:238-250` (`loadVistaAdminConsultor`), con un cuarto fetch encadenado dentro de `loadQuickStats` (línea 466)
- **Descripción:** Tres fetches independientes (gateados cada uno por su propio permiso, sin dependencia de datos entre sí) se esperan en cadena con `await` en vez de en paralelo.
- **Impacto:** En el peor caso, el dashboard tarda la suma de 3-4 round-trips en vez del máximo de ellos (latencia percibida, no costo de servidor).
- **Sugerencia de solución:** `Promise.allSettled([...])` sobre las llamadas gateadas por permiso.

---

### FE-054 — Documentación desactualizada: `debug.html`, `test-api.html` y `test-padron.html` ya no existen

- **Categoría:** Inconsistencia (documentación)
- **Severidad:** Baja (hubiera sido Alta si el hallazgo fuera real hoy)
- **Ubicación:** `CLAUDE.md` (sección "Deuda conocida"); `test/assets.test.js:167-169` (regex `EXENTOS` que las menciona)
- **Descripción:** Se confirmó con búsqueda recursiva en todo el working directory que ninguno de esos tres archivos existe en el repo. El hallazgo de seguridad que documentan `CLAUDE.md` y el test ya no está vigente.
- **Impacto:** Induce a error a cualquier auditoría futura que confíe en `CLAUDE.md` sin verificar, y mantiene una excepción en el test que ya no protege nada real.
- **Sugerencia de solución:** Quitar la entrada de deuda conocida en `CLAUDE.md` y limpiar la regex `EXENTOS` del test (o documentar por qué se conserva).

---

### FE-055 — Contenido dinámico sin `aria-live` en todas las páginas revisadas

- **Categoría:** UX / Accesibilidad
- **Severidad:** Baja
- **Ubicación:** `public/auditoria.html:46`, `public/usuarios.html:46`, `public/comicio.html:47`, `public/listas.html:46`, `public/resultados.html:199`, `public/dashboard.html:542,549,553,556,564,568`
- **Descripción:** Todos estos contenedores muestran "Cargando…" y se reemplazan vía `innerHTML` desde JS, sin `aria-live="polite"` (sólo `aria-label` estático, que no anuncia cambios).
- **Sugerencia de solución:** Agregar `aria-live="polite"` a estos contenedores.

---

### FE-056 — Boilerplate de auth/init casi idéntico duplicado entre las 4 páginas administrativas

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `public/src/pages/auditoria.js:1-32`, `usuarios.js:1-32` (mismo flujo línea por línea); patrón similar en `comicio.js:19-24`, `listas.js:19-24`
- **Descripción:** Mismo flujo de guard de acceso (init navbar → `authService.init()` → verificar rol/permiso → alert+redirect) repetido a mano en cuatro archivos.
- **Impacto:** Un cambio en la política de acceso tiene que aplicarse a mano en cada page-script.
- **Sugerencia de solución:** Extraer un helper común (`requireAdmin()`/`requirePermiso(lista)`) en un módulo compartido de páginas.

---

## Resumen ordenado por severidad

| ID | Título | Categoría | Severidad |
|---|---|---|---|
| FE-001 | Votos de mesa guardados en la mesa equivocada (race condition) | Bug | **Crítica** |
| FE-002 | Token y datos de rol en localStorage, agravado por XSS conocido | Seguridad | **Crítica** |
| FE-003 | Select de circuitos sin escapar (filtros del padrón) | Seguridad | Alta |
| FE-004 | Select de circuitos sin escapar (modal nuevo votante) | Seguridad | Alta |
| FE-005 | Campo `circuito` sin escapar en tabla de Resultados por circuito | Seguridad | Alta |
| FE-006 | `resultados.js` interpola `error.message` sin escapar | Seguridad | Alta |
| FE-007 | DNI crudo interpolado en selectores CSS (`querySelector`) | Bug/Seguridad | Alta |
| FE-008 | `actualizarTabla()` del padrón sin protección de carrera | Bug | Alta |
| FE-009 | Asignaciones de fiscales guardadas en caché de mesa equivocada | Bug | Alta |
| FE-010 | Crash de Comicio con permiso `fiscalesEdit` sin `fiscalesView` | Bug | Alta |
| FE-011 | Gráfico "Sin datos" queda roto permanentemente | Bug | Alta |
| FE-012 | Verificación de token duplicada en cada login | Bug/Performance | Alta |
| FE-013 | CSS colisionante entre `padron-styles` y `resultados-styles` | Bug/Inconsistencia | Alta |
| FE-014 | `ApiService.request()` devuelve `undefined` en 401 | Bug | Alta |
| FE-015 | N+1 de asignaciones de fiscales tras cada guardado | Performance | Alta |
| FE-016 | Listener global de menú exportar acumulable | Mantenibilidad | Media |
| FE-017 | Lost update al tildar varias fuerzas rápido | Bug | Media |
| FE-018 | Escape lanza excepción sin `fiscalesView` | Bug | Media |
| FE-019 | Comparador de barras con `|| 1` (bug ya corregido en otro lugar) | Bug | Media |
| FE-020 | `microchart.js`: `role="img"` sin `aria-label` | Accesibilidad | Media |
| FE-021 | Validación de usuarios sólo en frontend | Seguridad/Mantenibilidad | Media |
| FE-022 | Errores de login sin `aria-live` | UX/Accesibilidad | Media |
| FE-023 | Sombra índigo hardcodeada (resabio de marca vieja) | Inconsistencia | Media |
| FE-024 | Biblioteca de componentes CSS duplicada en Comicio | Mantenibilidad | Media |
| FE-025 | `mostrarCargando()` del padrón es un stub | UX/Mantenibilidad | Media |
| FE-026 | Validación de DNI inconsistente (helper vs. submit) | Inconsistencia | Media |
| FE-027 | Timeout de `ApiService` nunca se aplica | Bug | Media |
| FE-028 | `ComicioComponent` mezcla 7 responsabilidades | Mantenibilidad | Media |
| FE-029 | Listeners recreados por fila en vez de delegación (Comicio) | Inconsistencia/Performance | Media |
| FE-030 | Clases `.stat-*` duplicadas ya colisionaron (ref. FE-013/024) | Mantenibilidad | Baja |
| FE-031 | `cambiarOpcionPolitica` sin `await` en su rollback | Mantenibilidad | Baja |
| FE-032 | Fallback N+1 de `enriquecerConDetalles` sin monitoreo | Mantenibilidad/Performance | Baja |
| FE-033 | Listeners de `document` acumulables si se reinicializa el padrón | Mantenibilidad | Baja |
| FE-034 | `<label>` sin `for` en selector de registros por página | UX/Accesibilidad | Baja |
| FE-035 | `formatearTipo`/`mostrarToast` duplicados entre componentes | Mantenibilidad | Baja |
| FE-036 | Sin tope de candidatos/suplentes en el cliente (Listas) | Inconsistencia | Baja |
| FE-037 | Pérdida de foco al mover/quitar candidatos (Listas) | UX | Baja |
| FE-038 | Código muerto `mesaEnEdicionVotos` | Mantenibilidad | Baja |
| FE-039 | `colorFuerzaVar` sin cast defensivo | Seguridad | Baja |
| FE-040 | Escape no cierra modal de fiscal sin `comicioView` | UX | Baja |
| FE-041 | Falta `|| 0` en cálculo de "Sin Relevar" (NaN%) | Bug | Baja |
| FE-042 | `mostrarTablaSexo` asume orden de array | Bug/Inconsistencia | Baja |
| FE-043 | Gráficos de barra sin estado "Sin datos" | UX/Inconsistencia | Baja |
| FE-044 | Mensaje de error desactualizado ("Chart.js") | Mantenibilidad | Baja |
| FE-045 | Endpoint hardcodeado sin método dedicado en Resultados | Mantenibilidad | Baja |
| FE-046 | Redirección duplicada en flujo de 401 | Mantenibilidad | Baja |
| FE-047 | Botones de icono sin texto accesible (Usuarios) | UX/Accesibilidad | Baja |
| FE-048 | Modales de Usuarios sin `role="dialog"`/focus trap | UX/Accesibilidad | Baja |
| FE-049 | Código duplicado en export/selects (ApiService/Usuarios) | Mantenibilidad | Baja |
| FE-050 | `NavbarComponent` setea username dos veces | Mantenibilidad | Baja |
| FE-051 | Contraseña no se limpia tras login fallido | UX | Baja |
| FE-052 | `MODULES_CONFIG` es código muerto (dashboard.js) | Mantenibilidad | Baja |
| FE-053 | Llamadas API en serie en el dashboard | Performance | Baja |
| FE-054 | Documentación desactualizada sobre páginas de debug | Inconsistencia (doc) | Baja |
| FE-055 | Contenido dinámico sin `aria-live` en todas las páginas | UX/Accesibilidad | Baja |
| FE-056 | Boilerplate de auth/init duplicado entre páginas | Mantenibilidad | Baja |

**Totales:** 2 Crítica · 13 Alta · 14 Media · 27 Baja = **56 hallazgos**
