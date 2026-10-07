# G1 — Comicio: condiciones de carrera en la carga de votos y la asignación de fiscales

> Estado: implementada y verificada contra producción (2026-09-23). Único pendiente:
> `node scripts/api-snapshot.js` necesita credenciales que esta sesión no maneja —
> comando exacto pasado al usuario para correr con `!` (ver tareas.md, Paso 6.2).
> Tamaño estimado: L

## Problema

Seis hallazgos de la revisión de código, verificados contra el código actual, son la
misma familia de bug (una operación que depende de un estado leído antes de un `await`,
sin proteger que ese estado siga siendo válido cuando el `await` resuelve) repetida en
tres capas distintas del módulo comicio/fiscales:

1. **`ComicioComponent.abrirModalVotos(mesaId)` puede guardar los votos de una mesa en
   el registro de otra** (`public/src/components/ComicioComponent.js:1497-1524`). El
   título y el campo oculto `form-votos-mesa-id` se fijan de forma síncrona al abrir el
   modal, pero los inputs de blancos/nulos/por fuerza se completan recién después de
   `await obtenerVotosMesa(...)`. Si se abre la mesa A y, antes de que resuelva ese
   fetch, se abre la mesa B (cuyo fetch resuelve antes), el modal queda mostrando
   título "Mesa B" con el campo oculto en B — pero cuando el fetch de A resuelve tarde,
   sus valores sobrescriben los inputs visibles sin que nada lo note. Si el usuario
   guarda en ese momento, los votos de A quedan guardados bajo el id de B.

2. **`ComicioComponent.cargarAsignacionesMesa()` puede guardar la agenda de una mesa en
   la caché de otra** (`ComicioComponent.js:1652-1663`). Lee
   `this.mesaSeleccionadaFiscales` para pedir los datos, y **vuelve a leer esa misma
   propiedad mutable** después del `await` para decidir bajo qué clave guardar la
   respuesta (`asignacionesPorMesa.set(this.mesaSeleccionadaFiscales, response.data)`).
   Si el usuario cierra el modal de A y abre el de B antes de que resuelva la petición
   de A, el resultado de A queda guardado bajo la clave de B cuando resuelve tarde.

