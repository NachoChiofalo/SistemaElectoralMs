# 021 — Plan

Cómo se implementa [la spec](spec.md). Cada fase se puede desplegar sola y deja la instancia
actual funcionando igual que hoy.

## Enfoque

El aislamiento no se programa: **se hereda de la arquitectura**. Cada municipio es una
instancia (servicio de Render + proyecto de Supabase + variables propias) que corre el mismo
código, así que no hay un `WHERE` que olvidar y no hay fuga posible por consulta.

Entonces el trabajo real son dos cosas:

1. **Que el código deje de ser de un municipio**: las opciones políticas pasan de estar
   escritas en el esquema y en la UI a ser datos de la instancia. Es el único cambio de negocio.
2. **Que operar N instancias sea seguro**: una instancia `demo` que sirva de staging, un
   inventario, y scripts que impidan migrar la base equivocada o dejar una desactualizada.

El orden está pensado para ganar **staging antes de tocar el esquema**: hoy no hay donde
probar una migración que no sea la base real, y este plan incluye una migración con datos.

## Diseño

### 1. Opciones políticas como datos

```
padron.opciones_politicas(
  codigo    VARCHAR(20) PRIMARY KEY,        -- estable; es lo que guarda relevamientos.opcion_politica
  etiqueta  VARCHAR(50) NOT NULL,           -- lo que se muestra; editable
  color     SMALLINT NOT NULL CHECK (color BETWEEN 1 AND 8),  -- índice a token --ds-*, como elecciones.fuerzas
  orden     SMALLINT NOT NULL,
  es_neutra BOOLEAN NOT NULL DEFAULT FALSE  -- reemplaza al valor mágico 'Indeciso'
)
-- exactamente una neutra:
CREATE UNIQUE INDEX … ON padron.opciones_politicas (es_neutra) WHERE es_neutra;
```

- `relevamientos.opcion_politica` pasa de `CHECK (… IN ('PJ','UCR','Indeciso'))` a
  `FOREIGN KEY → opciones_politicas(codigo) ON DELETE RESTRICT`. Borrar una opción con
  relevamientos es un 409 ("tiene datos asociados"), que `core/errors.js` ya mapea.
- La migración **siembra `PJ`, `UCR` e `Indeciso`**: es lo que necesita la instancia actual
  y lo que escribe el código viejo durante la ventana entre migrar y desplegar. Una instancia
  nueva se configura después con `scripts/configurar-opciones.js`, que reemplaza el juego
  completo y se niega a hacerlo si hay relevamientos que quedarían huérfanos.
- El default de un relevamiento nuevo (`COALESCE($2, 'Indeciso')` en `upsertRelevamiento`)
  pasa a ser la opción `es_neutra`.
- **Caché en memoria** de la tabla (es chica, se lee en cada validación y en cada
  estadística). Un solo proceso por instancia, así que se invalida exacto al escribir; no suma
  consultas por request. Mismo razonamiento que la caché de sesión (`core/security/sessions.js`).

### 2. Estadísticas genéricas

Hoy cada estadística es una fila con columnas fijas (`votos_pj`, `votos_ucr`, `empleados_pj`,
`ayuda_social_ucr`…, unas veinte en `padron/repository.js:24-28, 356-357, 463-476`). Pasan a
devolver **filas por opción** (`GROUP BY opcion_politica`) y el servicio arma la forma que
consume el frontend. Mismo escaneo de la tabla, mismo costo: es el mismo agregado con otra
forma.

Contrato, **aditivo** durante la transición:

```json
{ "por_opcion": [{ "codigo": "PJ", "etiqueta": "PJ", "color": 1, "total": 120, "porcentaje": 40.0 }, …],
  "votos_pj": 120, "votos_ucr": 90 }       // legados, solo mientras exista la instancia actual y el FE no migró
```

Los campos legados se calculan desde `por_opcion` para los códigos `PJ`/`UCR` y se quitan en
la fase 3.

### 3. Frontend

`GET /api/padron/opciones` (autenticado, cacheable) entrega las opciones. Los componentes
construyen selectores, columnas, barras y leyendas desde esa lista en vez de literales:

- `PadronComponent.js:175-176, 1111`: `<option>` y lista de opciones.
- `ResultadosComponent.js`: ~35 puntos (tarjetas, barras, tablas, gráficos, CSV).
- `pages/dashboard.js:309-320`: las píldoras de intención de voto.

