#!/bin/bash

# Script para ejecutar el sistema en modo desarrollo con usuarios de prueba
echo "🔧 Sistema Electoral - Modo Desarrollo con Roles"
echo "================================================"

# Función para mostrar usuarios disponibles
mostrar_usuarios() {
    echo ""
    echo "👤 Usuarios de prueba disponibles:"
    echo "   • admin     - Administrador (acceso completo)"
    echo "   • consultor - Consultor (solo estadísticas)"
    echo "   • encargado - Encargado de Relevamiento (solo padrón)"
    echo ""
    echo "🔑 Contraseña para todos: password"
    echo ""
}

# Función para inicializar base de datos con usuarios de ejemplo
init_db_con_usuarios() {
    echo "🗃️ Inicializando base de datos con usuarios de ejemplo..."
    
    # Ejecutar scripts de inicialización
    if [ -f "scripts/init-db.sql" ]; then
        echo "   • Ejecutando init-db.sql..."
        psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts/init-db.sql
    fi
    
    if [ -f "scripts/extend-db-detalle-votante.sql" ]; then
        echo "   • Ejecutando extend-db-detalle-votante.sql..."
        psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts/extend-db-detalle-votante.sql
    fi
    
    if [ -f "scripts/crear-usuarios-ejemplo.sql" ]; then
        echo "   • Creando usuarios de ejemplo..."
        psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts/crear-usuarios-ejemplo.sql
    fi
    
    echo "✅ Base de datos inicializada con usuarios de ejemplo"
}

# Función para mostrar estado del sistema
mostrar_estado() {
    echo ""
    echo "🌐 URLs del sistema:"
    echo "   • Web Admin:     http://localhost:8080"
    echo "   • API Gateway:   http://localhost:8080/api"
    echo "   • Auth Service:  http://localhost:3002"
    echo "   • Padrón Service: http://localhost:3001"
    echo ""
}

# Verificar si Docker está disponible
if ! command -v docker &> /dev/null; then
    echo "❌ Docker no está disponible. Asegúrese de tener Docker instalado."
    exit 1
fi

# Verificar si docker-compose está disponible
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose no está disponible."
    exit 1
fi

# Menú principal
while true; do
    echo ""
    echo "Seleccione una opción:"
    echo "1. 🚀 Iniciar sistema completo"
    echo "2. 🗃️ Inicializar BD con usuarios de ejemplo"
    echo "3. 👤 Mostrar usuarios de prueba"
    echo "4. 📊 Ver estado del sistema"
    echo "5. 🛑 Parar sistema"
    echo "6. 🧹 Limpiar y reiniciar"
    echo "7. ❌ Salir"
    echo ""
    
    read -p "Opción: " option
    
    case $option in
        1)
            echo "🚀 Iniciando sistema completo..."
            docker-compose up -d
            echo "✅ Sistema iniciado"
            mostrar_estado
            mostrar_usuarios
            ;;
        2)
            echo "🗃️ Inicializando base de datos..."
            init_db_con_usuarios
            mostrar_usuarios
            ;;
        3)
            mostrar_usuarios
            ;;
        4)
            mostrar_estado
            echo "🔍 Estado de los contenedores:"
            docker-compose ps
            ;;
        5)
            echo "🛑 Deteniendo sistema..."
            docker-compose down
            echo "✅ Sistema detenido"
            ;;
        6)
            echo "🧹 Limpiando y reiniciando sistema..."
            docker-compose down -v
            docker-compose up -d
            sleep 5
            init_db_con_usuarios
            echo "✅ Sistema reiniciado con datos limpios"
            mostrar_estado
            mostrar_usuarios
            ;;
        7)
            echo "👋 ¡Hasta luego!"
            exit 0
            ;;
        *)
            echo "❌ Opción no válida"
            ;;
    esac
done