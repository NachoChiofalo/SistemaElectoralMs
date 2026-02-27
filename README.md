# 🗳️ Sistema Electoral — Microservicios

Sistema electoral basado en arquitectura de microservicios para la gestión de padrón, autenticación de usuarios y visualización de resultados electorales.

## 📐 Arquitectura

```
┌──────────────────────────────────────────────────────┐
│                  Clientes / Browser                  │
└───────────────────────────┬──────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │     🌐 API Gateway         │
              │        Puerto 8080         │  ← Punto de entrada único
              └──┬───────────┬────────────┘
                 │           │
   ┌─────────────▼──┐   ┌───▼──────────────┐
   │ 🔐 Auth Service │   │ 📋 Padrón Service │
   │   Puerto 3002   │   │   Puerto 3001     │
   └─────────────┬──┘   └───┬──────────────┘
                 │           │
   ┌─────────────▼───────────▼──────────────┐
   │           🗃️ PostgreSQL                 │
   │             Puerto 5432                 │
   └─────────────────────────────────────────┘

   🖥️ Web Admin Client — Puerto 3000 (acceso directo o vía gateway)
```

### Estructura del repositorio

```
SistemaElectoralMs/
├── services/
│   ├── gateway-service/   # API Gateway — enrutamiento y autenticación
│   ├── auth-service/      # Servicio de autenticación JWT
│   └── padron-service/    # Gestión del padrón electoral
├── clients/
│   └── web-admin/         # Interfaz web de administración
├── shared/                # Código compartido
├── scripts/               # Scripts de inicialización y deploy
├── docker-compose.yml     # Orquestación local
└── docker-compose.railway.yml  # Orquestación para Railway
```

---

## 🚀 Inicio Rápido

### Requisitos

