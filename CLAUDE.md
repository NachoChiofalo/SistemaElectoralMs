# Sistema Electoral — guía para trabajar en este repo

Monolito modular en Node 20. Un proceso sirve la API y el frontend. La base es
PostgreSQL en **Supabase** y no se cambia.

Antes esto eran microservicios (`gateway-service`, `auth-service`, `padron-service` y
un contenedor con `serve` para el frontend). Si encontrás documentación, ramas o
comentarios que hablen de puertos 3001/3002/8080 separados, están desactualizados.

---

## Reglas que no se rompen

**No tocar el frontend para cambiar el backend.** `public/` consume `/api/*` con
`window.location.origin`. Si un cambio de servidor obliga a editar `public/`, el cambio
está mal planteado. La excepción es una feature nueva que necesite UI nueva.

**Un solo pool de PostgreSQL.** Se recibe por inyección (`db` en `register`). Nunca
`new Pool()`. La versión anterior tenía ocho instancias de `Database`, cada una con su
pool: hasta 120 conexiones potenciales contra Supabase.

**`process.env` solo se lee en `core/config.js`.** El resto usa `config`.

**Los errores se lanzan, no se responden.** `errores.*` de `core/errors` + `asyncHandler`.
Nada de `res.status(500).json(...)` dentro de un handler.

**El esquema se cambia con migraciones, y toda migración tiene que ser idempotente**
(`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Verificado: `npm run migrate` corrido
directo contra una base con las tablas y datos del sistema viejo no tocó lo existente
y sembró lo que faltaba. Eso es lo que permite no usar `migrate:adopt` — que existe
pero es más arriesgado, porque salta migraciones enteras sin ejecutarlas. Una
migración aplicada no se edita: se agrega la siguiente.

**Toda ruta de datos exige token.** Los módulos declaran `requiresAuth: true` y el
factory lo aplica a todo el router, para que una ruta nueva nazca protegida.

---

## Mapa

| Necesitás… | Está en |
|---|---|
| Config y validación de entorno | `src/core/config.js` |
| El pool y los helpers de SQL | `src/core/db.js` |
| Login, tokens, sesión única, inactividad | `src/core/security/` |
| Middlewares de autenticación y permisos | `src/core/security/authorize.js` |
| Montaje de la app y de los módulos | `src/core/app.js` |
| La lista de módulos | `src/modules/index.js` |
| Registro de auditoría | `src/modules/auditoria/` |
| Usuarios, roles, permisos | `src/modules/auth/` |
| Votantes, relevamientos, resultados | `src/modules/padron/` |
| Importación por COPY | `src/modules/padron/importer.js` |
| Exportación en streaming | `src/modules/padron/exporter.js` |

Cada módulo sigue el mismo corte: `routes` (HTTP) → `service` (reglas) → `repository`
(SQL). `routes` no escribe SQL; `repository` no conoce `req`/`res`.

---

## Comandos

```bash
npm run dev              # con --watch
npm test                 # 55 tests, no necesitan base
npm run migrate:status   # qué está aplicado
npm run migrate          # aplicar pendientes
npm run seed:usuarios    # crear el administrador
```

---

## Dónde está el rendimiento

El sistema corre en un servidor chico. Tres cosas cargan con casi todo el ahorro; antes
de tocarlas, entender por qué son como son.

**`core/security/sessions.js`.** Antes cada request protegido hacía un salto HTTP al
auth-service más cuatro consultas (blacklist, sesión activa, `UPDATE last_activity`,
usuario). Ahora es `jwt.verify` en proceso más una caché en memoria, y `last_activity`
se persiste con write-behind. En el caso típico, autenticarse no toca la base.

La caché es local al proceso, y eso es lo que la hace correcta: login, logout, cambio de
rol y desactivación la invalidan de forma exacta e inmediata. **Con más de una
instancia, esto necesita Redis.** Es el supuesto que sostiene el diseño.

**`modules/padron/importer.js`.** El importador viejo hacía
`.on('data', async fila => await insertar(fila))`: sin pausar el stream, lanzaba miles
de INSERT en paralelo. Ahora es COPY a una tabla temporal con backpressure real. No
volver a insertar fila por fila.

**`modules/padron/service.js` → `CacheResultados`.** Los cinco endpoints de
`resultados/*` agregan sobre todo el padrón. Se cachean 60 s y **toda escritura de
relevamiento invalida el caché** — si agregás una escritura, invalidá.

---

## Contrato de la API

`scripts/api-snapshot.js` releva la forma de las respuestas y compara contra una línea
de base. Correrlo antes y después de cualquier cambio que toque rutas:

```bash
node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before.json
```

---

## Deuda conocida

- El listado de votantes pagina con `OFFSET`. Con el padrón actual (~5.500 filas) no
  molesta; si crece mucho, conviene keyset — pero eso cambia el contrato de paginación
  que consume el frontend. El exportador ya usa keyset.
- `public/` es JS plano sin build. Es una decisión, no un olvido: no hay que
  compilarlo ni servirlo aparte.
- Quedan páginas sin backend: `fiscales.html` y `comicio.html`. Sus permisos ya están
  en la migración de auth.
- Sin tests de integración contra una base real. Los 55 tests corren sin PostgreSQL;
  lo que toca la base se verifica con el snapshot de contrato.

---

## Agregar un módulo

[docs/AGREGAR-MODULO.md](docs/AGREGAR-MODULO.md). Carpeta nueva con `module.js` y una
línea en `src/modules/index.js`. El orden de esa lista importa: un módulo solo ve los
servicios de los que están antes.
