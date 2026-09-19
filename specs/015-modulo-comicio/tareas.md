# 015 — Tareas

## Backend

- [x] **1.1** `migrations/001_esquema_comicio.sql`: `elecciones.comicios`,
      `elecciones.comicio_listas` (join, `ON DELETE CASCADE` desde comicio,
      `ON DELETE RESTRICT` desde lista), `elecciones.mesas` (con
      `padron_desde_dni`/`padron_hasta_dni` FK a `padron.votantes`, `UNIQUE(comicio_id,
      numero)`), `elecciones.votos_lista` (`UNIQUE(mesa_id, lista_id)`).
      verificación: `migrate:status` contra Postgres real, corrida dos veces.
- [x] **2.1** `repository.js`: `crearComicio`, `porIdComicio` (con listas y mesas),
      `listarComicios` (paginado), `actualizarComicio` (reemplaza `comicio_listas`),
      `eliminarComicio`.
      verificación: tests contra Postgres real.
- [x] **2.2** `repository.js`: `contarVotantesEnRango(desde, hasta)` — comparación de
      tuplas `(apellido, nombre, dni)`.
      verificación: test con datos de padrón conocidos, el conteo coincide.
- [x] **2.3** `repository.js`: `haySolapamiento(comicioId, desde, hasta, excluirMesaId)`.
      verificación: test — dos rangos que se cruzan dan `true`; rangos contiguos sin
      cruce dan `false`.
- [x] **2.4** `repository.js`: `crearMesa`, `actualizarMesa`, `eliminarMesa`,
      `mesasDeComicio`.
      verificación: tests contra Postgres real.
- [x] **2.5** `repository.js`: `reemplazarVotos(mesaId, {blancos, nulos, porLista})` en
      una transacción.
      verificación: test — recargar votos dos veces deja sólo el segundo set.
- [x] **2.6** `repository.js`: `metricas(comicioId)` — totales por lista, blancos,
      nulos, emitidos, mesas con votos cargados/total, votantes asignados,
      participación.
      verificación: test con dos mesas, una con votos y otra sin cargar.
- [x] **3.1** `service.js`: valida tipo de elección (lista blanca), listas existentes al
      crear/editar comicio.
      verificación: test de cada 400.
- [x] **3.2** `service.js`: valida rango de mesa (DNIs existentes, `hasta` no antes que
      `desde`, sin solapamiento con otra mesa del comicio, número de mesa único).
      verificación: test de cada caso, incluido el 409 de solapamiento y de número
      repetido.
- [x] **3.3** `service.js`: valida votos (cantidades no negativas, `listaId` pertenece
      al comicio de la mesa).
      verificación: test de cada 400.
- [x] **3.4** `service.js`: audita alta/edición/baja de comicio, mesa y votos.
      verificación: test con un `auditoria` falso.
- [x] **4.1** `routes.js`: `GET/POST /api/comicio`, `GET/PUT/DELETE /api/comicio/:id`,
      `POST/PUT/DELETE /api/comicio/:id/mesas[/:mesaId]`,
      `PUT /api/comicio/:id/mesas/:mesaId/votos`, `GET /api/comicio/:id/metricas`.
      Gateadas por `comicio.view`/`comicio.edit`.
      verificación: test de 403 sin el permiso, 404 en ids inexistentes.
- [x] **5.1** `module.js`: `permissions: ['comicio.view', 'comicio.edit']` (ya
      sembrados en `auth`, sin migración propia).
      verificación: `npm test` — `integracion.test.js` los encuentra en la migración
      de auth.
- [x] **5.2** Línea en `src/modules/index.js`, después de `listas`.
      verificación: `GET /api/comicio` responde (no 404) con token válido.
- [x] **6.1** `npm run migrate` contra Postgres real (Docker) + `npm test` en verde.

## Frontend

- [x] **7.1** `ApiService.js`: métodos de comicio, mesas, votos, métricas.
- [x] **7.2** `public/comicio.html` + `ComicioComponent.js`: listado de comicios
      (tabla + modal de alta/edición con selector de listas participantes).
- [x] **7.3** Drill-down: entrar a un comicio muestra sus mesas (tabla + modal de alta
      con rango de padrón, cantidad de votantes calculada al guardar).
- [x] **7.4** Editor de votos por mesa: blancos, nulos, cantidad por cada lista
      participante.
- [x] **7.5** Sección de métricas del comicio (totales por lista, participación, mesas
      cargadas/total).
- [x] **7.6** `NavbarComponent.js`: item "Comicio" gateado por `comicio.view`.
- [x] **7.7** `dashboard.js`: tarjeta de comicio pasa a `available`.
- [x] **7.8** `npm run build:assets` sin dejar el árbol sucio; iconos nuevos si hacen
      falta, agregados a `scripts/iconos-lucide.js`.
- [x] **7.9** Smoke en navegador real contra Postgres real: alta de comicio con listas,
      alta de mesa (rango válido y rango solapado → rechazo visible), carga de votos,
      métricas, edición y borrado. Sin errores de consola.

## Cierre

- [x] `docs/BACKLOG.md`: 015 a ⬛.
- [x] `CLAUDE.md`: si algo de esto no se deduce del código (el criterio de orden del
      rango, por qué no hay tabla de asignación votante↔mesa), dejarlo en el mapa o en
      la deuda conocida.