Los colores salen de tokens `--ds-opcion-N` (N=1…8) definidos en `design-system.css` con su
variante oscura. **Se reutiliza la paleta que ya existe para `elecciones.fuerzas.color`**
(`comicio/003`, `comicio/006`) si sirve; si no, se definen. Nunca un `#hex`: hay un test que
lo prohíbe. La fase 0 verifica qué colores usa hoy `PJ`/`UCR` para que la instancia actual no
cambie de aspecto.

### 4. Identidad de instancia

- `MUNICIPIO_NOMBRE` en `core/config.js` (único lugar donde se lee `process.env`).
- `GET /api/instancia` **público** (hace falta antes del login) devuelve `{ nombre }` y nada
  más: ni versión ni datos de la base. Cacheable.
- El frontend lo pide una vez y lo pone en el encabezado y en el `<title>`. Si falla o no está
  configurado, se muestra solo "ÁGORA". Esto es lo que evita cargar datos en el municipio
  equivocado cuando hay dos pestañas abiertas.

### 5. Operar varias instancias

**Inventario, `instancias.json`** (versionado, sin secretos):

```json
[{ "slug": "demo", "nombre": "Demo", "render": "agora-demo", "supabase": "abcd1234",
   "url": "https://…", "rol": "staging", "jwtFingerprint": "9f2c1a7e" }]
```

**Secretos, `.instancias.env`** (en `.gitignore`, solo en tu máquina):
`DATABASE_URL__DEMO=…`, `DATABASE_URL__MUNICIPIO_A=…`. Nunca en el repo ni en el chat.

**`scripts/instancias.js`**, que envuelve a los scripts existentes (no los reescribe: llama
a `scripts/migrate.js` y a `scripts/preflight-migraciones.js` con `DATABASE_URL` apuntando a
la instancia elegida):

| Comando | Qué hace |
|---|---|
| `status` | Para **todas**: migraciones aplicadas / pendientes. Solo lectura. Marca `jwtFingerprint` repetidos. |
| `preflight <slug>` | El preflight de siempre, sobre esa base. |
| `migrate <slug>` | Muestra el estado y el host de la base, y pide **escribir el slug** para confirmar. Una instancia por vez; no existe `--all`. |

La decisión de no tener "migrar todas" es deliberada: el error que este diseño tiene que
evitar es aplicar una migración a la base equivocada, o a todas antes de haberla visto
funcionar en una. Cuesta unos segundos por instancia.

**Instancia `demo` = staging y también demo comercial.** Con datos ficticios y sin ninguna
persona real, sirve para mostrarle el sistema a un partido que todavía no compró, sin exponer
el padrón de otro cliente. Nunca se carga ahí un dato real.

**Instancia `demo` = staging.** Un proyecto de Supabase y un servicio de Render con datos
ficticios (el seed ya existe: `npm run seed:usuarios -- --ejemplos`, más un CSV de padrón
generado). Toda migración se aplica primero ahí, se corre la suite y se prueba en el
navegador; recién entonces va a los municipios reales. Resuelve la restricción actual de
`CLAUDE.md` ("no hay staging").

**Actualizar todas las instancias** (reemplaza el orden de `CLAUDE.md`, que asume una):

1. `instancias.js status` → ver qué migraciones faltan en cada una.
2. Backup de cada base real.
3. `instancias.js migrate demo` → probar en la demo.
4. `instancias.js migrate <cada municipio>`, de a una, con la confirmación.
5. `git push`. Render redespliega **todas**.
6. Verificar `/health` y un login en cada una.

Si algún servicio arranca con migraciones pendientes **se niega a levantar** y sigue sirviendo
la versión anterior (comportamiento de `src/server.js` ya comprobado): olvidarse una
instancia no rompe nada, queda desactualizada hasta que se la migre y se le haga *Manual
Deploy*. Para despliegues de mayor riesgo, se desactiva el auto-deploy de las reales y se
despliega la demo primero.

**Alta de un municipio** (runbook en `docs/INSTANCIAS.md`):

1. Proyecto nuevo de Supabase; copiar la conexión del *session pooler* (puerto 5432).
2. Servicio nuevo de Render desde el **mismo repo y la misma rama**, con `NODE_ENV=production`,
   `DATABASE_URL`, un `JWT_SECRET` **nuevo** (`openssl rand -base64 48`), `MUNICIPIO_NOMBRE`,
   `TRUST_PROXY`, y el dominio.
3. Agregar la base a `.instancias.env` y la instancia a `instancias.json` (con el
   fingerprint del secreto).
