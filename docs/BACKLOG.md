# Backlog

Lo que falta hacer, ordenado por cuánto duele no hacerlo. Cada ítem de acá se convierte
en una carpeta bajo `specs/` cuando se toma — ver [SDD.md](SDD.md).

El backlog **no se ordena por esfuerzo**. Se ordena por consecuencia.

Casi todo esto ya estaba anotado como deuda conocida en `CLAUDE.md`. Lo que cambia acá es
que deja de ser una nota al pie y pasa a tener alcance, criterios y un número.

| Estado | |
|---|---|
| 🔴 | No tomado |
| 🟡 | Spec escrita, sin aprobar |
| 🟢 | En curso |
| ⬛ | Cerrado |

---

## Agregar un ítem

Se escribe **acá mismo**, en este archivo, dentro de la prioridad que le corresponda. El
número es el siguiente libre y no se reusa nunca, aunque el ítem se descarte.

Un ítem nuevo necesita sólo cuatro cosas:

```markdown
### 🔴 0NN — <título en una línea> · **S | M | L**

<Qué pasa hoy, en hechos observables.>

<Por qué ahora: qué se desbloquea, o qué se rompe si se posterga.>
```

**Nada más.** Los criterios de aceptación, el alcance y los riesgos son trabajo de la
spec, y escribirlos antes de que el ítem se tome es adivinar: para cuando le toque, el
repo cambió. Si ya sabés algo que se va a olvidar, va como *"criterios candidatos"* — una
pista, no un contrato.

Si no podés escribir el "por qué ahora" sin esfuerzo, probablemente el ítem sea P3 o no
sea un ítem.

---

## P0 — Multiusuario. Hoy se pierden cargas, en silencio.

### 🟢 012 — Multiusuario sin pisarse · **L**

Dos personas cargando al mismo tiempo se borran datos entre sí y ninguna se entera. El
mecanismo principal falla incluso con un solo usuario: `guardarPanel`
(`public/src/components/PadronComponent.js:754`) manda en `Promise.all` dos
read-modify-write sobre la misma fila de `relevamientos`, cada uno "preservando" campos
que leyó antes del otro. Guardar teléfono y observación juntos pierde uno de los dos, con
respuesta 200.

Es la prioridad uno declarada del sistema. Hoy hay una sola persona cargando —y ya pierde
datos por ese `Promise.all`—, pero van a ser varias, con usuarios distintos y **todas
sobre los mismos DNIs**. El día que entre la segunda, cada carga pisada se vuelve
irrecuperable salvo mirando `datos_anteriores` en `padron.auditoria`, y sólo si alguien
sospecha que falta algo.

Eso da la fecha: **las fases 0 a 2 de la spec tienen que estar en producción antes del
alta del segundo usuario.** La fase 3 *es* esa alta.

Spec y plan: [specs/012-multiusuario/](../specs/012-multiusuario/spec.md).
**Estado:** fases 0, 1 y 2 hechas en código. Falta aplicar las dos migraciones contra la
base, la verificación manual, y la fase 3 (alta de usuarios), que es lo último.

---

### ⬛ 013 — Serializar la importación de CSV · **S**

Dos importaciones simultáneas corren dos `COPY` a temporal más dos
`INSERT ... ON CONFLICT` sobre `padron.votantes` en paralelo
(`src/modules/padron/importer.js`). No corrompe —el upsert es por DNI y no toca
`relevamientos`— pero duplica el trabajo y compite por el pool contra la gente que está
relevando.

Ahora porque el sistema pasa a tener varias personas con `padron.edit`: hasta hoy, que
dos importaciones se solaparan requería que alguien lo hiciera a propósito.

**Hecho.** `pg_try_advisory_xact_lock` dentro de la transacción del importador: la
segunda importación concurrente responde 409 en vez de esperar colgada, y el lock se
suelta solo al terminar la transacción —incluido el ROLLBACK y la caída del proceso—,
así que no hay nada que liberar a mano.

---

## P0 — Seguridad. Nada nuevo antes de esto.

### ⬛ 001 — Escapar los datos del votante en el padrón · **S**

`PadronComponent.renderizarTabla` interpola datos en HTML sin escapar:
`${votante.apellido}`, `${observacion}`, `value="${telefono}"`. Una observación que
contenga `</textarea><script>` se ejecuta en el navegador de cualquiera que abra esa
página del padrón.

**Es alcanzable**: los datos entran por carga manual *y* por importación de CSV. Quien
importa un padrón no necesita ser quien lo mira.

Es lo más barato y lo más grave del backlog al mismo tiempo. Una función de escapado y
sus usos.

