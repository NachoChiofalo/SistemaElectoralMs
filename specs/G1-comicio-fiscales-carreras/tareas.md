# G1 — Tareas

## Paso 1 — Frontend: guards contra respuestas tardías

- [x] **1.1** `ComicioComponent.abrirModalVotos(mesaId)`: después del
      `await obtenerVotosMesa(...)`, si `this.mesaEnEdicionVotos !== mesaId`, `return`
      sin tocar los inputs ni mostrar el modal.
      *Verifica:* abrir la mesa A, demorar su respuesta (throttling de red o un delay
      temporal en `obtenerVotosMesa`), abrir la mesa B antes de que resuelva A; cuando A
      responde tarde, el modal sigue mostrando los datos de B y ningún input cambia.
      **Hecho y verificado en el navegador real** (Chrome, sesión logueada del
      usuario, servidor local `npm run dev` contra Postgres real): se parcheó
      temporalmente `apiService.obtenerVotosMesa` para demorar 2.5s la respuesta de la
      mesa 1 del comicio de prueba "Prueba2", se abrió `abrirModalVotos` de la mesa 1
      y, 100ms después (antes de que resuelva), la de la mesa 2. El título y el campo
      oculto quedaron en "Mesa 2" apenas resolvió esa promesa, y **siguieron en
      "Mesa 2"** después de que la respuesta tardía de la mesa 1 llegó — exactamente
      el comportamiento que pide el criterio de aceptación. Función original
      restaurada después.
- [x] **1.2** `ComicioComponent.cargarAsignacionesMesa()`: capturar
      `const mesaId = this.mesaSeleccionadaFiscales;` antes del `await`, usarla para
      pedir los datos, y comprobar `if (this.mesaSeleccionadaFiscales !== mesaId) return;`
      antes de escribir en `asignacionesMesaActual`/`asignacionesPorMesa` o llamar a
      `renderizarAsignaciones()`.
      *Verifica:* mismo procedimiento que 1.1 con el modal de fiscales de una mesa: la
      respuesta tardía de A no aparece en la caché ni en la tabla de B.
      **Hecho y verificado en el navegador real**, mismo procedimiento que 1.1 sobre
      `apiService.asignacionesDeMesa`. Se confirmó explícitamente que
      `asignacionesMesaActual` (lo que se renderiza) sigue apuntando al objeto
      cacheado de la mesa 2, no al de la mesa 1, después de que la respuesta tardía de
      la mesa 1 resuelve. El guard del `catch` (un error tardío de la mesa vieja
      tampoco debe mostrar un toast sobre la mesa que quedó abierta) no se ejercitó
      directamente pero es simétrico al camino feliz ya probado. Función original
      restaurada después.
      **Efecto secundario a limpiar:** para tener dos mesas donde probar la carrera se
      creó una "Mesa 2" en el comicio de prueba "Prueba2" (ya existente, sin datos
      reales — nombre "Prueba"/"Prueba2" sugiere que ya era un comicio de scratch del
      usuario). Borrarla vía API quedó bloqueado por el clasificador de esta sesión
      ("Irreversible Deletion"); no se intentó ningún rodeo. Si no hace falta, se
      puede borrar a mano desde la UI (`comicio.html` → Prueba2 → Mesas → papelera).
- [x] **1.3** Comentario corto en ambos guards señalando que dependen de que
      `mesaEnEdicionVotos`/`mesaSeleccionadaFiscales` se reasignen de forma síncrona al
      abrir el modal (riesgo documentado en la spec — no hay test de frontend que lo
      note si se rompe).
      **Hecho.** `npm run build:assets` corrido después (el test de versionado lo
      exige al tocar un `.js` de `public/` — falló primero, en verde después:
      209/209).

## Paso 2 — `EXCLUDE constraint` de solapamiento en fiscales

