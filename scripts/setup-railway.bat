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

REM Inicializar Railway y desplegar todos los servicios detectados automáticamente
railway init
echo 🚀 Desplegando todos los servicios detectados...
railway up

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