3. **La validación de que un fiscal/mesa no tenga dos asignaciones simultáneas es
   check-then-insert sin transacción ni lock** (`src/modules/fiscales/service.js:166-184`,
   `_validarSinSolapamiento`; `repository.js:75-98`, `solapaConMesa`/`solapaConFiscal`).
   Dos requests concurrentes pueden pasar ambos el `SELECT` (todavía no ven la fila del
   otro, `READ COMMITTED`) y ambos `INSERT` con éxito. Nada en el esquema
   (`fiscales/migrations/001_esquema_fiscales.sql:15-22`) lo impide tampoco. Rompe
   exactamente la garantía que `CLAUDE.md` documenta ("una mesa no tiene dos fiscales a
   la vez, un fiscal no está en dos mesas a la vez"), con más probabilidad de ocurrir el
   día de la elección, con varias personas cargando el calendario a la vez.

4. **La misma carrera existe en el rango de DNIs de una mesa**
   (`src/modules/comicio/service.js:242-264`, `_validarRango`;
   `repository.js:179-194`, `mesasSolapadas`). Mismo patrón: dos `SELECT` (existencia +
   solapamiento) y un `INSERT`/`UPDATE` posterior, sin transacción ni lock, y nada en el
   esquema lo impide. A diferencia del punto 3, acá el rango se compara contra un `JOIN`
   a `padron.votantes` en tiempo de consulta (no contra columnas propias de la fila), así
   que **no** es resoluble con un `EXCLUDE constraint` de Postgres — necesita
   transacción + lock a nivel de aplicación.

5. **`elecciones.mesas.padron_desde_dni`/`padron_hasta_dni` no declaran `ON DELETE`
   explícito hacia `padron.votantes(dni)`** (`comicio/migrations/001_esquema_comicio.sql:27-28`).
   El comportamiento hoy ya es "no borrar" (default `NO ACTION` de Postgres), pero no
   está escrito — cualquiera que lea el esquema no sabe si es a propósito o un olvido.

## Por qué ahora

Es el hallazgo crítico de mayor severidad del backlog después de G3 (ya cerrado) que
todavía queda en P0, y el único que es un bug de **corrección** activo — no de
seguridad ni de auditoría — en el módulo que va a estar bajo más carga concurrente real
el día de una elección: varias personas cargando votos y fiscales de mesas distintas al
mismo tiempo, exactamente el escenario que dispara los cinco puntos. Los puntos 1 y 2
(frontend) no necesitan que dos *usuarios* distintos coincidan — alcanza con que la
misma persona abra dos mesas seguidas antes de que la primera responda, algo casi
seguro de pasar con una conexión lenta el día del comicio.

## Alcance

1. `abrirModalVotos`: después del `await obtenerVotosMesa(...)`, si
   `this.mesaEnEdicionVotos !== mesaId` (alguien ya abrió otra mesa mientras tanto), no
   tocar ningún campo del formulario ni mostrar el modal — la invocación más reciente es
   la responsable de dejarlo en el estado correcto.
2. `cargarAsignacionesMesa`: capturar `const mesaId = this.mesaSeleccionadaFiscales;` al
   entrar, usarla para pedir los datos, y volver a comprobarla después del `await`
   (`if (this.mesaSeleccionadaFiscales !== mesaId) return;`) antes de escribir en
   `asignacionesMesaActual`/`asignacionesPorMesa` o renderizar.
3. `fiscal_asignaciones` (esquema `elecciones`): agregar dos `EXCLUDE constraint`
   (`btree_gist`) que cierran de raíz el solapamiento por mesa y por fiscal, como
   respaldo de la validación de aplicación existente — no la reemplazan, porque el
   `_validarSinSolapamiento` actual da un mensaje con el nombre del fiscal/número de
   mesa en conflicto, que un error de constraint no puede dar. El código de Postgres
   `23P01` (`exclusion_violation`) se suma a la tabla `PG_A_HTTP` de
   `core/errors.js` con un mensaje genérico, para que la carrera real (poco frecuente)
   siga respondiendo 409 y no 500.
4. `crearMesa`/`actualizarMesa`: la validación de solapamiento de rango y el
   `INSERT`/`UPDATE` pasan a correr dentro de la misma transacción, protegidos por un
   `pg_advisory_xact_lock` con clave `(namespace fijo, comicioId)` — serializa sólo las
   mesas del mismo comicio, no todas las mesas del sistema. Se usa la variante que
   espera (no `pg_try_advisory_xact_lock`, que existe para el caso de 013 donde fallar
   rápido es preferible a que un import quede colgado): acá es una acción interactiva de
   un formulario, y esperar el instante que tarda otra escritura de la misma pantalla es
   mejor experiencia que un 409 espontáneo.
5. `padron_desde_dni`/`padron_hasta_dni`: se agrega `ON DELETE RESTRICT` explícito a la
   FK existente (mismo comportamiento efectivo que hoy — Postgres ya usa `NO ACTION` por
   default —, sólo lo hace legible desde el esquema).

## Fuera de alcance

- **DB-007** (el rango de mesa cambia de identidad si se edita el apellido/nombre del
  votante que es su límite, vía una reimportación de CSV). No es una condición de
  carrera entre dos requests — es una redefinición silenciosa disparada por una
  operación normal y ya soportada (013), en un momento arbitrario después de que el
  rango quedó fijado. El propio hallazgo original lo marca como incierto en su solución
  ("si el requisito de negocio es recalcular dinámicamente... esto es una *feature*
  parcial") — es una decisión de producto (¿el límite de una mesa debe quedar congelado
  para siempre, o debe poder correrse si el padrón se corrige?) que no corresponde tomar
  dentro de una spec de condiciones de carrera. Queda como ítem propio del backlog.
- **BE-010/BE-027** (cascadas de borrado sin registro completo en auditoría) — es un
  hallazgo de trazabilidad, no de carrera; ya está en su propio grupo (G2, P1).
- **Un `EXCLUDE constraint` para el rango de mesas.** El propio DB-008 explica por qué
  no aplica: la comparación depende de un `JOIN` a `padron.votantes` en tiempo de
  consulta, no de columnas propias de la fila — no hay range type posible sin
  materializar el orden, que es justamente el trade-off que 015 decidió no tomar.
- **Cambiar cómo se calcula el orden del padrón** (`(apellido, nombre, dni)`) o
  materializar una tabla votante↔mesa. Fuera de alcance total: es la decisión de diseño
  de 015, no algo que una spec de condiciones de carrera deba reabrir.

## Criterios de aceptación

- [x] Abrir la mesa A y, antes de que responda, abrir la mesa B (simulable demorando el
      fetch de A): el modal queda mostrando los datos de B, y cuando la respuesta de A
      llega tarde, los inputs no cambian.
      **Verificado en el navegador real** (Chrome, sesión logueada, servidor local
      contra Postgres de producción) — ver `tareas.md` 1.1.
- [x] Mismo escenario con el modal de fiscales de una mesa: la respuesta tardía de la
      mesa A no aparece en la caché ni en la tabla de la mesa B.
      **Verificado en el navegador real**, mismo procedimiento — ver `tareas.md` 1.2.
- [x] Dos `POST` concurrentes que asignan al mismo fiscal (o a la misma mesa) un horario
      que se superpone: como máximo uno de los dos responde 2xx: el otro responde 409,
      con o sin el mensaje detallado (según cuál de las dos protecciones lo frenó).
      **Verificado end-to-end vía HTTP contra producción**: dos fiscales distintos a
      la misma mesa con horario superpuesto — uno 201, el otro 409 — ver `tareas.md`
      3.5-bis.
- [x] `SELECT conname FROM pg_constraint WHERE conrelid = 'elecciones.fiscal_asignaciones'::regclass`
      incluye las dos restricciones `EXCLUDE` nuevas.
      **Verificado contra producción** — `fiscal_asignaciones_sin_solape_mesa` y
      `fiscal_asignaciones_sin_solape_fiscal`.
- [x] Insertar dos filas en `fiscal_asignaciones` con horario superpuesto directamente
      por SQL (sin pasar por el service) falla con `exclusion_violation` — confirma que
      la garantía la sostiene la base, no sólo la aplicación.
      **Verificado contra producción**, con `ROLLBACK` explícito (sin dejar filas
      espurias) — ver `tareas.md` 2.3. Además, test automático permanente en
      `test/migraciones.test.js`, gateado por `DATABASE_URL_TEST`.
- [x] Dos `POST`/`PUT` concurrentes de mesas del mismo comicio con rangos de DNI que se
      cruzan: como máximo uno responde 2xx.
      **Verificado contra producción**, incluido el caso limpio de dos mesas nuevas
      compitiendo solo entre sí (una 201, la otra 409) — ver `tareas.md` 3.5.
- [x] Crear/editar mesas de **dos comicios distintos** en simultáneo no se bloquea entre
      sí (el lock es por comicio, no global) — verificable con el tiempo de respuesta,
      no debería crecer con actividad en otro comicio.
      **Verificado contra producción**, probando el `pg_advisory_xact_lock` de forma
      aislada (tres conexiones directas, `ROLLBACK`, sin tocar tablas): mismo comicio
      bloquea, comicio distinto no espera nada — ver `tareas.md` 3.6.
- [x] `\d elecciones.mesas` muestra `ON DELETE RESTRICT` explícito en las dos FK hacia
      `padron.votantes`.
      **Verificado contra producción** (`pg_get_constraintdef`, sin `psql` instalado
      en esta máquina) — ver `tareas.md` 4.2.
- [x] `npm test` en verde; los casos de carrera de backend que necesiten Postgres real
      (imposibles de simular con el repositorio en memoria sin una segunda conexión) se
      documentan como parte de 003, igual que el resto de los casos con conexión
      concurrente real de este backlog.
      **209/209, 1 skip** (el de siempre, `DATABASE_URL_TEST`). El caso de la
      constraint quedó como test real (no solo documentado) en
      `test/migraciones.test.js`, gateado por esa misma variable.
- [ ] `node scripts/api-snapshot.js` antes y después: sin diferencias en la forma de
      `/api/fiscales/*` ni `/api/comicio/*` en el camino feliz (sin carrera) — sólo
      cambia qué pasa cuando dos requests chocan.
      **No hecho.** No existía ningún snapshot previo en el repo (mismo bloqueo que
      quedó pendiente en G3) — sin línea de base no hay "antes" contra qué comparar.
      El script necesita credenciales reales que esta sesión no maneja; se le pasó al
      usuario el comando para correrlo con `!`. Verificación de reemplazo por lectura
      de código: ningún cambio de G1 toca el *shaping* de las respuestas — ver
      `tareas.md` 6.2.

## Restricciones

- **Dentro de una transacción, nada de leer por el pool.** El `INSERT`/`UPDATE` de mesa
  y su chequeo de solapamiento van en el mismo `cliente` de `db.transaccion`, no en
  llamadas separadas del repositorio contra el pool general.
- **`routes` no escribe SQL; `repository` no conoce `req`/`res`.** El lock y el chequeo
  de solapamiento de mesas son SQL puro en el repositorio; la decisión de traducirlo en
  un 409 con mensaje sigue en el service, como ya es hoy.
- **Los errores se lanzan, no se responden.** El nuevo código `23P01` se suma a
  `PG_A_HTTP` en `core/errors.js`, el mismo mecanismo ya usado para `23505`/`23503`/etc.
  — no un `try/catch` puntual en el service de fiscales.
- **Ningún color fuera del design system / no tocar el frontend para cambiar el
  backend.** Los cambios de `ComicioComponent.js` no agregan estilos ni marcado nuevo:
  son guards de datos puros, sin tocar el DOM que no tocaban antes.
- **Toda migración es idempotente.** El `EXCLUDE constraint` y el `ON DELETE RESTRICT`
  se agregan con `ADD CONSTRAINT IF NOT EXISTS` donde Postgres lo permite, o
  verificando `pg_constraint` antes de crear cuando la sintaxis no lo soporta
  directamente (el `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` para la FK es
  idempotente por construcción).

## Riesgos

- **`CREATE EXTENSION btree_gist` requiere privilegio suficiente en Supabase.** Si el
  rol de la app no lo tiene (ver DB-010, todavía sin confirmar qué rol usa la
  conexión), la migración falla al aplicarse y hay que crearla con un rol distinto una
  única vez — no bloquea el resto del ítem si se resuelve por separado.
- **El `pg_advisory_xact_lock` bloqueante puede alargar la respuesta de crear/editar una
  mesa** si dos personas tocan el mismo comicio a la vez — aceptable (es una acción
  interactiva rara, no un endpoint de alta frecuencia), pero si algún día se vuelve
  perceptible, el límite natural es `statement_timeout` (20 s, ya configurado), que
  devuelve 503 en vez de colgar la request indefinidamente.
- **Los guards de frontend dependen de que `mesaEnEdicionVotos`/`mesaSeleccionadaFiscales`
  se reasignen de forma síncrona al abrir un modal nuevo** — si algún cambio futuro
  mueve esa asignación a después de un `await`, el guard deja de proteger nada sin que
  ningún test lo note (no hay tests de frontend en este repo, ver 003). Vale la pena
  dejar un comentario en el código señalando la dependencia.
- **Probar la carrera de verdad requiere dos conexiones/requests concurrentes reales**
  — ni el repositorio en memoria de los tests de fiscales/comicio ni un test de un solo
  proceso lo ejercitan tal cual. El criterio de aceptación de la constraint (insertar
  dos filas conflictivas por SQL directo) cubre la garantía de fondo sin necesitar
  concurrencia real; el resto se deja como verificación manual, igual que 013 en su
  momento.
