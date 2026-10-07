# Backlog

Lo que falta hacer, ordenado por cuánto duele no hacerlo. Cada ítem de acá se convierte
en una carpeta bajo `specs/` cuando se toma — ver [SDD.md](SDD.md).

El backlog **no se ordena por esfuerzo**. Se ordena por consecuencia.

Casi todo esto ya estaba anotado como deuda conocida en `CLAUDE.md`. Lo que cambia acá es
que deja de ser una nota al pie y pasa a tener alcance, criterios y un número.

**2026-09-23 — unificación.** Además de las features y deuda propias (numeración `0NN`,
spec en `specs/`), este backlog incorpora los 126 hallazgos de la revisión de código de
frontend/backend/base de datos (`BACKLOG-FRONTEND.md`, `BACKLOG-BACKEND.md`,
`BACKLOG-DB.md`, consolidados antes en `BACKLOG-UNIFICADO.md`) con sus IDs originales
(`FE-`, `BE-`, `DB-`, y los grupos `Gx` que cruzan capas). Se integraron a este mismo
orden de prioridad mapeando severidad → prioridad — **Crítica→P0, Alta→P1, Media→P2,
Baja/Informativo→P3** — porque es el mismo criterio ("consecuencia, no esfuerzo") aplicado
con otro vocabulario. Acá sólo aparecen título, categoría y severidad/estado de cada
hallazgo; la descripción completa, el impacto y la sugerencia de solución de cada uno
siguen en su backlog de origen (`BACKLOG-FRONTEND.md`, `BACKLOG-BACKEND.md`,
`BACKLOG-DB.md`), indicado por el prefijo del ID. `BACKLOG-UNIFICADO.md` quedó
reemplazado por esta sección y se puede borrar.

**2026-10-07 — avance sin intervención.** Cerrados en código, con tests (237/237 contra un
Postgres descartable; ninguno tocó producción): G4 (FE-003/004/005, circuito escapado), G7 (CHECK
`NOT VALID` en `comicio/005`), G8 (contraseña 8–72 bytes, backend y formulario a la vez),
y los sueltos FE-006, 007, 008, 010, 011, 014, 026 y BE-003, 004, 005, 006, 007, 008, 011,
012, 017, 020, 022, 028, 046. G6 **aplicado en producción** (2026-10-07, junto con las otras 9 migraciones de la
ronda, corridas a mano con `npm run migrate`).
Quedan para vos: G2 (CASCADE→RESTRICT cambia qué se puede borrar), DB-007, DB-010 (hay que
mirar el rol real de la conexión), 018, 014 y 002.

**2026-10-07 (decisiones de base de datos) — DB-004, 005 y 018 hechos; DB-015 decidido que no.**
DB-004: `auth/007` y `padron/007` convierten las 15 columnas `TIMESTAMP` a `TIMESTAMPTZ`
interpretando lo guardado como UTC (verificado: 18:00 queda 18:00 UTC aun con la sesión en otra
zona, y correrla dos veces no mueve nada); la zona de la sesión no se fija desde el pool (un `SET` por conexión nueva dispara el aviso de deprecación de pg y será error en pg@9).
**Antes de migrar, mirar la sección "Zona horaria" del preflight**: la última actividad guardada
tiene que coincidir con la hora UTC actual. DB-005: los rangos etarios de Resultados salen de
`anio_nac` (año actual menos año de nacimiento); la columna `edad` queda para la exportación.
DB-018: `auth/008` hace `rol_id NOT NULL` (el preflight cuenta las cuentas sin rol). DB-015: el
email no se hace único hasta que exista una feature que lo use (reset de contraseña).

**2026-10-07 (decisiones de permisos) — BE-015, 021, 024 y 040 cerrados.** BE-015: gestión de
usuarios y roles queda sólo del rol administrador, `admin.users`/`admin.roles` ya no se declaran.
BE-024: exportar el padrón es sólo del administrador; la migración `auth/006` le quita
`padron.export` al encargado (veía dos botones que daban 403). BE-021: el teléfono viaja con
`padron.view`, decidido y documentado en `padron/routes.js`. BE-040: el username se compara sin
distinguir mayúsculas ni espacios, conservando el nombre guardado (índice único sobre
`LOWER(username)`, `auth/006`); no se renombró a nadie. **Antes de migrar:** correr el preflight,
que ahora verifica que no haya dos cuentas que difieran sólo en mayúsculas.

**2026-10-07 (segunda tanda) — hallazgos medios.** Hechos: ver ⬛ en la tabla de severidad
media. **Quedan para decidir con vos, no por falta de tiempo:** (BE-015, 021 y 024 ya decididos, ver arriba) DB-004 (¿en qué zona horaria
están los `TIMESTAMP` viejos?), DB-014/015/018 (un `UNIQUE`/`NOT NULL` sobre datos reales
que no revisé puede impedir el arranque), DB-017 (esperar el patrón de uso real), DB-026
(borrar un worktree), FE-024/028/029 (refactors grandes de Comicio/CSS, se tocan junto con
005). Migraciones nuevas, todas idempotentes y con `CHECK ... NOT VALID`:
`padron/005` y `006`, `comicio/006`, `fiscales/003`, `listas/004`.

**2026-10-07 (tercera tanda) — severidad baja.** Hechos los ⬛ de la tabla P3. **No tocados a
propósito:** BE-040 (normalizar `username` a minúsculas rompería el login de cuentas ya
creadas con mayúsculas, como `DaianaMontenegro`), BE-042/043/045/052/053/054 (diseño o
dev-only), FE-035/037/049/056 (refactors de duplicación, mejor junto a 005/FE-024),
DB-027/028/029/030/032/036/037/040/041/042/043 (documentación, o borrar objetos sin
decisión). Migraciones: `listas/005`, `comicio/007`, `auth/005`.

| Estado | |
|---|---|
| 🔴 | No tomado |
| 🟡 | Spec escrita, sin aprobar |
| 🟢 | En curso |
| ⬛ | Cerrado |

---

## Agregar un ítem

Un ítem propio del proyecto (feature, deuda) se escribe **acá mismo**, dentro de la
prioridad que le corresponda, con el próximo número `0NN` libre — no se reusa nunca,
aunque el ítem se descarte. Necesita sólo cuatro cosas:

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

Un hallazgo nuevo de revisión de código se agrega en su backlog de origen (`FE-`, `BE-`,
`DB-`) con el siguiente ID libre de esa capa, y se suma a la tabla de la severidad que le
corresponda acá. Si el mismo problema aparece en más de una capa, se agrupa como `Gx` —
ver el criterio de agrupación al principio de cada sección de hallazgos.

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
**Estado:** fases 0, 1 y 2 desplegadas — las migraciones `003` y `004` ya están aplicadas
en producción y el 409 con versión vieja se confirmó a mano. Fase 3: ya hay tres cuentas
personales activas (`admin1`, `DaianaMontenegro`, `augusto`), cada una con su rol. Falta
sólo **3.6**: mirar los 409 logueados después de una semana de uso real y decidir 014 con
ese número.

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

