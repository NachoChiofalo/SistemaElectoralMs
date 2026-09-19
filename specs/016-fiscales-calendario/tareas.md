# 016 — Tareas

## Backend

- [x] **1.1** `migrations/001_esquema_fiscales.sql`: `elecciones.fiscales` (id, nombre,
      dni opcional, telefono opcional), `elecciones.fiscal_asignaciones` (id, mesa_id
      FK, fiscal_id FK, desde TIME, hasta TIME, `CHECK` 08:00–18:00 y `hasta > desde`).
      verificación: `migrate:status` contra Postgres real, corrida dos veces.
- [x] **2.1** `repository.js`: CRUD de `fiscales` (crear, porId, listar paginado,
      actualizar, eliminar).
      verificación: tests contra Postgres real.
- [x] **2.2** `repository.js`: `solapaConMesa(mesaId, desde, hasta, excluirId)`.
      verificación: test — franjas que se cruzan dan resultado no vacío; contiguas dan
      vacío.
- [x] **2.3** `repository.js`: `solapaConFiscal(fiscalId, desde, hasta, excluirId)`.
      verificación: test — mismo fiscal en dos mesas con horario cruzado da resultado
      no vacío.
- [x] **2.4** `repository.js`: CRUD de `fiscal_asignaciones`, `asignacionesDeMesa(mesaId)`.
      verificación: tests contra Postgres real.
- [x] **2.5** `repository.js`: `agendaDeComicio(comicioId, hora)` — por mesa, el
      fiscal presente a esa hora o null.
      verificación: test con dos mesas, una con fiscal en el horario pedido y otra sin.
- [x] **3.1** `service.js`: valida horario (08:00–18:00, `hasta > desde`).
      verificación: test de cada 400.
- [x] **3.2** `service.js`: valida existencia de mesa y fiscal al asignar.
      verificación: test de cada 400/404.
- [x] **3.3** `service.js`: valida los dos solapamientos (mesa y fiscal) en la misma
      operación de alta/edición.
      verificación: test de cada 409, y que franjas contiguas no disparan ninguno.
- [x] **3.4** `service.js`: audita alta/edición/baja de fiscal y de asignación.
      verificación: test con un `auditoria` falso.
- [x] **4.1** `routes.js`: `GET/POST /api/fiscales`, `PUT/DELETE /api/fiscales/:id`,
      `GET/POST /api/fiscales/mesas/:mesaId/asignaciones`,
      `PUT/DELETE /api/fiscales/asignaciones/:id`,
      `GET /api/fiscales/comicio/:comicioId/agenda?hora=`.
      Gateadas por `fiscales.view`/`fiscales.edit`.
      verificación: test de 403 sin el permiso.
- [x] **5.1** `module.js`: `permissions: ['fiscales.view', 'fiscales.edit']` (ya
      sembrados en `auth`).
      verificación: `npm test` — `integracion.test.js` los encuentra.
- [x] **5.2** Línea en `src/modules/index.js`, después de `comicio`.
      verificación: `GET /api/fiscales` responde (no 404) con token válido.
- [x] **6.1** `npm run migrate` contra Postgres real (Docker) + `npm test` en verde.

## Frontend

- [x] **7.1** `ApiService.js`: métodos de fiscales, asignaciones, agenda.
- [x] **7.2** `public/fiscales.html` + `FiscalesComponent.js`: padrón de fiscales
      (tabla + modal de alta/edición).
- [x] **7.3** Selector de comicio + mesa, calendario de la mesa (franjas asignadas,
      alta de franja nueva).
- [x] **7.4** Selector de hora + agenda del comicio a esa hora (qué fiscal cubre cada
      mesa).
- [x] **7.5** `NavbarComponent.js`: item "Fiscales" gateado por `fiscales.view`.
- [x] **7.6** `dashboard.js`: tarjeta de fiscales pasa a `available`.
- [x] **7.7** `npm run build:assets` sin dejar el árbol sucio; iconos nuevos si hacen
      falta.
- [x] **7.8** Smoke en navegador real contra Postgres real: alta de fiscal, asignación
      válida, solapamiento por mesa (409 visible), solapamiento por fiscal en otra mesa
      (409 visible), agenda por hora, edición, borrado. Sin errores de consola.

## Cierre

- [x] `docs/BACKLOG.md`: 016 a ⬛.
- [x] `CLAUDE.md`: si algo no se deduce del código (por qué el fiscal no tiene cuenta,
      por qué se valida doble solapamiento), dejarlo en el mapa o en la deuda conocida.