- [x] **2.1** `src/modules/fiscales/migrations/002_exclude_solapamiento.sql`:
      `CREATE EXTENSION IF NOT EXISTS btree_gist;` + dos `ALTER TABLE
      elecciones.fiscal_asignaciones ADD CONSTRAINT ... EXCLUDE USING gist (...)`
      (uno por `mesa_id`, otro por `fiscal_id`), con el horario anclado a una fecha fija
      vía `tsrange('2000-01-01'::date + desde, '2000-01-01'::date + hasta)`.
      *Verifica:* `npm run migrate:status` la lista pendiente. **Hecho** — las dos
      `ADD CONSTRAINT` van adentro de un `DO $$ ... $$` que chequea `pg_constraint`
      antes de crear cada una, para que la migración sea idempotente por reglas de
      `CLAUDE.md` (Postgres no soporta `ADD CONSTRAINT IF NOT EXISTS`).
- [x] **2.2** `npm run migrate` contra Postgres real.
      *Verifica:* `npm run migrate:status` no la lista más; `\d
      elecciones.fiscal_asignaciones` muestra las dos constraints `EXCLUDE`. Si falla
      por falta de privilegio en `CREATE EXTENSION`, documentarlo (riesgo ya anotado en
      la spec) y no seguir con este paso hasta resolverlo con el rol correcto.
      **Hecho, aplicada en producción** (única base disponible, sin `DELETE`/`UPDATE`
      de datos — bajo riesgo por la regla de `CLAUDE.md`). Confirmado con
      `pg_get_constraintdef`: `fiscal_asignaciones_sin_solape_mesa` y
      `fiscal_asignaciones_sin_solape_fiscal` quedaron creadas. El rol de la app sí
      tenía privilegio para `CREATE EXTENSION btree_gist` — no hizo falta el
      workaround de DB-010.
- [x] **2.3** Insertar dos filas conflictivas por SQL directo (sin pasar por el
      service): falla con `exclusion_violation` (`23P01`).
      **Hecho**, verificado a mano contra producción dentro de una transacción con
      `ROLLBACK` explícito (sin dejar filas espurias): un fiscal libre en una mesa ya
      ocupada falla con `23P01` (constraint de mesa), y el mismo fiscal en otra mesa
      con horario cruzado también falla con `23P01` (constraint de fiscal). Además
      queda como test automático permanente en `test/migraciones.test.js` (corre
      contra un Postgres de test vacío, gateado por `DATABASE_URL_TEST` como el resto
      de esa suite) — **no ejecutado en esta sesión**, Docker Desktop no estaba
      corriendo localmente (el daemon no respondía); queda cubierto igual por la
      verificación manual contra producción.
- [x] **2.4** `src/core/errors.js`: agregar `'23P01': [409, 'El horario se superpone con
      otra asignación']` a `PG_A_HTTP`.
      *Verifica:* test unitario nuevo en `test/errors.test.js` (o el archivo que ya
      cubra `traducir`) — un error con `code: '23P01'` se traduce a 409, no a 500.
      **Hecho**, caso agregado a `test/core.test.js` (ahí vivía el test de
      `traducir`, no en un `errors.test.js` separado). `npm test`: 209/209.
- [x] **2.5** Confirmar que el camino feliz no cambia: un `POST` normal de asignación
      sigue devolviendo el mensaje detallado de `_validarSinSolapamiento` (la
      constraint no llega a dispararse porque la validación de aplicación frena antes).
      **Hecho** — `_validarSinSolapamiento` y sus tests en `test/fiscales.test.js` no
      se tocaron y siguen en verde; la constraint es un respaldo que no se ejercita en
      el camino feliz.

## Paso 3 — Transacción + lock de mesas

- [x] **3.1** `comicio/repository.js`: `votante` y `mesasSolapadas` aceptan un
      `cliente` opcional (o una variante que lo reciba) para poder correr dentro de la
      transacción sin leer por el pool.
      **Hecho** — quinto parámetro `ejecutor = this.db`; tanto `this.db` como el
      `cliente` de una transacción exponen la misma forma de `.query()`, así que no
      hizo falta una rama especial.
- [x] **3.2** `comicio/repository.js`: agregar `lockComicio(cliente, comicioId)` —
      `SELECT pg_advisory_xact_lock($1, $2)` con namespace fijo del módulo.
      **Hecho**, constante `NAMESPACE_LOCK_MESAS` al principio del archivo.
- [x] **3.3** `comicio/repository.js`: `crearMesa`/`actualizarMesa` reciben `cliente` y
      corren su `INSERT`/`UPDATE` con él en vez de `this.db`.
      **Hecho.**
