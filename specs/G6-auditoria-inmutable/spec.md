# G6 — Auditoría: la inmutabilidad no está garantizada y hay eventos que no se registran

> Estado: borrador
> Tamaño estimado: M

## Problema

`padron.auditoria` (`src/modules/auditoria/migrations/001_esquema_auditoria.sql:9-22`)
es hoy el único rastro de quién hizo qué en el sistema. Su "inmutabilidad" no existe a
nivel de motor: no hay trigger que impida `UPDATE`/`DELETE`, no hay `REVOKE` sobre esos
privilegios para el rol con el que se conecta la aplicación, y no hay Row Level Security.
Que `AuditoriaRepository` sólo exponga `insertar`/`listar`/`contar`/`estadisticas`/
`porId` (`src/modules/auditoria/repository.js`) es una convención del código — cualquier
acceso directo a la base (consola de Supabase, un script de mantenimiento, una migración
futura mal escrita, una inyección SQL en otro módulo que comparta el rol de conexión)
puede alterar o borrar filas sin dejar indicio (DB-003).

Además, hay un evento real que hoy no se registra: `AuthService.renovar()`
(`src/modules/auth/service.js:133-153`) llama a `abrirSesion()`, que invalida en caché y
en base la sesión anterior del usuario exactamente igual que `login()` — pero a
diferencia de `login()`/`logout()`, `renovar()` no llama a `this.auditoria.registrar(...)`
en ningún punto. El caso concreto que esto deja invisible: alguien fabrica o roba un
refresh token válido y lo usa para reemplazar la sesión de un usuario activo — el mismo
vector de "sesión que reemplaza a otra" que motivó [G3](../G3-sesion-jwt/spec.md) — y esa
investigación forense no tiene ningún evento `REFRESH` para encontrarlo (BE-016).

Dos hallazgos menores del mismo grupo, ambos en
`src/modules/auditoria/migrations/001_esquema_auditoria.sql`:
`usuario_id VARCHAR(50)` no tiene FK a `usuarios` (línea 11) y `operacion`/`entidad`
(líneas 14-15) aceptan cualquier string sin `CHECK` (DB-016, DB-033).

## Por qué ahora

Es el único P0 de la última revisión de código que sigue sin tocar (G1 y G3 ya están
cerrados o resueltos). El problema central (DB-003) es que la garantía de inmutabilidad
no existe donde debería —a nivel de base—, y no depende de ningún otro ítem del backlog
para arrancar.

## Alcance

- Un trigger `BEFORE UPDATE OR DELETE ON padron.auditoria` que aborte la operación
  (`RAISE EXCEPTION`), y `REVOKE UPDATE, DELETE` sobre esa tabla para el rol con el que
  se conecta la aplicación — la garantía queda en el motor, no en que el repository no
  exponga esos métodos (DB-003).
- `AuthService.renovar()` registra un evento de auditoría (`operacion: 'REFRESH'`) con
  el mismo patrón que `login()`: `usuario_id`, `usuario_nombre`, `usuario_username`,
  `entidad: 'SESION'`, `entidad_id`, `ip_address` (BE-016).
- Documentar en la migración, con un comentario SQL, que `auditoria.usuario_id` no tiene
  FK a propósito: así un `DELETE` sobre `usuarios` nunca arrastra en cascada el rastro de
  auditoría de esa cuenta (DB-016). No se agrega la FK.
- Una restricción liviana (`CHECK`) sobre `operacion`/`entidad` que impida que una
  variante nueva (minúscula, con espacios) fragmente en silencio las agregaciones de
  `estadisticas()` — sin migrar a una tabla de catálogo (DB-033).

## Fuera de alcance

- **Row Level Security** sobre `padron.auditoria` (DB-043, catalogado como
  Informativo). El trigger + `REVOKE` cierra el caso concreto (una conexión con el rol de
  la app, o un acceso directo con ese mismo rol); RLS es una capa adicional para un
  modelo con varios roles de base distintos, que este sistema no tiene hoy — un solo
  pool con un solo rol (`core/db.js`).
- **Auditar cualquier operación nueva que no sea `renovar()`.** BE-016 es puntual: el
  único evento equivalente a un login que hoy no se audita. No es una revisión general de
  qué se audita y qué no.
