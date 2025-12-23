# 🚀 Guía Completa de Deployment - Sistema Electoral en Railway

## 📋 Pasos para Deployment Automatizado

### 1. 🔧 Configuración Inicial

#### A. Preparar el Repositorio GitHub
```bash
# 1. Crear/subir el repositorio a GitHub
git init
git add .
git commit -m "Initial commit: Sistema Electoral"
git remote add origin https://github.com/tu-usuario/sistema-electoral.git
git push -u origin main
```

#### B. Instalar Railway CLI
```bash
# Windows
npm install -g @railway/cli

# Mac/Linux  
curl -fsSL https://railway.app/install.sh | sh
```

### 2. 🏗️ Setup en Railway

#### A. Ejecutar script de configuración
```bash
# Windows
.\scripts\setup-railway.bat

# Linux/Mac
chmod +x scripts/setup-railway.sh
./scripts/setup-railway.sh
```

#### B. Configuración manual alternativa
```bash
# Login en Railway
railway login

# Crear proyecto
railway init

# Crear servicios individuales
railway service create auth-service
railway service create gateway-service  
railway service create padron-service
railway service create web-admin

# Crear base de datos PostgreSQL
railway service create postgres --template postgres
```

### 3. 🔑 Configurar Secrets en GitHub

En tu repositorio GitHub, ve a **Settings > Secrets and variables > Actions** y agrega:

```
RAILWAY_TOKEN=rwy_xxxxxxxxxx
```

Para obtener tu Railway token:
```bash
railway auth
# Copia el token que aparece
```

### 4. ⚙️ Variables de Entorno en Railway

Para cada servicio en Railway Dashboard, configura estas variables:

#### 🔐 Auth Service
```bash
PORT=3002
NODE_ENV=production
JWT_SECRET=your_super_secure_jwt_secret_change_this
JWT_EXPIRATION=24h
REFRESH_TOKEN_EXPIRATION=7d
DB_HOST=${{ POSTGRES.PGHOST }}
DB_PORT=${{ POSTGRES.PGPORT }}
DB_NAME=${{ POSTGRES.PGDATABASE }}
DB_USER=${{ POSTGRES.PGUSER }}
DB_PASSWORD=${{ POSTGRES.PGPASSWORD }}
```

#### 🌐 Gateway Service
```bash
PORT=8080
NODE_ENV=production
AUTH_SERVICE_URL=http://${{ AUTH_SERVICE.RAILWAY_PRIVATE_DOMAIN }}
PADRON_SERVICE_URL=http://${{ PADRON_SERVICE.RAILWAY_PRIVATE_DOMAIN }}
FRONTEND_URL=https://${{ WEB_ADMIN.RAILWAY_PUBLIC_DOMAIN }}
```

#### 📊 Padrón Service
```bash
PORT=3001
NODE_ENV=production
DB_HOST=${{ POSTGRES.PGHOST }}
DB_PORT=${{ POSTGRES.PGPORT }}
DB_NAME=${{ POSTGRES.PGDATABASE }}
DB_USER=${{ POSTGRES.PGUSER }}
DB_PASSWORD=${{ POSTGRES.PGPASSWORD }}
```

#### 🖥️ Web Admin
```bash
PORT=3000
NODE_ENV=production
API_URL=https://${{ GATEWAY_SERVICE.RAILWAY_PUBLIC_DOMAIN }}
```

### 5. 🚀 Deployment Automático

Una vez configurado todo, cada push a la rama `main` ejecutará automáticamente:

1. ✅ **Tests y Validación**
2. 🏗️ **Build de contenedores Docker**  
3. 🚀 **Deploy a Railway**
4. 🗃️ **Setup de base de datos**
5. 📊 **Verificación de health checks**

### 6. 📱 Monitoreo y Gestión

#### Ver estado del sistema:
```bash
./scripts/monitor-railway.sh  # Linux/Mac
# o usar Railway Dashboard
```

#### URLs de acceso:
- **Web Admin**: `https://web-admin-xxxx.railway.app`
- **API Gateway**: `https://gateway-service-xxxx.railway.app` 
- **Dashboard Railway**: `https://railway.app/dashboard`

## 🔍 Troubleshooting

### ❌ Problemas Comunes

#### 1. **Error de autenticación Railway**
```bash
railway logout
railway login
```

#### 2. **Variables de entorno no funcionan**
- Verificar sintaxis en Railway Dashboard
- Usar `${{ SERVICE.VARIABLE }}` para referencias internas

#### 3. **Build fallido**
```bash
# Ver logs detallados
railway logs --service service-name

# Reconstruir
railway redeploy --service service-name
```

#### 4. **Base de datos no conecta**
- Verificar variables `DB_*` en todos los servicios
- Confirmar que PostgreSQL está running

#### 5. **Servicios no se comunican**
- Usar URLs internas: `http://${{ SERVICE.RAILWAY_PRIVATE_DOMAIN }}`
- Verificar health checks

### 🔧 Comandos Útiles

```bash
# Ver status general
railway status

# Ver logs de un servicio
railway logs --service auth-service --tail

# Redeploy servicio específico
railway redeploy --service gateway-service

# Rollback en caso de problemas
railway rollback --service service-name

# Abrir Railway Dashboard
railway open

# Conectar a PostgreSQL
railway connect postgres
```

## 📊 Arquitectura de Deployment

```
GitHub Repo
     ↓ (git push)
GitHub Actions 
     ↓ (deploy)
Railway Platform
     ↓ (services)
┌─────────────────────────────────────┐
│  🌐 API Gateway (8080)              │ ← Entry Point
│  ┌─────────────────────────────────┐ │
│  │ 🔐 Auth Service (3002)          │ │
│  │ 📊 Padrón Service (3001)        │ │  
│  │ 🖥️  Web Admin (3000)            │ │
│  │ 🗃️  PostgreSQL (5432)           │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## 🎯 Checklist de Deployment

- [ ] ✅ Código subido a GitHub
- [ ] 🔑 Railway token configurado en GitHub Secrets
- [ ] 🏗️ Servicios creados en Railway
- [ ] ⚙️ Variables de entorno configuradas
- [ ] 🗃️ PostgreSQL database configurada
- [ ] 🚀 Pipeline ejecutado exitosamente
- [ ] 🌐 URLs públicas funcionando
- [ ] 📊 Health checks passing
- [ ] 🔍 Logs sin errores críticos

## 📞 Soporte

Si necesitas ayuda:
1. 📋 Revisa logs en Railway Dashboard
2. 🔍 Verifica GitHub Actions logs  
3. 📚 Consulta [Railway Documentation](https://docs.railway.app)
4. 🆘 Crea issue en el repositorio

---

🎉 **¡Tu Sistema Electoral estará disponible 24/7 en Railway con deployment automático!**