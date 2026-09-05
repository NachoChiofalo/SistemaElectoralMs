# CLAUDE — Resumen del repositorio Sistema Electoral (Microservicios)

Este documento describe de forma concisa y práctica la arquitectura, componentes, endpoints principales, variables de entorno, comandos de desarrollo/despliegue y observaciones importantes del repositorio.

**Nota:** Archivo generado automáticamente tras una revisión del código fuente. Para detalles por archivo, ver la sección "Archivos clave".

---

## Resumen rápido

- Arquitectura: Microservicios con API Gateway que enruta a `auth-service` (autenticación) y `padron-service` (padrón electoral). Cliente web `web-admin` alimenta la UI.
- Contenedores: `docker-compose.yml` orquesta `api-gateway`, `auth-service`, `padron-service`, `web-admin`, `postgres` y `redis` (opcional).
- Lenguaje principal: Node.js 18 (Express).

---

## Diagrama (alto nivel)

Clients → API Gateway (8080) → { Auth Service (3002), Padron Service (3001) }
Database: PostgreSQL 15 (5432)
Web Admin (3000) puede ser servido directamente o a través del gateway.

---

## Servicios y responsabilidades

- API Gateway (`services/gateway-service`)
  - Punto de entrada único. Middleware: helmet, cors, compression, morgan, express-rate-limit.
  - Proxy a `/api/auth` → Auth Service.
  - Proxy a `/api/padron` → Padron Service (requiere `authMiddleware`).
  - Servir archivos estáticos del cliente o proxy al `WEB_ADMIN_URL`.
  - Health: `GET /health`.
  - Archivos clave: `services/gateway-service/src/app.js`, `app-simple.js`, `middleware/*`.

- Auth Service (`services/auth-service`)
  - Maneja login, logout, refresh de tokens, verificación y endpoints de usuarios.
  - Endpoints proxied por gateway en `/api/auth` y `/api/users`.
  - Health: `GET /health`.
  - Inicializa DB y usuarios por defecto (`/init-db` endpoint).
  - Archivos clave: `services/auth-service/src/app.js`, `routes/authRoutes.js`, `routes/userRoutes.js`, `services/AuthService.js`, `database/Database.js`.

- Padron Service (`services/padron-service`)
  - Gestión de votantes, relevamientos, import/export CSV, estadísticas y auditoría.
  - Endpoints proxied por gateway en `/api/padron`.
  - Rutas principales: `GET /votantes`, `GET /votantes/:dni`, `POST /importar-csv`, rutas de `resultados/*`, `detalle-votante/*`, `auditoria/*`, `GET /health`.
  - Archivos clave: `services/padron-service/src/routes/padronRoutes.js`, `controllers/PadronController.js`, `database/Database.js`, `models/*.js`.

- Web Admin Client (`clients/web-admin`)
  - Frontend vanilla JS + HTML. Utiliza `window.apiService` y `window.authService` para comunicarse con la API.
  - Archivos clave: `clients/web-admin/index.html`, `src/app.js`, `src/services/*`, `src/components/*`.

- Shared & Scripts
  - `shared/` contiene utilidades compartidas.
  - `scripts/` incluye SQL y scripts de desarrollo (init-db, crear-usuarios, dev scripts).

---

## Endpoints principales (resumen)

- Gateway
  - `GET /health` — health del gateway
  - Proxy:
    - `/api/auth/*` → Auth Service
    - `/api/users/*` → Auth Service (rutas protegidas)
    - `/api/padron/*` → Padron Service (rutas protegidas)

- Auth Service (ejemplos)
  - `POST /api/auth/login` → { accessToken, refreshToken, user }
  - `POST /api/auth/logout`
  - `POST /api/auth/verify`
  - `POST /api/auth/refresh`
  - `GET /api/auth/me` → información y permisos del usuario
  - `GET /api/users/profile` — perfil (protegido)
  - `POST /api/users` — crear usuario (admin)

- Padron Service (ejemplos)
  - `POST /api/padron/importar-csv` — subir CSV con `multipart/form-data` (campo `csv`)
  - `GET /api/padron/votantes` — list paginada y con filtros
  - `GET /api/padron/votantes/:dni` — obtener votante
  - `PUT /api/padron/relevamientos/:dni` — actualizar relevamiento
  - `GET /api/padron/estadisticas` — estadísticas básicas
  - `GET /api/padron/resultados/por-sexo`, `/por-rango-etario`, `/por-circuito` — resultados
  - `GET /api/padron/health` — health del servicio

---

## Variables de entorno más relevantes

(Se usan tanto en `docker-compose.yml` como en `services/*/.env`)

- Gateway
  - `GATEWAY_PORT` (8080 por defecto)
  - `AUTH_SERVICE_URL` — URL del Auth Service
  - `PADRON_SERVICE_URL` — URL del Padron Service
  - `WEB_ADMIN_URL` — URL del cliente web en desarrollo (opcional)
  - `FRONTEND_URL`, `PUBLIC_EXTERNAL_URL`, `RENDER_EXTERNAL_URL`