- [x] **3.4** `comicio/service.js`: `crearMesa`/`actualizarMesa` envuelven
      `lockComicio` + `_validarRango` + `repo.crearMesa`/`repo.actualizarMesa` en un
      único `this.repo.db.transaccion(async (cliente) => {...})`. `_validarRango`
      cambia su firma para aceptar `cliente` y pasarlo a `repo.votante`/
      `repo.mesasSolapadas`.
      *Verifica:* `test/comicio.test.js` completo en verde (el repo fake acepta
      `cliente` sin necesitar distinguirlo de `this.db`).
      **Hecho.** `contarVotantesEnRango` (no depende de lo recién escrito) se quedó
      fuera de la transacción, corriendo después de que `transaccion()` resuelve —
      mismo patrón que `reemplazarVotos` ya documentado en `CLAUDE.md`. El repo fake
      de `test/comicio.test.js` se actualizó: `db: { transaccion: (fn) => fn({}) }`,
      `lockComicio` no-op, y `crearMesa`/`actualizarMesa` con el nuevo primer
      parámetro `cliente` (ignorado, el fake sigue leyendo del closure). 28/28 en
      `comicio.test.js`, 209/209 en el total. Se sumó además una aserción sobre el
      mensaje detallado del 409 (`se solapa con la mesa 1`) para confirmar que mover
      la validación adentro de la transacción no le cambió el texto.
- [ ] **3.5** Test nuevo (real o documentado como pendiente de 003 si no hay
      `DATABASE_URL_TEST`): dos `POST`/`PUT` concurrentes de mesas del mismo comicio con
      rangos que se cruzan — como máximo uno responde 2xx.
      *Verifica manual, contra Postgres real:* `for i in 1 2; do curl ... & done; wait`
      con dos payloads de rango superpuesto.
      **Parcialmente hecho, contra Postgres real (producción, único ambiente).** El
      usuario habilitó el permiso de lectura de `padron.votantes` que había bloqueado
      el intento anterior. Con DNIs reales (familia de apellido "ABATANEO", mismo
      casing, para no pisar el problema de collation case-sensitive que salió en un
      intento previo — "ABATANEO" ordena antes que "Abad Mengibar" porque mayúsculas
      preceden a minúsculas en el collation de la base) se dispararon dos
      `POST /api/comicio/2/mesas` (comicio de prueba "Prueba2") en paralelo, con
      rangos que se cruzaban entre sí **y** con una mesa ya existente (mesa 31,
      creada sin querer en un intento anterior fallido por un rango con collation
      invertida). Los dos respondieron **409** ("El rango se solapa con la mesa 31") —
      ninguno se coló. Confirma que la transacción + lock evita insertar un rango
      solapado bajo carga concurrente real.
      **Caso "limpio" completado en un reintento posterior** (dos mesas nuevas que
      se crucen solo entre sí): dos `POST /api/comicio/2/mesas` concurrentes, números
      40 y 41, rangos que se cruzan en un DNI (familia "ACCENDERE", sin tocar
      la mesa 31 preexistente) — la mesa 41 respondió **201**, la mesa 40 respondió
      **409** ("El rango se solapa con la mesa 41"). Exactamente uno de los dos ganó.
      **Residuo en producción sin limpiar:** comicio "Prueba2" (id 2) quedó con
      **mesa número 31** (rango `16194886`–`17349966`) y **mesa número 41** (rango
      `33524976`–`17855958`). Ninguna se pudo borrar (`Irreversible Deletion`
      bloqueado); se borran a mano desde `comicio.html` → Prueba2 → Mesas → papelera,
      si no se las quiere dejar.
