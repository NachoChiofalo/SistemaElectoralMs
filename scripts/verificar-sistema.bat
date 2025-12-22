@echo off
echo 🔧 Sistema Electoral - Verificación de Estado
echo =============================================

echo.
echo 🐳 Verificando estado de contenedores...
docker-compose ps

echo.
echo 🗃️ Verificando base de datos...
echo Verificando tablas de roles y permisos:
docker exec -it electoral-db psql -U electoral_user -d sistema_electoral -c "SELECT COUNT(*) as total_roles FROM roles;"
docker exec -it electoral-db psql -U electoral_user -d sistema_electoral -c "SELECT COUNT(*) as total_permisos FROM permisos;"
docker exec -it electoral-db psql -U electoral_user -d sistema_electoral -c "SELECT COUNT(*) as usuarios_con_roles FROM usuarios WHERE rol_id IS NOT NULL;"

echo.
echo 👤 Usuarios disponibles:
docker exec -it electoral-db psql -U electoral_user -d sistema_electoral -c "SELECT u.username, r.nombre as rol, u.activo FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id WHERE u.username IN ('admin', 'consultor', 'encargado');"

echo.
echo 🌐 URLs del sistema:
echo    • Web Admin:      http://localhost:8080
echo    • Dashboard:      http://localhost:8080/dashboard.html
echo    • API Gateway:    http://localhost:8080/api
echo    • Auth Service:   http://localhost:3002
echo    • Padrón Service: http://localhost:3001

echo.
echo 🔑 Credenciales de prueba:
echo    • admin / password     - Administrador (acceso completo)
echo    • consultor / password - Consultor (solo estadísticas)
echo    • encargado / password - Encargado (solo padrón)

echo.
echo 🧪 Prueba rápida de autenticación...
curl -s -X POST http://localhost:8080/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"password\"}" | findstr "success"

echo.
pause