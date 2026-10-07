# Backlog de auditoría de BASE DE DATOS

Auditoría exhaustiva de DBA sobre el esquema, migraciones y forma en que el código
interactúa con la base (PostgreSQL/Supabase, SQL crudo parametrizado vía `pg`, sin ORM,
migraciones versionadas a mano por módulo en `src/modules/*/migrations/*.sql`) hecha
antes de un release importante. Es **diagnóstico**: nada de lo listado acá fue
corregido todavía, salvo la excepción de DB-001 que se señala explícitamente por ser
una exposición activa, no un defecto de código.

Alcance cubierto: las 16 migraciones de los 5 módulos (`auth`, `auditoria`, `padron`,
`comicio`, `fiscales`, `listas`), los repositorios que las consultan, `core/db.js`,
`core/migrations.js`, `.env.example`/`docker-compose.yml`/`render.yaml`, y una revisión
del disco del proyecto en busca de backups o dumps de datos reales.

No se repiten acá los hallazgos ya documentados en `BACKLOG-BACKEND.md` que son bugs de
**código de aplicación** (condiciones de carrera TOCTOU sin lock, cascadas de borrado sin
registro completo en auditoría, validaciones de negocio faltantes en el service). Sí se
incluyen aquí las conclusiones de **diseño de esquema** derivadas de esos mismos bugs
(por ejemplo, si un `EXCLUDE constraint` los resolvería de raíz), y se referencia el ID
de backend correspondiente cuando aplica.

---

## ⚠️ Hallazgo urgente fuera del código: exposición activa de datos reales

Antes del backlog de esquema, un hallazgo que no es un defecto de diseño sino una
**exposición de datos ocurriendo ahora mismo**, encontrada al revisar el disco del
proyecto en busca de dumps/backups (ver DB-001 abajo para el detalle completo): la
carpeta `respaldo-pre-migracion-2026-09-19/` (fuera del repositorio git de
`microservicios/`, no versionada) contiene CSVs con hashes de contraseña reales y PII
completa de votantes (DNI, nombre, domicilio, teléfono), dentro de una ruta
`...\OneDrive\Desktop\...` que se sincroniza automáticamente a la nube sin cifrado.
Se recomienda tratar esto con prioridad independiente del resto del backlog, sin
esperar a la priorización general — es información sensible expuesta hoy, no una deuda
técnica a programar.

---

## Hallazgos

### DB-001 — Backup de producción sin cifrar, con hashes de contraseña y PII completa, en una carpeta sincronizada a la nube

- **Categoría:** Seguridad
- **Severidad:** Crítica
- **Ubicación:** `C:\Users\juani\OneDrive\Desktop\Proyectos\SistemaElectoral\respaldo-pre-migracion-2026-09-19\` (7 archivos CSV: `padron_auditoria.csv` ~2,8 MB, `padron_votantes.csv` ~712 KB, `padron_relevamientos.csv` ~144 KB, `permisos.csv`, `usuarios.csv`, `roles.csv`, `rol_permisos.csv`)
- **Descripción:** `usuarios.csv` tiene columna `password_hash` con hashes reales en texto plano en disco. `padron_votantes.csv` tiene PII completa (DNI, apellido, nombre, domicilio) de votantes reales. `padron_relevamientos.csv` incluye `telefono`/`observacion`/`observaciones_detalle`. `padron_auditoria.csv` incluye `ip_address` y el detalle de cada cambio histórico. La carpeta está fuera del repositorio git de `microservicios/` y no hay ningún `.git` en la raíz del proyecto que la trackee — no está versionada. Pero la ruta está bajo `OneDrive\Desktop`, lo que indica sincronización automática a la nube de Microsoft sin ningún control de acceso, cifrado en reposo propio, ni fecha de purga.
- **Impacto:** Exposición de hashes de contraseña e identidad completa de votantes reales a cualquier proceso o cuenta con acceso a esa carpeta de OneDrive, y a quien tenga acceso a la máquina. Es un backup "pre-migración" que aparenta transitorio pero no tiene mecanismo de purga.
- **Sugerencia de solución:** Mover estos CSV fuera de cualquier carpeta sincronizada a la nube de inmediato (o pausar la sincronización de OneDrive para esa subcarpeta), cifrarlos (7z con contraseña, o gpg) si deben conservarse, y borrarlos del disco una vez confirmada la migración exitosa.

---

### DB-002 — Refresh token guardado en texto plano en la base

- **Categoría:** Seguridad
- **Severidad:** Crítica
- **Ubicación:** `src/modules/auth/migrations/001_esquema_auth.sql:43-49` (tabla `refresh_tokens`, columna `token VARCHAR(255) UNIQUE NOT NULL`); insertado en `auth/repository.js:67` (`abrirSesion`), comparado literal en `:81-95` (`porRefreshToken`) y `:98-100` (`borrarRefreshToken`)
- **Descripción:** La columna `token` guarda el refresh token tal cual se emite —el secreto que permite obtener nuevos access tokens— sin hashing a nivel de aplicación ni de columna (pgcrypto).
- **Impacto:** Si la tabla se filtra (dump, backup, acceso indebido a Supabase, un `SELECT *` mal logueado), cualquiera con esas filas puede impersonar a esos usuarios indefinidamente hasta que expiren, sin necesitar la contraseña. Equivalente a filtrar credenciales activas.
- **Sugerencia de solución:** Guardar `SHA-256(token)` (o HMAC con clave del servidor) en la columna en vez del token crudo; el cliente sigue recibiendo el token real, el servidor sólo compara el hash. No rompe compatibilidad de API.

---

### DB-003 — La tabla de auditoría no tiene ninguna protección real contra UPDATE/DELETE a nivel de motor

- **Categoría:** Seguridad / Diseño
- **Severidad:** Crítica
- **Ubicación:** `src/modules/auditoria/migrations/001_esquema_auditoria.sql:9-22` (`padron.auditoria`)
- **Descripción:** No hay trigger `BEFORE UPDATE OR DELETE` que aborte la operación, no se revocan privilegios `UPDATE`/`DELETE` al rol de la aplicación, y no hay Row Level Security. Que el `repository.js` sólo exponga `insertar`/`listar`/`contar`/`estadisticas`/`porId` es una convención de código, no un mecanismo del motor.
- **Impacto:** Cualquier acceso directo a la base (consola de Supabase, un script de mantenimiento, una migración futura mal escrita, una inyección SQL en otro módulo que comparta el rol de conexión) puede alterar o borrar el rastro de auditoría sin dejar ningún indicio. En un sistema electoral, la inmutabilidad del log de auditoría suele ser un requisito de integridad, no sólo buena práctica.
- **Sugerencia de solución:** Agregar un trigger `BEFORE UPDATE OR DELETE ON padron.auditoria` que haga `RAISE EXCEPTION`, y/o `REVOKE UPDATE, DELETE ON padron.auditoria FROM <rol_app>`, dejando sólo `INSERT`/`SELECT`.

---

### DB-004 — `TIMESTAMP` sin zona horaria inconsistente en todo el esquema: módulos viejos vs. nuevos

- **Categoría:** Diseño / Tipos de datos
- **Severidad:** Alta
- **Ubicación:** `auth/migrations/001_esquema_auth.sql` (`roles.created_at`, `usuarios.created_at/updated_at`, `refresh_tokens.expires_at`, `active_sessions.last_activity`, todos `TIMESTAMP` sin tz) y `padron/migrations/001_esquema_padron.sql` (`votantes.created_at/updated_at`, `relevamientos.fecha_relevamiento/fecha_modificacion/fecha_detalle`, también sin tz) — vs. `elecciones.*` (listas, comicios, fiscales) y `padron.auditoria.created_at`, que sí usan `TIMESTAMPTZ`
- **Descripción:** Hay una división clara: los módulos más viejos (`auth`, `padron`) usan `TIMESTAMP` sin zona horaria; los módulos nuevos (`listas`, `comicio`, `fiscales`) y `auditoria` usan `TIMESTAMPTZ`. `TIMESTAMP` sin tz almacena la hora "de pared" tal como la manda el driver, sin normalizar a UTC — ambiguo si el servidor de la app, el pool de conexión o Supabase alguna vez corren con timezone distinto al asumido.
- **Impacto:** Comparar/ordenar fechas entre `padron.relevamientos.fecha_modificacion` (sin tz) y `padron.auditoria.created_at` (con tz) para una misma operación puede desalinearse ante un cambio de horario de verano o de configuración regional de Postgres. El propio mecanismo anti-colisión del sistema (`GET /api/padron/cambios?desde=`) depende de comparar timestamps con precisión — un corrimiento de zona horaria podría hacer que cambios recientes no se detecten o se detecten de más. Login/logout y expiración de tokens en `auth` tienen el mismo riesgo.
- **Sugerencia de solución:** Migración nueva que convierta las columnas `TIMESTAMP` de `auth` y `padron` a `TIMESTAMPTZ` (`ALTER COLUMN ... TYPE TIMESTAMPTZ USING columna AT TIME ZONE '<zona real de los datos existentes>'`), fijando explícitamente desde qué zona se interpretan los valores ya guardados antes del release — no es un cambio trivial de tipo. Fijar además `timezone` explícito en la config del pool (`core/db.js`).

---

### DB-005 — `padron.votantes.edad` es un valor estático que se desactualiza con el tiempo

- **Categoría:** Diseño
- **Severidad:** Alta
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:17` (`edad INTEGER`)
- **Descripción:** `edad` se carga en la importación junto con `anio_nac` (dato estable), pero nunca se recalcula. Es derivable (`año_actual - anio_nac`) y sin embargo se persiste como columna independiente. Cada re-importación del padrón (que puede ocurrir años después) vuelve a fijar `edad` al valor del archivo importado, no al real al momento de la consulta.
- **Impacto:** `estadisticasPorRangoEtario()` y cualquier filtro/ordenamiento por edad quedan progresivamente incorrectos entre importaciones, sin ningún error visible — sólo un número mal calculado en el módulo de resultados.
- **Sugerencia de solución:** Calcular la edad en la consulta a partir de `anio_nac` en vez de persistirla, o si el dato "edad" viene tal cual del archivo oficial del padrón a una fecha de corte, agregar una columna `edad_al` (fecha de corte) para que quede explícito que no es una edad vigente. Marcado con incertidumbre media: podría ser una decisión ya conocida si el archivo fuente trae "edad" como campo oficial.

