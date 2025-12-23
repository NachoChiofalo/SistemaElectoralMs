@echo off
setlocal EnableDelayedExpansion

REM Script para configurar deployment en Railway (Windows)
echo 🚀 Configurando deployment en Railway...

REM Verificar que Node.js esté instalado
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js no está instalado. Instálalo desde https://nodejs.org/
    exit /b 1
)

REM Verificar que Railway CLI esté instalado
where railway >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo 📦 Instalando Railway CLI...
    npm install -g @railway/cli
)

REM Login en Railway
echo 🔐 Iniciando sesión en Railway...
railway login

REM Crear proyecto en Railway
echo 📋 Configurando proyecto...
railway init

REM Crear servicios para cada microservicio
echo 🏗️ Creando servicios...

REM Auth Service
echo    • Creando auth-service...
cd services\auth-service
railway service create auth-service
railway up --service auth-service --detach
cd ..\..

REM Gateway Service  
echo    • Creando gateway-service...
cd services\gateway-service
railway service create gateway-service
railway up --service gateway-service --detach
cd ..\..

REM Padron Service
echo    • Creando padron-service...
cd services\padron-service
railway service create padron-service
railway up --service padron-service --detach
cd ..\..

REM Web Admin
echo    • Creando web-admin...
cd clients\web-admin
railway service create web-admin
railway up --service web-admin --detach
cd ..\..

REM PostgreSQL Database
echo    • Configurando PostgreSQL...
railway service create postgres --template postgres

echo ✅ Configuración completada!
echo.
echo 🔧 Próximos pasos:
echo 1. Configurar variables de entorno en Railway Dashboard
echo 2. Conectar repositorio GitHub
echo 3. Configurar domain custom (opcional)
echo 4. Configurar secrets en GitHub
echo.
echo 🌐 Accede a Railway Dashboard: https://railway.app/dashboard

pause