- [Docker](https://www.docker.com/) y Docker Compose
- Node.js 18+ (solo para desarrollo local)

### Con Docker (Recomendado)

```bash
# 1. Clonar el repositorio
git clone https://github.com/NachoChiofalo/SistemaElectoralMs.git
cd SistemaElectoralMs

# 2. Levantar todos los servicios
docker-compose up -d

# 3. Ver logs
docker-compose logs -f
```

**URLs de acceso:**

| Servicio | URL |
|---|---|
| 🌐 Sistema principal (con autenticación) | http://localhost:8080 |
| 🖥️ Web Admin (acceso directo) | http://localhost:3000 |
| 🔐 Auth Service health | http://localhost:3002/health |
| 📋 Padrón Service health | http://localhost:3001/health |
| 🌐 API Gateway health | http://localhost:8080/health |

### Desarrollo local (sin Docker)

```bash
# API Gateway
cd services/gateway-service && npm install && npm run dev

# Auth Service
cd services/auth-service && npm install && npm run dev

# Padrón Service
cd services/padron-service && npm install && npm run dev

# Web Admin
cd clients/web-admin && npm install && npm start
```

---

## 🔑 Usuarios de prueba

| Usuario | Contraseña | Rol | Acceso |
|---|---|---|---|
| `admin` | `admin123` | Administrador | Completo |
| `encargado1` | `enc123` | Encargado de relevamiento | Solo padrón |
| `encargado2` | `enc123` | Encargado de relevamiento | Solo padrón |
| `consultor` | `password` | Consultor | Solo estadísticas/resultados |

---

## 📦 Servicios

### 🌐 API Gateway (Puerto 8080)

Punto de entrada único al sistema. Gestiona el enrutamiento de peticiones a los servicios internos y aplica autenticación JWT a las rutas protegidas.

**Tecnologías:** Node.js, Express, http-proxy-middleware, express-rate-limit

**Responsabilidades:**
- Enrutamiento de peticiones a los servicios internos
- Validación de tokens JWT en rutas protegidas
- Rate limiting
- Compresión de respuestas

### 🔐 Auth Service (Puerto 3002)

Gestión de autenticación y autorización con JWT.

**Tecnologías:** Node.js, Express, jsonwebtoken, bcryptjs, PostgreSQL

**Endpoints:**

```
POST /api/auth/login           - Iniciar sesión → devuelve access token + refresh token
POST /api/auth/logout          - Cerrar sesión (agrega token a blacklist)
POST /api/auth/verify          - Verificar validez de un token
POST /api/auth/refresh         - Renovar access token con refresh token

GET  /api/users/profile        - Perfil del usuario autenticado
PUT  /api/users/profile        - Actualizar perfil
POST /api/users/change-password - Cambiar contraseña
GET  /api/users                - Listar usuarios (solo admin)
POST /api/users                - Crear usuario (solo admin)
```

**Ejemplo — Login:**
```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 📋 Padrón Service (Puerto 3001)

Gestión del padrón electoral, relevamientos y resultados.

**Tecnologías:** Node.js, Express, multer, csv-parser, PostgreSQL

**Endpoints:**

```
# Votantes
GET  /api/padron/votantes              - Lista paginada con filtros
GET  /api/padron/votantes/:dni         - Obtener votante por DNI

# Relevamientos
GET  /api/padron/relevamientos/:dni    - Obtener relevamiento de un votante
PUT  /api/padron/relevamientos/:dni    - Actualizar relevamiento

# Estadísticas y resultados
GET  /api/padron/estadisticas          - Estadísticas generales del padrón
GET  /api/padron/resultados/estadisticas-avanzadas - Distribución de votos
GET  /api/padron/resultados/por-sexo               - Resultados por sexo
GET  /api/padron/resultados/por-rango-etario        - Resultados por edad
GET  /api/padron/resultados/por-circuito            - Resultados por circuito

# Utilidades
GET  /api/padron/filtros               - Opciones disponibles para filtros
POST /api/padron/importar-csv          - Importar padrón desde CSV
GET  /api/padron/exportar              - Exportar datos

GET  /health                           - Health check
```

**Ejemplo — Obtener votantes con filtro:**
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8080/api/padron/votantes?pagina=1&limite=50&circuito=162"
```

### 🖥️ Web Admin Client (Puerto 3000)

Interfaz web de administración del sistema electoral.

**Tecnologías:** HTML5, JavaScript Vanilla, CSS3, Chart.js

**Páginas disponibles:**
- `/index.html` — Gestión del padrón y relevamientos
- `/dashboard.html` — Dashboard principal
- `/resultados.html` — Gráficos y estadísticas electorales (Chart.js)
- `/fiscales.html` — Gestión de fiscales
- `/comicio.html` — Gestión de comicios

---

## 👥 Sistema de Roles y Permisos

Los tokens JWT incluyen los permisos del usuario. La validación se realiza tanto en frontend como en el API Gateway.

| Rol | Permisos |
|---|---|
| **Administrador** | Acceso completo: padrón, resultados, fiscales, usuarios, reportes, comicios |
| **Encargado de relevamiento** | `padron.view`, `padron.edit`, `padron.import`, `padron.export` |
| **Consultor** | `resultados.view`, `reportes.view` |

---

## 🗄️ Base de Datos

**Motor:** PostgreSQL 15

### Tablas principales

| Tabla | Descripción |
|---|---|
| `votantes` | Padrón electoral |
| `detalle_votante` | Información cualitativa del relevamiento |
| `usuarios` | Usuarios del sistema |
| `roles` | Definición de roles |
| `permisos` | Permisos disponibles |
| `rol_permisos` | Asignación de permisos por rol |
| `refresh_tokens` | Tokens de renovación de sesión |
| `token_blacklist` | Tokens revocados (logout seguro) |

### Variables de entorno

```env
# PostgreSQL
DB_HOST=postgres
DB_PORT=5432
DB_NAME=sistema_electoral
DB_USER=electoral_user
DB_PASSWORD=electoral_password

# Auth Service
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRATION=24h
REFRESH_TOKEN_EXPIRATION=7d

# Gateway
GATEWAY_PORT=8080
AUTH_SERVICE_URL=http://auth-service:3002
PADRON_SERVICE_URL=http://padron-service:3001
```

---

## 🚀 Deployment en Railway

El proyecto incluye configuración lista para deployment en [Railway](https://railway.app).

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login y deploy
railway login
railway init
railway up
```

Consulta la [Guía completa de deployment](./DEPLOYMENT-GUIDE.md) para instrucciones detalladas incluyendo configuración de variables de entorno, secrets de GitHub Actions y pipeline CI/CD.

---

## 🔒 Seguridad

- Tokens JWT firmados con secreto configurable
- Blacklist de tokens para logout seguro
- Middleware de autenticación en el API Gateway
- Helmet para headers de seguridad HTTP
- CORS configurado por entorno
- Rate limiting en el gateway
- Validación doble de permisos (frontend + backend)

---

## 🧪 Tests

```bash
# Ejecutar tests de un servicio
cd services/auth-service && npm test
cd services/padron-service && npm test
cd services/gateway-service && npm test
```

---

## 🔍 Troubleshooting

**Ver logs de un servicio:**
```bash
docker-compose logs auth-service
docker-compose logs padron-service
docker-compose logs api-gateway
```

**Reiniciar un servicio:**
```bash
docker-compose restart auth-service
```

**Reiniciar la base de datos:**
```bash
docker-compose restart postgres
```

**Puerto ocupado:** Modificar el mapeo de puertos en `docker-compose.yml`.

**Error "Token expirado":** El sistema redirige automáticamente al login. Los access tokens duran 24 hs y los refresh tokens 7 días.

---

## 📄 Documentación adicional

- [Autenticación y API Gateway](./README-AUTH.md)
- [Sistema de Roles y Permisos](./README-ROLES.md)
- [Área de Resultados](./RESULTADOS-README.md)
- [Guía de Deployment en Railway](./DEPLOYMENT-GUIDE.md)

---

## 🤝 Contribución

1. Fork del repositorio
2. Crear una rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit con mensaje descriptivo
4. Push y abrir un Pull Request

---

**Licencia:** MIT