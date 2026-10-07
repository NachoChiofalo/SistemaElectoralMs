# G3 — Ciclo de vida de sesión: el token queda expuesto y no se invalida correctamente

> Estado: en curso — código, migración (aplicada en producción) y tests completos;
> falta el snapshot de contrato y el smoke manual contra el servidor real (7.2/7.3 de
> `tareas.md`), bloqueados por falta de credenciales en esta sesión.
> Tamaño estimado: L

## Problema

Cuatro puntos débiles de la misma cadena de confianza (cliente → verificación →
persistencia del secreto), verificados en el código actual:

1. **`POST /api/auth/logout` cierra la sesión de cualquier usuario sin ninguna
   autenticación real** (`src/modules/auth/routes.js:29-36`,
   `src/modules/auth/service.js:151-179`). La ruta está montada **sin** `requireAuth` a
   propósito ("cerrar una sesión ya vencida debe funcionar"), y `logout()` lee los claims
   con `jwtHelper.decodificar()` (`src/core/security/jwt.js:63-65`), que es `jwt.decode`
   — **no verifica la firma**. Cualquiera puede mandar un JWT con forma válida pero
   firma inventada, con `{ id: <cualquier userId> }` en el payload, y `repo.cerrarSesion`
   (`src/modules/auth/repository.js:106-120`) borra sin más preguntas los
   `refresh_tokens` y el `active_sessions` de ese usuario. Es un logout forzado de
   cualquier cuenta, sin credenciales, repetible.

2. **Un refresh token sobrevive a la sesión que reemplaza.** `abrirSesion`
   (`src/modules/auth/repository.js:64-78`) hace `INSERT INTO refresh_tokens` en cada
   login sin borrar los que ya tenía ese usuario; sólo se borran los de una sesión
   puntual cuando se **usa** ese refresh token (`service.js:132`, borra sólo el usado) o
   cuando hay un logout explícito (`repository.js:116`). Mientras tanto, el access token
   sí queda protegido por sesión única (`active_sessions.session_jti`,
   `core/security/sessions.js:116-118`) — pero un refresh token de una sesión vieja
   sigue siendo válido hasta sus 7 días (`service.js:17`) o hasta que alguien haga
   logout. Cualquiera que lo tenga (un dispositivo compartido, un token capturado antes)
   puede llamar `POST /api/auth/refresh` en cualquier momento y **reabre sesión
   pisando la activa**, porque `renovar()` llama `abrirSesion()` igual que un login
   (`service.js:126-145`).

3. **El refresh token se guarda en texto plano.** `refresh_tokens.token VARCHAR(255)`
   (`src/modules/auth/migrations/001_esquema_auth.sql:43-49`) guarda tal cual el valor
   de `crypto.randomBytes(32).toString('hex')` que via el punto 2 sigue siendo válido
   por 7 días. Una fuga de esa tabla —el mismo backup sin cifrar de DB-001— es
   equivalente a fugar credenciales activas de cualquier usuario con sesión reciente.

4. **`AuthService.login()` duplica el intervalo de verificación de token.**
   `public/src/services/AuthService.js:126-168` llama `this.startTokenVerification()`
   al final de un login exitoso sin llamar antes `stopTokenVerification()`; el
   `constructor` (línea 12) ya arrancó uno si había un token en `localStorage`. Si
   `login()` se ejecuta más de una vez en la misma carga de página (reintento tras
   error, doble submit), quedan dos o más `setInterval` corriendo la misma verificación
   cada 5 minutos.

## Por qué ahora

CLAUDE.md declara la sesión única y la atribución personal como regla "no negociable":
*"la cuenta es personal, nunca compartida (...) por eso un segundo login cierra el
primero"*. El punto 2 rompe exactamente esa garantía por una vía que no pasa por el
login: no hace falta la contraseña de nadie, alcanza con un refresh token viejo. Y el
punto 1 es explotable hoy mismo, sin ninguna cuenta ni token válido — sólo un JWT con
forma correcta y firma cualquiera. Los cuatro puntos son la misma cadena; corregir sólo
uno (por ejemplo, sólo el guardado en texto plano) deja los otros tres como vía de
explotación equivalente.

