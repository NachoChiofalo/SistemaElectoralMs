@echo off
setlocal EnableDelayedExpansion

REM Script para ejecutar el sistema en modo desarrollo con usuarios de prueba
echo 🔧 Sistema Electoral - Modo Desarrollo con Roles
echo ================================================

:menu
echo.
echo Seleccione una opción:
echo 1. 🚀 Iniciar sistema completo
echo 2. 🗃️ Inicializar BD con usuarios de ejemplo  
echo 3. 👤 Mostrar usuarios de prueba
echo 4. 📊 Ver estado del sistema
echo 5. 🛑 Parar sistema
echo 6. 🧹 Limpiar y reiniciar
echo 7. ❌ Salir
echo.

set /p option="Opción: "

if "%option%"=="1" goto start_system
if "%option%"=="2" goto init_db
if "%option%"=="3" goto show_users
if "%option%"=="4" goto show_status
if "%option%"=="5" goto stop_system
if "%option%"=="6" goto clean_restart
if "%option%"=="7" goto exit_script
echo ❌ Opción no válida
goto menu

:start_system
echo 🚀 Iniciando sistema completo...
docker-compose up -d
echo ✅ Sistema iniciado
call :show_status
call :show_users
goto menu

:init_db
echo 🗃️ Inicializando base de datos con usuarios de ejemplo...
echo    • Ejecutando scripts de inicialización...

if exist "scripts\init-db.sql" (
    echo    • Ejecutando init-db.sql...
    psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts\init-db.sql
)

if exist "scripts\extend-db-detalle-votante.sql" (
    echo    • Ejecutando extend-db-detalle-votante.sql...
    psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts\extend-db-detalle-votante.sql
)

if exist "scripts\crear-usuarios-ejemplo.sql" (
    echo    • Creando usuarios de ejemplo...
    psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts\crear-usuarios-ejemplo.sql
)

echo ✅ Base de datos inicializada con usuarios de ejemplo
call :show_users
goto menu

:show_users
echo.
echo 👤 Usuarios de prueba disponibles:
echo    • admin     - Administrador (acceso completo)
echo    • consultor - Consultor (solo estadísticas)
echo    • encargado - Encargado de Relevamiento (solo padrón)
echo.
echo 🔑 Contraseña para todos: password
echo.
goto :eof

:show_status
echo.
echo 🌐 URLs del sistema:
echo    • Web Admin:      http://localhost:8080
echo    • API Gateway:    http://localhost:8080/api
echo    • Auth Service:   http://localhost:3002
echo    • Padrón Service: http://localhost:3001
echo.
echo 🔍 Estado de los contenedores:
docker-compose ps
goto :eof

:stop_system
echo 🛑 Deteniendo sistema...
docker-compose down
echo ✅ Sistema detenido
goto menu

:clean_restart
echo 🧹 Limpiando y reiniciando sistema...
docker-compose down -v
docker-compose up -d
echo Esperando que se inicien los servicios...
timeout /t 5 /nobreak > nul
goto init_db

:exit_script
echo 👋 ¡Hasta luego!
pause
exit /b 0