### 🟢 002 — Sacar `unsafe-inline` de `script-src` · **L**

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

**Estado (2026-10-07):** implementado — `script-src 'self'`, sin `<script>` inline ni
manejadores `on*=`; smoke en navegador real hecho (ver `specs/002.../tareas.md` 4.2). Faltan el
snapshot de contrato (credenciales) y probar a mano "eliminar detalle" y logout. Se corrigió
de paso `GET /votantes/:dni`, que no envolvía `{success, data}`.

---

### Hallazgos críticos de la revisión de código (FE/BE/DB)

Mismo criterio de agrupación que el resto de esta sección: un hallazgo se agrupó en `Gx`
cuando dos o más backlogs de capa describían el mismo flujo visto desde un lado distinto.
Detalle completo (impacto, sugerencia de solución) en el backlog de origen indicado por
el prefijo del ID.

**⬛ G1 — Comicio: condiciones de carrera en la carga de votos y la asignación de fiscales**
*(Bug/Diseño · Frontend, Backend, Base de datos · FE-001, FE-009, BE-009, BE-026, DB-007,
DB-008, DB-019)*

En el frontend, `ComicioComponent` no protege contra que dos fetches de mesas/fiscales
distintas resuelvan fuera de orden, y termina guardando los votos o la caché de
asignaciones de una mesa bajo el id de otra (FE-001, FE-009). En el backend, la
validación de que una mesa/fiscal no se solape con otra es un check-then-insert sin
transacción ni lock (BE-009, BE-026) — la misma carrera, del lado del servidor. En el
esquema, `fiscal_asignaciones` admite un `EXCLUDE constraint` de Postgres que cerraría
esa carrera de raíz (DB-008); el rango de mesa depende de una columna mutable de
`padron.votantes` (DB-007) y no tiene `ON DELETE` explícito hacia esa tabla (DB-019).
Arreglar sólo una capa no cierra la carrera del lado de la otra; el `EXCLUDE constraint`
es la corrección de fondo, el fix de frontend sigue siendo necesario para la experiencia
de usuario.

**Implementado y verificado contra producción (2026-09-23).** FE-001/FE-009: `abrirModalVotos` y
`cargarAsignacionesMesa` en `ComicioComponent.js` ahora descartan una respuesta tardía
si mientras tanto se abrió otra mesa — verificado en un navegador real contra
producción, no solo por test. BE-026/DB-008: `fiscal_asignaciones` tiene dos `EXCLUDE
constraint` (`btree_gist`) que cierran el solapamiento de raíz, con el código Postgres
`23P01` mapeado a 409 en `core/errors.js`; probado insertando filas conflictivas por
SQL directo contra producción (con `ROLLBACK`) y como test permanente en
`test/migraciones.test.js`. BE-009: `crearMesa`/`actualizarMesa` corren la validación de
rango y el insert/update dentro de una misma transacción, bajo
`pg_advisory_xact_lock(namespace, comicioId)` — lock por comicio, no global. DB-019: las
FK de `elecciones.mesas` hacia `padron.votantes` ahora declaran `ON DELETE RESTRICT`
explícito. Las cinco migraciones nuevas (`fiscales/002`, `comicio/004`) están aplicadas
en producción. `npm test`: 209/209. Spec, plan y tareas en
[specs/G1-comicio-fiscales-carreras/](../specs/G1-comicio-fiscales-carreras/spec.md).

Las tres verificaciones de concurrencia HTTP real que habían quedado bloqueadas
(fiscales concurrentes, el caso "limpio" de mesas nuevas compitiendo entre sí, y que dos
comicios no se bloqueen entre sí) se completaron en un reintento posterior — las tres
contra producción, la última probando el `pg_advisory_xact_lock` de forma aislada sin
tocar ninguna tabla. Quedaron algunas filas de prueba sin poder borrar (borrado
bloqueado por el sandbox): mesas 31 y 41 en el comicio "Prueba2", y una asignación de
fiscal en su mesa 1 — se borran a mano desde la UI si no se las quiere dejar (detalle en
`tareas.md`).

**Pendiente de cerrar del todo**: solo el snapshot de contrato antes/después
(`scripts/api-snapshot.js`) — no hay ninguna línea de base previa en el repo con la cual
comparar (mismo bloqueo que dejó pendiente G3), y el script necesita credenciales reales
que la sesión no maneja. Comando exacto pasado al usuario para correr con `!`. Detalle en
`tareas.md` (Paso 6) y `spec.md`.

DB-007 quedó fuera de alcance de este ítem a propósito (no es una condición de carrera
entre requests, sino una redefinición silenciosa del límite de una mesa disparada por
una reimportación de padrón — una decisión de producto distinta, ver el razonamiento
completo en la spec); sigue como hallazgo Alta suelto hasta que se decida tratarlo
aparte.

**⬛ G3 — Ciclo de vida de sesión: el token queda expuesto y no se invalida correctamente**
*(Seguridad · Frontend, Backend, Base de datos · FE-002, FE-012, BE-001, BE-002, DB-002)*

El frontend guarda el JWT y los datos de rol en `localStorage`, legible por cualquier
script si hay XSS (FE-002), y duplica el `setInterval` de verificación de token en cada
login sin limpiar el anterior (FE-012). En el backend, `logout` no verifica la firma del
JWT — cualquiera puede fabricar un token con el `id` de otro usuario y forzarle el cierre
de sesión (BE-001) — y un login nuevo no invalida los refresh tokens del dispositivo
anterior, eludiendo la "sesión única" documentada como regla dura (BE-002). En el
esquema, el refresh token se guarda en texto plano (DB-002): si la tabla se filtra, es
equivalente a filtrar credenciales activas. Son cuatro puntos débiles de la misma cadena
de confianza (cliente → verificación → persistencia del secreto); corregir sólo uno deja
los otros tres como vía de explotación equivalente.

**Resuelto** — BE-001, BE-002, DB-002 y FE-012, no FE-002 (mover el token fuera de
`localStorage` quedó fuera de alcance, ver más abajo). `logout()` ahora verifica la
firma del JWT (ignorando sólo la expiración) antes de tocar `refresh_tokens`/
`active_sessions`; `abrirSesion()` borra los refresh tokens previos del usuario en la
misma transacción en la que crea el nuevo, así que uno de una sesión ya reemplazada no
puede revivirla; `refresh_tokens.token` pasa a guardar un hash SHA-256 en vez del valor
crudo. `AuthService.login()` (frontend) limpia el intervalo de verificación anterior
antes de crear uno nuevo. Migración `004_hash_refresh_tokens.sql` (purga los refresh
tokens viejos en texto plano) aplicada en producción. Spec, plan y tareas en
[specs/G3-sesion-jwt/](../specs/G3-sesion-jwt/spec.md).