---

### DB-006 — FK `relevamientos.dni → votantes.dni` con `ON DELETE CASCADE` puede borrar trabajo de campo irreversible

- **Categoría:** Bug / Diseño
- **Severidad:** Alta
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:26` (`dni VARCHAR(20) REFERENCES padron.votantes(dni) ON DELETE CASCADE`)
- **Descripción:** Si en algún momento se borra una fila de `padron.votantes` (deduplicación, limpieza manual, futura herramienta de mantenimiento), el `CASCADE` borra automáticamente y sin aviso todo el relevamiento asociado: opción política, teléfono, observaciones, condiciones especiales y autoría. Hoy `repository.js` no expone ningún DELETE sobre `votantes`, pero el CASCADE queda como trampa para código futuro o un DELETE manual desde el panel de Supabase.
- **Impacto:** Pérdida irreversible y silenciosa del dato más valioso del sistema (trabajo de relevamiento recolectado con esfuerzo humano) ante un borrado de votante que en apariencia es sólo "sacar un registro del padrón".
- **Sugerencia de solución:** Cambiar a `ON DELETE RESTRICT` (obligar a decidir explícitamente qué hacer con el relevamiento antes de borrar el votante), o desacoplar/archivar el relevamiento antes de permitir la baja del votante.

---

### DB-007 — El "rango" de mesa no es autocontenido: su orden depende de una columna mutable de otra tabla

- **Categoría:** Diseño
- **Severidad:** Alta
- **Ubicación:** `comicio/migrations/001_esquema_comicio.sql:27-28` (`mesas.padron_desde_dni`, `padron_hasta_dni`), `comicio/repository.js:162-229`
- **Descripción:** El rango de una mesa no se guarda como un intervalo con orden propio; se guarda como dos FKs a `padron.votantes(dni)`, y la posición de esos DNIs dentro del rango se define en cada query por `(apellido, nombre, dni)` de la fila **actual** de esos votantes. Si se corrige el apellido/nombre del votante que es límite de una mesa, el límite efectivo de esa mesa cambia solo, sin ningún UPDATE sobre `elecciones.mesas` ni evento de auditoría en comicio.
- **Impacto:** Redefinición silenciosa de qué votantes pertenecen a qué mesa después de creado el comicio, sin rastro — sensible en un sistema electoral porque cambia participación/asignación de mesa sin acción explícita sobre el dominio de comicio.
- **Sugerencia de solución:** Si el trade-off (evitar duplicar ~5500 filas) es aceptado conscientemente, al menos congelar la posición guardando un snapshot de `(apellido, nombre)` al momento de fijar el rango, o un trigger en `padron.votantes` que impida modificar silenciosamente el apellido/nombre de un DNI que hoy es límite de mesa. Incertidumbre: si el requisito de negocio es "recalcular dinámicamente para que nuevos votantes caigan en mesas existentes", esto es una *feature* parcial — el problema específico es que el propio límite cambie de identidad, no que un tercero nuevo entre al rango.

---

### DB-008 — `fiscal_asignaciones` admite un `EXCLUDE constraint` que cierra de raíz la condición de carrera de solapamiento (BE-009)

- **Categoría:** Diseño
- **Severidad:** Alta
- **Ubicación:** `fiscales/migrations/001_esquema_fiscales.sql:15-22`
- **Descripción:** `BACKLOG-BACKEND.md` (BE-009) reportó una condición de carrera TOCTOU en la validación de doble solapamiento de fiscales, resuelta hoy sólo en la capa de aplicación (check-then-insert sin transacción/lock). Acá el rango horario (`desde`, `hasta TIME`) vive como columnas propias de la fila, comparables sin JOIN externo — a diferencia del solapamiento de mesas (ver nota abajo), este caso sí es resoluble con un `EXCLUDE USING gist` sobre `mesa_id`/`fiscal_id` + rango horario, usando `btree_gist`.
- **Impacto:** Con el `EXCLUDE constraint`, la garantía de no-solapamiento la sostiene la base, no la aplicación — no se puede "olvidar" en un futuro endpoint nuevo, a diferencia del guard de código actual.
- **Sugerencia de solución:**
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE elecciones.fiscal_asignaciones
    ADD CONSTRAINT no_solapa_mesa
    EXCLUDE USING gist (mesa_id WITH =, horario_range(desde, hasta) WITH &&);
  ALTER TABLE elecciones.fiscal_asignaciones
    ADD CONSTRAINT no_solapa_fiscal
    EXCLUDE USING gist (fiscal_id WITH =, horario_range(desde, hasta) WITH &&);
  ```
  El `CHECK` existente (`desde >= '08:00' AND hasta <= '18:00' AND hasta > desde`) ya garantiza que el intervalo es válido y no cruza medianoche, lo que simplifica construir el range sin fecha. **Nota:** el solapamiento de *rango de mesas* (BE-026) **no** es resoluble de la misma forma porque compara contra un JOIN a `padron.votantes` en tiempo de consulta, no contra columnas propias de la fila — ese caso sigue dependiendo de transacción/lock a nivel de aplicación.

