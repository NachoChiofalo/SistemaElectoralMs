#!/bin/bash

# Script para configurar deployment en Railway
echo "🚀 Configurando deployment en Railway..."

# Verificar que Railway CLI esté instalado
if ! command -v railway &> /dev/null; then
    echo "📦 Instalando Railway CLI..."
    npm install -g @railway/cli
fi

# Login en Railway
echo "🔐 Iniciando sesión en Railway..."
railway login

# Crear proyecto en Railway
echo "📋 Configurando proyecto..."
railway init

# Crear servicios para cada microservicio
echo "🏗️ Creando servicios..."

# Auth Service
echo "   • Creando auth-service..."
cd services/auth-service
railway service create auth-service
railway up --service auth-service --detach
cd ../..

# Gateway Service  
echo "   • Creando gateway-service..."
cd services/gateway-service
railway service create gateway-service
railway up --service gateway-service --detach
cd ../..

# Padron Service
echo "   • Creando padron-service..."
cd services/padron-service
railway service create padron-service
railway up --service padron-service --detach
cd ../..

# Web Admin
echo "   • Creando web-admin..."
cd clients/web-admin
railway service create web-admin
railway up --service web-admin --detach
cd ../..

# PostgreSQL Database
echo "   • Configurando PostgreSQL..."
railway service create postgres --template postgres

echo "✅ Configuración completada!"
echo ""
echo "🔧 Próximos pasos:"
echo "1. Configurar variables de entorno en Railway Dashboard"
echo "2. Conectar repositorio GitHub"
echo "3. Configurar domain custom (opcional)"
echo "4. Configurar secrets en GitHub"
echo ""
echo "🌐 Accede a Railway Dashboard: https://railway.app/dashboard"