## Alcance

1. `logout()` verifica la firma del JWT (`jwt.verify`, ignorando sólo la expiración —
   `jwt.verify(token, secreto, { ...opciones, ignoreExpiration: true })`) antes de tocar
   `refresh_tokens`/`active_sessions`/`token_blacklist`. Un token con firma inválida no
   cierra ninguna sesión. Sigue sin requerir `requireAuth`/sesión activa, porque una
   sesión ya vencida tiene que poder cerrarse iguel — lo que cambia es que el JWT
   presentado tiene que ser uno que el servidor emitió alguna vez.
2. `abrirSesion` borra los refresh tokens previos del usuario (`DELETE FROM
   refresh_tokens WHERE user_id = $1`) en la misma transacción en la que inserta el
   nuevo, tanto si el origen es un login como un refresh. Un refresh token de una sesión
   ya reemplazada deja de servir en el mismo instante en que se abre la sesión nueva —
   igual que ya pasa hoy con el access token vía `active_sessions`.
3. `refresh_tokens.token` pasa a guardar un hash (SHA-256, hex) del valor en vez del
   valor en texto plano; la búsqueda (`porRefreshToken`) y el borrado
   (`borrarRefreshToken`) hashean el valor recibido antes de la consulta. El valor que
   viaja al cliente y que el cliente reenvía no cambia — sólo lo que queda persistido.
   No hace falta bcrypt: es un valor de alta entropía generado por el propio servidor,
   no una contraseña elegida por una persona.
4. `AuthService.login()` (frontend) llama `this.stopTokenVerification()` antes de
   `this.startTokenVerification()`, igual que ya lo hace `logout()`.
5. Migración idempotente para el nuevo formato de `refresh_tokens.token`: los refresh
   tokens ya emitidos en texto plano dejan de validar tras el deploy (se tratan como
   sesión vencida, no como error) — no se migran valores existentes a hash, se
   documenta como corte limpio.

## Fuera de alcance

- **FE-002 (mover el token fuera de `localStorage`, p. ej. a una cookie `httpOnly`).**
  Es un cambio de arquitectura del transporte del token —cookies, CORS con
  credenciales, protección CSRF nueva—, no un ajuste del ciclo de vida de la sesión.
  El modelo de amenaza que motiva esta spec (robo de un token ya emitido) depende de
  que XSS esté cerrado, que es lo que 001 (hecho) y 002 (pendiente, en curso) atacan
  directamente; moverlo de `localStorage` es una mitigación en profundidad que merece
  su propio ítem de backlog, no se suma acá para no mezclar dos cambios de alcance muy
  distinto bajo el mismo criterio de aceptación.
- **BE-012 (`jwt.verify` sin restringir `algorithms`)** y cualquier otro hallazgo de
  severidad Media/Baja de `jwt.js` o `sessions.js` — quedan en su prioridad propia
  (P2/P3 del backlog), no tienen relación con el ciclo de vida de sesión que ataca esta
  spec.
- **Bajar los 7 días de vigencia del refresh token o el TTL de la caché de sesión.**
  Ninguno de los cuatro puntos depende de esos valores; cambiarlos sin que lo pida un
  hallazgo propio es alcance no pedido.
- **Rotar `JWT_SECRET` en producción.** No corrige ninguno de los cuatro puntos (un
  JWT con firma inválida ya es rechazado hoy en cualquier ruta con `requireAuth`; el
  agujero de logout es que esa ruta puntual no lo verificaba, no que el secreto esté
  comprometido) y es una operación aparte, con su propio riesgo de invalidar todas las
  sesiones activas de golpe.

## Criterios de aceptación