---

### DB-009 — Inconsistencia de protección de historial: `fuerza` está protegida con `RESTRICT`, pero `mesa`/`comicio` permiten borrar votos en cascada

- **Categoría:** Diseño
- **Severidad:** Alta
- **Ubicación:** `comicio/migrations/002_fuerzas_y_mesa_opcional.sql:29` (`votos_fuerza.fuerza_id ... ON DELETE RESTRICT`) vs. `001_esquema_comicio.sql:25` (`mesas.comicio_id ... ON DELETE CASCADE`), `:35` (`votos_lista.mesa_id ... ON DELETE CASCADE`), `002:28` (`votos_fuerza.mesa_id ... ON DELETE CASCADE`)
- **Descripción:** El esquema ya decidió proteger los votos contra el borrado de una `fuerza` (correctamente, con `RESTRICT`: no se puede borrar una fuerza con votos cargados). Pero ese mismo principio no se sostiene del otro lado: borrar la `mesa` (o el `comicio` completo) sí cascadea y destruye físicamente esos mismos votos, sin protección.
- **Impacto:** El sistema impide perder los votos por un camino pero permite perderlos por el otro — borrado físico e irreversible de resultados de votación ya cargados, simplemente borrando la mesa o el comicio contenedor.
- **Sugerencia de solución:** Aplicar el mismo criterio en la otra dirección: `mesas.comicio_id` y `votos_fuerza.mesa_id`/`votos_lista.mesa_id` a `ON DELETE RESTRICT` (al menos condicionalmente cuando la mesa tenga votos cargados), forzando un borrado explícito de resultados antes de poder borrar la mesa/comicio.

---

### DB-010 — Posible uso del rol superusuario (`postgres`) de Supabase para la conexión de la app

- **Categoría:** Seguridad
- **Severidad:** Alta (incertidumbre: no se pudo confirmar sin acceso al panel de Supabase)
- **Ubicación:** `.env.example:10` (`DATABASE_URL=postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`)
- **Descripción:** El patrón `postgres.<ref>` es el formato por defecto que Supabase entrega para el usuario `postgres` (owner/superusuario del proyecto) vía el Transaction Pooler, salvo que se haya creado explícitamente un rol de aplicación acotado. No hay en el código ni en las migraciones ninguna creación de rol propio (`CREATE ROLE`, `GRANT` acotado) ni RLS en ninguna de las 16 migraciones.
- **Impacto:** Si en producción se usa efectivamente el rol `postgres`, cualquier fuga de `DATABASE_URL` (log, error mal serializado, variable de entorno expuesta) da acceso total de lectura/escritura/DDL a toda la base del proyecto, sin ninguna barrera de defensa en profundidad a nivel de motor.
- **Sugerencia de solución:** Verificar en Supabase → Database → Roles cuál es el rol que efectivamente usa `DATABASE_URL` en Render; si es `postgres`, crear un rol de aplicación con GRANT explícito sólo sobre los schemas `padron`/`elecciones` y las tablas de `auth` que necesita.

---

### DB-011 — Falta índice compuesto `(apellido, nombre, dni)` sobre `padron.votantes` (confirma BE-029)

- **Categoría:** Performance
- **Severidad:** Media
- **Ubicación:** `padron/migrations/002_indices_busqueda.sql:9-10` (sólo `idx_votantes_apellido_nombre (apellido, nombre)`, dos columnas)
- **Descripción:** El módulo comicio calcula rangos de mesa ordenando `padron.votantes` por `(apellido, nombre, dni)` para desempatar apellido+nombre repetidos de forma determinística, pero el único índice compuesto existente es de dos columnas. Postgres puede usar el índice para el `ORDER BY` de apellido+nombre pero necesita un paso adicional para desempatar por DNI en filas con apellido+nombre duplicados.
- **Impacto:** Bajo con ~5.500 filas; podría degradarse si el padrón crece.
- **Sugerencia de solución:** Si comicio depende de ese orden exacto para calcular rangos de mesa, agregar `CREATE INDEX idx_votantes_apellido_nombre_dni ON padron.votantes (apellido, nombre, dni)`.

---

### DB-012 — Índice redundante: `idx_votantes_apellido` subsumido por `idx_votantes_apellido_nombre`

- **Categoría:** Performance
- **Severidad:** Media
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:41` vs. `002_indices_busqueda.sql:9-10`
- **Descripción:** Cualquier consulta que use `apellido` solo (o como prefijo) puede resolverse con el índice compuesto; el índice de una sola columna no aporta nada adicional.
- **Impacto:** Overhead de escritura duplicado (dos índices B-tree a mantener en cada INSERT/UPDATE de votantes, que ocurre en cada importación) sin beneficio de lectura.
- **Sugerencia de solución:** `DROP INDEX padron.idx_votantes_apellido` en una migración nueva.

---

### DB-013 — Falta `CHECK` de rango en `anio_nac`/`edad`

- **Categoría:** Diseño / Constraints
- **Severidad:** Media
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:10` (`anio_nac`, sin CHECK), `:17` (`edad`, sin CHECK) — contrastar con `sexo`, que sí tiene `CHECK (sexo IN ('M','F'))` en la misma tabla (línea 16)
- **Descripción:** No hay ningún `CHECK` que impida `anio_nac` fuera de un rango razonable ni `edad` negativa o absurda, a diferencia de `sexo` en la misma tabla.
- **Impacto:** Un error de importación (columna corrida, parseo mal hecho) puede insertar valores absurdos sin que la base los rechace.
- **Sugerencia de solución:** `CHECK (anio_nac BETWEEN 1900 AND EXTRACT(YEAR FROM now()))` y `CHECK (edad IS NULL OR edad BETWEEN 0 AND 130)`.

