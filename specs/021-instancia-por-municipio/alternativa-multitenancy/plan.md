# 021 — Plan

> **Alternativa descartada por ahora.** La decisión vigente es [una instancia aislada por municipio](../spec.md); este diseño se retoma si se cumple alguna condición de "Cuándo reabrir esta decisión" de esa spec.

Cómo se implementa [la spec](spec.md). Cada fase se puede desplegar sola y deja el sistema
funcionando para el único tenant actual. **Hasta la fase 5 no hay un segundo municipio en
producción**: todo lo anterior es preparar el terreno sin cambio visible.

## Enfoque

**Base compartida, esquema compartido, columna `tenant_id` en cada tabla de negocio.**
Aislamiento por consulta (`WHERE tenant_id = $n`) como mecanismo primario, probado por tests;
Row Level Security como red de seguridad opcional en la fase 6, solo si se mide que cabe en
el presupuesto de rendimiento.

El tenant sale de la sesión que ya se cachea (`core/security/sessions.js`), por lo que no
suma ninguna consulta por request. Los repositorios reciben `tenantId` como primer parámetro
explícito: no hay estado oculto ni "tenant actual" global, porque un global en un proceso
Node con requests concurrentes es exactamente la forma de filtrar datos entre tenants.

## Diseño

### 1. Modelo

```
tenants(id, slug UNIQUE, nombre, activo, config JSONB, created_at)
usuarios.tenant_id  → tenants(id)   NULL solo para rol 'superadmin'
```

`config` guarda lo chico y de lectura frecuente (nombre visible, `tipos_eleccion`, color);
las **opciones políticas** son filas, no JSON (se relacionan con `relevamientos`):

```
tenant_opciones_politicas(tenant_id, codigo, etiqueta, color, orden, es_neutra, PRIMARY KEY (tenant_id, codigo))
```

`es_neutra` reemplaza al valor mágico `'Indeciso'` (el default de un relevamiento nuevo).

Un usuario pertenece a un tenant. Si más adelante hace falta que uno trabaje en varios, se
agrega `usuario_tenants(usuario_id, tenant_id)` y el login elige uno: el resto del sistema,
que consume `req.user.tenantId`, no cambia. Por eso `tenantId` en la sesión es un solo valor
y no una lista.

### 2. Qué tabla lleva qué

| Tabla | `tenant_id` | Clave nueva |
|---|---|---|
| `padron.votantes` | sí | PK `(tenant_id, dni)` |
| `padron.relevamientos` | sí | `UNIQUE (tenant_id, dni)`; FK compuesta a votantes |
| `padron.auditoria` | sí | — (índice `(tenant_id, fecha DESC)`) |
| `elecciones.comicios`, `fuerzas`, `listas`, `fiscales` | sí (raíces) | `UNIQUE` existentes se prefijan con `tenant_id` si dependen de un nombre |
| `elecciones.mesas`, `candidatos`, `suplentes`, `fiscal_asignaciones`, `votos_*`, `comicio_*` | sí, **denormalizado** | FK compuesta `(tenant_id, padre_id)` |
| `usuarios` | sí | username sigue único global (D2) |
| `refresh_tokens`, `active_sessions`, `token_blacklist` | no | cuelgan de `usuario_id`/`jti`; el tenant se deriva del usuario |
| `roles`, `permisos`, `rol_permisos` | no (catálogo global) | — |

La denormalización en las tablas hijas es deliberada: permite que una FK compuesta
`(tenant_id, mesa_id) → mesas(tenant_id, id)` haga **imposible a nivel motor** que un hijo
de A apunte a un padre de B. Es el único modo de cumplir el criterio de "no puedo crear una
asignación con un `fiscal_id` de B" sin depender de que cada servicio se acuerde de validarlo.
Para los pocos casos donde el hijo es siempre accedido a través del padre ya validado, se
puede omitir la columna; la decisión se documenta tabla por tabla en la migración.

Las restricciones `EXCLUDE` de `fiscales` (solapamiento por mesa y por fiscal) no cambian: se
expresan sobre `mesa_id`/`fiscal_id`, que son globalmente únicos.

### 3. Índices y rendimiento

Todo índice de búsqueda/listado pasa a empezar por `tenant_id`:
`idx_votantes_apellido` → `(tenant_id, apellido)`, el índice de orden del listado de
`padron/005` → `(tenant_id, apellido, nombre, dni)`, los parciales de `relevamientos`
→ `(tenant_id) WHERE …`. Con un solo tenant el costo es una columna constante; con varios,
es lo que impide que un listado de A recorra filas de B.

