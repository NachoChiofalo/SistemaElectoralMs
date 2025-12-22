#!/bin/bash

# Script de desarrollo para iniciar servicios localmente
echo "🚀 Iniciando servicios de desarrollo..."

# Verificar si Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js no está instalado. Por favor instálelo desde https://nodejs.org/"
    exit 1
fi

# Función para instalar dependencias si no existen
install_if_needed() {
    if [ ! -d "$1/node_modules" ]; then
        echo "📦 Instalando dependencias en $1..."
        cd "$1" && npm install && cd ..
    fi
}

# Instalar dependencias
install_if_needed "services/padron-service"
install_if_needed "clients/web-admin"

echo "✅ Dependencias listas"

# Iniciar servicios en segundo plano
echo "🔧 Iniciando servicio de padrón..."
cd services/padron-service
npm run dev &
PADRON_PID=$!
cd ../..

# Esperar un poco para que el servicio se inicie
sleep 3

echo "🌐 Iniciando cliente web..."
cd clients/web-admin
npm start &
WEB_PID=$!
cd ../..

echo ""
echo "🎉 Servicios iniciados:"
echo "   📊 API Padrón: http://localhost:3001"
echo "   🖥️ Web Admin: http://localhost:3000"
echo ""
echo "📝 Para detener los servicios, presiona Ctrl+C"

# Función para limpiar procesos al salir
cleanup() {
    echo ""
    echo "🛑 Deteniendo servicios..."
    kill $PADRON_PID 2>/dev/null
    kill $WEB_PID 2>/dev/null
    echo "✅ Servicios detenidos"
    exit 0
}

# Capturar señal de salida
trap cleanup INT

# Mantener el script ejecutándose
wait