---

### DB-014 — `actualizado_por` sin FK a usuarios, decisión no documentada explícitamente en el esquema

- **Categoría:** Diseño
- **Severidad:** Media (mitigada por ser decisión consciente, ver descripción)
- **Ubicación:** `padron/migrations/003_autoria_relevamientos.sql:16-18` (`actualizado_por INTEGER`, sin `REFERENCES`)
- **Descripción:** La propia migración documenta que la ausencia de FK es deliberada para evitar un JOIN entre esquemas (`padron` y `auth`) en el camino caliente del listado — decisión consciente, no accidental. Pero no hay ningún control a nivel de base de que `actualizado_por` corresponda a un usuario real: un bug de aplicación (pasar un id de sesión en vez de un id de usuario) insertaría un entero cualquiera sin que Postgres lo rechace.
- **Impacto:** Bajo mientras el código sea correcto; si falla, la corrupción de autoría es silenciosa, sensible porque esta atribución es la base de la sesión única y del 409 multiusuario.
- **Sugerencia de solución:** Mantener la desnormalización (está bien justificada), pero agregar un test de integración que verifique periódicamente que todo `actualizado_por` no nulo existe en `auth.usuarios`. No se sugiere agregar la FK real porque rompería la razón de ser de la migración.

---

### DB-015 — `email` sin `UNIQUE` en `usuarios`

- **Categoría:** Diseño
- **Severidad:** Media (incertidumbre: no se confirmó si el negocio requiere email único)
- **Ubicación:** `auth/migrations/001_esquema_auth.sql:36` (`email VARCHAR(100)`, nullable, sin UNIQUE) — contrastar con `username`, que sí tiene `UNIQUE NOT NULL` (línea 33)
- **Descripción:** Nada impide dos usuarios con el mismo email.
- **Impacto:** Si en el futuro el email se usa para reseteo de contraseña o notificaciones, un duplicado puede enviar el reset de una cuenta a otra.
- **Sugerencia de solución:** Si el negocio requiere email único, `CREATE UNIQUE INDEX ... ON usuarios (LOWER(email)) WHERE email IS NOT NULL` (permite múltiples NULL, no duplicados reales).

---

### DB-016 — `auditoria.usuario_id` sin Foreign Key a `usuarios`, con efecto colateral positivo no documentado

- **Categoría:** Diseño
- **Severidad:** Media
- **Ubicación:** `auditoria/migrations/001_esquema_auditoria.sql:11` (`usuario_id VARCHAR(50)`, sin `REFERENCES`)
- **Descripción:** Probablemente intencional (la tabla vive en `padron` y audita entidades de varios módulos con `entidad_id` polimórfico), con un efecto colateral positivo real: al no haber FK, un `DELETE` sobre `usuarios` nunca puede arrastrar (CASCADE) registros de auditoría — el rastro sobrevive aunque se borre la cuenta. Pero es una garantía accidental, no documentada como decisión de diseño.
- **Impacto:** Bajo en integridad, pero sin FK tampoco hay validación de que el `usuario_id` insertado exista o haya existido.
- **Sugerencia de solución:** Agregar comentario en la migración documentando la decisión ("sin FK a propósito, para que un DELETE de usuarios nunca borre auditoría en cascada").

---

### DB-017 — Falta de índices compuestos para los filtros combinados de auditoría

- **Categoría:** Performance
- **Severidad:** Media (crece con el volumen)
- **Ubicación:** `auditoria/migrations/001_esquema_auditoria.sql:24-28` (sólo índices de una columna); filtros combinados en `auditoria/repository.js:45-65`
- **Descripción:** Postgres puede resolver los filtros combinados (`usuario_id + fecha_desde + fecha_hasta`, `entidad + fechas`) con bitmap AND de los índices simples existentes, razonable hasta cierto volumen. Un índice compuesto `(usuario_id, created_at DESC)` o `(entidad, created_at DESC)` sería más directo para el patrón de paginación ordenada por fecha.
- **Impacto:** Hoy probablemente no se nota (tabla chica), pero puede degradar en un día de elección con alto volumen de escrituras y consultas de estadísticas en vivo.
- **Sugerencia de solución:** Agregar índices compuestos según los filtros reales que use el frontend de auditoría, cuando se conozca el patrón de uso real.

---

### DB-018 — `usuarios.rol_id` nullable sin `NOT NULL`

- **Categoría:** Diseño
- **Severidad:** Media
- **Ubicación:** `auth/migrations/001_esquema_auth.sql:37` (`rol_id INTEGER REFERENCES roles(id)`, sin `NOT NULL`, sin `ON DELETE` explícito)
- **Descripción:** La capa de servicio siempre resuelve un `rolId` válido antes de insertar, pero el esquema no lo garantiza: un INSERT directo (script de mantenimiento, seed futuro) puede dejar un usuario sin rol, con `permisos = []` — un usuario "fantasma" autenticable pero sin ningún permiso, en vez de un error explícito al crearlo.
- **Impacto:** Bajo mientras todo el código pase por `users.service.js`.
- **Sugerencia de solución:** Si la regla de negocio es "todo usuario tiene rol", agregar `NOT NULL` (con backfill si hace falta) y decidir explícitamente el `ON DELETE` de esa FK.

---

### DB-019 — Sin `ON DELETE` explícito de `mesas` hacia `padron.votantes`

- **Categoría:** Diseño / Bug potencial
- **Severidad:** Media
- **Ubicación:** `comicio/migrations/001_esquema_comicio.sql:27-28` (`padron_desde_dni`/`padron_hasta_dni REFERENCES padron.votantes(dni)`, sin `ON DELETE`, default `NO ACTION`)
- **Descripción:** Si en algún momento el módulo padrón permite borrar un votante y ese DNI es límite de una mesa, el DELETE en padrón fallará con un error de FK que el módulo padrón desconoce — acoplamiento cruzado entre schemas no evidente desde donde falla.
- **Impacto:** Error operativo confuso al intentar depurar el padrón, con motivo real no evidente desde el módulo que falla.
- **Sugerencia de solución:** Declarar `ON DELETE RESTRICT` explícito (mismo efecto, más legible) y documentar el acoplamiento en el esquema de padrón.

---

### DB-020 — `color` de fuerza sin `CHECK` a nivel de esquema

