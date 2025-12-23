#!/bin/bash

# Script para monitorear el deployment en Railway
echo "📊 Monitoring Sistema Electoral en Railway"
echo "=========================================="

# Función para mostrar status de un servicio
show_service_status() {
    local service_name=$1
    echo ""
    echo "🔍 Status de $service_name:"
    echo "----------------------------------------"
    railway status --service $service_name
    
    echo ""
    echo "📝 Últimos logs de $service_name:"
    echo "----------------------------------------" 
    railway logs --service $service_name --lines 10
}

# Verificar que Railway CLI esté disponible
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI no está instalado"
    echo "Instalalo con: npm install -g @railway/cli"
    exit 1
fi

# Login si es necesario
echo "🔐 Verificando autenticación..."
railway whoami || railway login

# Menú principal
while true; do
    echo ""
    echo "==================== RAILWAY MONITOR ===================="
    echo "1. 📊 Ver estado general de todos los servicios"
    echo "2. 🔍 Ver logs de Auth Service"
    echo "3. 🔍 Ver logs de Gateway Service" 
    echo "4. 🔍 Ver logs de Padrón Service"
    echo "5. 🔍 Ver logs de Web Admin"
    echo "6. 🗃️ Ver logs de PostgreSQL"
    echo "7. 🌐 Abrir Railway Dashboard"
    echo "8. 🔄 Redeploy servicio específico"
    echo "9. ⬅️ Rollback servicio"
    echo "0. ❌ Salir"
    echo "========================================================"
    
    read -p "Selecciona una opción: " option
    
    case $option in
        1)
            echo "📊 Estado general del sistema:"
            echo "=============================="
            railway status
            ;;
        2)
            show_service_status "auth-service"
            ;;
        3)
            show_service_status "gateway-service"
            ;;
        4)
            show_service_status "padron-service" 
            ;;
        5)
            show_service_status "web-admin"
            ;;
        6)
            show_service_status "postgres"
            ;;
        7)
            echo "🌐 Abriendo Railway Dashboard..."
            railway open
            ;;
        8)
            echo "Servicios disponibles:"
            echo "1. auth-service"
            echo "2. gateway-service"
            echo "3. padron-service"
            echo "4. web-admin"
            read -p "Selecciona servicio a redeploy (1-4): " service_option
            
            case $service_option in
                1) railway redeploy --service auth-service ;;
                2) railway redeploy --service gateway-service ;;
                3) railway redeploy --service padron-service ;;
                4) railway redeploy --service web-admin ;;
                *) echo "❌ Opción inválida" ;;
            esac
            ;;
        9)
            echo "Servicios disponibles:"
            echo "1. auth-service"
            echo "2. gateway-service" 
            echo "3. padron-service"
            echo "4. web-admin"
            read -p "Selecciona servicio a rollback (1-4): " rollback_option
            
            case $rollback_option in
                1) railway rollback --service auth-service ;;
                2) railway rollback --service gateway-service ;;
                3) railway rollback --service padron-service ;;
                4) railway rollback --service web-admin ;;
                *) echo "❌ Opción inválida" ;;
            esac
            ;;
        0)
            echo "👋 ¡Hasta luego!"
            exit 0
            ;;
        *)
            echo "❌ Opción inválida"
            ;;
    esac
    
    echo ""
    read -p "Presiona Enter para continuar..."
done