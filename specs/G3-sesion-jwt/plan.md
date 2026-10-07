# G3 — Plan

## Enfoque

Cuatro cambios independientes entre sí en la práctica, pero que se implementan y se
prueban juntos porque comparten el mismo archivo central (`auth/service.js`) y el mismo
criterio de aceptación de conjunto (el contrato HTTP no cambia). Orden: primero el hash
del refresh token (toca el esquema), después el borrado de refresh tokens previos al
abrir sesión (usa el mismo helper de hash), después la verificación de firma en logout
(no depende de los dos anteriores), y al final el fix de frontend (aislado, sin
dependencias con el resto).

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `src/core/security/jwt.js` | Dos funciones nuevas: `hashRefreshToken(token)` (SHA-256 hex) y `verificarIgnorandoExpiracion(token)` (como `verificar`, pero con `ignoreExpiration: true`, para el logout). |
| `src/modules/auth/repository.js` | `abrirSesion`: agrega `DELETE FROM refresh_tokens WHERE user_id = $1` antes del `INSERT`, misma transacción. `porRefreshToken`/`borrarRefreshToken`: sin cambios de SQL — reciben lo que el service les pase (ahora un hash), no saben que antes era el valor crudo. |
| `src/modules/auth/service.js` | `abrirSesion()`: hashea el `refreshToken` antes de pasarlo a `repo.abrirSesion`, devuelve el valor crudo al caller (sin cambios en la forma de la respuesta). `renovar()`: hashea `refreshToken` antes de `repo.porRefreshToken`/`repo.borrarRefreshToken`. `logout()`: cambia `jwtHelper.decodificar(token)` por `jwtHelper.verificarIgnorandoExpiracion(token)` dentro del mismo `try`; si la firma no es válida, cae al mismo `catch` que ya existe (responde éxito igual, no hace nada). |
| `src/modules/auth/migrations/004_hash_refresh_tokens.sql` | Migración nueva: `DELETE FROM refresh_tokens` — purga los tokens existentes en texto plano (dejan de poder validarse contra hashes de cualquier forma, así que dejarlos no cumple ningún propósito y sólo alarga la ventana de exposición del dato viejo). Idempotente por naturaleza: correrla dos veces no hace nada distinto la segunda vez. |
| `public/src/services/AuthService.js` | `login()`: agrega `this.stopTokenVerification();` antes de `this.startTokenVerification();` (línea ~158). |
| `test/auth.test.js` | `repoFalso.abrirSesion`: simula el borrado previo (limpia las entradas de `refreshTokens` con ese `userId` antes de setear la nueva) para que el test de "un refresh token viejo deja de servir tras un nuevo login" sea representativo del repo real. Tests nuevos: logout con firma inválida no borra nada; logout con token vencido pero firma válida sigue funcionando; refresh token de una sesión reemplazada por otro login del mismo usuario deja de aceptarse; `refresh_tokens` en el repo real (o su fake) nunca contiene el valor crudo. |
| `test/*` (frontend) | No hay test runner de frontend en este repo (ver 003 del backlog); el fix de `AuthService.js` se verifica leyendo el diff y, si el tiempo lo permite, con un test manual en navegador (login dos veces en la misma pestaña, contar `setInterval` activos vía `window.authService.verifyInterval` antes/después). |

## Orden de trabajo

1. **`jwt.js`: agregar `hashRefreshToken` y `verificarIgnorandoExpiracion`.**
   Se verifica con dos tests unitarios chicos: un token con firma alterada tira, uno
   vencido con firma válida no tira; `hashRefreshToken` es determinístico (mismo input,
   mismo output) y no reversible por inspección (no es la única prueba posible, pero
   alcanza para este alcance).
2. **`repository.js`: `abrirSesion` borra refresh tokens previos.**
   Se verifica con el test existente "el login exitoso devuelve usuario, tokens y
   permisos" (no debe romperse) más un test nuevo contra el repo real si hay
   `DATABASE_URL_TEST` (ver 003) — si no, sólo contra el fake actualizado.