- **Migrar `operacion`/`entidad` a una tabla de catálogo con FK.** DB-033 sugiere esto
  como alternativa a un `CHECK`; se descarta acá por ser un cambio de esquema mayor para
  un problema de severidad Baja — ver Restricciones.
- **Alertar o notificar** si alguien intenta un `UPDATE`/`DELETE` bloqueado por el
  trigger. El trigger aborta la transacción con una excepción visible en los logs del
  motor; un canal de alerta aparte no está pedido por ningún hallazgo de este grupo.

## Criterios de aceptación

- [ ] Un `UPDATE` o `DELETE` directo sobre `padron.auditoria`, corrido con el rol de
      conexión de la aplicación, falla con una excepción — verificado con un test que
      inserta una fila y luego intenta `UPDATE`/`DELETE` sobre ella, esperando que la
      query rechace.
- [ ] Un `INSERT` sobre `padron.auditoria` sigue funcionando sin cambios — los tests
      existentes de auditoría (login, logout, operaciones del padron) siguen en verde.
- [ ] Llamar a `POST /api/auth/refresh` con un refresh token válido deja una fila nueva
      en `padron.auditoria` con `operacion = 'REFRESH'`, `entidad = 'SESION'` y el
      `usuario_id` correspondiente.
- [ ] La migración de `usuario_id` sin FK trae un comentario explicando que es
      intencional (el `DELETE` de un usuario no debe arrastrar su auditoría).
- [ ] Insertar una fila con `operacion`/`entidad` fuera del vocabulario esperado (por
      ejemplo, minúscula) falla a nivel de base — verificado con un test.
- [ ] `npm test` completo en verde.
- [ ] La migración es idempotente: correrla dos veces seguidas contra la misma base no
      falla ni duplica el trigger/constraint.

## Restricciones

- **Toda migración es idempotente** (`CLAUDE.md`): el trigger y el `CHECK` se agregan
  con `CREATE OR REPLACE FUNCTION` / `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, y un
  `CHECK` nombrado que se pueda recrear sin chocar con una corrida anterior.
- **No hay base de staging: `DATABASE_URL` es la de producción** (`CLAUDE.md`). El
  `REVOKE` se corre contra la base real la primera vez — antes de correrlo, confirmar con
  el usuario, igual que se hizo con `004_hash_refresh_tokens.sql` en G3: no hay forma de
  probarlo primero en otro lado. A diferencia de esa migración, ésta no toca datos
  existentes, sólo permisos y un trigger — riesgo bajo, pero sigue sin ser reversible sin
  intervención manual si algo sale mal.
- **Los errores se lanzan, no se responden** (`CLAUDE.md`): si el trigger llega a
  dispararse desde código de la aplicación (no debería, porque `repository.js` no expone
  `UPDATE`/`DELETE`), el error de Postgres tiene que propagarse como una `AppError` con
  `asyncHandler`, no silenciarse.
- **`process.env` sólo se lee en `core/config.js`.** Si el plan necesita saber el nombre
  del rol de conexión para el `REVOKE`, usar el rol de la sesión de Postgres
  (`CURRENT_USER`) dentro del SQL de la migración, no leer una variable de entorno nueva.

## Riesgos

- **El `REVOKE` corrido con el rol equivocado no revoca nada**, y el criterio de
  aceptación de arriba (el `UPDATE`/`DELETE` sigue funcionando igual) no lo va a mostrar
  como error — hay que confirmar contra qué rol corre `DATABASE_URL` antes de escribir el
  `REVOKE` en el plan.
- **Un trigger mal escrito que también bloquee el `INSERT`** deja de auditar todo el
  sistema en silencio — nadie ve un error, porque `AuditoriaRepository.insertar` no
  revisa el resultado de la query más que esperar que no tire excepción, y varias
  llamadas a `auditoria.registrar(...)` no tienen `try/catch` alrededor (ver `login()`:
  si `auditoria.registrar` tirara, el login entero fallaría). Verificar el trigger contra
  `INSERT` explícitamente, no sólo contra `UPDATE`/`DELETE`.
- **Migrar contra producción sin poder hacer rollback fácil de un `REVOKE`**: si algo
  depende hoy, sin que el código lo muestre, de poder hacer `UPDATE`/`DELETE` sobre esa
  tabla (un script de mantenimiento externo, por ejemplo), se rompe en silencio recién
  cuando se lo corra. Buscar en el repo y preguntarle al usuario si existe algo así antes
  de aplicar el `REVOKE`.