**Con varias personas cargando (012) empeora**: con un solo usuario el XSS es casi
auto-infligido; con varias es una persona ejecutando código en la sesión de otra, que
puede tener más permisos. Multiusuario sube esto de prioridad, no lo baja.

Criterios candidatos: un helper de escapado aplicado a **toda** interpolación de dato de
usuario en `public/`; un test que renderice un votante con `</textarea><script>` y
verifique que no queda un `<script>` en el DOM; la revisión no se limita a
`renderizarTabla` — `abrirPanel`, `AuditoriaComponent` y `UsuariosComponent` interpolan
igual.

**Fuera de alcance**: sacar el `unsafe-inline` de la CSP, que es 002.

**Hecho.** Un solo helper (`public/src/lib/escapar.js`), cargado por todas las páginas y
aplicado en `PadronComponent`, `DetalleVotanteComponent`, `NavbarComponent` y
`UsuariosComponent`. Escapa **también las comillas**: las dos copias que ya existían
usaban `textContent`/`innerHTML`, que deja pasar `"` y `'` y por lo tanto no sirve dentro
de un atributo — y este frontend interpola en `value=`, `title=` y `onclick=`. Los cuatro
métodos de condiciones inline, muertos desde que la carga se mudó al panel, se borraron
en vez de escaparse. `test/escapado.test.js` falla si alguna interpolación vuelve.

---

### 🔴 002 — Sacar `unsafe-inline` de `script-src` · **L**

La CSP está activa y corta recursos externos, `<base>` y el framing. Pero mientras
`script-src` lleve `unsafe-inline`, **no frena XSS inline**, que es exactamente lo que
001 arregla a mano.

001 tapa los agujeros conocidos; 002 hace que los que no conocemos tampoco sirvan. Uno
sin el otro deja la mitad del trabajo.

Es L de verdad: hay que eliminar los bloques `<script>` de cada página y **todos** los
`onclick=`, incluidos los que los componentes generan dentro de sus plantillas. Toca todo
el frontend.

Conviene que su plan evalúe delegación de eventos contra hash/nonce por script, y que
decida si se hace de a una página o todo junto.

---

## P1 — Confianza. Sin esto, todo lo demás avanza a ciegas.

### 🔴 003 — Tests de integración contra Postgres real · **M**

Los 89 tests corren sin base. Todo lo que toca SQL —repositorios, migraciones, el
importador por COPY, la invalidación de `CacheResultados`— se verifica hoy sólo con el
snapshot de contrato, que hay que acordarse de correr a mano contra un servidor
levantado.

Ya existe la pieza: `migraciones.test.js` se saltea solo si no hay `DATABASE_URL_TEST`.
Falta extender ese patrón al resto y dejarlo corriendo en CI.

**Por qué ahora**: 009 (keyset) y los módulos nuevos de P2 cambian SQL. Sin esto, cada
uno se verifica a ojo contra la base de producción — que es la única que hay.

---

### 🔴 004 — `build:assets` y `npm test` en CI · **S**

Hoy el build de assets se corre a mano. Si alguien edita un CSS y no lo corre, el `?v=`
queda viejo y **los navegadores que ya tienen el archivo se quedan con la versión
anterior un año**, sin forma práctica de invalidarla.

Hay un test que lo detecta. Nadie garantiza que ese test se corra antes de un push.

Criterios candidatos: un workflow que corra `npm ci`, `npm run build:assets` y
`npm test`; que **falle si el build deja el árbol sucio** —eso prueba que el commit traía
la salida al día—; y los tests de Postgres con un servicio `postgres:15-alpine`.

---

### 🔴 005 — Consolidar las clases duplicadas entre hojas · **M**

`padron-styles.css`, `resultados-styles.css`, `auditoria-styles.css` y
`usuarios-styles.css` definen `.stat-card`, `.stat-icon` y `.stat-label` con medidas
distintas. Hoy no choca porque ninguna página carga dos de esas hojas a la vez.

Es una trampa puesta para el primer módulo que combine dos: los componentes van a salir
deformes y el causante va a estar en otro archivo.

**Por qué ahora**: P2 agrega justamente dos módulos. Es más barato antes de 007 y 008 que
después.

---

## P2 — Funcionalidad. Lo que el sistema todavía no hace.

### 🔴 006 — Encabezado fijo en la tabla del padrón · **S**

Se probó y **se revirtió**: `position: sticky` necesita que el contenedor tenga scroll
propio, y esa barra vertical angosta el área útil hasta empujar la última columna fuera
de la vista. Además cambia el modelo de scroll — la rueda mueve la tabla, no la página.

La tabla ahora tiene 8 columnas y no 11, así que el motivo del revert puede haber
desaparecido. Vale la pena, pero **como cambio verificado a mano**, no por test.

Su spec tiene que decir explícitamente a qué anchos de pantalla se verifica.