**Fuera de alcance, con su propio ítem pendiente**: FE-002 (mover el JWT de
`localStorage` a una cookie `httpOnly`) es un cambio de arquitectura de transporte
(CORS con credenciales, protección CSRF nueva), no un ajuste del ciclo de vida de
sesión — ver el razonamiento completo en la spec.

**Pendiente de cerrar del todo**: el snapshot de contrato antes/después y el smoke
manual contra el servidor real (`tareas.md`, paso 7.2/7.3) — bloqueados por falta de
credenciales del sistema en la sesión que lo implementó, mismo bloqueo que dejaron
pendiente 002 y 017.

**🟢 G6 — Auditoría: la inmutabilidad no está garantizada y hay eventos que no se registran**
*(Seguridad/Mantenibilidad · Backend, Base de datos · DB-003, BE-016, DB-016, DB-033)*

La tabla de auditoría no tiene ningún trigger, `REVOKE` ni política que impida un
`UPDATE`/`DELETE` directo a nivel de motor — hoy la "inmutabilidad" depende sólo de que
`repository.js` no exponga esos métodos (DB-003). El refresh de sesión no genera ningún
evento de auditoría, pese a que reemplaza una sesión igual que un login (BE-016) — un
vector real de "sesión que reemplaza a otra" (ver G3) queda invisible para cualquier
investigación forense. El esquema tampoco valida que `usuario_id` corresponda a un
usuario real (DB-016) ni restringe el vocabulario de `operacion`/`entidad` (DB-033). El
problema central (DB-003) es que la garantía de inmutabilidad no existe donde debería —a
nivel de base—; los otros tres reducen la utilidad de esa auditoría aun si se blindara el
motor.

**Implementado y verificado contra Postgres real descartable (2026-10-07), sin aplicar en
producción.** Migración `auditoria/002_inmutabilidad.sql` (trigger `BEFORE UPDATE OR DELETE`,
`REVOKE UPDATE, DELETE`, `CHECK` de mayúsculas en `operacion`/`entidad`, comentario sobre
`usuario_id` sin FK) y evento `REFRESH` en `AuthService.renovar()`. `npm test` 221/221 con
`DATABASE_URL_TEST`. **Falta sólo el paso 6 de `tareas.md`: correr la migración en
producción, que requiere confirmación** (no hay staging). Spec en
[specs/G6-auditoria-inmutable/](../specs/G6-auditoria-inmutable/spec.md).

| ID | Título | Categoría | Capas afectadas |
|---|---|---|---|
| ⬛ DB-001 | Backup sin cifrar con PII y hashes en carpeta sincronizada a la nube | Seguridad | Base de datos |

