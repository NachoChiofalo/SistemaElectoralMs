# 017 — Plan

## Enfoque

Módulo nuevo `src/modules/listas`, calcado del patrón de `AGREGAR-MODULO.md`. Dos tablas
en un esquema propio `elecciones` (no `padron`: una lista de candidatos no es un dato del
votante, y separar el esquema deja lugar a que 015 sume `elecciones.comicios` y
`elecciones.mesas` sin pisar nada). `listas` y `candidatos`, 1-a-N, con el reemplazo
completo de candidatos en el `PUT` dentro de una transacción — nada de PATCH parcial por
candidato, porque la lista de candidatos es una unidad (al revés que un relevamiento).

Tope de candidatos por lista: **60**. Un concejo deliberante grande en este tipo de
elección no pasa de unas pocas decenas de bancas más suplentes; 60 da margen sin abrir la
puerta a un payload arbitrario.

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `src/modules/listas/migrations/001_esquema_listas.sql` | Crea `elecciones` (schema), `elecciones.listas`, `elecciones.candidatos`. |
| `src/modules/listas/migrations/002_permisos_listas.sql` | `listas.view`, `listas.edit`; administrador los recibe automático. |
| `src/modules/listas/repository.js` | SQL: CRUD de listas + reemplazo transaccional de candidatos. |
| `src/modules/listas/service.js` | Valida tipo de elección, cantidad de lugares, candidatos sin orden duplicado y sin exceder el tope; llama a auditoría. |
| `src/modules/listas/routes.js` | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, gateadas por permiso. |
| `src/modules/listas/module.js` | Contrato del módulo. |
| `src/modules/index.js` | Suma `require('./listas/module')` después de `padron`. |
| `test/listas.test.js` | Tests del service (mocks) + de las rutas (permiso, 400 de validación). |
| `docs/AGREGAR-MODULO.md` | Ninguno — ya documenta el patrón, no hace falta tocarlo. |
| `docs/BACKLOG.md` | 017 pasa a 🟢 al arrancar, a ⬛ al cerrar. |

## Orden de trabajo

1. Migración `001_esquema_listas.sql`: schema `elecciones`, tabla `listas` (id, nombre,
   tipo_eleccion, cantidad_lugares, created_at), tabla `candidatos` (id, lista_id FK,
   nombre, orden, UNIQUE(lista_id, orden)). — se verifica con `npm run migrate:status`
   y corriéndola dos veces.
2. Migración `002_permisos_listas.sql` — se verifica igual, más
   `test/integracion.test.js` (ya recorre módulos y valida que todo permiso declarado
   exista en una migración).
3. `repository.js`: `crear`, `porId` (con candidatos ordenados), `listar` (paginado),
   `reemplazarCandidatos` dentro de `db.transaccion`, `eliminar`. — se verifica con
   tests de repositorio contra Postgres real (mismo patrón que
   `test/migraciones.test.js`, condicionado a `DATABASE_URL_TEST`; sin base, se
   testea a través del service con un repo falso).
4. `service.js`: valida `tipo_eleccion` contra una lista blanca (`provincial`,
   `municipal`, `nacional`), `cantidad_lugares > 0`, al menos un candidato, órdenes
   1..N sin huecos ni duplicados, tope de 60. Llama a
   `auditoria.registrarDeRequest` en alta/edición/baja. — se verifica con tests que
   cubren cada 400 del criterio de aceptación.
5. `routes.js`: `requirePermission('listas.view')` para los GET,
   `requirePermission('listas.edit')` para POST/PUT/DELETE; `?limite=` con techo 100
   en el listado. — se verifica con un test de 403 sin el permiso.
6. `module.js` + línea en `src/modules/index.js`. — se verifica arrancando
   `npm run dev` y pegándole a `/api/listas` a mano.
7. `npm run migrate` contra la base de test/desarrollo, `npm test` en verde.
8. Cerrar: `docs/BACKLOG.md` 017 → ⬛, actualizar `CLAUDE.md` si aparece algo que no
   se deduce del código (por ejemplo, por qué `elecciones` es un schema propio).

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Candidatos como columna JSON dentro de `listas` | Rompe `UNIQUE(lista_id, orden)` a nivel de base — la validación de orden duplicado quedaría sólo en JS, y un `UPDATE` parcial mal escrito podría dejar el JSON inconsistente sin que Postgres lo impida. |
| `PATCH` por candidato individual | La spec ya lo descarta: una lista de candidatos es una unidad, no campos independientes como un relevamiento. Un PATCH por candidato multiplica los round-trips para el caso común (reordenar toda la lista) sin necesidad real. |
| Meter `listas` dentro del schema `padron` | Mezclaría un dato de candidatos con datos de votantes; separar en `elecciones` dejá lugar limpio para que 015 sume `comicios`/`mesas` sin decisiones de esquema pendientes. |
| Guardar el partido/color de la lista ahora | Fuera de alcance según la spec — no hay pedido concreto todavía de vincular esto a los `--ds-*` de partido que ya existen para `opcion_politica`. Se agrega cuando 015 lo necesite de verdad. |

## Cómo se verifica el conjunto

```bash
npm run migrate:status   # 001 y 002 de listas aparecen pendientes, después aplicadas
npm run migrate
npm test                 # incluye test/listas.test.js e integracion.test.js
node scripts/api-snapshot.js --base http://localhost:8080 --out specs/017-armado-listas/snapshot-antes.json
# … cambios …
node scripts/api-snapshot.js --base http://localhost:8080 --compare specs/017-armado-listas/snapshot-antes.json
```

El snapshot antes/después no debería mostrar diferencias fuera de la aparición de
`/api/listas` — no toca ninguna ruta existente.
