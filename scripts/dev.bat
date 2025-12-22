@echo off
REM Script de desarrollo para Windows

echo 🚀 Iniciando servicios de desarrollo...

REM Verificar si Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js no está instalado. Por favor instálelo desde https://nodejs.org/
    pause
    exit /b 1
)

REM Instalar dependencias si no existen
if not exist "services\padron-service\node_modules" (
    echo 📦 Instalando dependencias del servicio de padrón...
    cd services\padron-service
    call npm install
    cd ..\..
)

if not exist "clients\web-admin\node_modules" (
    echo 📦 Instalando dependencias del cliente web...
    cd clients\web-admin
    call npm install
    cd ..\..
)

echo ✅ Dependencias listas

REM Iniciar servicio de padrón
echo 🔧 Iniciando servicio de padrón...
start "Padrón Service" cmd /c "cd services\padron-service && npm run dev"

REM Esperar un poco
timeout /t 3 /nobreak >nul

REM Iniciar cliente web
echo 🌐 Iniciando cliente web...
start "Web Admin" cmd /c "cd clients\web-admin && npm start"

echo.
echo 🎉 Servicios iniciados en ventanas separadas:
echo    📊 API Padrón: http://localhost:3001
echo    🖥️ Web Admin: http://localhost:3000
echo.
echo 📝 Para detener los servicios, cierra las ventanas correspondientes
echo.
pause