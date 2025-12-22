@echo off
echo ================================
echo    SISTEMA ELECTORAL
echo    JWT + API Gateway
echo ================================
echo.

echo [1/7] Deteniendo contenedores existentes...
docker-compose down

echo.
echo [2/7] Construyendo servicios...
docker-compose build --no-cache

echo.
echo [3/7] Iniciando base de datos...
docker-compose up -d postgres

echo [4/7] Esperando base de datos (15 segundos)...
timeout /t 15 /nobreak > nul

echo.
echo [5/7] Iniciando servicios de backend...
docker-compose up -d auth-service padron-service

echo [6/7] Esperando servicios de backend (10 segundos)...
timeout /t 10 /nobreak > nul

echo.
echo [7/7] Iniciando web-admin y API Gateway...
docker-compose up -d web-admin api-gateway

echo.
echo ================================
echo         SERVICIOS INICIADOS
echo ================================
echo.
echo 🌐 API Gateway:       http://localhost:8080
echo 🔐 Auth Service:      http://localhost:3002/health
echo 📋 Padron Service:    http://localhost:3001/health
echo 💻 Web Admin:         http://localhost:3000
echo 🗄️  PostgreSQL:        localhost:5432
echo.
echo ================================
echo      CREDENCIALES DE PRUEBA
echo ================================
echo.
echo Administrador:
echo   Usuario: admin
echo   Password: admin123
echo.
echo Encargados:
echo   Usuario: encargado1  Password: enc123
echo   Usuario: encargado2  Password: enc123
echo.
echo ================================
echo         ACCESO PRINCIPAL
echo ================================
echo.
echo ⭐ ACCEDER AL SISTEMA:
echo    http://localhost:8080
echo.
echo Para ver logs en tiempo real:
echo    docker-compose logs -f
echo.
echo Para detener todo:
echo    docker-compose down
echo.
echo ¡Sistema listo con autenticación JWT!
echo ================================

pause