- **Categoría:** Diseño
- **Severidad:** Media
- **Ubicación:** `comicio/migrations/003_color_fuerza.sql:8` (`color SMALLINT NOT NULL DEFAULT 1`, sin CHECK; dominio 1-8 documentado sólo en comentario)
- **Descripción:** A diferencia de `tipo_eleccion` (un VARCHAR abierto donde un CHECK sería más disruptivo), acá el dominio es un rango numérico chico y fijo (1-8) atado 1:1 a tokens CSS fijos — caso típico de `CHECK (color BETWEEN 1 AND 8)`.
- **Impacto:** Un INSERT/UPDATE directo fuera de la capa de servicio puede dejar un color fuera de rango; el frontend probablemente no tiene fallback definido.
- **Sugerencia de solución:** `ALTER TABLE elecciones.fuerzas ADD CONSTRAINT chk_color CHECK (color BETWEEN 1 AND 8);` — costo cero.

---

### DB-021 — Índices redundantes con la PK compuesta en tablas de comicio

- **Categoría:** Performance / Mantenibilidad
- **Severidad:** Media
- **Ubicación:** `comicio/migrations/001_esquema_comicio.sql:41,43` (`idx_comicio_listas_comicio`, `idx_votos_lista_mesa`); `002_fuerzas_y_mesa_opcional.sql:34-35` (`idx_comicio_fuerzas_comicio`, `idx_votos_fuerza_mesa`)
- **Descripción:** Las cuatro tablas ya tienen PK compuesta con esa misma columna como primer componente. Un índice compuesto ya sirve como índice de soporte para filtros por el prefijo, así que estos 4 índices adicionales son idénticos en cobertura de lectura al índice de la PK y sólo agregan mantenimiento en cada INSERT/DELETE.
- **Impacto:** Bajo hoy (tablas chicas), trabajo de escritura duplicado sin ganancia.
- **Sugerencia de solución:** Eliminarlos en una migración nueva, o documentar por qué se mantienen si hay una razón no evidente en el código. (`idx_mesas_comicio`, `idx_fiscal_asignaciones_mesa`/`_fiscal` NO son redundantes — esas tablas tienen PK simple.)

---

### DB-022 — Mismo patrón de `CASCADE` en `fiscal_asignaciones` también por el lado `mesa_id`

- **Categoría:** Diseño
- **Severidad:** Media
- **Ubicación:** `fiscales/migrations/001_esquema_fiscales.sql:17` (`mesa_id ... ON DELETE CASCADE`)
- **Descripción:** `BACKLOG-BACKEND.md` (BE-027) reportó que borrar un fiscal con asignaciones activas cascadea su calendario sin aviso (lado `fiscal_id`). El mismo mecanismo existe, sin reportar hasta ahora, del lado `mesa_id`: borrar una mesa borra también silenciosamente todo el historial de fiscalización de esa mesa.
- **Impacto:** Pérdida de historial de quién fiscalizó dónde, sin registro, simétrico al hallazgo ya conocido del lado fiscal.
- **Sugerencia de solución:** Evaluar `RESTRICT` (forzar liberar/reasignar antes de poder borrar la mesa) o un soft-delete en vez de DELETE físico para `mesas` y `fiscales`.

---

### DB-023 — Sin columnas de auditoría temporal (`created_at`/`updated_at`) en las tablas mutables del núcleo electoral

- **Categoría:** Mantenibilidad / Diseño
- **Severidad:** Media
- **Ubicación:** `elecciones.mesas`, `votos_lista`, `votos_fuerza`, `comicio_listas`, `comicio_fuerzas`, `fiscal_asignaciones` — ninguna tiene `created_at`/`updated_at`, a diferencia de `comicios`, `fuerzas` y `fiscales`
- **Descripción:** Los votos se sobrescriben vía `reemplazarVotos` (DELETE + INSERT) sin dejar rastro temporal a nivel de esquema de cuándo se cargó o modificó por última vez un resultado.
- **Impacto:** Dificulta reconstruir la secuencia temporal de carga de resultados directamente desde el esquema sin depender de que el módulo de auditoría haya loggeado correctamente ese evento puntual.
- **Sugerencia de solución:** Agregar `updated_at TIMESTAMPTZ` al menos en `mesas` y `fiscal_asignaciones`, consistente con el patrón ya usado en `comicios`/`fuerzas`/`fiscales`.

---

### DB-024 — Enums de dominio (`tipo_eleccion`) sin `CHECK` en el schema `elecciones`

- **Categoría:** Diseño
- **Severidad:** Media
- **Ubicación:** `elecciones.listas.tipo_eleccion` (`listas/migrations/001_esquema_listas.sql:12`), `elecciones.comicios.tipo_eleccion` (`comicio/migrations/001_esquema_comicio.sql:13`)
- **Descripción:** `tipo_eleccion` es `VARCHAR(20) NOT NULL` sin CHECK, a diferencia de `padron.relevamientos.opcion_politica`, que sí tiene `CHECK (opcion_politica IN ('PJ','UCR','Indeciso'))`. La decisión está documentada como consistente en `003_color_fuerza.sql`, pero es una inconsistencia real frente a `padron`.
- **Impacto:** Un INSERT directo o una migración de datos futura puede dejar un `tipo_eleccion` inválido sin que la base lo impida.
- **Sugerencia de solución:** Agregar CHECK explícito si el dominio es fijo y conocido; si es exploratorio, dejar constancia explícita de que es deuda aceptada.

---

### DB-025 — Sin `CHECK` de no-negatividad en `votos_blancos`/`votos_nulos` de mesas (referencia cruzada con BE-050)

- **Categoría:** Diseño
- **Severidad:** Media
- **Ubicación:** `elecciones.mesas.votos_blancos`, `votos_nulos` (`comicio/migrations/001_esquema_comicio.sql:29-30`)
- **Descripción:** Son `INTEGER` nullable sin `CHECK (... >= 0)`, mientras que `votos_lista.cantidad`/`votos_fuerza.cantidad` sí tienen `CHECK (cantidad >= 0)` en el mismo módulo. Ya reportado en `BACKLOG-BACKEND.md` (BE-050) como inconsistencia de aplicación; se reafirma aquí como hallazgo de diseño de esquema.
- **Impacto:** Un valor negativo rompería cualquier total o porcentaje de participación calculado sobre esa mesa, sin que la base lo prevenga.
- **Sugerencia de solución:** `CHECK (votos_blancos >= 0)` y `CHECK (votos_nulos >= 0)`.

---

### DB-026 — Scripts SQL viejos con seeds de credenciales fijas, vivos en un worktree/branch local no releaseado

- **Categoría:** Seguridad
- **Severidad:** Media
- **Ubicación:** `microservicios.worktrees/copilot-worktree-2026-03-08T17-18-54/scripts/{crear-usuarios-ejemplo.sql, datos-prueba-detalle.sql, extend-db-detalle-votante.sql, fix-permisos-table.sql, init-db.sql, init-roles-completo.sql}` y `services/padron-service/src/database/*.sql`
- **Descripción:** Scripts DDL/seed de la arquitectura de microservicios vieja (pre-refactor), en un git worktree separado apuntando a una branch local no releaseada. No son un dump de datos reales, pero corresponden al patrón viejo de contraseñas fijas conocidas (admin/admin123).
- **Impacto:** La branch activa (`refactor/monolito-modular`) no los usa, pero existe el riesgo de que alguien corra un script a mano contra producción por error, o que la branch se mergee sin revisión.
- **Sugerencia de solución:** Confirmar si esa branch/worktree sigue siendo necesaria; si no, eliminarla antes del release.

