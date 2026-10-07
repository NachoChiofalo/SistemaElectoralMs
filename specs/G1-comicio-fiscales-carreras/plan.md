# G1 — Plan

## Enfoque

Los cinco puntos del alcance son independientes entre sí (dos de frontend, dos de
backend con protección en capas distintas, uno de esquema puro) pero comparten el mismo
criterio de cierre (`npm test` + snapshot de contrato sin diferencias), así que se
implementan en el orden de menor a mayor riesgo de romper algo que ya funciona:

1. Frontend (puntos 1-2): aislado, sin dependencias con el resto, y son los guards más
   fáciles de verificar a mano.
2. Constraint de fiscales (punto 3): la migración más simple de las dos (no necesita
   lock de aplicación, sólo el `EXCLUDE`).
3. Transacción + lock de mesas (punto 4): la más grande, toca service y repository.
4. `ON DELETE RESTRICT` de mesas (punto 5): un `ALTER` de una línea, al final porque no
   depende de nada y así no se mezcla con el resto en el mismo commit si algo del punto
   4 necesita iterar.

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `public/src/components/ComicioComponent.js` | `abrirModalVotos(mesaId)` (líneas 1495-1524): después del `await obtenerVotosMesa(...)`, si `this.mesaEnEdicionVotos !== mesaId`, `return` antes de tocar los inputs o mostrar el modal. `cargarAsignacionesMesa()` (líneas 1651-1660): captura `const mesaId = this.mesaSeleccionadaFiscales;` antes del `await`, pide los datos con esa constante, y antes de escribir en `asignacionesMesaActual`/`asignacionesPorMesa`/`renderizarAsignaciones()` comprueba `if (this.mesaSeleccionadaFiscales !== mesaId) return;`. |
| `src/modules/fiscales/migrations/002_exclude_solapamiento.sql` | Migración nueva: `CREATE EXTENSION IF NOT EXISTS btree_gist;` + dos `ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE USING gist (...)` sobre `elecciones.fiscal_asignaciones` (uno por `mesa_id`, otro por `fiscal_id`), comparando el rango horario con `tsrange('2000-01-01'::date + desde, '2000-01-01'::date + hasta)` — no existe un range type nativo para `TIME`, así que se ancla a una fecha fija arbitraria; es seguro porque el `CHECK` existente ya obliga `desde >= 08:00 AND hasta <= 18:00`, sin cruce de medianoche que ese anclaje pudiera romper. |
| `src/core/errors.js` | `PG_A_HTTP`: agrega `'23P01': [409, 'El horario se superpone con otra asignación']` (código `exclusion_violation`). |
| `src/modules/comicio/repository.js` | `crearMesa`/`actualizarMesa` (líneas 195-201 y 228-234): pasan a recibir `cliente` en vez de usar `this.db` directamente, para correr dentro de la transacción que abre el service. `mesasSolapadas`/`votante` necesitan una variante que acepte `cliente` en lugar de `this.db` (o un parámetro opcional `ejecutor = this.db`) para poder llamarse con el mismo cliente de la transacción — sin eso, el `SELECT` de solapamiento leería por el pool mientras el lock lo tiene la transacción, rompiendo la regla de "dentro de una transacción, nada de leer por el pool" de `CLAUDE.md`. Se agrega `lockComicio(cliente, comicioId)`: `SELECT pg_advisory_xact_lock($1, $2)` con `$1` = un namespace fijo (constante del módulo, ej. `hashtext('elecciones.mesas')`) y `$2` = `comicioId`. |
| `src/modules/comicio/service.js` | `crearMesa`/`actualizarMesa` (líneas 174-217): la validación de rango (`_validarRango`) y el `INSERT`/`UPDATE` pasan a correr dentro de un único `this.repo.db.transaccion(async (cliente) => {...})`: primero `lockComicio`, después `_validarRango` (ahora recibe `cliente`), después `crearMesa`/`actualizarMesa` (también con `cliente`). `_validarRango` cambia su firma para aceptar `cliente` y pasarlo a `repo.votante`/`repo.mesasSolapadas`. |
| `src/modules/comicio/migrations/004_on_delete_restrict_padron.sql` | Migración nueva: `ALTER TABLE elecciones.mesas DROP CONSTRAINT IF EXISTS mesas_padron_desde_dni_fkey, ADD CONSTRAINT mesas_padron_desde_dni_fkey FOREIGN KEY (padron_desde_dni) REFERENCES padron.votantes(dni) ON DELETE RESTRICT;` y lo mismo para `padron_hasta_dni`. El nombre exacto de la constraint autogenerada se confirma con `\d elecciones.mesas` antes de escribir el `DROP` (Postgres nombra `<tabla>_<columna>_fkey` por convención, pero se verifica, no se asume). |
| `test/fiscales.test.js` | Test nuevo: insertar dos asignaciones con horario superpuesto directamente por SQL (fuera del repo fake, contra Postgres real si hay `DATABASE_URL_TEST`; si no, se documenta como pendiente de 003) falla con `23P01`. El repo en memoria de los tests existentes no cambia (la constraint es una garantía de base, no de aplicación — el `_validarSinSolapamiento` actual sigue igual y sus tests tampoco). |
| `test/comicio.test.js` | El repo fake de `crearMesa`/`actualizarMesa` necesita simular `cliente` (puede ser el mismo objeto fake que ya usa, si no distingue pool de cliente) para que las firmas nuevas no rompan los tests existentes. Se agrega un test de que `_validarRango` sigue devolviendo el mismo mensaje de conflicto cuando hay solape (comportamiento sin cambios en el camino ya cubierto). |
| `scripts/snapshots/before-G1.json` | Snapshot de `node scripts/api-snapshot.js` tomado antes de tocar nada, para comparar al final. |