La vista `padron.estadisticas_condiciones_especiales` desaparece como vista y pasa a ser una
consulta parametrizada en el repositorio (una vista no puede recibir `tenant_id`).

Verificación: `EXPLAIN (ANALYZE, BUFFERS)` de las cinco consultas pesadas (listado paginado,
búsqueda por apellido, estadísticas, rangos etarios, resultados) antes y después, sobre un
dataset de prueba con **tres tenants de 50.000 votantes** (generado en el Postgres
descartable, nunca en producción).

### 4. Aislamiento: cómo se evita el olvido humano

Un `WHERE tenant_id` olvidado es el error típico de multitenancy y no lo atrapa ningún test
de camino feliz. Tres defensas, de más barata a más cara:

1. **Firma obligatoria.** Todo método de repositorio de una tabla con tenant recibe
   `tenantId` como primer argumento; no hay sobrecarga sin él.
2. **Test de cobertura de rutas.** Un test levanta la app con dos tenants y recorre el
   catálogo de rutas de los módulos: para cada ruta con `:id`, el usuario de A recibe 404 con
   el id de un recurso de B; para cada listado, ningún dato de B aparece. Como recorre las
   rutas registradas y no una lista a mano, una ruta nueva queda cubierta sola.
3. **Test estático de SQL.** Falla si un archivo `repository.js` contiene `FROM`/`JOIN`/`UPDATE`/
   `DELETE` sobre una tabla con tenant sin que la sentencia mencione `tenant_id` (con una
   lista de excepciones explícitas y comentadas, p. ej. el importador que opera sobre la tabla
   temporal). Es una heurística y se dice así; atrapa el olvido, no la intención maliciosa.
4. (Fase 6, opcional) **RLS** como red final.

Los errores entre tenants responden **404**, no 403.

### 5. Sesión y autenticación

- `jwt.firmar` agrega el claim `tid`. Se usa solo como pista y para logs; **la autoridad es la
  fila de `usuarios`** leída en `SQL_ESTADO_SESION`, que ya trae el usuario con su rol y que
  pasa a traer `tenant_id` y `tenants.activo`. Un tenant desactivado cierra todas sus
  sesiones dentro del TTL de la caché (30 s por defecto).
- `req.user` gana `tenantId`. `requirePermission`/`requireRol` no cambian.
- Un nuevo middleware `requireTenant` (aplicado por el factory de módulos a todo router con
  `requiresAuth`) rechaza con 403 a quien no tiene tenant (el `superadmin`) en rutas de datos
  de negocio, para que esa clase de usuario no caiga en consultas con `tenant_id = NULL`.
- Rate limit del login: la clave sigue siendo `username` + IP. Se agrega un tope por tenant
  para las exportaciones y las importaciones (recurso caro compartido).

### 6. Importador y exportador

El importador usa `COPY` a `tmp_import_votantes` y luego `INSERT … ON CONFLICT`. Cambios:
la tabla temporal gana `tenant_id`, el `ON CONFLICT` pasa a `(tenant_id, dni)` y el advisory
lock pasa de una constante a `pg_advisory_lock(LOCK_IMPORTACION, tenant_id)`, para que la
importación de A no espere a la de B. El exportador filtra por tenant en el `WHERE` del
cursor. Ambos tienen un test con dos tenants que importa un CSV con DNIs coincidentes.

### 7. Compatibilidad durante el despliegue (expand / contract)

**Es el riesgo operativo central.** Las migraciones se corren a mano **antes** del deploy,
así que entre `npm run migrate` y que Render sirva el código nuevo hay una ventana en la que
el código **viejo** corre contra el esquema **nuevo**. Cada migración tiene que ser compatible
con el código de la fase anterior:

- Fase 1 (expand): agrega `tenant_id` con `DEFAULT 1`, crea los `UNIQUE (tenant_id, …)` **al
  lado** de las claves viejas, no en reemplazo. El código viejo no menciona `tenant_id`, el
  `DEFAULT` lo completa y `ON CONFLICT (dni)` sigue teniendo su índice único.
- Fase 2 (código): el código nuevo ya escribe `tenant_id` y usa `ON CONFLICT (tenant_id, dni)`,
  que existe desde la fase 1. Por eso el código nuevo puede desplegarse **sin** otra migración.
- Fase 3 (contract): recién con el código nuevo estable en producción se quitan las claves
  viejas, se pasa a PK compuesta, se repuntan las FK y se saca el `DEFAULT 1`.