- Auth & Padron
  - `DATABASE_URL` (recomendado: Supabase/Remote Postgres)
  - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
  - `JWT_SECRET`, `JWT_EXPIRATION`, `REFRESH_TOKEN_EXPIRATION`

- Postgres
  - `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

---

## Base de datos — esquema y tablas importantes

- Schemas/tables (padron-service crea `padron` schema):
  - `padron.votantes` — DNI (PK), nombre, apellido, ano_nac, circuito, sexo, edad, domicilio
  - `padron.relevamientos` — id, dni (FK), opcion_politica, observaciones, telefono, flags
  - `padron.auditoria` — registros de cambios (usuario, operacion, entidad, antes/despues, ip)
- Auth-service maneja tablas: `usuarios`, `roles`, `permisos`, `refresh_tokens`, `token_blacklist` (según README y código).

---

## Cómo levantar el entorno (rápido)

Con Docker Compose (recomendado):

```bash
# desde la raíz del repo
docker-compose up -d --build
# Ver logs
docker-compose logs -f api-gateway
```

En desarrollo sin Docker (por servicio):

```bash
# Gateway
cd services/gateway-service
npm install
node src/app.js

# Auth
cd services/auth-service
npm install
node src/app.js

# Padron
cd services/padron-service
npm install
node src/app.js

# Web Admin (cliente estático)
cd clients/web-admin
# suele ser solo archivos estáticos, o usar un servidor estático
```

---

## Observaciones y recomendaciones (buenas prácticas y riesgos)

- Seguridad
  - `JWT_SECRET` por defecto debe cambiarse en producción.
  - Asegurar `DATABASE_URL` con SSL y `rejectUnauthorized` en producción.
  - Revisar exposición de `/init-db` (en `auth-service`) — debe estar protegida o deshabilitada en prod.

- Operación
  - Gateway añade headers `X-User-*` forwardeando identidad; validar que downstream confíe en el gateway cuando se usa en red privada.
  - El rate limiter en gateway permite alto throughput (1000 por 15min). Ajustar por entorno.

- Escalabilidad
  - Considerar separar hosting del cliente web (CDN) en producción.
  - Agregar healthchecks y probes en orquestador (ya hay health en docker-compose).

- Calidad del código
  - Existen utilidades compartidas en `shared/` que pueden centralizar validaciones y mappers.
  - Tests: no se detectaron tests automatizados en la revisión rápida; recomendable añadir unit/integration tests para Auth y Padron.

---

## Archivos clave (para inspección rápida)

- Root
  - `package.json` — script `start` inicia gateway (node services/gateway-service/src/app.js)
  - `docker-compose.yml` — orquestación local
  - `Dockerfile` — imagen monolítica orientada a contenerizar gateway + web-admin estático
  - `README.md`, `README-AUTH.md`, `README-ROLES.md`, `RESULTADOS-README.md`

- Gateway
  - `services/gateway-service/src/app.js` — main (proxy, middleware)
  - `services/gateway-service/src/middleware/authMiddleware.js`
  - `services/gateway-service/src/middleware/permissionMiddleware.js`
  - `services/gateway-service/Dockerfile`

- Auth
  - `services/auth-service/src/app.js`
  - `services/auth-service/src/routes/authRoutes.js`
  - `services/auth-service/src/routes/userRoutes.js`
  - `services/auth-service/src/services/AuthService.js`
  - `services/auth-service/src/database/Database.js`

- Padron
  - `services/padron-service/src/routes/padronRoutes.js`
  - `services/padron-service/src/controllers/PadronController.js`
  - `services/padron-service/src/database/Database.js`
  - `services/padron-service/src/models/*.js`

- Cliente
  - `clients/web-admin/index.html`
  - `clients/web-admin/src/app.js`
  - `clients/web-admin/src/services/AuthService.js`
  - `clients/web-admin/src/services/ApiService.js`

---

## Recomendaciones inmediatas

1. Cambiar `JWT_SECRET` en entorno de producción y rotarlo periódicamente.
2. Proteger o eliminar el endpoint `/init-db` antes de exponer servicios al público.
3. Añadir pruebas automatizadas (al menos unitarias) para `AuthService` y `PadronController`.
4. Documentar contractos API (OpenAPI/Swagger) para facilitar integración del frontend.
5. Revisar manejo de errores y logging sensible (no loggear secretos ni tokens completos).

---

## Notas finales

- He generado este resumen tras inspeccionar los archivos principales del repo. El código contiene más ficheros y detalles (migraciones SQL, scripts, componentes front-end). Si quieres, puedo:
  - Generar un OpenAPI básico con los endpoints encontrados.
  - Añadir una checklist de seguridad más detallada.
  - Crear documentación por servicio en formato `docs/<servicio>.md`.

---

Archivo creado automáticamente por revisión de código.