4. `instancias.js migrate <slug>`.
5. `scripts/configurar-opciones.js` con los partidos del municipio.
6. `npm run seed:usuarios` contra esa base → administrador con contraseña aleatoria, que se
   entrega por un canal seguro y se cambia en el primer ingreso.
7. Importar el padrón por la pantalla de siempre.
8. Humo: login, relevar un votante, resultados, exportar.
9. Backup programado y registro de la fecha de la última prueba de restauración.

---

## Fases

El orden es el de ejecución, no el de numeración.

### Fase 0 — Decisiones e inventario · S

- Responder D1–D6 de la spec.
- Inventario cerrado de `PJ`/`UCR` en `src/` y `public/src/` (`grep` ya hecho una vez: ~60
  apariciones en 7 archivos; se deja como tabla archivo→línea→qué hacer en `inventario.md`).
- Línea base: `scripts/api-snapshot.js` de los endpoints de estadísticas y de resultados
  sobre la instancia actual, guardada para comparar después de cada fase.
- Qué colores usan hoy `PJ`/`UCR` en los gráficos (`COLORES.pj`/`COLORES.ucr`).
- **Se verifica con:** spec aprobada, `inventario.md` y snapshot guardados.

### Fase 1 — Staging y herramientas de operación · M

Primero, porque la fase 2 incluye una migración que conviene probar en una base real.

- Crear la instancia `demo` (Supabase + Render) por el runbook; **cada paso que no se pueda
  hacer desde acá lo hacés vos**, yo escribo los scripts y la guía.
- `instancias.json`, `.instancias.env` (+ `.gitignore`), `scripts/instancias.js`
  (`status`/`preflight`/`migrate`), con tests de la parte pura (parseo del manifiesto,
  detección de fingerprints repetidos, rechazo de slug inexistente).
- `docs/INSTANCIAS.md` con el runbook de alta y de actualización.
- **Se verifica con:** `status` en dos instancias (la real y la demo) y un alta completa de
  la demo siguiendo solo el runbook.

### Fase 2 — Opciones políticas en el backend (aditivo) · M

1. Migración `padron/009_opciones_politicas.sql`: crea la tabla, siembra las tres, reemplaza
   el `CHECK` por la FK (`NOT VALID` y luego `VALIDATE`). El `CHECK` de una columna sin nombre
   explícito tiene un nombre autogenerado; la migración lo busca en `pg_constraint` en vez de
   asumirlo. Idempotente: si ya hay FK y no hay `CHECK`, no hace nada.
2. Repositorio y servicio: `OpcionesPoliticas` (caché), validación contra la tabla en lugar de
   `OPCIONES_POLITICAS = [...]`, default neutro en el upsert.
3. Estadísticas por `GROUP BY`, con campos legados derivados.
4. `GET /api/padron/opciones`.
5. Tests: dos juegos de opciones (el actual y uno de prueba) recorriendo upsert, estadísticas
   y rangos; la FK y el 409 al borrar; migración idempotente contra el Postgres descartable con
   datos del esquema viejo.
6. **Compatibilidad:** código viejo contra el esquema nuevo (la siembra cubre sus tres
   valores) y la suite anterior corre sin cambios.

**Orden de aplicación:** migración en `demo` → pruebas → migración en la instancia real
(con backup y confirmación: toca el esquema de la tabla más grande) → push.

- **Se verifica con:** `npm test`, comparar el snapshot con la línea base (idéntico en los
  campos existentes), `EXPLAIN (ANALYZE, BUFFERS)` de las tres consultas de estadísticas
  antes y después.

### Fase 3 — Frontend dinámico · M

- `PadronComponent`, `ResultadosComponent`, `dashboard.js`: opciones desde la API.
- Tokens `--ds-opcion-N` claro/oscuro; CSV exportado con columnas dinámicas.
- Se prueba la instancia actual (no debe verse distinta) y la `demo` configurada con partidos
  distintos (no debe aparecer `PJ`/`UCR` en ningún lado).
- `npm run build:assets` (hashes y compresión; hay un test que falla si quedan viejos).
- **Se verifica con:** recorrido manual en las dos instancias, el test de colores del design
  system, y un test que falla si vuelve a aparecer el literal `'PJ'`/`'UCR'` fuera de
  migraciones y comentarios.

### Fase 4 — Contraer el contrato · S

Con el frontend estable en producción: se eliminan los campos legados `votos_pj`/`votos_ucr`
y la constante `OPCIONES_POLITICAS`. Actualizar el snapshot de contrato.