Si se hiciera todo en una migración, el `ON CONFLICT (dni)` del código viejo dejaría de
tener índice y el upsert de relevamientos —la operación más frecuente— devolvería 500 durante
la ventana.

Las FK nuevas van `NOT VALID` y se validan después (`VALIDATE CONSTRAINT`) para no tomar
locks largos; con 5.518 filas es instantáneo, pero la migración se escribe para el caso grande.

---

## Fases

El orden no es negociable hasta la fase 3. Los tamaños son relativos (S ≤ 1 día, M 2–3 días,
L ≥ una semana de trabajo concentrado).

### Fase 0 — Decisiones y relevamiento · S

- Responder D1–D6 de la spec.
- Inventario exhaustivo: por cada `repository.js`, cada consulta que toca tabla con tenant
  (hay ~1.640 líneas de repositorios; es revisable de una vez). Sale una tabla en
  `inventario.md` con archivo, método, tabla, y qué cambia. Es la lista de trabajo de la fase 2.
- Auditar qué del frontend nombra `PJ`/`UCR` o asume un único municipio
  (`ComicioComponent`, `PadronComponent`, `ResultadosComponent`, `dashboard.js`) y qué
  textos dicen el nombre del municipio.
- **Se verifica con:** spec aprobada y `inventario.md` revisado.

### Fase 1 — Expandir el esquema (sin cambio de comportamiento) · M

Migraciones nuevas, idempotentes, compatibles con el código actual:

1. `core/001_tenants.sql` (módulo nuevo `tenants`): tabla `tenants`, inserta el tenant #1
   (`slug`/`nombre` a confirmar), `tenant_opciones_politicas` con `PJ`/`UCR`/`Indeciso`.
2. Por módulo: `tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id)` en cada tabla
   de la tabla de la sección 2 (en `NOT VALID` + `VALIDATE`), los `UNIQUE (tenant_id, …)`
   nuevos al lado de los viejos, y los índices con prefijo `tenant_id` (los viejos se
   conservan hasta la fase 3).
3. `usuarios.tenant_id` (DEFAULT 1) y el rol `superadmin`.

**Backfill:** `ADD COLUMN … DEFAULT 1` en PG ≥ 11 no reescribe la tabla. Sin `UPDATE` masivo.
La migración sigue tocando datos existentes de forma lógica, así que **se confirma con la
persona, se hace backup y se corre `migrate:status` antes**, como pide `CLAUDE.md`.

- **Preflight:** extender `scripts/preflight-migraciones.js` (solo lectura): conteo de filas
  por tabla, huérfanos que impedirían las FK compuestas (hijos cuyo padre no existe), `tenant_id`
  inexistente.
- **Se verifica con:** el procedimiento ya usado en 003/005: Postgres descartable en Docker,
  esquema desde `HEAD` + datos sucios, correr las migraciones nuevas, y correr **la suite
  actual sin modificar** (es la prueba de que el código viejo sigue funcionando). 273/273.

### Fase 2 — Código con tenant (un solo tenant en producción) · L

1. `core/security`: claim `tid`, `tenantId` en `SQL_ESTADO_SESION`, `req.user.tenantId`,
   `requireTenant`.
2. Repositorios: `tenantId` como primer parámetro en todos los métodos del inventario. Un módulo
   por commit, en este orden de riesgo creciente: `listas` → `fiscales` → `comicio` →
   `auditoria` → `auth` → `padron` (el más grande: 508 líneas, búsqueda dinámica, estadísticas,
   importer/exporter).
3. Servicios y rutas: propagan `req.user.tenantId`. Cualquier id recibido del cliente se
   resuelve **dentro** del tenant; si no aparece, 404.
4. Validaciones cruzadas explícitas donde la FK compuesta aún no existe (se cierran en fase 3):
   un `padron_desde_dni`, un `lista_id` o un `fiscal_id` recibidos en el cuerpo se comprueban
   contra el tenant antes de escribir.
5. Reemplazar la vista de estadísticas por la consulta parametrizada.
6. **Tests de aislamiento** (sección 4, defensas 2 y 3) con dos tenants fixture.
7. Logs: todo log de request incluye `tenantId`; la auditoría escribe `tenant_id`.

Despliegue: sin migración nueva. Es el primer cambio visible solo para el equipo.

- **Se verifica con:** `npm test` completo + los tests de aislamiento, `EXPLAIN` de las cinco
  consultas pesadas contra la línea base, y la verificación manual en producción con el único
  tenant (login, relevar, importar un CSV chico, exportar, comicio).