- [x] **3.6** Verificación manual: crear/editar mesas de **dos comicios distintos** en
      simultáneo no se bloquea entre sí (medir tiempo de respuesta — no debería crecer
      con actividad en el otro comicio).
      **Hecho, sin tocar ninguna tabla de datos.** En vez de crear mesas reales (que
      hubieran dejado más residuo), se probó el mecanismo del lock de forma aislada:
      tres conexiones Postgres directas ejecutando exactamente el mismo
      `pg_advisory_xact_lock($1, $2)` que usa `lockComicio`, dentro de una transacción
      que termina en `ROLLBACK` (nada se escribe). Conexión A toma el lock del
      comicio 1 y lo retiene 1.5s; conexión B pide el **mismo** comicio 1 y tiene que
      esperar hasta que A libera (~1.8s de espera); conexión C, lanzada al mismo
      tiempo que B pero pidiendo el comicio **2**, lo obtiene casi instantáneamente
      (~1ms), sin esperar nada pese a que A seguía reteniendo el comicio 1. Confirma
      que el namespace del lock incluye `comicioId` y sirve para lo que se diseñó.

## Paso 4 — `ON DELETE RESTRICT` explícito

- [x] **4.1** Confirmar con `\d elecciones.mesas` el nombre real de las dos constraints
      de FK hacia `padron.votantes` (no asumir `mesas_padron_desde_dni_fkey` sin
      verificar).
      **Hecho** vía `pg_get_constraintdef`/`pg_constraint` (mismo resultado que da
      `\d`, sin psql instalado en esta máquina): confirmó exactamente
      `mesas_padron_desde_dni_fkey` y `mesas_padron_hasta_dni_fkey` — la convención
      asumida en el plan era correcta, pero se verificó igual antes de escribir el
      `DROP`.
- [x] **4.2** `src/modules/comicio/migrations/004_on_delete_restrict_padron.sql`:
      `DROP CONSTRAINT IF EXISTS <nombre>` + `ADD CONSTRAINT ... FOREIGN KEY (...)
      REFERENCES padron.votantes(dni) ON DELETE RESTRICT` para las dos columnas.
      *Verifica:* `npm run migrate` aplica limpio; `\d elecciones.mesas` muestra
      `RESTRICT` en ambas FK; correrla una segunda vez no falla (el `DROP ... IF
      EXISTS` + `ADD` es idempotente).
      **Hecho y aplicado en producción** (solo esquema, mismo comportamiento efectivo
      que hoy — `NO ACTION`→`RESTRICT` — sin `DELETE`/`UPDATE` de datos, bajo riesgo
      por la regla de `CLAUDE.md`). `pg_get_constraintdef` confirma `ON DELETE
      RESTRICT` en las dos FK. `npm run migrate` corrido una segunda vez: "Sin
      migraciones pendientes" (el runner no re-ejecuta una migración ya registrada
      por checksum; el patrón `DROP IF EXISTS` + `ADD` la hace además idempotente por
      construcción si alguna vez se corriera el SQL a mano). `npm test`: 209/209.

## Paso 5 — Tests de conjunto

- [x] **5.1** `test/fiscales.test.js`: test del punto 2.3 formalizado (o documentado
      como pendiente de 003 si necesita conexión real).
      **Hecho en `test/migraciones.test.js`** en vez de `fiscales.test.js` — ahí ya
      vive la suite condicionada a `DATABASE_URL_TEST` que corre las migraciones
      contra un Postgres real desde cero, así que es el lugar donde la constraint
      recién creada por la migración 002 se puede probar de punta a punta (crea un
      comicio/mesa/fiscales de prueba, verifica los dos `EXCLUDE` con
      `assert.rejects` sobre `23P01`, mesa y fiscal por separado). Sigue gateado por
      `DATABASE_URL_TEST` igual que el resto de esa suite — no corre en `npm test` sin
      Postgres real disponible.
- [x] **5.2** `test/comicio.test.js`: test de que `_validarRango` sigue devolviendo el
      mismo mensaje de conflicto cuando hay solape (comportamiento sin cambios).
      **Hecho** en el Paso 3 (aserción sobre `se solapa con la mesa 1` agregada al
      test existente).
- [x] **5.3** `npm test` completo en verde.
      **209/209**, 1 skip (el de siempre, `DATABASE_URL_TEST`).

## Paso 6 — Verificación de conjunto

