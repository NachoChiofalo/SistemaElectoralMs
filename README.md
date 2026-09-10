# Sistema Electoral

Gestión de padrón electoral, relevamientos, resultados y auditoría.

Un solo proceso Node 20 que sirve la API y el frontend, con módulos enchufables.
La base es PostgreSQL en Supabase.

---

## Arquitectura

```
                    Navegador
                        │
        ┌───────────────▼────────────────┐
        │   Un proceso Node  (:8080)     │
        │                                │
        │   core/     infraestructura    │
        │   modules/  auditoria          │
        │             auth               │
        │             padron             │
        │   public/   web-admin          │
        └───────────────┬────────────────┘
                        │  un pool (max 8)
                ┌───────▼────────┐
                │    Supabase    │
                └────────────────┘
```

`core/` no conoce ningún módulo. Los módulos no se importan entre sí: si uno necesita
algo de otro, lo recibe por el objeto `services` que arma el arranque. Ese límite es lo
que hace barato agregar módulos nuevos — y, si algún día uno tuviera que escalar
aparte, es el punto exacto por donde cortarlo.

### Estructura

```
src/
├── core/
│   ├── config.js         env validado; el arranque aborta si falta algo
│   ├── db.js             el único pool de PostgreSQL
│   ├── logger.js         niveles, JSON en producción, oculta credenciales
│   ├── errors.js         AppError y traducción de códigos de PostgreSQL a HTTP
│   ├── migrations.js     runner de SQL numerado
│   ├── app.js            factory de Express y registro de módulos
│   └── security/
│       ├── jwt.js        firma y verificación, en proceso
│       ├── sessions.js   caché de sesión y write-behind de last_activity
│       └── authorize.js  requireAuth, requirePermission, requireRol
├── modules/
│   ├── index.js          la lista de módulos: agregar uno es sumar una línea
│   ├── auditoria/        transversal: audita auth y padrón
│   ├── auth/             /api/auth y /api/users
│   └── padron/           /api/padron
└── server.js

public/     el web-admin, servido por el mismo proceso
scripts/    migrate, seed de usuarios, snapshot de contrato
test/       node:test, sin base de datos
docs/       AGREGAR-MODULO.md
```

---

## Puesta en marcha

Requisitos: Node 20 o superior y una `DATABASE_URL` de Supabase.

```bash
npm install
cp .env.example .env          # completar DATABASE_URL y JWT_SECRET
npm run migrate
npm run dev
```

En http://localhost:8080.

Para generar un `JWT_SECRET`:

```bash
openssl rand -base64 48
```

### Primer usuario

```bash
npm run seed:usuarios
```

Crea el administrador si todavía no hay ninguno. La contraseña sale de
`ADMIN_PASSWORD` o, si no está definida, se genera y **se muestra una sola vez**.

### Con Docker

```bash
docker compose up app                 # contra Supabase, usando DATABASE_URL
docker compose --profile local up     # con un PostgreSQL en contenedor
```

---

## Comandos

| | |
|---|---|
| `npm start` | Arranca en producción |
| `npm run dev` | Arranca con recarga automática |
| `npm test` | Tests (no necesitan base) |
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run migrate:status` | Muestra qué está aplicado y qué falta |
| `npm run migrate:adopt` | Marca las migraciones como aplicadas **sin ejecutarlas** |
| `npm run seed:usuarios` | Crea el administrador si no existe |
| `npm run snapshot` | Releva el contrato de la API |

---

## Migraciones

El esquema ya no se crea en cada arranque. Cada módulo trae `migrations/` con archivos
`.sql` numerados que corren una vez y quedan registrados en `public.schema_migrations`.

Si hay migraciones pendientes, **el proceso no arranca**: prefiere fallar visiblemente
antes que servir contra un esquema desactualizado.

### Primera vez contra la base existente

La base de Supabase ya tiene todas las tablas, creadas por el código anterior con
`CREATE TABLE IF NOT EXISTS` en cada boot. Las migraciones `001` describen ese estado,
así que hay que adoptarlas en lugar de ejecutarlas:

```bash
npm run migrate:adopt     # UNA sola vez, contra la base que ya tiene el esquema
npm run migrate           # aplica lo que sí es nuevo (índices)
npm run migrate:status    # verificar
```

---

## Verificar el contrato de la API

`scripts/api-snapshot.js` releva la forma de las respuestas de los endpoints de solo
lectura y compara contra una línea de base. Es la red de seguridad que sostiene los
cambios:

```bash
# contra el sistema viejo, antes de desplegar
node scripts/api-snapshot.js --base https://<produccion> --out scripts/snapshots/before.json