### Fase 3 — Contraer el esquema · M

Con la fase 2 estable en producción:

- PK compuesta `(tenant_id, dni)` en `votantes`; FK compuestas desde `relevamientos`,
  `mesas.padron_desde_dni/hasta_dni`, `candidatos`/`fiscales` con DNI, y `(tenant_id, X_id)`
  desde todos los hijos.
- Se eliminan las claves viejas redundantes y los índices sin prefijo.
- `ALTER COLUMN tenant_id DROP DEFAULT` en todas: desde acá, olvidar el tenant en un `INSERT`
  es un error en voz alta, no un dato en el tenant equivocado.
- **Preflight de la contracción:** ningún hijo apunta a un padre de otro `tenant_id`. En una
  base de un solo tenant es trivialmente cierto; se escribe igual porque es el chequeo que
  protege la próxima vez.

### Fase 4 — Configuración por tenant · M

- Quitar `CHECK (opcion_politica IN (…))` (migración nueva) y reemplazarlo por FK compuesta a
  `tenant_opciones_politicas`.
- Endpoint de configuración del tenant (opciones políticas, tipos de elección, nombre) y
  mantenimiento por el administrador del tenant.
- Frontend: las opciones políticas se leen de la API en vez de estar en los componentes; el
  nombre del tenant en el encabezado. Colores de cada opción salen de tokens `--ds-*` del
  design system (no se introducen `#hex`).
- Cuidado: cambiar las etiquetas de opciones con relevamientos existentes. El `codigo` es
  estable; la `etiqueta` es lo editable.

### Fase 5 — Alta de tenants y segundo municipio · M

- `npm run tenant:crear -- --slug … --nombre … --admin …`: crea el tenant, copia las opciones
  por defecto y crea el usuario administrador con una contraseña inicial de un solo uso.
- Rol `superadmin` y sus pocas rutas: alta/baja/listado de tenants, restablecer el admin de
  un tenant. Sin acceso a datos de negocio (D4).
- Importación del padrón del segundo municipio **en Postgres descartable primero**, con
  `EXPLAIN` sobre el volumen real.
- Piloto controlado: segundo tenant cargado, un usuario de prueba de cada uno, y la prueba de
  fuga manual ("intento ver lo del otro por cada pantalla").
- **Capacidad:** estimar tamaño por tenant (votantes + relevamientos + auditoría) contra el
  límite del plan actual de Supabase y el pool (`config.db.max`). Es el número que decide si
  hace falta mover de plan antes del tercer municipio.

### Fase 6 — Defensa en profundidad (opcional, condicionada a medición) · M

- RLS no sirve con el rol actual: en Supabase el rol `postgres` tiene `BYPASSRLS`, así que las
  políticas se ignorarían. Hace falta un rol de aplicación sin ese atributo y que cada
  transacción haga `SET LOCAL ROLE` + `set_config('app.tenant_id', …)`.
- Eso obliga a que **cada** consulta corra dentro de una transacción, lo que suma viajes de ida y
  vuelta por request. Contradice el principio de rendimiento primero, por lo que solo se
  implementa si (a) la medición muestra costo despreciable, o (b) un cliente lo exige por
  contrato. La alternativa liviana es mantener las defensas 1–3 y sumar un test por cada hallazgo.

### Fase 7 — Operación · S, continua