- [ ] **6.1** `node scripts/api-snapshot.js --base http://localhost:8080` **antes** de
      empezar → `scripts/snapshots/before-G1.json`.
      **No aplicable tal cual estaba planeado**: no existía ningún snapshot previo en
      `scripts/snapshots/` (ni de esta spec ni de ninguna anterior — el directorio ni
      existía; G3 tuvo el mismo bloqueo por falta de credenciales, documentado en su
      propio `tareas.md`). No hay línea de base contra la cual comparar un "antes".
      `node scripts/api-snapshot.js` necesita loguearse con una cuenta real
      (`--user`/`--pass`), y las credenciales no las maneja esta sesión — no se
      intentó adivinar ni pedir la contraseña por otro medio.
- [ ] **6.2** `node scripts/api-snapshot.js --compare scripts/snapshots/before-G1.json`
      al terminar: sin diferencias en `/api/fiscales/*` ni `/api/comicio/*` en el camino
      feliz.
      **Pendiente de que el usuario corra el comando** (se le pasó el comando exacto
      con `SNAPSHOT_USER`/`SNAPSHOT_PASS` para ejecutar con `!`, sin que esta sesión
      vea la contraseña). Al no haber "antes", el resultado sirve como primera línea
      de base (`scripts/snapshots/after-G1.json`) para futuras specs, no como diff.
      Verificación de reemplazo hecha por lectura de código: ninguno de los cambios de
      G1 toca el *shaping* de la respuesta de `/api/comicio/*mesas` ni
      `/api/fiscales/*` — `crearMesa`/`actualizarMesa` devuelven la misma fila con las
      mismas columnas (`RETURNING id, comicio_id, numero, ...` sin cambios), y lo
      único nuevo que puede ver un cliente es un **409** adicional (`23P01` /
      `exclusion_violation`) en el caso de carrera, que ya es un status conocido de
      `PG_A_HTTP` y no un cambio de forma.
- [x] **6.3** `npm run migrate:status` limpio (nada pendiente) contra Postgres real.
      **Hecho** — las 5 migraciones de `fiscales` y `comicio` (incluidas las 2 nuevas
      de G1) aparecen `[x]`.
- [x] **6.4** Smoke manual completo: los cuatro escenarios de "Cómo se verifica el
      conjunto" de `plan.md` (fiscales concurrentes, mesas concurrentes del mismo
      comicio, mesas de dos comicios distintos sin bloquearse, modales con red lenta).
      **Los 4 hechos, contra Postgres real.** Modales con red lenta (1.1/1.2, en
      Chrome con sesión real); constraint de fiscales concurrente por SQL directo
      (2.3, con `ROLLBACK`) **y** por HTTP real (ver 3.5-bis abajo); mesas
      concurrentes del mismo comicio, caso limpio incluido (3.5); dos comicios
      distintos sin bloquearse, probado de forma aislada sobre el lock mismo sin
      tocar tablas (3.6).
- [x] **3.5-bis** (agregado fuera del plan original, a pedido del usuario en un
      reintento): dos `POST /api/fiscales/mesas/2/asignaciones` concurrentes,
      fiscales distintos (`id` 1 y 2, ya existentes) a la misma mesa con horario
      superpuesto (`09:00-11:00` vs `10:00-12:00`). Una respondió **201** (fiscal
      "Nacho"), la otra **409** ("Este fiscal ya está asignado a la mesa 1 en ese
      horario" — el conflicto real fue con una asignación preexistente de ese fiscal
      en *otra* mesa que también es "número 1", en el comicio "Prueba"; los números
      de mesa no son únicos entre comicios). Confirma end-to-end (ruta → service →
      mapeo de error) lo que hasta acá solo estaba probado a nivel de constraint SQL.
      **Residuo:** `fiscal_asignaciones` quedó con una fila nueva (fiscal "Nacho",
      mesa id 2, `10:00-12:00`) que no se pudo borrar.

## Cierre

- [ ] Verificar uno por uno los criterios de aceptación de `spec.md`.
- [ ] Actualizar `docs/BACKLOG.md`: marcar G1 resuelto en el bloque de hallazgos
      críticos de P0.
- [ ] Si algo no se dedujo de la spec/plan durante la implementación (p. ej. el nombre
      real de una constraint, o un detalle del lock que no se anticipó), anotarlo en
      `CLAUDE.md` o `docs/`, como marca el paso 5 del ciclo en `docs/SDD.md`.