# contra el nuevo
node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before.json
```

Compara status, content-type y estructura, ignorando valores volátiles (timestamps,
tokens, uptime). Sale con código 1 si algo cambió.

---

## API

Todas las respuestas tienen la forma `{ success, data | message }`.

### Autenticación — `/api/auth`

| | | |
|---|---|---|
| `POST` | `/login` | público. Devuelve `accessToken`, `refreshToken` y el usuario con sus permisos |
| `POST` | `/logout` | acepta tokens vencidos: cerrar sesión siempre funciona |
| `POST` | `/refresh` | consume el refresh token (un solo uso) |
| `POST` | `/verify` | verifica un token. Ya no se usa internamente |
| `GET` | `/me` | usuario con permisos y módulos disponibles |

### Usuarios — `/api/users`

`GET|PUT /profile` y `POST /change-password` para el usuario propio. El resto
(`GET /`, `POST /`, `PUT /:id`, `PATCH /:id/status`, `POST /:id/reset-password`,
`GET /roles`) requiere rol administrador.

### Padrón — `/api/padron`

`GET /votantes` (paginado y filtrable), `POST /votantes`, `GET /votantes/:dni`,
`GET|PUT /relevamientos/:dni`, `GET /estadisticas`, `/estado`, `/configuracion`,
`/filtros`, `POST /importar-csv`, `GET /exportar-padron` y `/exportar-relevamientos`
(ambos solo administrador).

`GET /resultados/{estadisticas-avanzadas, por-sexo, por-rango-etario, por-circuito,
condiciones-detalladas}` — cacheados 60 s, invalidados al guardar un relevamiento.

`POST|GET|DELETE /detalle-votante`, `GET /condiciones-especiales`,
`GET /estadisticas-condiciones-especiales`.

### Auditoría — `/api/padron/auditoria`

`GET /` (paginado, filtrable por usuario, operación, entidad y fechas),
`GET /estadisticas`, `GET /:id`.

### Salud — `GET /health`

Sin autenticación. Devuelve estado de la base con su latencia, ocupación del pool,
sesiones en caché y RSS del proceso. 503 si la base no responde.

---

## Roles y permisos

| Rol | Permisos |
|---|---|
| `administrador` | todos, incluidos los que se agreguen después |
| `consultor` | `dashboard.view`, `resultados.view`, `resultados.export` |
| `encargado_relevamiento` | `dashboard.view`, `padron.*` |

Los permisos viajan en el token, así que autorizar no consulta la base. Cambiar el rol
o desactivar un usuario invalida su sesión en el acto.

---

## Sesiones

Una sesión activa por usuario: iniciar sesión en otro dispositivo invalida la anterior.
La sesión se cierra por inactividad (`INACTIVITY_TIMEOUT_MINUTES`, 30 por defecto).

Verificar un token no consulta la base en el caso típico. La verificación se cachea en
memoria por `SESSION_CACHE_TTL_MS` y `last_activity` se persiste como mucho una vez por
usuario cada `ACTIVITY_WRITE_INTERVAL_MS`. Login, logout, cambio de rol y desactivación
invalidan la caché de inmediato, así que el TTL nunca deja pasar a alguien que ya no
debería entrar.

La caché es local al proceso — que es justamente lo que la hace exacta con una sola
instancia. Correr varias réplicas requeriría mover este estado a Redis.

---

## Variables de entorno

Están todas documentadas en `.env.example`. Las obligatorias son `DATABASE_URL` y
`JWT_SECRET` (mínimo 32 caracteres; el arranque falla en producción si no cumple).

Vale la pena conocer estas:

| | | |
|---|---|---|
| `DB_POOL_MAX` | `8` | Un solo pool para todo el proceso |
| `SESSION_CACHE_TTL_MS` | `30000` | Vida de una sesión verificada en caché |
| `ACTIVITY_WRITE_INTERVAL_MS` | `60000` | Frecuencia máxima de escritura de actividad |
| `TRUST_PROXY` | `1` | Proxies por delante. En Render, 1 |
| `NODE_OPTIONS` | — | `--max-old-space-size=256` en servidores chicos |

---

## Agregar un módulo

Ver [docs/AGREGAR-MODULO.md](docs/AGREGAR-MODULO.md).

Resumido: crear la carpeta con `module.js`, `routes.js`, `service.js`, `repository.js`
y `migrations/`, y sumar una línea en `src/modules/index.js`. Los tests de integración
verifican el montaje solos.