3. **`service.js`: hash en `abrirSesion`/`renovar`, verificación de firma en `logout`.**
   Se verifica con `test/auth.test.js` completo en verde, más los tests nuevos del
   criterio de aceptación (logout con firma inválida, refresh viejo invalidado por
   login nuevo).
4. **Migración `004_hash_refresh_tokens.sql`.**
   Se verifica con `npm run migrate:status` (aparece pendiente), `npm run migrate`
   (aplica), y correrla una segunda vez sin error (`IF EXISTS`/naturaleza de `DELETE`
   ya es idempotente sin cláusula especial).
5. **`AuthService.js`: `stopTokenVerification()` antes de re-arrancar.**
   Se verifica en el navegador: login, capturar `window.authService.verifyInterval`,
   forzar un segundo `login()` sin recargar la página (posible desde la consola,
   reutilizando las credenciales), confirmar que el intervalo anterior se limpió
   (mismo id numérico no queda huérfano — Chrome DevTools > `getEventListeners` no
   aplica a timers, pero se puede instrumentar con un contador temporal en el método
   para la prueba y sacarlo después).
6. **Conjunto:** `npm test`, `node scripts/api-snapshot.js --compare` contra un
   snapshot tomado antes de empezar, y el smoke manual de login/logout/refresh con las
   tres cuentas reales (`admin1`, `DaianaMontenegro`, `augusto`) contra Postgres real.

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Guardar el refresh token con `bcrypt` en vez de SHA-256 | Es un valor de 32 bytes aleatorios generado por el servidor, no una contraseña elegida por una persona — no hay diccionario que atacar ni necesidad de costo computacional alto. `bcrypt` además tiene límite de 72 bytes de entrada y agregaría carga de CPU en cada `/refresh`, que el proyecto ya identificó como recurso escaso (ver [[feedback_rendimiento_features_nuevas]]). |
| Migrar los refresh tokens existentes recalculando su hash en la migración SQL | No se puede: el valor crudo no está disponible en la migración (nunca viajó a la base tal cual para poder rehashearlo hacia atrás sin el secreto original, que es justamente la propiedad que se busca). Purgarlos es la única opción consistente con "hash no reversible". |
| Revocar sólo el `session_jti` viejo en vez de borrar los refresh tokens del usuario | No alcanza: el punto 2 del problema es que el refresh token sigue vivo *después* de que la sesión (el access token) ya fue reemplazada — revocar el jti ya pasa hoy (via `active_sessions`), lo que falta es que el refresh token deje de poder generar uno nuevo. |
| Requerir `requireAuth` en `/api/auth/logout` | Rompe el caso de uso documentado a propósito ("cerrar una sesión ya vencida debe funcionar") — un usuario con access token vencido no podría limpiar su `refresh_tokens`/`active_sessions` en el servidor, y la sesión "colgada" seguiría contando como sesión única hasta el próximo login (que igual la reemplaza, pero deja una ventana). Verificar la firma sin exigir vigencia resuelve el problema real (forjar un token) sin ese costo. |
| Cambiar `activeSessions`/JWT a un modelo de múltiples sesiones por usuario | Fuera de alcance total: la spec 012 y la constitución del proyecto declaran sesión única como regla dura; esta spec la refuerza, no la reabre. |

## Cómo se verifica el conjunto

```bash
npm test
node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before.json
npm run migrate:status
npm run migrate
```

Manual, contra Postgres real: login con una cuenta real, capturar el `refreshToken`
devuelto; loguear la misma cuenta una segunda vez desde otra pestaña/curl; confirmar con
`POST /api/auth/refresh` que el primer `refreshToken` ya no sirve (401) y que el segundo
sí. Enviar a `POST /api/auth/logout` un JWT con la misma forma pero firma alterada
(editar un carácter de la tercera parte) y confirmar en la base que no se tocó ninguna
fila de `active_sessions`/`refresh_tokens`.