- Backup y restauración **por tenant** (exportar un tenant a SQL/CSV), probado una vez.
- Métricas y errores filtrables por `tenantId`.
- Procedimiento de baja de un tenant (D5) documentado.
- `CLAUDE.md`: regla nueva ("todo dato de negocio lleva `tenant_id`; los repositorios lo reciben
  primero; un id del cliente se resuelve dentro del tenant") y el mapa; `docs/AGREGAR-MODULO.md`
  y `specs/_plantilla` actualizados para que un módulo futuro nazca multitenant.

---

## Archivos que se tocan

| Área | Archivos |
|---|---|
| Esquema | migraciones nuevas en cada módulo + módulo nuevo `src/modules/tenants/` |
| Núcleo | `core/security/jwt.js`, `sessions.js`, `authorize.js`, `core/app.js` (factory de módulos), `core/errors.js` |
| Repositorios | los seis `repository.js` (~1.640 líneas) |
| Servicios/rutas | `*/service.js`, `*/routes.js`; `padron/importer.js`, `padron/exporter.js` |
| Auth | `auth/users.service.js` (alta con tenant), `auth/module.js` (permisos de `superadmin`) |
| Frontend | solo fase 4: los 4 archivos con `PJ`/`UCR` y el encabezado |
| Scripts | `preflight-migraciones.js`, nuevo `scripts/crear-tenant.js` |
| Tests | `test/migraciones.test.js`, nuevo `test/aislamiento.test.js`, fixtures de dos tenants |
| Docs | `CLAUDE.md`, `docs/AGREGAR-MODULO.md`, `docs/BACKLOG.md`, `specs/_plantilla` |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Una consulta olvida `tenant_id` y filtra datos | Firma obligatoria + test de rutas con dos tenants + test estático de SQL. Es el riesgo que justifica toda la fase 2. |
| Ventana código viejo / esquema nuevo | Expand/contract (sección 7). Cada migración se prueba corriendo la suite **vieja** contra el esquema nuevo. |
| Migración que toca datos reales sin staging | Backup + preflight + confirmación expresa antes de `npm run migrate`, como ya se hizo con las anteriores. |
| Cambio de PK de `votantes` con muchas FK | Fase 3 separada y chequeada con preflight de huérfanos; se prueba en el Postgres descartable con datos sucios. |
| Regresión de rendimiento | Índices con prefijo `tenant_id`; `EXPLAIN` antes/después; tenant desde la sesión cacheada (0 consultas extra). |
| Caché de sesión con tenant viejo tras mover un usuario | TTL de 30 s y la base como autoridad; cambiar de tenant a un usuario invalida su entrada en caché explícitamente. |
| Un `superadmin` con `tenant_id NULL` cae en una consulta de negocio | `requireTenant` y un `CHECK` que obliga `tenant_id` no nulo salvo para ese rol. |
| Dato sensible expuesto entre municipios | Es el motivo de las tres defensas; revisión legal previa al segundo cliente (spec). |

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| **Base de datos por tenant** | Un `Pool` por tenant rompe la regla de un solo pool (120 conexiones potenciales ya fue un problema); Supabase se cobra por proyecto; migraciones × N. Tiene sentido solo si un cliente exige aislamiento físico por contrato, y entonces es un despliegue aparte, no multitenancy. |
| **Schema por tenant** | Las migraciones corren N veces y hay que registrar cuáles aplicaron en cada schema; `search_path` por conexión choca con un pool compartido y con el pooler de Supabase en modo transacción; el runner actual (`core/migrations.js`) asume un solo conjunto. Se gana aislamiento a costa de operación. |
| **RLS como mecanismo primario** | Requiere rol sin `BYPASSRLS` y `SET LOCAL` en cada transacción: más viajes por request y el rol de Supabase lo ignora. Queda como fase 6 condicionada. |
| **Tenant por subdominio desde el inicio** | Obliga a DNS, certificados y a que el frontend sepa el origen; el plan free de Render no sirve comodines. Es aditivo: el día que haga falta, se resuelve el tenant por `Host` y se **valida** contra el del usuario. |
| **Tenant en el cuerpo/URL de cada request** | El cliente elige su propio tenant: la fuga pasa a depender de un chequeo por endpoint. El tenant viene de la sesión, nunca de un parámetro. |
| **Variable global "tenant actual"** (AsyncLocalStorage implícito) | Una omisión silenciosa usa el tenant de otro request o ninguno. El parámetro explícito falla a la vista. |

## Cómo se verifica el conjunto

1. `docker run` del Postgres descartable (ver `CLAUDE.md`), luego
   `DATABASE_URL_TEST=… npm test` — la suite completa más `test/aislamiento.test.js`.
2. **Prueba de compatibilidad por fase:** al terminar la fase 1, correr la suite de la fase
   anterior (checkout del commit previo) contra la base migrada. Debe pasar entera.
3. `EXPLAIN (ANALYZE, BUFFERS)` de las cinco consultas pesadas con tres tenants de 50.000
   votantes; comparar con la línea base de hoy.
4. `node scripts/preflight-migraciones.js` en producción antes de cada migración que toque
   datos (solo lectura, lo corre la persona).
5. Verificación manual con dos usuarios de dos tenants: recorrer cada pantalla intentando
   ver, editar, exportar y borrar lo del otro.
6. Revisión del inventario de la fase 0 contra el diff final: cada fila tachada.

## Orden de entrega sugerido

`0 → 1 → 2 → 3` son el núcleo y se hacen seguidos. `4` y `5` abren la puerta al segundo
municipio. `6` y `7` se deciden con datos. Mientras dure `2`, **conviene no empezar 018, 014
ni 020**: cada módulo nuevo escrito antes se revisaría dos veces.