**DB-001 resuelto (2026-09-23).** No era un defecto de código: `respaldo-pre-migracion-2026-09-19/`
—al lado de `microservicios/`, dentro del `OneDrive\Desktop` sincronizado a la nube—
tenía 7 CSV sin cifrar con hashes bcrypt reales de las cuentas activas y PII completa de
votantes. Se movió comprimido y cifrado (`tar` + `gpg --symmetric AES256`) a
`C:\Users\juani\backups-electoral-privado\` (fuera de cualquier carpeta sincronizada),
verificado byte a byte contra el original antes de borrar el texto plano de la carpeta
de OneDrive. La passphrase quedó sólo en la conversación donde se generó — pendiente
que el usuario la guarde en un gestor de contraseñas; sin ella el backup cifrado no
sirve para nada.

---

## P1 — Confianza. Sin esto, todo lo demás avanza a ciegas.

### 🔴 003 — Tests de integración contra Postgres real · **M**

Los 89 tests corren sin base. Todo lo que toca SQL —repositorios, migraciones, el
importador por COPY, la invalidación de `CacheResultados`— se verifica hoy sólo con el
snapshot de contrato, que hay que acordarse de correr a mano contra un servidor
levantado.

**Avance (2026-10-07):** `migraciones.test.js` ya cubre, contra Postgres real: migraciones
idempotentes y concurrentes, trigger de auditoría, los `CHECK`, `insertarVotante`, PUT de
listas atómico, importador (Windows-1252, filas largas, dos importaciones simultáneas),
exportador por keyset en varios lotes, invalidación del caché, sesión única y refresh
hasheado. CI ya corre `postgres:15-alpine` (004). Falta sólo ampliar a comicio/fiscales por
HTTP real; el resto de lo que pedía este ítem está.

Ya existe la pieza: `migraciones.test.js` se saltea solo si no hay `DATABASE_URL_TEST`.
Falta extender ese patrón al resto y dejarlo corriendo en CI.

**Por qué ahora**: 009 (keyset) y los módulos nuevos de P2 cambian SQL. Sin esto, cada
uno se verifica a ojo contra la base de producción — que es la única que hay.

---

### ⬛ 004 — `build:assets` y `npm test` en CI · **S**

Hoy el build de assets se corre a mano. Si alguien edita un CSS y no lo corre, el `?v=`
queda viejo y **los navegadores que ya tienen el archivo se quedan con la versión
anterior un año**, sin forma práctica de invalidarla.

Hay un test que lo detecta. Nadie garantiza que ese test se corra antes de un push.

Criterios candidatos: un workflow que corra `npm ci`, `npm run build:assets` y
`npm test`; que **falle si el build deja el árbol sucio** —eso prueba que el commit traía
la salida al día—; y los tests de Postgres con un servicio `postgres:15-alpine`.

**Hecho** (`6f327d7`). `.github/workflows/deploy.yml` corre `npm ci`, `npm run
build:assets` + `git diff --exit-code -- public/` (falla si el build deja el árbol
sucio), `npm test` con un servicio `postgres:15-alpine` vía `DATABASE_URL_TEST`, `npm
audit` sobre dependencias de producción, y build + arranque real de la imagen Docker
(con y sin base disponible). No tuvo spec propia — S, sin decisiones de alcance
discutibles.

---

### ⬛ 005 — Consolidar las clases duplicadas entre hojas · **M**

`padron-styles.css`, `resultados-styles.css`, `auditoria-styles.css` y
`usuarios-styles.css` definen `.stat-card`, `.stat-icon` y `.stat-label` con medidas
distintas. Hoy no choca porque ninguna página carga dos de esas hojas a la vez.

Es una trampa puesta para el primer módulo que combine dos: los componentes van a salir
deformes y el causante va a estar en otro archivo.

**Por qué ahora**: P2 agrega justamente dos módulos. Es más barato antes de 007 y 008 que
después.

**Hecho (2026-10-07).** Lo que el ítem daba por latente ya estaba pasando: `resultados.html`
cargaba `padron-styles.css` **y** `resultados-styles.css`, las dos con `.stat-card`, y sin las
reglas del padrón la tarjeta perdía borde y padding. El padrón y el dashboard no usan ninguna
clase `.stat-*`. Se mudaron esas reglas a `resultados-styles.css`, sin cambiar un valor, y se
verificó en Chrome comparando **todos** los estilos computados de 11 elementos de Resultados
antes y después: 0 diferencias. `test/frontend-regresiones.test.js` falla si una página vuelve
a cargar dos hojas que definan `.stat-card`. FE-013 y FE-030 quedan cerrados con esto.
**FE-024** (UI duplicada entre `comicio-styles.css` y `fiscales-styles.css`): se quitaron las 36
reglas idénticas de la segunda, con 0 diferencias medidas; no se midieron por separado los
estados `:hover` ni los toasts, porque no estaban en pantalla.

---

### Hallazgos de severidad alta de la revisión de código (FE/BE/DB)

**G2 — Comicio/Fiscales/Padrón: borrados en cascada que destruyen historial sin
protección** *(Bug/Diseño · Backend, Base de datos · BE-010, BE-027, DB-006, DB-009,
DB-022)*

El backend registra en auditoría sólo la fila directa que se borra, sin adjuntar lo que
la cascada de la base arrastra con ella (BE-010, BE-027). Las FK de `mesas→comicios`,
`votos_fuerza→mesa`, `votos_lista→mesa` y `fiscal_asignaciones→mesa` son `ON DELETE
CASCADE` (DB-009, DB-022), mientras que el propio esquema demuestra con
`votos_fuerza→fuerza (RESTRICT)` que la intención de diseño sí es proteger los votos
cargados — es una protección aplicada de un solo lado. El mismo patrón, más grave, existe
en `relevamientos→votantes` (DB-006), pudiendo borrar trabajo de campo real sin dejar
rastro. Cambiar el `CASCADE` a `RESTRICT` en el esquema es la corrección de fondo; hasta
que se haga, el backend necesita al menos capturar y auditar lo que la cascada se llevó.

**⬛ G4 — El dato "circuito" no está sanitizado en ningún punto de su recorrido**
*(Seguridad/Diseño · Frontend, Base de datos · FE-003, FE-004, FE-005, DB-031)*

`circuito` entra por importación CSV y se guarda sin normalizar, sin tabla de referencia
ni FK (DB-031). Ese mismo dato sin sanitizar se interpola sin `escaparHtml` en tres
puntos del frontend: el select de filtros del padrón, el modal de alta de votante, y la
tabla de resultados por circuito (FE-003, FE-004, FE-005) — tres rutas de XSS
independientes con el mismo origen. Escapar el dato en las tres pantallas es la
corrección inmediata y suficiente; normalizar `circuito` en el esquema no es urgente para
la seguridad pero reduce la superficie de origen si se hace.

**🟢 G5 (parcial: FE-007, FE-026, BE-022 y DB-013 hechos; falta DB-005, que es decisión de producto) — Integridad del DNI en el padrón: validación y constraints inconsistentes en cada
capa** *(Bug/Inconsistencia · Frontend, Backend, Base de datos · FE-007, FE-026, BE-022,
DB-013, DB-005)*

En el frontend, el DNI se interpola crudo dentro de selectores CSS (`querySelector`),
rompiendo la UI si contiene comillas (FE-007), y la validación visual de "mínimo 7
dígitos" no coincide con la validación real de submit (FE-026). En el backend, ningún
endpoint valida formato/longitud de DNI (BE-022) — el error llega crudo desde Postgres en
vez de un 400 controlado. En el esquema, no hay `CHECK` de rango para `anio_nac`/`edad`
(DB-013), y `edad` es un valor estático que se desactualiza con cada re-importación sin
recalcularse (DB-005). Ninguna de las cuatro capas valida lo mismo de la misma forma;
definir una única regla de formato de DNI de punta a punta cierra a la vez el bug de UI,
el 500 no controlado y el riesgo de dato corrupto.

| ID | Título | Categoría | Capas afectadas |
|---|---|---|---|
| ⬛ FE-006 | `resultados.js` interpola `error.message` sin escapar | Seguridad | Frontend |
| ⬛ FE-008 | `actualizarTabla()` del padrón sin protección de carrera | Bug | Frontend |
| ⬛ FE-010 | Crash de Comicio con permiso `fiscalesEdit` sin `fiscalesView` | Bug | Frontend |
| ⬛ FE-011 | Gráfico "Sin datos" queda roto permanentemente | Bug | Frontend |
| ⬛ FE-013 | CSS colisionante entre `padron-styles` y `resultados-styles` | Bug/Inconsistencia | Frontend |
| ⬛ FE-014 | `ApiService.request()` devuelve `undefined` en 401 | Bug | Frontend |
| FE-015 | N+1 de asignaciones de fiscales tras cada guardado | Performance | Frontend |
| ⬛ BE-003 | `TRUST_PROXY` como string sin convertir a número | Bug/Seguridad | Backend |
| ⬛ BE-004 | Rate limit global insuficiente contra fuerza bruta | Seguridad | Backend |
| ⬛ BE-005 | `POST /votantes` sobrescribe en silencio a un votante existente | Bug | Backend |
| ⬛ BE-006 | Sin rate limiting específico ni lockout en `/login` | Seguridad | Backend |
| ⬛ BE-007 | Enumeración de usuarios por canal de tiempo | Seguridad | Backend |
| ⬛ BE-008 | Exportador de padrón sin manejo de errores de conexión a mitad de stream | Bug | Backend |
| ⬛ BE-011 | `PUT /listas/:id` no atómico entre metadata y candidatos | Bug | Backend |
| ⬛ DB-004 | `TIMESTAMP` sin timezone inconsistente en módulos viejos vs. nuevos | Diseño/Tipos | Backend, Base de datos |
| DB-010 | Posible uso de rol superusuario de Supabase para la conexión de la app | Seguridad | Backend, Base de datos |

---

## P2 — Funcionalidad. Lo que el sistema todavía no hace.

### 🔴 006 — Encabezado fijo en la tabla del padrón · **S**

**Revisado 2026-10-07 y no tomado:** `position: sticky` sigue necesitando que el contenedor tenga
scroll propio (la tabla es `overflow-x: auto` para ser responsive), y eso cambia cómo se
desplaza la página — una decisión de uso que hay que probar a mano con la rueda del mouse, no
medir. Lo único que se puede medir es el ancho útil; la parte que importa es la sensación.

Se probó y **se revirtió**: `position: sticky` necesita que el contenedor tenga scroll
propio, y esa barra vertical angosta el área útil hasta empujar la última columna fuera
de la vista. Además cambia el modelo de scroll — la rueda mueve la tabla, no la página.

La tabla ahora tiene 8 columnas y no 11, así que el motivo del revert puede haber
desaparecido. Vale la pena, pero **como cambio verificado a mano**, no por test.

Su spec tiene que decir explícitamente a qué anchos de pantalla se verifica.

---

### ⬛ 007 — Módulo de fiscales · **L**

**Reemplazado por 016** — el pedido real trae calendario de franjas horarias y la regla
de un solo fiscal por mesa a la vez, que este ítem no contemplaba.

`public/fiscales.html` existe con 80 líneas de cáscara y **no tiene backend**. Los
permisos `fiscales.view` y `fiscales.edit` ya están sembrados en
`auth/migrations/002_roles_y_permisos.sql`.

---

### ⬛ 008 — Módulo de comicio (lugares de votación) · **L**

**Reemplazado por 015** — el pedido real define el alcance que este ítem dejaba abierto:
mesas con sectorización del padrón, carga de votos por lista y métricas del comicio.

Mismo estado que 007 en su momento: página vacía, permisos sembrados, sin backend.

---

### ⬛ 015 — Módulo de comicio: mesas, votos y sectorización del padrón · **L**

Hoy no existe forma de registrar un comicio: qué listas participan, cuántas mesas, tipo
de elección (provincial, municipal, nacional). Tampoco hay dónde cargar los votos que
obtiene cada lista por mesa, ni los votos en blanco y nulos, ni una sección de métricas y
estadísticas del comicio.

Reemplaza el alcance de 008, que dejaba sin resolver la relación entre `comicio`, mesa y
circuito. Ahora el alcance viene dado: cada mesa se configura con un rango del padrón
("desde tal persona hasta tal persona" en la mesa 1, la mesa 2, etc.), lo que fija cómo
`comicio` se relaciona con `padron`.

Criterios candidatos: alta de comicio con listas y tipo de elección; alta de mesa con
rango de padrón asignado; carga de votos por lista + blancos + nulos por mesa; sección de
métricas agregadas del comicio.

**Hecho, back y front.** Módulo `comicio` (`/api/comicio`), mismo schema `elecciones` que
017 — `comicios`, `comicio_listas`, `mesas`, `votos_lista`. El rango de una mesa son dos
DNIs (no una tabla que copie votante↔mesa): la cantidad de votantes y el solapamiento
entre mesas se calculan con comparaciones de tupla `(apellido, nombre, dni)` contra
`padron.votantes`, en el momento — mismo orden que ya usa el listado del padrón. Dos mesas
del mismo comicio no pueden tener rangos que se crucen (409). Votos por mesa: blancos,
nulos y cantidad por cada lista participante, reemplazo transaccional completo (mismo
patrón que los candidatos de 017). Métricas agregadas: totales por lista, blancos, nulos,
emitidos, mesas cargadas/total, participación. Permisos `comicio.view`/`comicio.edit` ya
estaban sembrados desde antes, sin migración propia.

`public/comicio.html` + `ComicioComponent.js`: listado de comicios con drill-down a sus
mesas, editor de votos por mesa y sección de métricas. Probado de punta a punta en un
navegador real contra Postgres real: alta de comicio con listas, mesa válida, mesa con
rango solapado (rechazada, mensaje visible en el modal), mesa contigua sin solapar, carga
de votos, métricas correctas, edición y borrado.

Dos bugs reales encontrados y arreglados al probar en vivo, ninguno anticipado por la spec:
- `repository.reemplazarVotos` leía el resultado con el pool general **antes** del commit
  de la transacción: la respuesta del `PUT` de votos devolvía `null`/vacío aunque el
  `UPDATE` ya se había mandado (visible recién al releer con `GET`). Se lee ahora después
  de que la transacción resuelve.
- `ApiService.request()` sólo leía el cuerpo del error en un puñado de rutas especiales
  (401, 404/500 de detalle-votante, 409 de relevamientos, 429): cualquier otro error —
  cualquier 400 o 409 de listas y comicio incluidos — llegaba a la UI como
  `"HTTP 409: Conflict"` en vez del mensaje real. Afecta a todo el frontend, no sólo a
  este ítem; arreglado leyendo `message` del cuerpo en el resto de los casos.

Spec, plan y tareas en [specs/015-modulo-comicio/](../specs/015-modulo-comicio/spec.md).

---

### ⬛ 016 — Gestión de fiscales por mesa con calendario · **L**

`public/fiscales.html` existe con cáscara y sin backend. El pedido es más específico que
007: cada mesa necesita uno o más fiscales asignados, pero solo uno presente en cada
momento — lo que exige un calendario/horario (8 a 18hs) que muestre quién cubre qué
franja.

Depende de 015: no hay mesa a la que asignar un fiscal hasta que exista el módulo de
comicio.

Criterios candidatos: asignación de uno o más fiscales por mesa; calendario por franja
horaria que impida o marque dos fiscales simultáneos en la misma mesa; vista de quién
está en cada mesa en un horario dado.

**Hecho, back y front.** Módulo `fiscales` (`/api/fiscales`), mismo schema `elecciones`.
El fiscal es un registro de datos — nombre, DNI y teléfono opcionales — sin cuenta de
usuario: nunca se loguea, alguien con `fiscales.edit` lo carga y lo asigna. Una
asignación es una franja (`desde`/`hasta`, `TIME`) entre 08:00 y 18:00. Dos validaciones
de solapamiento, las dos sobre la misma operación de alta/edición: una mesa no puede
tener dos fiscales al mismo tiempo (409), y un mismo fiscal no puede estar en dos mesas
al mismo tiempo (409) — la segunda no estaba en el criterio original del backlog, se
sumó porque es la misma consulta con otro `WHERE` y evita un dato imposible en la
realidad. Franjas contiguas no chocan. `GET .../agenda?hora=` devuelve, por cada mesa
del comicio, qué fiscal está presente a esa hora (o ninguno). Permisos
`fiscales.view`/`fiscales.edit` ya estaban sembrados desde antes.

`public/fiscales.html` + `FiscalesComponent.js` reemplazan la cáscara "Próximamente":
padrón de fiscales (tabla + modal), selector de comicio → mesa con el calendario de esa
mesa, y una vista de agenda por hora. Probado de punta a punta en un navegador real
contra Postgres real: alta de fiscal, asignación válida, asignación contigua sin chocar,
rechazo por solapamiento de mesa (mensaje real visible en el modal), rechazo por
solapamiento del mismo fiscal en otra mesa, agenda correcta a distintas horas, edición y
borrado. Sin errores de consola.

Spec, plan y tareas en
[specs/016-fiscales-calendario/](../specs/016-fiscales-calendario/spec.md).

---

### ⬛ 017 — Módulo de armado de listas (borradores) · **M**

No existe forma de armar un borrador de lista antes de presentarla: cantidad de lugares,
tipo de elección, candidatos. Hoy esto se arma fuera del sistema.

Es insumo directo de 015 (qué listas participan en el comicio) y hoy no queda registrado
en ningún lado del sistema.

**Hecho, con frontend.** Módulo `listas` (`/api/listas`), schema propio `elecciones` —
separado de `padron` porque una lista de candidatos no es un dato del votante, y deja
lugar a que 015 sume `elecciones.comicios`/`elecciones.mesas` sin decisiones de esquema
pendientes. CRUD completo de listas y candidatos (reemplazo transaccional en el `PUT`, no
PATCH parcial), validado contra Postgres real: alta con candidatos ordenados, edición,
baja, y los 400 de validación (tipo de elección fuera de lista blanca, orden duplicado o
con huecos, tope de 60 candidatos). Auditado. Spec y plan en
[specs/017-armado-listas/](../specs/017-armado-listas/spec.md).

`public/listas.html` + `ListasComponent.js`: tabla con conteo de candidatos por lista
(`candidatos_count`, un `COUNT` barato en el listado — no viene gratis, se agregó porque
la tabla lo necesitaba) y un editor de candidatos donde el orden es la posición en la
lista, no un campo que la persona tipea. Probado de punta a punta en un navegador real
(alta, reordenar, editar quitando un candidato, borrar, validación de nombre vacío) contra
Postgres real, sin errores de consola.

En el camino apareció un bug real y ajeno a este ítem: `/api/auth/verify` no devolvía
`permisos`, así que cualquier item de navbar gateado por permiso (no por rol) quedaba
invisible después de la primera verificación periódica del token. Arreglado agregando
`permisos: req.user.permisos` a esa respuesta — ya viaja en el JWT, no es una consulta
nueva.

Pendiente: el snapshot de contrato antes/después contra producción, que necesita
credenciales de esta sesión (mismo bloqueo que dejó pendiente 002).

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

### 🔴 018 — Mapa sectorizado por domicilio del votante · **L**

No existe una vista geográfica del padrón. El pedido es un mapa que sectorice por barrio
o manzana de una localidad y ubique automáticamente a los votantes según su domicilio,
para sacar estadísticas y trabajar sobre esa información. Incluye una subsección para
marcar manzanas ya visitadas en el casa por casa.

Es la única herramienta pedida que conecta el padrón con el trabajo territorial (visitas
casa por casa), hoy inexistente en el sistema.

**Fuera de alcance inicial**: la fuente de los polígonos de barrios/manzanas (mapa base)
queda para la spec — no está definida en el pedido original.

Ya se probó geocoding contra OSM/Nominatim y falló: en localidades chicas, cuando
Nominatim no tiene la calle con numeración cargada, devuelve el centroide del pueblo en
vez de fallar, así que puntos "resueltos" quedan todos apilados en el centro sin que se
note. Dos problemas distintos que conviene no mezclar:

- **Mapa base** (qué se dibuja de fondo: calles, manzanas) vs. **geocoding** (de dónde
  sale el lat/lon de cada domicilio). Nominatim falló en esto último, no en lo primero.
- El geocoding no corre en runtime por cada visita al mapa — corre **una vez por
  importación de padrón**, server-side, y el resultado se guarda en la base. Por eso una
  dependencia externa acá no choca con la regla de "`public/` no le pide nada a ningún
  tercero": queda confinada a un script de importación, nunca al frontend.

Criterios candidatos:
- Geocoding en batch contra **Georef** (API oficial de datos.gob.ar, normaliza
  direcciones contra el callejero del INDEC) en vez de Nominatim — mejor cobertura de
  nomenclatura argentina en localidades chicas. Medir qué porcentaje del padrón actual
  resuelve antes de comprometerse.
- Fallback para lo que Georef no resuelva: tabla manual "esta calle, entre tal y tal
  altura, cae en tal manzana/barrio", para asignar por rango sin necesitar lat/lon
  exacto — coherente con que el pedido es sectorizar por manzana, no pinpoint exacto.
- Ningún geocoder debe poder devolver "el centro del pueblo" como si fuera un domicilio
  resuelto: una dirección no encontrada tiene que quedar marcada como pendiente, no
  aterrizar en un punto falso indistinguible de uno real.
- Basemap: auto-hospedado, sin pedirle tiles a un tercero en cada vista (ver la regla
  de rendimiento del proyecto). Preferible arrancar sin capa de calles —solo polígonos
  de barrio/manzana en SVG/canvas propio, mismo enfoque liviano que `microchart.js`— y
  sumar una capa de calles estática y propia después si hace falta más referencia
  visual.

---

### Hallazgos de severidad media de la revisión de código (FE/BE/DB)

**⬛ G7 — Cantidad de votos sin protección contra valores negativos** *(Diseño/Inconsistencia
· Backend, Base de datos · BE-050, DB-025)*

`votos_blancos`/`votos_nulos` no tienen `CHECK (>= 0)` a nivel de esquema (DB-025),
mientras que `votos_fuerza.cantidad` en la misma migración sí lo tiene. El backend
depende hoy únicamente de la validación en `service.js` (BE-050). Agregar el `CHECK` en
el esquema resuelve el problema de raíz sin depender de que ningún camino de escritura
futuro pase por el service.

**⬛ G8 — Política de contraseñas débil, validada sólo en frontend salvo el mínimo de
longitud** *(Seguridad · Frontend, Backend · FE-021, BE-018, BE-019)*

El frontend valida username/password/rol antes de enviar el alta de usuario, pero eso es
trivial de saltear con una request directa (FE-021). Confirmado desde el backend: sí hay
una validación server-side de longitud mínima, pero es baja (6 caracteres) y sin techo de
longitud máxima (BE-018, BE-019), lo que además abre una superficie de agotamiento de CPU
vía `bcrypt` en un servidor chico. Subir el mínimo y agregar un máximo es un cambio
coordinado — el propio código backend advierte que 6 es así para no romper el frontend
actual.

| ID | Título | Categoría | Capas afectadas |
|---|---|---|---|
| ⬛ FE-016 | Listener global de menú exportar acumulable | Mantenibilidad | Frontend |
| ⬛ FE-017 | Lost update al tildar varias fuerzas rápido | Bug | Frontend |
| ⬛ FE-018 | Escape lanza excepción sin `fiscalesView` | Bug | Frontend |
| ⬛ FE-019 | Comparador de barras con `\|\| 1` | Bug | Frontend |
| ⬛ FE-020 | `microchart.js`: `role="img"` sin `aria-label` | Accesibilidad | Frontend |
| ⬛ FE-022 | Errores de login sin `aria-live` | UX/Accesibilidad | Frontend |
| ⬛ FE-023 | Sombra índigo hardcodeada (resabio de marca vieja) | Inconsistencia | Frontend |
| ⬛ FE-024 | Biblioteca de componentes CSS duplicada en Comicio | Mantenibilidad | Frontend |
| ⬛ FE-025 | `mostrarCargando()` del padrón es un stub | UX/Mantenibilidad | Frontend |
| ⬛ FE-027 | Timeout de `ApiService` nunca se aplica | Bug | Frontend |
| FE-028 | `ComicioComponent` mezcla 7 responsabilidades | Mantenibilidad | Frontend |
| FE-029 | Listeners recreados por fila en vez de delegación (Comicio) | Inconsistencia/Performance | Frontend |
| ⬛ BE-012 | `jwt.verify` sin restringir `algorithms` | Seguridad | Backend |
| ⬛ BE-013 | Stack traces descartados en logs internos de producción | Mantenibilidad | Backend |
| ⬛ BE-014 | Sin advisory lock en el runner de migraciones | Bug/Mantenibilidad | Backend |
| ⬛ BE-015 | Permisos `admin.users`/`admin.roles` nunca verificados | Inconsistencia/Seguridad | Backend |
| ⬛ BE-017 | `PUT /users/:id` no valida tipo de `activo` | Bug/Inconsistencia | Backend |
| ⬛ BE-020 | CSV Injection / Formula Injection en exportación | Seguridad | Backend |
| ⬛ BE-021 | Teléfono relevado visible con sólo `padron.view` | Seguridad | Backend |
| ⬛ BE-023 | Campo demasiado largo aborta importación de padrón completa | Bug | Backend |
| ⬛ BE-024 | Permisos `padron.export`/`resultados.export` no aplicados | Mantenibilidad | Backend |
| ⬛ BE-025 | Sin manejo de encoding en importación de CSV | Bug | Backend |
| ⬛ BE-028 | Falta validar `fuerzaId` duplicado al cargar votos | Bug | Backend |
| ⬛ BE-029 | Posible falta de índice compuesto sobre `padron.votantes` | Performance | Backend |
| ⬛ BE-030 | Falta cobertura de test para `TOPE_NOTAS` (Listas) | Mantenibilidad | Backend |
| ⬛ BE-031 | Sin tests de ruta para PUT/DELETE de listas | Mantenibilidad | Backend |
| ⬛ BE-032 | Credencial `admin123` hardcodeada en `api-snapshot.js` | Seguridad | Backend |
| ⬛ DB-011 | Falta índice compuesto `(apellido, nombre, dni)` en `padron.votantes` | Performance | Base de datos |
| ⬛ DB-012 | Índice redundante `idx_votantes_apellido` | Performance | Base de datos |
| DB-014 | `actualizado_por` sin FK, decisión no documentada en esquema | Diseño | Backend, Base de datos |
| ⬛ DB-015 | `email` sin `UNIQUE` en `usuarios` | Diseño | Base de datos |
| DB-017 | Falta índices compuestos para filtros combinados de auditoría | Performance | Base de datos |
| ⬛ DB-018 | `usuarios.rol_id` nullable sin `NOT NULL` | Diseño | Base de datos |
| ⬛ DB-020 | `color` de fuerza sin `CHECK` a nivel de esquema | Diseño | Base de datos |
| ⬛ DB-021 | Índices redundantes con PK compuesta en tablas de comicio | Performance/Mantenibilidad | Base de datos |
| ⬛ DB-023 | Sin `created_at`/`updated_at` en tablas núcleo electoral | Mantenibilidad/Diseño | Base de datos |
| ⬛ DB-024 | Enums de dominio sin CHECK en schema `elecciones` | Diseño | Base de datos |
| DB-026 | Scripts SQL viejos con credenciales fijas en worktree no releaseado | Seguridad | Base de datos |

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

### ⬛ 019 — Métricas de familias por apellido · **S**

Hoy no hay una métrica que agrupe votantes por apellido para detectar núcleos familiares
en el padrón. El pedido queda abierto a sumar otras métricas similares más adelante.

Extensión chica de las métricas existentes del padrón: no bloquea ni es bloqueada por
otro ítem.

**Hecho (2026-10-07).** `GET /api/padron/resultados/por-familia` (apellidos con `minimo`
integrantes, desglose PJ/UCR/Indeciso, cacheado 60 s por parámetros y recortados a un rango)
y un bloque "Apellidos repetidos" en Resultados que se carga a pedido, no con la pantalla.
Agrupa por apellido, no por domicilio: eso es mejor medida de núcleo familiar y queda para 018.
Spec en [specs/019-familias-por-apellido/](../specs/019-familias-por-apellido/spec.md).

---

### 🔴 020 — Pronósticos por mesa en base al padrón · **M**

Idea: usar lo relevado en el padrón para proyectar resultados en las mesas ya asignadas.
El alcance no está definido todavía — así quedó anotado en el pedido original ("ver
alcance, no definido aún").

**No se toma hasta tener 015 y 018**: sin sectorización real del padrón por mesa no hay
con qué pronosticar. Su spec debe empezar por definir qué se pronostica y con qué
información, no por la pantalla.

---

### Hallazgos de severidad baja e informativa de la revisión de código (FE/BE/DB)

| ID | Título | Categoría | Capas afectadas |
|---|---|---|---|
| ⬛ FE-030 | Clases `.stat-*` duplicadas ya colisionaron (ref. G4-adyacente) | Mantenibilidad | Frontend |
| ⬛ FE-031 | `cambiarOpcionPolitica` sin `await` en su rollback | Mantenibilidad | Frontend |
| ⬛ FE-032 | Fallback N+1 de `enriquecerConDetalles` sin monitoreo | Mantenibilidad/Performance | Frontend |
| FE-033 | Listeners de `document` acumulables si se reinicializa el padrón | Mantenibilidad | Frontend |
| ⬛ FE-034 | `<label>` sin `for` en selector de registros por página | UX/Accesibilidad | Frontend |
| FE-035 | `formatearTipo`/`mostrarToast` duplicados entre componentes | Mantenibilidad | Frontend |
| ⬛ FE-036 | Sin tope de candidatos/suplentes en el cliente (Listas) | Inconsistencia | Frontend |
| FE-037 | Pérdida de foco al mover/quitar candidatos (Listas) | UX | Frontend |
| ⬛ FE-038 (obsoleto: `mesaEnEdicionVotos` ya se lee, es el guard de G1) | Código muerto `mesaEnEdicionVotos` | Mantenibilidad | Frontend |
| ⬛ FE-039 | `colorFuerzaVar` sin cast defensivo | Seguridad | Frontend |
| ⬛ FE-040 (obsoleto: sin `comicioView` los modales no existen) | Escape no cierra modal de fiscal sin `comicioView` | UX | Frontend |
| ⬛ FE-041 | Falta `\|\| 0` en cálculo de "Sin Relevar" (NaN%) | Bug | Frontend |
| ⬛ FE-042 | `mostrarTablaSexo` asume orden de array | Bug/Inconsistencia | Frontend |
| ⬛ FE-043 | Gráficos de barra sin estado "Sin datos" | UX/Inconsistencia | Frontend |
| ⬛ FE-044 | Mensaje de error desactualizado ("Chart.js") | Mantenibilidad | Frontend |
| ⬛ FE-045 | Endpoint hardcodeado sin método dedicado en Resultados | Mantenibilidad | Frontend |
| ⬛ FE-046 | Redirección duplicada en flujo de 401 | Mantenibilidad | Frontend |
| ⬛ FE-047 | Botones de icono sin texto accesible (Usuarios) | UX/Accesibilidad | Frontend |
| 🟢 FE-048 (roles y etiquetas hechos, falta el focus trap) | Modales de Usuarios sin `role="dialog"`/focus trap | UX/Accesibilidad | Frontend |
| FE-049 | Código duplicado en export/selects (ApiService/Usuarios) | Mantenibilidad | Frontend |
| ⬛ FE-050 | `NavbarComponent` setea username dos veces | Mantenibilidad | Frontend |
| ⬛ FE-051 | Contraseña no se limpia tras login fallido | UX | Frontend |
| ⬛ FE-052 | `MODULES_CONFIG` es código muerto (dashboard.js) | Mantenibilidad | Frontend |
| ⬛ FE-053 | Llamadas API en serie en el dashboard | Performance | Frontend |
| ⬛ FE-054 | Documentación desactualizada sobre páginas de debug | Inconsistencia (doc) | Frontend |
| ⬛ FE-055 | Contenido dinámico sin `aria-live` en todas las páginas | UX/Accesibilidad | Frontend |
| FE-056 | Boilerplate de auth/init duplicado entre páginas | Mantenibilidad | Frontend |
| ⬛ BE-033 | Orden de migraciones depende de disciplina de nombres | Mantenibilidad | Backend |
| ⬛ BE-034 | Orígenes CORS de localhost hardcodeados en producción | Mantenibilidad | Backend |
| ⬛ BE-035 | `crossOriginEmbedderPolicy: false` sin justificación | Mantenibilidad | Backend |
| ⬛ BE-036 | Límite de body 10MB antes de auth/rate limit específico | Performance/Seguridad | Backend |
| ⬛ BE-037 | Sin `server.requestTimeout` explícito | Performance/Seguridad | Backend |
| ⬛ BE-038 | `auditoria/estadisticas` sin límite en `porUsuario`/`porTipo` | Performance | Backend |
| ⬛ BE-039 | Inconsistencia de forma de respuesta en listado de auditoría | Inconsistencia | Backend |
| ⬛ BE-040 | Sin normalización de `username` | Mantenibilidad | Backend |
| ⬛ BE-041 | Código muerto y columnas de export duplicadas | Mantenibilidad | Backend |
| BE-042 | `guardarDetalle` hace 5 round-trips por escritura | Performance | Backend |
| BE-043 | Opciones políticas duplicadas entre JS y `CHECK` SQL | Mantenibilidad | Backend |
| ⬛ BE-044 | Rango inicio/fin sin sentido con 0 filas | Inconsistencia | Backend |
| BE-045 | `fileFilter` de multer confía en mimetype/extensión del cliente | Seguridad | Backend |
| ⬛ BE-046 | Sin validación de rango para `anioNac` | Bug | Backend |
| ⬛ BE-047 | Documentación desactualizada sobre backend de comicio/fiscales | Mantenibilidad | Backend |
| ⬛ BE-048 | Coerción silenciosa de `color` de fuerza inválido a 1 | Bug | Backend |
| ⬛ BE-049 | Paginación de fiscales sin desempate estable | Bug/Performance | Backend |
| ⬛ BE-051 | Notas vacías se persisten como `NULL` en candidatos | Bug | Backend |
| BE-052 | Sin validar relación `cantidadLugares` vs. candidatos | Inconsistencia | Backend |
| BE-053 | Sin ownership/scoping de borradores de listas | Inconsistencia | Backend |
| BE-054 | Credenciales por defecto versionadas en `docker-compose.yml` | Seguridad | Backend |
| DB-027 | Índice `idx_relevamientos_fecha` sin uso visible | Performance/Mantenibilidad | Base de datos |
| DB-028 | Índice sobre `sexo`, columna de baja cardinalidad | Performance | Base de datos |
| DB-029 | Inconsistencia de DEFAULT entre `observacion`/`observaciones_detalle` | Mantenibilidad | Base de datos |
| DB-030 | Ausencia total de `COMMENT ON` en el esquema | Mantenibilidad | Base de datos |
| DB-032 | Tablas puente sin PK surrogate vs. patrón con surrogate en auth | Mantenibilidad | Base de datos |
| ⬛ DB-034 | `active_sessions.last_activity` sin índice | Performance | Base de datos |
| ⬛ DB-035 | Falta índice de soporte para lado no-líder de FKs RESTRICT | Performance | Base de datos |
| DB-036 | Sin UNIQUE que impida fuerzas duplicadas por nombre en un comicio | Diseño | Base de datos |
| DB-037 | `mesas.numero` sin CHECK > 0, `fiscales.dni` sin UNIQUE | Diseño | Base de datos |
| DB-038 | Ventana horaria de fiscalización hardcodeada como CHECK | Mantenibilidad | Base de datos |
| ⬛ DB-039 | `cantidad_lugares`/`orden` sin cota inferior en Listas | Diseño | Base de datos |
| DB-040 | Tablas obsoletas `comicio_listas`/`votos_lista` no eliminadas | Mantenibilidad | Base de datos |
| DB-041 | Nomenclatura inconsistente para columnas de referencia a usuario | Mantenibilidad | Base de datos |
| DB-042 | Dos convenciones de timestamp dentro del módulo padron | Mantenibilidad | Base de datos |
| DB-043 | Sin Row Level Security habilitado en ninguna tabla *(informativo)* | Seguridad | Backend, Base de datos |

---

## Higiene

### ⬛ 011 — Poner al día la deuda conocida de `CLAUDE.md` · **S**

La sección tiene ítems ya resueltos: menciona `debug.html`, `test-api.html` y
`test-padron.html` como servidos públicamente en producción, y **esos archivos ya no
existen**.

Una lista de deuda con entradas falsas se deja de leer entera. Corregir esa, y reemplazar
las demás por punteros a los números de este backlog, para que la deuda tenga un solo
lugar.

**Hecho (2026-10-07).** Se borraron de `CLAUDE.md` las tres entradas falsas (páginas de debug,
"páginas sin backend" de fiscales/comicio, "sin tests de integración") y se corrigió el
conteo de tests. El resto de las entradas ya apuntaba a este backlog.

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

---

## Resumen numérico de la revisión de código

| Severidad | Grupos multi-capa | Hallazgos de una sola capa | Total filas | Prioridad asignada |
|---|---|---|---|---|
| Crítica | 3 (G1, G3, G6) | 1 | 4 | P0 |
| Alta | 3 (G2, G4, G5) | 16 | 19 | P1 |
| Media | 2 (G7, G8) | 38 | 40 | P2 |
| Baja | 0 | 62 | 62 | P3 |
| Informativo | 0 | 1 | 1 | P3 |
| **Total** | **8** | **118** | **126** | |

Los 8 grupos multi-capa concentran 35 de los 153 hallazgos originales (23%). El resto
(118) son específicos de una sola capa y se listan tal cual en su backlog de origen
(`BACKLOG-FRONTEND.md`, `BACKLOG-BACKEND.md`, `BACKLOG-DB.md`).