---

### DB-027 — Índice `idx_relevamientos_fecha` sin uso visible en el código

- **Categoría:** Performance / Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:45`
- **Descripción:** Ninguna consulta en `repository.js` filtra ni ordena por `fecha_relevamiento`; los índices realmente usados para "qué cambió" son `fecha_modificacion`/`fecha_detalle` (`003_autoria_relevamientos.sql`).
- **Impacto:** Overhead de escritura sin beneficio de lectura detectable en este módulo (podría usarse en otro módulo fuera de este alcance).
- **Sugerencia de solución:** Confirmar con `pg_stat_user_indexes` en producción antes de eliminarlo.

---

### DB-028 — Índice sobre `sexo`, columna de baja cardinalidad

- **Categoría:** Performance
- **Severidad:** Baja
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:43` (`idx_votantes_sexo`)
- **Descripción:** `sexo` tiene sólo dos valores posibles; el beneficio de un índice B-tree sobre una columna binaria es marginal frente a un seq scan filtrado en una tabla de ~5.500 filas.
- **Sugerencia de solución:** Sin acción urgente; reevaluar si el padrón crece un orden de magnitud.

---

### DB-029 — Inconsistencia de `DEFAULT` entre `observacion` y `observaciones_detalle`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:28` (`observacion TEXT`, sin DEFAULT) vs. `:35` (`observaciones_detalle TEXT DEFAULT ''`)
- **Descripción:** Dos columnas de texto libre conceptualmente similares tienen defaults distintos a nivel de columna. No genera bug porque toda escritura pasa por `COALESCE` explícito en el código, pero es un default "muerto" que puede confundir a quien lea el esquema sin el código.
- **Sugerencia de solución:** Unificar criterio y documentar con `COMMENT ON COLUMN`.

---

### DB-030 — Ausencia total de `COMMENT ON TABLE/COLUMN` en las 16 migraciones

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** Todas las migraciones de los 5 módulos + auditoria
- **Descripción:** Hay comentarios SQL (`--`) extensos y buenos en los archivos de migración explicando decisiones no triviales (por qué `version` es INTEGER y no timestamp, la desnormalización de `actualizado_por_username`, la diferencia entre `fecha_modificacion` y `fecha_detalle`), pero ninguno usa `COMMENT ON COLUMN`/`COMMENT ON TABLE`, que Postgres persiste como metadata consultable desde herramientas de introspección (`\d+`, pgAdmin, Supabase Studio).
- **Impacto:** Cualquiera que explore el esquema desde una herramienta de BD (no desde el repo) pierde todo ese contexto de diseño, incluyendo alguien de guardia investigando un incidente sin el código a mano.
- **Sugerencia de solución:** Agregar `COMMENT ON COLUMN` para las columnas más importantes mencionadas explícitamente en los comentarios (`version`, `actualizado_por`, `fuerzas.color`, `mesas.padron_desde_dni/hasta_dni`) en una migración de documentación pura.

---

### DB-031 — `circuito` como texto libre sin normalizar a tabla de referencia

- **Categoría:** Diseño
- **Severidad:** Baja (incertidumbre: probablemente intencional dado el volumen y que el dato es de importación)
- **Ubicación:** `padron/migrations/001_esquema_padron.sql:15` (`circuito VARCHAR(50)`, sin FK ni tabla `circuitos`)
- **Descripción:** `circuito` se repite como texto libre en cada fila de `votantes`. `circuitosDisponibles()` hace `SELECT DISTINCT` para poblar un combo, sugiriendo un conjunto limitado y estable — candidato típico a normalizar. El dato llega por importación masiva, no carga manual, así que el riesgo de inconsistencia por typo es menor.
- **Impacto:** Bajo hoy; si comicio/fiscales dependen de matchear `circuito` textualmente contra otra tabla, un typo importado rompería ese join silenciosamente.
- **Sugerencia de solución:** No urgente; evaluar una FK a `elecciones.circuitos` si en el futuro se necesita ese match exacto.

---

### DB-032 — Tablas puente sin PK surrogate en `elecciones` vs. patrón con PK surrogate en `auth`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `elecciones.comicio_listas`, `votos_lista`, `comicio_fuerzas`, `votos_fuerza` (PK compuesta directa) vs. `auth.rol_permisos` (`SERIAL id` + `UNIQUE(rol_id, permiso_id)`)
- **Descripción:** Ambos patrones son válidos en Postgres, pero es una inconsistencia real entre dos módulos para el mismo tipo de tabla (relación N:M). En `rol_permisos`, el `id` surrogate no aporta valor semántico — nada en `repository.js` lo referencia.
- **Impacto:** Ninguno funcional; dificulta tener una regla única de "cómo se hace una tabla puente en este proyecto".
- **Sugerencia de solución:** No vale la pena migrar tablas ya en producción sólo por esto; fijar un criterio único en `docs/AGREGAR-MODULO.md` para módulos nuevos (recomendado: PK compuesta sin surrogate cuando la tabla no necesita ser referenciada por FK de terceros).

---

### DB-033 — Vocabulario libre en `operacion`/`entidad` de auditoría, sin `CHECK` ni tabla de referencia

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `auditoria/migrations/001_esquema_auditoria.sql:14-15` (`operacion VARCHAR(50) NOT NULL`, `entidad VARCHAR(50) NOT NULL`, sin CHECK ni FK a catálogo)
- **Descripción:** Los valores usados hoy son consistentes por convención de código, pero nada impide que otro módulo escriba una variante (minúscula, sinónimo) y fragmente sin querer las agregaciones de `estadisticas()` (`GROUP BY operacion`).
- **Impacto:** Bajo pero acumulativo — problema típico de "estadísticas que no cierran" por typos silenciosos, difícil de detectar hasta que alguien audita los números.
- **Sugerencia de solución:** `CHECK (operacion = UPPER(operacion))` liviano, o normalizar en el repository antes de insertar.
- **Nota:** un `CHECK` de mayúsculas se probó y se descartó. El vocabulario real es mixto (`operacion` en mayúsculas, `entidad` en minúscula) y el `CHECK` rechazaría los eventos de casi todos los módulos. Sigue abierto: si se quiere fijar el vocabulario, va con tabla de catálogo y migración de datos.

---

### DB-034 — `active_sessions.last_activity` sin índice, usado con filtro de rango