### Fase 5 — Identidad de instancia · S

`MUNICIPIO_NOMBRE`, `GET /api/instancia`, encabezado y `<title>`. Sin cambio de esquema.
Puede hacerse en cualquier momento después de la fase 1; se deja acá para no mezclar con el
refactor de opciones.

### Fase 6 — Configurar una instancia nueva · S

`scripts/configurar-opciones.js` (reemplaza el juego de opciones; se niega si dejaría
relevamientos huérfanos; idempotente). Documentado en el runbook.

### Fase 7 — Segundo municipio · S–M

Alta real por el runbook. Piloto con un usuario del municipio. Prueba de aislamiento manual
(las URLs y cuentas de una instancia no abren la otra) y prueba de restauración de un backup.
Se anota cuánto tardó cada paso: es el dato que alimenta la decisión de "cuándo reabrir".

### Fase 8 — Operación continua · S

- `CLAUDE.md`: reemplazar el orden de despliegue de una instancia por el de varias, y agregar
  la regla "una funcionalidad nunca depende de qué municipio es".
- `docs/AGREGAR-MODULO.md`: cómo configurar un módulo nuevo por instancia.
- Calendario de prueba de restauración.
- Registrar tiempo por release; si supera el umbral de la spec, reabrir multitenancy.

---

## Archivos que se tocan

| Área | Archivos |
|---|---|
| Esquema | `padron/migrations/009_opciones_politicas.sql` |
| Backend | `padron/repository.js`, `padron/service.js`, `padron/routes.js`, `core/config.js`, ruta nueva `/api/instancia` |
| Frontend | `PadronComponent.js`, `ResultadosComponent.js`, `dashboard.js`, `design-system.css`, encabezado común |
| Scripts | nuevo `scripts/instancias.js`, `scripts/configurar-opciones.js`; reutiliza `migrate.js`, `preflight-migraciones.js`, `seed-usuarios.js` |
| Operación | `instancias.json`, `.instancias.env` (ignorado), `.gitignore`, `docs/INSTANCIAS.md` |
| Tests | `test/padron.test.js`, `test/migraciones.test.js`, nuevo `test/instancias.test.js`, test del literal `PJ`/`UCR` |
| Docs | `CLAUDE.md`, `docs/BACKLOG.md`, `docs/AGREGAR-MODULO.md`, `specs/_plantilla` |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Aplicar una migración a la base equivocada | `instancias.js migrate` muestra host y exige escribir el slug; no hay "todas"; la confirmación humana ya es la regla de `CLAUDE.md`. |
| Una instancia queda desactualizada por olvido | `status` las lista todas; el servicio se niega a arrancar con migraciones pendientes (no rompe, solo no actualiza). |
| Una migración con datos sin staging | La instancia `demo` es el staging; la fase 1 va antes de tocar el esquema. |
| Cambio de aspecto o de números en la instancia actual | Snapshot de la fase 0 comparado en las fases 2, 3 y 4. |
| Reutilizar el `JWT_SECRET` entre instancias | El runbook genera uno nuevo; `status` marca fingerprints repetidos; un token firmado en una instancia igual se rechaza si el `jti` no existe en la otra base. |
| Una persona carga datos en el municipio equivocado | Nombre del municipio en cada pantalla (fase 5) y una URL propia por instancia. |
| Rendimiento de las estadísticas | Mismo escaneo con otro agregado; `EXPLAIN` antes/después; opciones en caché de proceso. |
| Costo por instancia | Se decide en D2 antes del alta; el costo es la razón para reabrir la decisión si crece. |
| Backup sin restauración probada | Prueba de restauración en la fase 7, con fecha anotada. |

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Multitenancy con `tenant_id` | Funciona, pero el aislamiento depende de que cada consulta lo respete. Con este dato es el riesgo equivocado. Diseño completo en [alternativa-multitenancy](alternativa-multitenancy/plan.md). |
| Esquema por municipio en una sola base | Mezcla lo peor de los dos mundos: migraciones × N en una base que se cae junta, `search_path` por conexión con un pool compartido, y el aislamiento sigue sin ser físico. |
| Una rama por municipio | Cada arreglo hay que replicarlo N veces y las ramas divergen. Todo lo específico es configuración. |
| Opciones políticas en variables de entorno | Cambiarlas exige redeploy, y la base y su configuración se pueden desincronizar. Son datos de la instancia; viven en su base. |
| "Migrar todas" con un solo comando | Quita la oportunidad de ver una migración funcionar en la demo y en una real antes de la siguiente. |
| Un panel central de administración | Es multitenancy disfrazado: una app que conoce todas las bases. Fuera de alcance. |

