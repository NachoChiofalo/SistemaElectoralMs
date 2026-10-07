# G6 — Tareas

- [x] **1** Crear `src/modules/auditoria/migrations/002_inmutabilidad.sql` con el
      trigger, el `REVOKE`, el `CHECK` y el comentario, tal como está en `plan.md`.
      verificación: `npm run migrate` contra `DATABASE_URL_TEST` no falla, corrido dos
      veces seguidas tampoco.
- [x] **2** Agregar el caso en `test/migraciones.test.js`: `INSERT` en
      `padron.auditoria` funciona; `UPDATE`/`DELETE` sobre esa fila con la misma
      conexión rechaza con error de Postgres.
      verificación: `npm test` (con `DATABASE_URL_TEST` seteada) pasa.
- [x] **3** `routes.js`: pasar `req` a `auth.renovar(refreshToken, req)`.
      verificación: lectura del diff, un solo argumento nuevo.
- [x] **4** `auth/service.js`: `renovar(refreshToken, req)` registra un evento
      `operacion: 'REFRESH'`, `entidad: 'SESION'` después de `abrirSesion()`, mismo
      patrón que `login()`.
      verificación: test nuevo en `test/auth.test.js` — refrescar y confirmar la fila
      en `padron.auditoria`.
- [x] **5** `npm test` completo en verde.
      verificación: la corrida misma.
- [ ] **6** *(PENDIENTE DE TU OK — toca producción)* Confirmar con el usuario y correr la migración contra producción
      (`DATABASE_URL` real).
      verificación: `npm run migrate:status` muestra `002_inmutabilidad` aplicada; un
      login real de prueba sigue funcionando y `GET /api/auditoria` responde igual que
      antes.
- [ ] **7** Cierre: `docs/BACKLOG.md` — G6 a ⬛, con el resumen de qué quedó resuelto de
      cada hallazgo (DB-003, BE-016, DB-016, DB-033) y qué quedó fuera (RLS, DB-043).
