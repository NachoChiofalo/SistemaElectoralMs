# G6 — Plan

## Enfoque

Una migración nueva en `src/modules/auditoria/migrations/` agrega el trigger de
inmutabilidad, el `REVOKE`, el `CHECK` de vocabulario y el comentario de `usuario_id`.
`AuthService.renovar()` gana una llamada a `auditoria.registrar(...)` con el mismo patrón
que ya usan `login()`/`logout()`. Dos tests nuevos verifican el trigger a nivel de motor
(necesitan Postgres real, mismo patrón que `migraciones.test.js`) y el evento `REFRESH`.

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `src/modules/auditoria/migrations/002_inmutabilidad.sql` (nuevo) | Trigger `BEFORE UPDATE OR DELETE`, `REVOKE UPDATE, DELETE`, `CHECK` de `operacion`/`entidad`, comentario en `usuario_id` |
| `src/modules/auth/service.js` | `renovar()` llama a `this.auditoria.registrar({ operacion: 'REFRESH', ... })` después de `abrirSesion()`, mismo patrón que `login()` |
| `test/migraciones.test.js` | Agrega el caso: `INSERT` funciona, `UPDATE`/`DELETE` sobre esa fila rechaza |
| `test/auth.test.js` | Agrega el caso: `renovar()` deja una fila `REFRESH` en auditoría |

## Migración: contenido exacto

```sql
-- padron.auditoria pasa a ser de solo insercion tambien a nivel de motor: hasta ahora
-- la garantia dependia de que AuditoriaRepository no expusiera UPDATE/DELETE (DB-003).

CREATE OR REPLACE FUNCTION padron.bloquear_auditoria_mutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'padron.auditoria es de solo insercion: % no permitido sobre id=%',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON padron.auditoria;
CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON padron.auditoria
  FOR EACH ROW EXECUTE FUNCTION padron.bloquear_auditoria_mutable();

-- CURRENT_USER, no un nombre de rol hardcodeado: la migracion corre con la misma
-- conexion (mismo rol) que usa la aplicacion (ver core/db.js, un solo pool).
REVOKE UPDATE, DELETE ON padron.auditoria FROM CURRENT_USER;

COMMENT ON COLUMN padron.auditoria.usuario_id IS
  'Sin FK a usuarios a proposito: un DELETE sobre una cuenta no debe arrastrar en '
  'cascada su rastro de auditoria (DB-016).';

```

> **Corrección (preflight de producción):** el plan original agregaba un `CHECK` de
> mayúsculas sobre `operacion` y `entidad`. Se descartó: el código escribe `entidad` en
> minúscula (`'votante'`, `'comicio'`, `'mesa'`…) y producción tiene 5.275 filas así. El
> `CHECK` habría rechazado el evento de casi todos los módulos, y `registrar` lo habría
> perdido sin avisar. DB-033 queda abierto.

El `REVOKE` corrido dos veces no falla (Postgres no tira error si el privilegio ya no
está). `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` hace que la migración completa sea idempotente, igual que el resto del
esquema.


## `renovar()` — evento REFRESH

```js
async renovar(refreshToken, req) {
  const usuario = await this.repo.porRefreshToken(jwtHelper.hashRefreshToken(refreshToken));

  if (!usuario) throw errores.noAutenticado('Refresh token invalido o expirado');
  if (!usuario.activo) throw errores.sinPermiso('Usuario inactivo');

  const tokens = await this.abrirSesion(usuario);

  await this.auditoria.registrar({
    usuario_id: usuario.id,
    usuario_nombre: usuario.nombre_completo,
    usuario_username: usuario.username,
    operacion: 'REFRESH',
    entidad: 'SESION',
    entidad_id: usuario.id,
    detalles: 'Sesion renovada via refresh token',
    ip_address: ipDeRequest(req),
  });

  return { ... };
}
```

`renovar()` no recibe `req` hoy (`src/modules/auth/service.js:133`, sólo
`refreshToken`) — hay que revisar `routes.js` para confirmar si el handler tiene el
`req` disponible para pasarlo. Si no lo pasa, se agrega el parámetro igual que lo tiene
`login(username, password, req)`.

## Orden de trabajo

1. **Migración** `002_inmutabilidad.sql` — se verifica corriendo `npm run migrate`
   contra la base de test (`DATABASE_URL_TEST`) y confirmando con `\d padron.auditoria`
   (o una query a `information_schema`) que el trigger y el `CHECK` quedaron.
2. **Test del trigger** en `test/migraciones.test.js`: insertar una fila, intentar
   `UPDATE` (rechaza), intentar `DELETE` (rechaza), confirmar que el `INSERT` original
   sigue ahí. Se verifica con `npm test` (sólo corre con `DATABASE_URL_TEST` seteada,
   mismo patrón que el resto del archivo).
3. **`renovar()` + evento REFRESH** en `auth/service.js` y, si hace falta, en
   `auth/routes.js` para pasar `req`. Se verifica con el test nuevo en `auth.test.js` y
   a mano: login, refresh, `GET /api/auditoria` muestra la fila `REFRESH`.
4. **`npm test` completo** en verde, incluidos los casos nuevos.
5. **Confirmar con el usuario y correr la migración contra producción** — el `REVOKE`
   es sobre permisos, no sobre datos, pero corre contra la única base que hay
   (`DATABASE_URL` es la de producción). Después de aplicarla, un `SELECT` de prueba
   (no un `UPDATE`) contra `padron.auditoria` confirma que el sistema sigue funcionando
   con normalidad — login real, y `GET /api/auditoria` responde igual que antes.

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Row Level Security en vez de `REVOKE` | Un solo rol de conexión (un solo pool, `core/db.js`) no se beneficia de RLS: es una capa pensada para varios roles con distinta visibilidad de filas. `REVOKE` + trigger cierra el caso real con menos piezas nuevas. |
| `CHECK` con lista cerrada de valores para `operacion` | Rompe con el primer valor nuevo (empezando por `REFRESH`, que este mismo ítem agrega). Se prefiere la restricción de forma (mayúsculas) sobre la de contenido. |
| Agregar la FK en `usuario_id` | DB-016 documenta que la ausencia de FK es una garantía positiva (un DELETE de usuario no borra su auditoría en cascada). Agregarla revertiría eso; sólo se documenta con un comentario. |
| Hardcodear el nombre del rol (`electoral_user`) en el `REVOKE` | `CURRENT_USER` sigue siendo correcto aunque cambie el usuario de conexión entre entornos, sin depender de una variable de entorno nueva (`process.env` sólo se lee en `config.js`, y este SQL no es JS). |

## Cómo se verifica el conjunto

```bash
DATABASE_URL_TEST=postgresql://test:test@localhost:5432/test_migraciones npm run migrate
npm test
```

Más el smoke manual del paso 5 contra producción, después de que el usuario confirme
correr la migración ahí.