## Orden de trabajo

1. **Frontend: guards de `abrirModalVotos` y `cargarAsignacionesMesa`.**
   Se verifica a mano en el navegador: abrir la mesa A, demorar su respuesta (throttling
   de red en DevTools o un `await new Promise(r => setTimeout(r, 3000))` temporal en el
   fake de `obtenerVotosMesa`), abrir la mesa B antes de que resuelva, confirmar que
   cuando la respuesta de A llega tarde no pisa lo que muestra el modal de B. Mismo
   procedimiento con el modal de fiscales de una mesa.
2. **Migración `002_exclude_solapamiento.sql` en fiscales + `23P01` en `errors.js`.**
   Se verifica con `npm run migrate:status` (aparece pendiente), `npm run migrate`
   (aplica — si falla por falta de privilegio en `CREATE EXTENSION`, ver Riesgos),
   `\d elecciones.fiscal_asignaciones` (aparecen las dos `EXCLUDE`), e insertar dos filas
   conflictivas por SQL directo (falla con `23P01`). Después, un `POST` normal de
   asignación sigue devolviendo el mensaje detallado de `_validarSinSolapamiento` (la
   constraint no se llega a disparar en el camino feliz, donde la validación de
   aplicación ya frena antes).
3. **`comicio/repository.js` + `comicio/service.js`: transacción + lock de mesas.**
   Se verifica con `test/comicio.test.js` completo en verde (el repo fake no debe
   necesitar más que aceptar `cliente` sin usarlo como algo distinto de `this.db`), más
   un test manual con dos pestañas o `curl` en paralelo (`for i in 1 2; do curl ... &
   done; wait`) creando/editando dos mesas del mismo comicio con rangos que se cruzan:
   como máximo una responde 2xx. Repetir con mesas de **dos comicios distintos** y
   confirmar que no se bloquean entre sí (medir tiempo de respuesta, no debería crecer).
4. **`ON DELETE RESTRICT` en `comicio/migrations/004_...sql`.**
   Se verifica con `\d elecciones.mesas` (muestra `RESTRICT` en las dos FK) y, si hay
   ambiente para probarlo, intentar borrar un votante que es límite de una mesa
   existente (debe fallar con `23503`, ya traducido a 400 por `PG_A_HTTP`, comportamiento
   sin cambios respecto a hoy).
5. **Conjunto:** `npm test`, `node scripts/api-snapshot.js --compare
   scripts/snapshots/before-G1.json` (sin diferencias en el camino feliz), y
   `npm run migrate` limpio de punta a punta contra Postgres real.

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Range type nativo de Postgres para el horario (`timerange`) | No existe un tipo `range` incorporado sobre `TIME`; sólo hay para `int4`, `int8`, `numeric`, `timestamp`, `timestamptz`, `date`. Crear un tipo `range` custom es más ceremonia que anclar `TIME` a una fecha fija arbitraria con `tsrange`, y el `CHECK` existente ya garantiza que no hay cruce de medianoche que ese anclaje pudiera esconder. |
| Un solo `EXCLUDE` combinando mesa y fiscal en una expresión | Cambiaría el significado: un `EXCLUDE` sobre `(mesa_id, fiscal_id) WITH =, rango WITH &&` sólo evitaría que el *mismo par* mesa-fiscal se superponga consigo mismo, no que una mesa tenga dos fiscales distintos a la vez ni que un fiscal esté en dos mesas distintas a la vez — que son las dos garantías reales. Hacen falta las dos constraints por separado, tal como ya hace `_validarSinSolapamiento` con dos queries. |
| `pg_try_advisory_xact_lock` (no bloqueante) en vez de la variante que espera | Ya lo descarta la spec (sección Restricciones/Riesgos): es una acción interactiva de formulario, no un job en background como 013 — fallar rápido con 409 espontáneo cuando dos personas tocan el mismo comicio en el mismo instante es peor experiencia que esperar el instante que tarda la otra escritura. |
| Lock a nivel de tabla completa (`LOCK TABLE elecciones.mesas`) en vez de advisory lock por comicio | Serializaría la creación/edición de mesas de *todos* los comicios activos a la vez, violando el criterio de aceptación de que dos comicios distintos no se bloqueen entre sí. El advisory lock con clave `(namespace, comicioId)` da la misma exclusión mutua acotada al comicio que realmente comparte el `_validarRango`. |
| Agregar el `SELECT` de solapamiento como parte del `EXCLUDE` en vez de aplicación + lock | Ya lo descarta la spec: DB-008 explica que la comparación depende de un `JOIN` contra `padron.votantes` en tiempo de consulta (el rango de mesa son dos DNIs, no columnas de rango propias de la fila) — no hay range type posible sin materializar el orden del padrón, que 015 decidió no tomar. |

## Cómo se verifica el conjunto

```bash
npm test
node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before-G1.json
npm run migrate:status
npm run migrate
```

Manual, contra Postgres real: dos requests concurrentes de asignación de fiscales al
mismo fiscal/mesa con horario superpuesto (una gana, la otra 409); dos requests
concurrentes de `crear`/`actualizar` mesa del mismo comicio con rangos que se cruzan (una
gana, la otra 409); las mismas dos acciones repartidas entre dos comicios distintos no se
demoran entre sí; abrir dos modales de votos/fiscales seguidos con red lenta y confirmar
que el más reciente manda.