- **Categoría:** Performance
- **Severidad:** Baja
- **Ubicación:** `auditoria/repository.js:148-156` (`usuariosActivos`, `WHERE last_activity >= NOW() - interval`); `active_sessions` sólo tiene `user_id PRIMARY KEY`
- **Descripción:** En teoría un full scan de esta tabla es barato porque tiene a lo sumo una fila por usuario con sesión activa (sesión única).
- **Impacto:** Bajo hoy, crece linealmente con la cantidad de usuarios, no con el volumen histórico.
- **Sugerencia de solución:** No actuar salvo que el número de usuarios crezca mucho; si se quiere ser prolijo, `CREATE INDEX ON active_sessions(last_activity)`.

---

### DB-035 — Falta de índice de soporte para el lado no-líder de FKs con `RESTRICT`

- **Categoría:** Performance
- **Severidad:** Baja
- **Ubicación:** `comicio_listas.lista_id`, `votos_lista.lista_id`, `comicio_fuerzas.fuerza_id`, `votos_fuerza.fuerza_id` — todas segunda columna de su PK compuesta
- **Descripción:** Cuando Postgres borra una fila de `listas`/`fuerzas` y esas FKs son `ON DELETE RESTRICT`, verifica si existe alguna fila referenciándola; como esa columna es la segunda componente de una PK compuesta, esa verificación no puede usar el índice de la PK y hace seq scan.
- **Impacto:** Bajo mientras el volumen sea chico.
- **Sugerencia de solución:** Si se nota lentitud al borrar una `lista`/`fuerza`, agregar índices dedicados.

---

### DB-036 — Sin `UNIQUE` que impida dos `fuerzas` con el mismo nombre en el mismo comicio

- **Categoría:** Diseño
- **Severidad:** Baja-Media (incertidumbre: no se verificó si el service ya lo valida en aplicación)
- **Ubicación:** `comicio/migrations/002_fuerzas_y_mesa_opcional.sql:13-19` (`fuerzas`, tabla global sin unicidad de `nombre`), `:21-25` (`comicio_fuerzas`, la PK compuesta sólo evita vincular la misma fila dos veces)
- **Descripción:** Nada impide crear dos filas `fuerzas` con `nombre='PJ'` y vincular ambas al mismo comicio.
- **Impacto:** Boleta/resultados con dos "PJ" en el mismo comicio, sin que la base lo impida.
- **Sugerencia de solución:** Si el modelo de "fuerza global reutilizable" es intencional, considerar un trigger que valide no-duplicado-de-nombre por comicio (no expresable como constraint simple entre dos tablas).

---

### DB-037 — `mesas.numero` sin `CHECK > 0`, `fiscales.dni` sin `UNIQUE`

- **Categoría:** Diseño
- **Severidad:** Baja
- **Ubicación:** `comicio/migrations/001_esquema_comicio.sql:26` (`numero INTEGER NOT NULL`, sin CHECK); `fiscales/migrations/001_esquema_fiscales.sql:10` (`dni VARCHAR(20)`, nullable, sin UNIQUE)
- **Descripción:** `numero` de mesa admite 0 o negativos a nivel de esquema. `fiscales.dni` no tiene UNIQUE, permitiendo cargar al mismo fiscal (misma persona) dos veces como registros distintos, lo cual además podría eludir la validación de solapamiento de horario (DB-008) tratando a la misma persona como dos fiscales.
- **Sugerencia de solución:** `CHECK (numero > 0)` en `mesas`; `UNIQUE (dni)` en `fiscales` (Postgres permite múltiples NULL bajo UNIQUE, o un índice único parcial `WHERE dni IS NOT NULL` si se permite cargar sin DNI inicialmente).

---

### DB-038 — Ventana horaria de fiscalización (`08:00`-`18:00`) hardcodeada como `CHECK`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `fiscales/migrations/001_esquema_fiscales.sql:21`
- **Descripción:** El CHECK ya cubre correctamente `hasta > desde` además de acotar la franja legal de votación (punto positivo). Si la ley electoral cambia el horario de votación entre elecciones, esta migración ya aplicada no se edita (regla del repo) — habría que agregar una migración nueva con `DROP CONSTRAINT`/`ADD CONSTRAINT`, y el CHECK es global a la tabla, no por comicio.
- **Impacto:** Bajo hoy; riesgo latente si el horario cambia entre comicios de distintos años.
- **Sugerencia de solución:** Ninguna acción inmediata; dejar nota para cuando haga falta soportar horarios distintos por comicio.

---

### DB-039 — `cantidad_lugares` y `orden` sin cota inferior a nivel de constraint en Listas

- **Categoría:** Diseño
- **Severidad:** Baja
- **Ubicación:** `elecciones.listas.cantidad_lugares`, `elecciones.candidatos.orden`, `elecciones.suplentes.orden` (`listas/migrations/001_esquema_listas.sql`, `003_suplentes_notas.sql`)
- **Descripción:** No hay `CHECK (cantidad_lugares > 0)` ni `CHECK (orden > 0)`. Complementa lo ya reportado como validación sólo en código (tope de candidatos vs. `cantidad_lugares`).
- **Impacto:** Datos incoherentes silenciosos si algún camino de escritura futuro no pasa por el service actual.
- **Sugerencia de solución:** `CHECK (cantidad_lugares > 0)`, `CHECK (orden > 0)` en ambas tablas de orden.

---

### DB-040 — Tablas obsoletas `comicio_listas`/`votos_lista` no eliminadas

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `elecciones.comicio_listas`, `elecciones.votos_lista` (`comicio/migrations/001_esquema_comicio.sql`), reemplazadas por `comicio_fuerzas`/`votos_fuerza` en `002_fuerzas_y_mesa_opcional.sql`
- **Descripción:** Ya reconocido en el propio comentario de la migración 002 ("Quedan sin uso"); no hay DROP posterior.
- **Impacto:** Esquema con tablas muertas que puede confundir a un desarrollador nuevo con el modelo vigente; el `RESTRICT` de sus FKs hacia `listas` sigue activo y podría bloquear un DELETE sin motivo aparente.
- **Sugerencia de solución:** Migración de limpieza que haga `DROP TABLE` de ambas si se confirma que siguen sin filas antes del release.

---

### DB-041 — Nomenclatura inconsistente para columnas que referencian a un usuario

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `auth.refresh_tokens.user_id`, `auth.active_sessions.user_id` (inglés) vs. `padron.auditoria.usuario_id` (español, sufijo estándar) vs. `padron.relevamientos.actualizado_por` (español, sin sufijo `_id`)
- **Descripción:** Tres convenciones de nombre distintas para "referencia a un usuario" conviven en el mismo sistema.
- **Impacto:** Puramente de mantenibilidad/legibilidad; dificulta grep/búsquedas cruzadas.
- **Sugerencia de solución:** No migrar columnas existentes por esto solo; documentar la convención elegida (español, sufijo `_id`) en `docs/AGREGAR-MODULO.md` para módulos nuevos.

---

### DB-042 — Dos convenciones de timestamp dentro del mismo módulo `padron`

