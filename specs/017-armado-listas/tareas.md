# 017 — Tareas

- [x] **1.1** `migrations/001_esquema_listas.sql`: `CREATE SCHEMA IF NOT EXISTS elecciones`,
      tabla `elecciones.listas` (id, nombre, tipo_eleccion, cantidad_lugares, created_at),
      tabla `elecciones.candidatos` (id, lista_id FK con `ON DELETE CASCADE`, nombre,
      orden, `UNIQUE(lista_id, orden)`).
      verificación: `npm run migrate:status` la muestra pendiente y después aplicada;
      correrla dos veces no falla.
- [x] **1.2** `migrations/002_permisos_listas.sql`: `listas.view`, `listas.edit`,
      asignados al administrador.
      verificación: `npm test` — `test/integracion.test.js` valida que todo permiso
      declarado en `module.js` exista en una migración.
- [x] **2.1** `repository.js`: `crear(datos, candidatos)` en una transacción (INSERT
      lista + INSERT candidatos).
      verificación: test contra Postgres real (`DATABASE_URL_TEST`) — crear una lista
      con 3 candidatos y releerla trae los 3 en orden.
- [x] **2.2** `repository.js`: `porId(id)` trae la lista con sus candidatos ordenados
      por `orden`; `null` si no existe.
      verificación: test — candidato con `orden` 2 aparece antes que el de `orden` 3.
- [x] **2.3** `repository.js`: `listar({ page, limit })` paginado.
      verificación: test — pedir `limit` mayor al techo del service no rompe (el techo
      se aplica en el service, ver 4.5).
- [x] **2.4** `repository.js`: `reemplazarCandidatos(listaId, candidatos)` — `DELETE`
      de los candidatos existentes de esa lista más `INSERT` de los nuevos, misma
      transacción.
      verificación: test — reemplazar deja exactamente los candidatos nuevos, ningún
      resto del set anterior.
- [x] **2.5** `repository.js`: `actualizarDatos(id, {nombre, tipo_eleccion,
      cantidad_lugares})`, `eliminar(id)`.
      verificación: test de cada uno contra Postgres real.
- [x] **3.1** `service.js`: valida `tipo_eleccion` contra
      `['provincial', 'municipal', 'nacional']`.
      verificación: test — valor fuera de la lista blanca → 400.
- [x] **3.2** `service.js`: valida `cantidad_lugares > 0` (entero).
      verificación: test — 0, negativo o no numérico → 400.
- [x] **3.3** `service.js`: valida al menos un candidato, órdenes 1..N sin huecos ni
      duplicados.
      verificación: test para cada caso (sin candidatos, orden repetido, hueco en la
      secuencia) → 400.
- [x] **3.4** `service.js`: tope de 60 candidatos.
      verificación: test — 61 candidatos → 400, no se trunca silenciosamente.
- [x] **3.5** `service.js`: alta, edición (datos y reemplazo de candidatos) y baja
      llaman a `auditoria.registrarDeRequest`.
      verificación: test con un `auditoria` falso — se llamó una vez por operación, con
      la entidad `'lista'` y el id correcto.
- [x] **4.1** `routes.js`: `GET /` y `GET /:id` con `requirePermission('listas.view')`.
      verificación: test — sin el permiso, 403.
- [x] **4.2** `routes.js`: `POST /`, `PUT /:id`, `DELETE /:id` con
      `requirePermission('listas.edit')`.
      verificación: test — con sólo `listas.view`, POST/PUT/DELETE dan 403.
- [x] **4.3** `routes.js`: `GET /:id` inexistente → 404 vía `errores.noEncontrado`.
      verificación: test.
- [x] **4.4** `routes.js`: `POST /` responde 201 con la lista creada, candidatos
      incluidos y en orden.
      verificación: test de forma de la respuesta.
- [x] **4.5** `routes.js`: `?limite=` en `GET /` con techo 100
      (`Math.min(limite || 25, 100)`, mismo patrón que auditoría).
      verificación: test — pedir `limite=100000` no trae más de 100.
- [x] **5.1** `module.js`: `name: 'listas'`, `basePath: '/api/listas'`, `requiresAuth:
      true`, `permissions: ['listas.view', 'listas.edit']`.
      verificación: arranca sin error (`npm run dev`).
- [x] **5.2** Línea en `src/modules/index.js`, después de `padron`.
      verificación: `GET /api/listas` con token válido responde (200 u 401/403 según
      permiso, nunca 404).
- [x] **6.1** `npm run migrate` contra la base de desarrollo/test.
      verificación: `migrate:status` sin pendientes.
- [x] **6.2** `npm test` completo en verde.
      verificación: el conteo de tests sube respecto del que había antes de este ítem.
- [ ] **6.3** Snapshot de contrato antes/después, sin diferencias fuera de la aparición
      de `/api/listas`.
      verificación: `node scripts/api-snapshot.js --compare`.

---

## Fase 2 — Frontend (fuera del alcance original de la spec, sumada después)

- [x] **7.1** `public/listas.html` + `ListasComponent.js`: tabla, filtro por tipo de
      elección, modal de alta/edición con editor de candidatos por posición (sin
      pedir el orden a mano).
      verificación: probado en un navegador real contra Postgres real — alta,
      reordenar con las flechas, editar quitando un candidato, borrar, validación de
      nombre vacío. Sin errores de consola.
- [x] **7.2** `NavbarComponent.js`: item "Listas" gateado por `listas.view` (no por
      rol, a diferencia de Usuarios/Auditoría).
      verificación: visible tras login como admin, con los permisos reales del token.
- [x] **7.3** Bug encontrado y arreglado, ajeno a este ítem: `/api/auth/verify` no
      devolvía `permisos`, así que el navbar perdía cualquier item gateado por
      permiso después de la primera verificación periódica del token.
      verificación: agregado `permisos: req.user.permisos` (ya viaja en el JWT);
      confirmado que el item "Listas" aparece después del fix.
- [x] **7.4** `repository.listar` suma `candidatos_count` (COUNT barato, LEFT JOIN +
      GROUP BY): la tabla lo necesitaba y el listado no traía candidatos.
      verificación: la columna "Candidatos" deja de mostrar "-" tras crear una lista.
- [x] **7.5** Iconos nuevos (`list-ol`, `plus`, `arrow-down`, `folder-open`) agregados
      a `scripts/iconos-lucide.js`.
      verificación: `npm run build:assets` no falla por icono faltante.

## Cierre

- [x] `docs/BACKLOG.md`: 017 a ⬛.
- [ ] `CLAUDE.md`: si `elecciones` como schema propio (en vez de meter todo bajo
      `padron`) no es obvio por el código, dejar la razón en el mapa o en la deuda
      conocida — es la decisión que más se va a repreguntar cuando llegue 015.