- [ ] `POST /api/auth/logout` con un token de firma inválida (mismo payload, firma
      alterada) responde `success: true` sin efecto — no borra `refresh_tokens` ni
      `active_sessions` de ningún usuario real, y no aparece en `auditoria`.
- [ ] `POST /api/auth/logout` con un token vencido pero de firma válida sigue
      funcionando igual que hoy (caso que la ruta existe para cubrir).
- [ ] Tras un segundo `POST /api/auth/login` exitoso del mismo usuario, el refresh
      token emitido en el primer login deja de aceptarse en `POST /api/auth/refresh`
      (401), aunque no haya vencido.
- [ ] `SELECT token FROM refresh_tokens` no contiene ningún valor igual al
      `refreshToken` devuelto por `/api/auth/login` o `/api/auth/refresh` — sólo su
      hash.
- [ ] `POST /api/auth/refresh` sigue funcionando de punta a punta con el token que
      recibe el cliente (sin exponerle el hash).
- [ ] Test que llama `login()` dos veces seguidas en la misma instancia de
      `AuthService` y verifica que sólo hay un `setInterval` activo
      (`this.verifyInterval` no se pisa sin limpiar el anterior — verificable
      espiando `clearInterval`/`setInterval`).
- [ ] `npm test` sigue en verde; los tests nuevos de este ítem no requieren
      `DATABASE_URL_TEST` si se puede probar `logout`/hash a nivel unitario, y si
      hace falta Postgres real, se documentan como parte de 003.
- [ ] `node scripts/api-snapshot.js` antes y después: sin diferencias en la forma de
      `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` — el contrato externo
      no cambia, sólo lo que pasa puertas adentro.

## Restricciones

- **Los errores se lanzan, no se responden.** El logout sigue sin lanzar hacia el
  cliente (ver el `catch` de `service.js:176-178`, que responde éxito siempre); lo que
  cambia es que un token con firma inválida no ejecuta el borrado, no que empiece a
  devolver un error nuevo.
- **`process.env` sólo en `core/config.js`.** Nada de este cambio lee `process.env`
  directo; `JWT_SECRET` ya se resuelve vía `config.jwt.secreto`.
- **Toda migración es idempotente.** La migración que cambia el `refresh_tokens.token`
  existente (si hace falta alguna, más allá de que el código empiece a hashear en
  escritura) usa `IF NOT EXISTS`/`ON CONFLICT DO NOTHING` igual que el resto.
- **Un solo pool de PostgreSQL, nada nuevo por fuera de `db` inyectado.** El hash se
  calcula en Node (`crypto.createHash('sha256')`), no en SQL.

## Riesgos

- **Invalidar todas las sesiones activas al deployar.** El corte limpio de
  `refresh_tokens` (punto 5) significa que cualquier refresh token emitido antes del
  deploy deja de aceptarse — quien tenga la sesión abierta en ese momento sigue
  autenticado por el access token hasta que expire o intente renovarlo, y ahí tiene que
  volver a loguearse. Con 3 usuarios activos hoy, conviene avisar antes de deployar en
  horario de uso.
- **Confundir "firma inválida" con "token vencido" en el logout.** Si la verificación
  nueva no ignora la expiración explícitamente, un logout de una sesión vencida (el
  caso que la ruta existe para cubrir) empezaría a fallar silenciosamente en vez de
  limpiar el estado — hay que probar ambos casos, no sólo el de firma inválida.
- **Que el borrado de refresh tokens previos en `abrirSesion` rompa el flujo de
  `renovar()`**, que hoy borra el token usado (`service.js:132`) y después llama
  `abrirSesion()`: si el orden cambia, un `DELETE ... WHERE user_id` en `abrirSesion`
  después de un `borrarRefreshToken` puntual no rompe nada porque ya no queda ese
  token, pero hay que confirmar que la transacción de `abrirSesion` no pisa una
  escritura en vuelo de otro login simultáneo del mismo usuario — improbable (single
  session ya lo asume) pero verificable con el mismo criterio que 013.