- **Categoría:** Mantenibilidad
- **Severidad:** Baja
- **Ubicación:** `padron.votantes` (`created_at`/`updated_at`) vs. `padron.relevamientos` (`fecha_relevamiento`/`fecha_modificacion`/`fecha_detalle`) — ambas en el mismo archivo de migración
- **Descripción:** Mismo módulo, mismo archivo, dos vocabularios distintos para "cuándo se creó/modificó una fila".
- **Impacto:** Bajo; son campos con semántica de negocio propia, no timestamps técnicos genéricos.
- **Sugerencia de solución:** Ninguna acción retroactiva necesaria; dejarlo documentado como decisión, no como deuda.

---

### DB-043 — Sin Row Level Security habilitado en ninguna tabla

- **Categoría:** Seguridad
- **Severidad:** Informativo / confirmación (potencialmente Alta si cambia el supuesto de acceso)
- **Ubicación:** Todas las migraciones (ningún `ENABLE ROW LEVEL SECURITY` ni `CREATE POLICY`)
- **Descripción:** Coherente con que la app usa `pg` con SQL crudo (no PostgREST/Supabase client) — RLS no es la primera línea de defensa esperada en este patrón, pero tampoco hay ninguna. Todo el control de acceso a datos sensibles (DNI, teléfono, observaciones, flags políticamente delicados) es responsabilidad exclusiva de la capa de aplicación.
- **Impacto:** Mientras el único camino de acceso sea la API Node (que sí autentica), el riesgo es el que ya asume el diseño general. Se vuelve Alto si en algún momento se habilita la API REST autogenerada de Supabase sobre estos schemas, o se otorgan credenciales de sólo-lectura a un tercero pensando que "no importa no tener RLS".
- **Sugerencia de solución:** No es necesariamente un cambio requerido ahora, pero conviene un `COMMENT ON SCHEMA padron IS '...'` explícito documentando que el control de acceso vive en la API, para que quien administre Supabase en el futuro no asuma protección a nivel de base antes de exponer el schema por otra vía.

---

## Resumen ordenado por severidad

| ID | Título | Categoría | Severidad |
|---|---|---|---|
| DB-001 | Backup sin cifrar con PII y hashes en carpeta sincronizada a la nube | Seguridad | **Crítica** |
| DB-002 | Refresh token guardado en texto plano | Seguridad | **Crítica** |
| DB-003 | Tabla de auditoría sin protección real contra UPDATE/DELETE | Seguridad/Diseño | **Crítica** |
| DB-004 | `TIMESTAMP` sin timezone inconsistente entre módulos viejos y nuevos | Diseño/Tipos | Alta |
| DB-005 | `edad` estática en `padron.votantes` se desactualiza | Diseño | Alta |
| DB-006 | FK relevamientos→votantes con CASCADE puede borrar trabajo de campo | Bug/Diseño | Alta |
| DB-007 | Rango de mesa depende de columna mutable de otra tabla | Diseño | Alta |
| DB-008 | `fiscal_asignaciones` admite EXCLUDE constraint que resuelve TOCTOU de raíz | Diseño | Alta |
| DB-009 | Inconsistencia: fuerza protegida (RESTRICT) pero mesa/comicio permiten borrar votos | Diseño | Alta |
| DB-010 | Posible uso de rol superusuario de Supabase para conexión de la app | Seguridad | Alta |
| DB-011 | Falta índice compuesto `(apellido, nombre, dni)` en `padron.votantes` | Performance | Media |
| DB-012 | Índice redundante `idx_votantes_apellido` | Performance | Media |
| DB-013 | Falta CHECK de rango en `anio_nac`/`edad` | Diseño | Media |
| DB-014 | `actualizado_por` sin FK, decisión no documentada en esquema | Diseño | Media |
| DB-015 | `email` sin UNIQUE en `usuarios` | Diseño | Media |
| DB-016 | `auditoria.usuario_id` sin FK, efecto positivo no documentado | Diseño | Media |
| DB-017 | Falta índices compuestos para filtros combinados de auditoría | Performance | Media |
| DB-018 | `usuarios.rol_id` nullable sin NOT NULL | Diseño | Media |
| DB-019 | Sin ON DELETE explícito mesas→votantes | Diseño/Bug potencial | Media |
| DB-020 | `color` de fuerza sin CHECK a nivel de esquema | Diseño | Media |
| DB-021 | Índices redundantes con PK compuesta en tablas de comicio | Performance/Mantenibilidad | Media |
| DB-022 | Mismo patrón CASCADE en fiscal_asignaciones por `mesa_id` | Diseño | Media |
| DB-023 | Sin `created_at`/`updated_at` en tablas núcleo electoral | Mantenibilidad/Diseño | Media |
| DB-024 | Enums de dominio sin CHECK en schema `elecciones` | Diseño | Media |
| DB-025 | Sin CHECK no-negatividad en `votos_blancos`/`votos_nulos` | Diseño | Media |
| DB-026 | Scripts SQL viejos con credenciales fijas en worktree no releaseado | Seguridad | Media |
| DB-027 | Índice `idx_relevamientos_fecha` sin uso visible | Performance/Mantenibilidad | Baja |
| DB-028 | Índice sobre `sexo`, baja cardinalidad | Performance | Baja |
| DB-029 | Inconsistencia de DEFAULT entre `observacion`/`observaciones_detalle` | Mantenibilidad | Baja |
| DB-030 | Ausencia total de `COMMENT ON` en el esquema | Mantenibilidad | Baja |
| DB-031 | `circuito` sin normalizar a tabla de referencia | Diseño | Baja |
| DB-032 | Tablas puente sin PK surrogate vs. patrón con surrogate en auth | Mantenibilidad | Baja |
| DB-033 | Vocabulario libre en `operacion`/`entidad` sin CHECK | Mantenibilidad | Baja |
| DB-034 | `active_sessions.last_activity` sin índice | Performance | Baja |
| DB-035 | Falta índice de soporte para lado no-líder de FKs RESTRICT | Performance | Baja |
| DB-036 | Sin UNIQUE que impida fuerzas duplicadas por nombre en un comicio | Diseño | Baja |
| DB-037 | `mesas.numero` sin CHECK > 0, `fiscales.dni` sin UNIQUE | Diseño | Baja |
| DB-038 | Ventana horaria de fiscalización hardcodeada como CHECK | Mantenibilidad | Baja |
| DB-039 | `cantidad_lugares`/`orden` sin cota inferior en Listas | Diseño | Baja |
| DB-040 | Tablas obsoletas `comicio_listas`/`votos_lista` no eliminadas | Mantenibilidad | Baja |
| DB-041 | Nomenclatura inconsistente para columnas de referencia a usuario | Mantenibilidad | Baja |
| DB-042 | Dos convenciones de timestamp dentro del módulo padron | Mantenibilidad | Baja |
| DB-043 | Sin Row Level Security habilitado en ninguna tabla | Seguridad | Informativo |

**Totales:** 3 Crítica · 7 Alta · 16 Media · 16 Baja · 1 Informativo = **43 hallazgos**