---

### 🔴 007 — Módulo de fiscales · **L**

`public/fiscales.html` existe con 80 líneas de cáscara y **no tiene backend**. Los
permisos `fiscales.view` y `fiscales.edit` ya están sembrados en
`auth/migrations/002_roles_y_permisos.sql`.

Es el primer módulo nuevo desde que el monolito quedó modular: es la prueba de que
`docs/AGREGAR-MODULO.md` sirve. Si agregar un módulo duele, el problema es la guía, no el
módulo.

Su spec necesita definir **el dominio antes que la pantalla**: qué es un fiscal, qué lo
liga a una mesa, si se importa o se carga a mano, y qué pasa cuando falta uno.

---

### 🔴 008 — Módulo de comicio (lugares de votación) · **L**

Mismo estado que 007: página vacía, permisos sembrados, sin backend.

Va después de 007 a propósito: el segundo módulo es el que dice si el patrón de 007 se
sostiene o si lo copiamos mal dos veces.

Relación a resolver en su spec: `comicio` es probablemente el dueño de mesa y circuito,
que hoy viven sueltos dentro de `padron`. Eso cruza el límite entre módulos, y ese límite
es lo que hace barato agregar módulos — merece decidirse por escrito y no en el camino.

---

### 🔴 014 — Señal de presencia en la ficha del padrón · **M**

Con varias personas relevando los mismos DNIs, dos van a abrir la misma ficha. El 409 de
012 evita que se pisen, pero avisa recién al guardar: el trabajo de los dos minutos
anteriores ya está hecho por duplicado.

"Juan tiene esta ficha abierta" en el panel lo evitaría antes. **No se toma hasta tener el
número**: 012 loguea cada conflicto, así que después de una semana de uso real se sabe si
pasan dos veces por semana o veinte por día. Es la única pieza de todo esto que necesita
estado efímero de servidor —heartbeat y expiración—, y eso no se construye por las dudas.

*Criterios candidatos:* sin bloquear nunca la edición; una pestaña cerrada sin avisar no
puede dejar una ficha marcada para siempre.

---

## P3 — Escala. Cuando haga falta, no antes.

### 🔴 009 — Paginación keyset en el listado de votantes · **M**

`GET /votantes` pagina con `OFFSET`. Con ~5.500 filas no molesta. El exportador ya usa
keyset, así que el patrón está resuelto en el repo.

**Cambia el contrato de paginación que consume el frontend**, así que no es un cambio
interno: se hace con snapshot antes y después.

Disparador: que el padrón crezca un orden de magnitud, o que se note el salto a páginas
altas. Hoy no pasa ninguna de las dos.

---

### 🔴 010 — Sesiones en Redis · **L**

La caché de sesión es local al proceso, **y eso es lo que la hace correcta**: login,
logout, cambio de rol y desactivación la invalidan de forma exacta e inmediata.

Con más de una instancia eso deja de ser cierto en silencio: alguien desactivado sigue
entrando por la otra réplica hasta que venza el TTL.

**Es el supuesto que sostiene el diseño de `core/security/sessions.js`.** Disparador: la
primera vez que se hable de correr dos instancias. Antes de eso es pagar infraestructura
por nada.

---

## Higiene

### 🔴 011 — Poner al día la deuda conocida de `CLAUDE.md` · **S**

La sección tiene ítems ya resueltos: menciona `debug.html`, `test-api.html` y
`test-padron.html` como servidos públicamente en producción, y **esos archivos ya no
existen**.

Una lista de deuda con entradas falsas se deja de leer entera. Corregir esa, y reemplazar
las demás por punteros a los números de este backlog, para que la deuda tenga un solo
lugar.

---

## Lo que decidimos NO hacer

Va acá para no volver a discutirlo cada vez que aparezca.

| | Por qué no |
|---|---|
| Framework de frontend (React, Vue, Svelte) | `public/` es JS plano *por decisión*: no hay que compilarlo ni servirlo aparte, y el VPS es chico. Un framework no resuelve ningún problema de esta lista. |
| Tailwind o cualquier librería de UI | El design system ya es la fuente única del color, y permitió rehacer la identidad visual dos veces tocando un archivo. Tailwind agrega un build para llegar al mismo lugar. |
| Volver a microservicios | Eran ocho instancias de `Database` con su pool cada una —hasta 120 conexiones contra Supabase— y un salto HTTP por request autenticado. El monolito modular ya tiene el corte hecho por si algún día un módulo tiene que salir. |
| Migrar el markup de Font Awesome 5 a 6 | `build-assets.js` traduce los nombres leyendo la metadata del paquete. Migrar son 181 usos y cero ganancia. |
| Cambiar de Supabase | Fuera de discusión. |
