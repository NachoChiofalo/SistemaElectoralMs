# Sistema Electoral - Autenticación JWT con API Gateway

## 🔐 Nueva Arquitectura con Autenticación

El sistema ha sido extendido con un **API Gateway** y **servicio de autenticación JWT** que permite el acceso seguro de múltiples "Encargados de relevamiento".

### 🏗️ Arquitectura de Servicios

```
┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │◄─--│   Web Client    │
│   Port: 8080    │    │   Port: 3000    │
└─────────┬───────┘    └─────────────────┘
          │
          ├─────────────────────────────────────┐
          │                                     │
┌─────────▼───────┐                  ┌─────────▼───────┐
│  Auth Service   │                  │ Padron Service  │
│   Port: 3002    │                  │   Port: 3001    │
└─────────┬───────┘                  └─────────┬───────┘
          │                                     │
          └─────────────────┬───────────────────┘
                            │
                  ┌─────────▼───────┐
                  │   PostgreSQL    │
                  │   Port: 5432    │
                  └─────────────────┘
```

### 🚀 Inicio Rápido

#### Opción 1: Script Automatizado (Windows)
```bash
# En el directorio microservicios/
./scripts/dev-auth.bat
```

#### Opción 2: Script Automatizado (Linux/Mac)
```bash
# En el directorio microservicios/
./scripts/dev-auth.sh
```

#### Opción 3: Manual
```bash
# 1. Detener contenedores existentes
docker-compose down

# 2. Construir servicios
docker-compose build --no-cache

# 3. Iniciar todos los servicios
docker-compose up -d

# 4. Ver logs (opcional)
docker-compose logs -f
```

### 🌐 Endpoints de Acceso

| Servicio | URL | Descripción |
|----------|-----|-------------|
| **🌐 Sistema Principal** | http://localhost:8080 | **Punto de acceso único con autenticación** |
| API Gateway | http://localhost:8080/health | Health check del gateway |
| Auth Service | http://localhost:3002/health | Health check de autenticación |
| Padron Service | http://localhost:3001/health | Health check del padrón |
| Web Admin | http://localhost:3000 | Cliente web (acceso directo sin auth) |
| PostgreSQL | localhost:5432 o remoto | Base de datos |

### 👥 Usuarios y Credenciales

#### Administrador
- **Usuario:** `admin`  
- **Password:** `admin123`
- **Permisos:** Gestión completa del sistema y usuarios

#### Encargados de Relevamiento
- **Usuario:** `encargado1` / **Password:** `enc123`
- **Usuario:** `encargado2` / **Password:** `enc123`
- **Permisos:** Relevamiento de votantes y gestión de detalles

### 🔑 Funcionalidades de Autenticación

#### 🚪 Login
- Pantalla de login con credenciales
- Validación de usuario y contraseña
- Generación de token JWT (24h de duración)
- Refresh token para renovación automática

#### 🛡️ Seguridad
- Tokens JWT firmados con secreto seguro
- Blacklist de tokens para logout seguro
- Middleware de autenticación en API Gateway
- Verificación de permisos por rol (admin/encargado)

#### 🔄 Sesión
- Persistencia de sesión en localStorage
- Auto-renovación de tokens expirados
- Logout seguro con limpieza de tokens
- Información del usuario en header

### 📋 API Endpoints

#### Autenticación
```
POST /api/auth/login       - Iniciar sesión
POST /api/auth/logout      - Cerrar sesión
POST /api/auth/verify      - Verificar token
POST /api/auth/refresh     - Renovar token
```

#### Usuarios (requiere autenticación)
```
GET  /api/users/profile    - Perfil del usuario actual
PUT  /api/users/profile    - Actualizar perfil
POST /api/users/change-password - Cambiar contraseña
GET  /api/users           - Listar usuarios (solo admin)
POST /api/users           - Crear usuario (solo admin)
```

#### Padrón (requiere autenticación)
```
GET  /api/padron/estadisticas  - Estadísticas del padrón
GET  /api/padron/buscar       - Buscar votantes
POST /api/padron/detalle-votante - Crear detalle de votante
GET  /api/padron/detalle-votante - Obtener detalles
DELETE /api/padron/detalle-votante/:id - Eliminar detalle
```

### 🔧 Configuración

#### Variables de Entorno

**API Gateway** (`.env`)
```
GATEWAY_PORT=8080
AUTH_SERVICE_URL=http://localhost:3002
PADRON_SERVICE_URL=http://localhost:3001
WEB_ADMIN_URL=http://localhost:3000
```

**Auth Service** (`.env`)
```
AUTH_PORT=3002
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION=24h
REFRESH_TOKEN_EXPIRATION=7d
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require

# Alternativa local
# DB_HOST=localhost
# DB_PORT=5432
# DB_NAME=electoral_db
# DB_USER=postgres
# DB_PASSWORD=postgres
```

### 🗄️ Base de Datos

#### Nuevas Tablas de Autenticación
- `usuarios` - Datos de usuarios del sistema
- `refresh_tokens` - Tokens de renovación
- `token_blacklist` - Tokens revocados

#### Tablas Existentes
- `votantes` - Padrón electoral  
- `detalle_votante` - Información cualitativa de relevamiento

### 🚨 Troubleshooting

#### Error: "Servicio no disponible"
```bash
# Verificar estado de contenedores
docker-compose ps

# Ver logs de servicios
docker-compose logs auth-service
docker-compose logs api-gateway
```

#### Error: "Token expirado"
- El sistema redirige automáticamente al login
- Los tokens JWT duran 24 horas por defecto
- Los refresh tokens duran 7 días

#### Error: "Base de datos no conecta"
```bash
# Reiniciar solo la base de datos
docker-compose restart postgres

# Verificar logs de la DB
docker-compose logs postgres
```

### 🧪 Testing

#### Probar Autenticación
```bash
# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Verificar token (reemplazar TOKEN)
curl -X POST http://localhost:8080/api/auth/verify \
  -H "Authorization: Bearer TOKEN"
```

#### Probar API Gateway
```bash
# Health check del gateway
curl http://localhost:8080/health

# Acceso protegido (sin token = 401)
curl http://localhost:8080/api/padron/estadisticas

# Acceso protegido (con token = 200)
curl -H "Authorization: Bearer TOKEN" \
     http://localhost:8080/api/padron/estadisticas
```

### 📝 Desarrollo

Para agregar nuevos usuarios o modificar permisos:

1. **Crear usuario via API** (como admin):
```javascript
await fetch('/api/users', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    username: 'nuevo_encargado',
    password: 'password123', 
    nombre_completo: 'Juan Pérez',
    email: 'juan@ejemplo.com',
    rol: 'encargado'
  })
});
```

2. **Modificar roles en la base de datos**:
```sql
UPDATE usuarios SET rol = 'admin' WHERE username = 'usuario';
```

### 🎯 Próximas Mejoras

- [ ] Rate limiting por usuario
- [ ] Logs de auditoría 
- [ ] 2FA (Two-Factor Authentication)
- [ ] Roles más granulares
- [ ] Dashboard de administración de usuarios
- [ ] Notificaciones en tiempo real
- [ ] API versioning

---

**¡El sistema electoral ahora es seguro y multiusuario!** 🔐✨

Accede desde: **http://localhost:8080**