# 🚀 Pipeline de Deployment - Sistema Electoral

Este directorio contiene la configuración para el deployment automatizado del Sistema Electoral en Railway usando GitHub Actions.

## 📁 Estructura del Pipeline

```
.github/
└── workflows/
    └── deploy.yml          # Pipeline principal de CI/CD
railway.json               # Configuración específica de Railway
docker-compose.railway.yml # Docker Compose para Railway
```

## 🔄 Flujo de Deployment

### 1. **Test y Validación** 
- ✅ Instala dependencias de todos los servicios
- ✅ Ejecuta tests unitarios 
- ✅ Valida builds de Docker
- ✅ Verifica integridad del código

### 2. **Deployment en Railway**
- 🚀 Deploy paralelo de todos los servicios
- 🔧 Configuración automática de variables de entorno
- 🐳 Build y deploy de contenedores Docker
- 🌐 Configuración de networking entre servicios

### 3. **Setup de Base de Datos**
- 🗃️ Inicialización automática de PostgreSQL
- 📊 Ejecución de migraciones y scripts iniciales
- 👥 Creación de usuarios por defecto

### 4. **Notificaciones**
- ✅ Notificación de éxito/fallo
- 📱 Reporte del estado del deployment

## ⚙️ Configuración Requerida

### Secrets de GitHub
Configura estos secrets en tu repositorio GitHub:

```bash
RAILWAY_TOKEN=your_railway_token_here
```

### Variables de Entorno en Railway
Para cada servicio, configura:

#### Auth Service
```bash
PORT=3002
JWT_SECRET=your_super_secure_jwt_secret
JWT_EXPIRE=24h
REFRESH_EXPIRE=7d
DB_HOST=${{ POSTGRES.PGHOST }}
DB_PORT=${{ POSTGRES.PGPORT }}
DB_NAME=${{ POSTGRES.PGDATABASE }}
DB_USER=${{ POSTGRES.PGUSER }}
DB_PASSWORD=${{ POSTGRES.PGPASSWORD }}
NODE_ENV=production
```

#### Gateway Service  
```bash
PORT=8080
AUTH_SERVICE_URL=${{ AUTH_SERVICE.RAILWAY_PRIVATE_DOMAIN }}
PADRON_SERVICE_URL=${{ PADRON_SERVICE.RAILWAY_PRIVATE_DOMAIN }}
FRONTEND_URL=${{ WEB_ADMIN.RAILWAY_PUBLIC_DOMAIN }}
NODE_ENV=production
```

#### Padron Service
```bash
PORT=3001
DB_HOST=${{ POSTGRES.PGHOST }}
DB_PORT=${{ POSTGRES.PGPORT }}
DB_NAME=${{ POSTGRES.PGDATABASE }}
DB_USER=${{ POSTGRES.PGUSER }}
DB_PASSWORD=${{ POSTGRES.PGPASSWORD }}
NODE_ENV=production
```

#### Web Admin
```bash
PORT=3000
API_URL=${{ GATEWAY_SERVICE.RAILWAY_PUBLIC_DOMAIN }}
NODE_ENV=production
```

## 🎯 Trigger del Pipeline

El pipeline se ejecuta automáticamente cuando:
- 🔄 Push a `main` o `master`
- 🔀 Pull Request a `main` o `master`
- 🔧 Deployment manual desde GitHub Actions

## 📋 Servicios Desplegados

| Servicio | Puerto | Descripción |
|----------|---------|-------------|
| Gateway | 8080 | API Gateway principal |
| Auth | 3002 | Servicio de autenticación |
| Padrón | 3001 | Gestión del padrón electoral |
| Web Admin | 3000 | Cliente web de administración |
| PostgreSQL | 5432 | Base de datos principal |

## 🔍 Monitoreo y Logs

- 📊 **Railway Dashboard**: Monitoreo en tiempo real
- 📝 **GitHub Actions**: Logs de deployment
- 🚨 **Health Checks**: Verificación automática de servicios
- 📈 **Metrics**: Métricas de rendimiento y uso

## 🛠️ Comandos Útiles

### Deploy manual desde local
```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy servicio específico
cd services/auth-service
railway up --service auth-service
```

### Ver logs en producción
```bash
railway logs --service auth-service
railway logs --service gateway-service
railway logs --service padron-service
railway logs --service web-admin
```

### Rollback en caso de problemas
```bash
railway rollback --service service-name
```

## 🚨 Troubleshooting

### Problemas Comunes

1. **Error de conexión a BD**
   - Verificar variables de entorno de PostgreSQL
   - Revisar configuración de networking

2. **Servicios no comunican**
   - Verificar URLs internas de Railway
   - Comprobar variables de entorno de servicios

3. **Build fallido**
   - Revisar Dockerfile
   - Verificar dependencias en package.json

### Logs de Debug
```bash
# Ver logs detallados
railway logs --service service-name --tail

# Ver estado de servicios
railway status
```

## 📞 Soporte

Si encuentras problemas:
1. 📋 Revisa los logs en Railway Dashboard
2. 🔍 Comprueba GitHub Actions logs
3. 📖 Consulta documentación de Railway
4. 🆘 Crea un issue en el repositorio