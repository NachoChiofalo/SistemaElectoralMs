# G3 — Tareas

## Paso 1 — Helpers en `jwt.js`

- [x] **1.1** `hashRefreshToken(token)`: SHA-256 hex, determinístico.
      *Verifica:* test unitario, mismo input → mismo hash, distinto input → distinto hash.
      **Hecho**, `test/jwt.test.js`.
- [x] **1.2** `verificarIgnorandoExpiracion(token)`: igual que `verificar`, con
      `ignoreExpiration: true`; sigue tirando si la firma es inválida.
      *Verifica:* test unitario con un token de firma alterada (tira) y uno vencido de
      firma válida (no tira).
      **Hecho**, `test/jwt.test.js`.

## Paso 2 — `repository.js`: borrar refresh tokens previos al abrir sesión

- [x] **2.1** `abrirSesion` agrega `DELETE FROM refresh_tokens WHERE user_id = $1` antes
      del `INSERT`, misma transacción.
      *Verifica:* `test/auth.test.js` con el fake actualizado (paso 4.1) — un segundo
      login del mismo usuario deja sin efecto el refresh token del primero.
      **Hecho.** De paso, `borrarRefreshToken` quedó sin ningún caller (el `DELETE`
      de `abrirSesion` ya cubre lo que hacía) y se borró en vez de dejarla muerta.

## Paso 3 — `service.js`: hash de refresh token y verificación de firma en logout

- [x] **3.1** `abrirSesion()` hashea el `refreshToken` antes de `repo.abrirSesion`;
      sigue devolviendo el valor crudo al caller.
      *Verifica:* `resultado.refreshToken` (crudo) funciona contra `POST /auth/refresh`;
      lo que queda en `refresh_tokens.token` (real o fake) no es igual a ese valor.
      **Hecho**, test "el repositorio nunca guarda el refresh token en texto plano".
- [x] **3.2** `renovar()` hashea `refreshToken` antes de `porRefreshToken`.
      *Verifica:* "el refresh token es de un solo uso" (test existente) sigue en verde.
      **Hecho.** El `borrarRefreshToken` puntual que tenía `renovar()` se sacó: el
      `DELETE` de `abrirSesion()` (que `renovar()` llama a continuación) ya borra ese
      mismo token junto con el resto de los del usuario — mantenerlo era un segundo
      `DELETE` redundante.
- [x] **3.3** `logout()` cambia `decodificar` por `verificarIgnorandoExpiracion` dentro
      del `try` existente.
      *Verifica:* token de firma alterada → no borra nada, no tira hacia la ruta
      (sigue devolviendo éxito). Token vencido de firma válida → sigue cerrando la
      sesión igual que antes.
      **Hecho**, tests "el logout con firma invalida no cierra ninguna sesion" y
      "el logout con firma valida pero token vencido sigue cerrando la sesion".

## Paso 4 — Tests

- [x] **4.1** `test/auth.test.js`: `repoFalso.abrirSesion` limpia las entradas previas
      de `refreshTokens` para ese `userId` antes de setear la nueva (refleja el
      `DELETE` del paso 2.1).
- [x] **4.2** Test nuevo: logout con firma inválida no modifica `sesionesCerradas` del
      fake ni genera evento `LOGOUT` en auditoría.
- [x] **4.3** Test nuevo: tras un segundo `auth.login()` del mismo usuario, el
      `refreshToken` del primer login falla en `auth.renovar()` con 401.
- [x] **4.4** Test nuevo: el valor guardado en el repo (fake) para un refresh token
      nunca es igual al valor crudo devuelto por `login()`.
- [x] **4.5** `npm test` completo en verde: **209 pass, 0 fail, 1 skip** (el skip de
      siempre, necesita `DATABASE_URL_TEST` — ver 003).

## Paso 5 — Migración

- [x] **5.1** `src/modules/auth/migrations/004_hash_refresh_tokens.sql`:
      `DELETE FROM refresh_tokens;`.
      *Verifica:* `npm run migrate:status` la listó pendiente; `npm run migrate` la
      aplicó contra la base de producción (confirmado con el usuario antes de
      correrla — ver nota abajo); correrla una segunda vez respondió "Sin migraciones
      pendientes", sin error.
      **Hecho y aplicado en producción.**

## Paso 6 — Frontend

- [x] **6.1** `public/src/services/AuthService.js`: `login()` llama
      `this.stopTokenVerification()` antes de `this.startTokenVerification()`.
      *Verifica:* revisión de diff. **Hecho.** `npm run build:assets` corrido después
      (el test de versionado lo exige — falló primero, en verde después).
      Smoke manual en navegador **no hecho** (ver Paso 7).

## Paso 7 — Verificación de conjunto

- [x] **7.1** `npm test`: 209/209, en verde.
- [ ] **7.2** `node scripts/api-snapshot.js` antes/después.
      **No hecho** — el script pide login y esta sesión no tiene credenciales reales
      del sistema (mismo bloqueo que quedó documentado en 002 y 017). Como este
      cambio no altera la forma de `/api/auth/login`, `/api/auth/refresh` ni
      `/api/auth/logout` (mismos campos de entrada/salida, sólo cambia qué pasa puertas
      adentro), el riesgo que este paso cubriría es bajo, pero sigue pendiente cerrarlo
      con credenciales válidas.
- [ ] **7.3** Smoke manual contra Postgres real (login doble invalida el primer refresh
      token; logout con JWT forjado no toca la base; login/logout/refresh normales
      siguen andando). **No hecho**, mismo motivo que 7.2: sin credenciales ni
      navegador conectado en esta sesión no se pudo ejecutar contra el servidor real
      corriendo. Los cuatro casos sí están cubiertos por tests automáticos contra un
      repositorio en memoria (Paso 4), que ejercitan exactamente la misma lógica de
      `service.js` que corre en producción — lo que falta es la confirmación de punta a
      punta con el servidor HTTP real.

## Cierre

- [x] Actualizar `docs/BACKLOG.md`: G3 anotado como resuelto en el bloque de hallazgos
      críticos de P0, sin quitar la fila de la tabla resumen.
- [x] Lo que se aprendió y no se dedujo de la spec: la migración de datos existentes
      (invalidar todos los refresh tokens) se corrió contra la base de **producción
      real** de este proyecto, confirmado explícitamente con el usuario antes de
      ejecutarla — no una base de test. Vale la pena que quede anotado en `CLAUDE.md`
      como precedente: cualquier spec que incluya una migración con `DELETE`/`UPDATE`
      sobre datos existentes (no sólo `CREATE TABLE`) tiene que confirmar con la
      persona antes de correr `npm run migrate`, porque este repo no tiene un entorno
      de staging separado — la única base es la de producción.