## Cómo se verifica el conjunto

1. `DATABASE_URL_TEST=… npm test` contra el Postgres descartable (receta en `CLAUDE.md`);
   incluye la suite con dos juegos de opciones.
2. Snapshot de contrato antes y después de cada fase de la instancia actual.
3. `EXPLAIN (ANALYZE, BUFFERS)` de las consultas de estadísticas, antes y después.
4. Código viejo contra esquema nuevo: la suite del commit anterior pasa contra la base migrada.
5. Recorrido manual en la instancia real y en la `demo` con partidos distintos.
6. `instancias.js status` sin pendientes ni fingerprints repetidos.
7. Alta de punta a punta por el runbook, medida en minutos.

## Orden de entrega sugerido

`0 → 1 → 2 → 3 → 4` es el núcleo (4 puede esperar). `5` y `6` se hacen cuando haya un
municipio concreto por dar de alta, y `7` es ese alta. Mientras se hacen la 2 y la 3
conviene **no empezar 018, 014 ni 020**: tocan el padrón y los resultados, justo lo que se
está reescribiendo.

---

## Estado de la implementación (2026-10-08)

**Hecho, sin desplegar:** fases 2, 3 y 4 de este plan, más la pantalla de configuración. Queda
pendiente la fase 1 (instancia `demo` y herramientas) y lo de despliegue, que se trata aparte.

| Fase | Estado | Qué quedó |
|---|---|---|
| 2 — Backend | ✅ | `padron/009_opciones_politicas.sql`, `padron/opciones.js`, estadísticas por `GROUP BY` con objetos `votos`/`porcentajes`, `GET/POST/PATCH/DELETE /api/padron/opciones-politicas` |
| 3 — Frontend | ✅ | `lib/opciones.js`, padrón, resultados y dashboard dinámicos, clases `op-N` en `design-system.css` |
| 4 — Contraer el contrato | ✅ (adelantada) | Ver abajo: no hubo etapa de campos legados |
| 6 — Configurar una instancia | ✅ (distinta) | Pantalla `configuracion.html` para el administrador, en lugar del script `configurar-opciones.js` |

**Dónde se apartó el código del plan, y por qué:**

- **Sin campos legados.** El plan preveía conservar `votos_pj`/`votos_ucr` durante la transición.
  No hizo falta: backend y frontend viajan en la misma imagen, así que se despliegan juntos. La
  única ventana de compatibilidad real es la de la base (migrar antes del deploy), y esa sí
  está cubierta: la migración siembra `PJ`, `UCR` e `Indeciso`, que es lo que escribe el código viejo.
- **Pantalla en vez de script.** D6 recomendaba que las fijara el desarrollador al dar el alta;
  se pidió poder configurarlas, así que el administrador de cada instancia las edita. El
  `codigo` no se puede cambiar, no se borra la opción neutra ni una con relevamientos.
- **Cambios visibles en la instancia actual** (los únicos): la neutra se llama "Indeciso" en todas
  partes (antes "Indecisos" en tablas y gráficos); las barras del comparador son de color plano
  en lugar de degradado; los porcentajes de las tablas salen con dos decimales (`40.00%`).
  Los colores del azul y el rojo son los mismos: `--ds-fuerza-1/2` valen igual que
  `--ds-party-pj/ucr` en claro y en oscuro.
- **Máximo 10 opciones** por instancia y 8 colores (puede haber dos opciones del mismo color).

**Antes de desplegar** (orden de `CLAUDE.md`): `node scripts/preflight-migraciones.js` (agrega una
línea que bloquea si hubiera un relevamiento con una opción fuera de PJ/UCR/Indeciso), backup,
`npm run migrate`, y recién entonces `git push`. La migración `padron/009` no pierde datos pero
toca el esquema de `padron.relevamientos`. Probada en un Postgres descartable sobre el estado
anterior (CHECK autonombrado y filas con `NULL`): lo elimina, crea la FK validada, y volver a
correrla no pisa la configuración.

**Sin verificar a ojo:** las pantallas nuevas (`configuracion.html`) y las modificadas se
comprobaron por API y por tests, pero **no en un navegador**: la extensión no estaba conectada.
Falta un recorrido manual (padrón, resultados, dashboard con un rol consultor, configuración,
modo oscuro).
