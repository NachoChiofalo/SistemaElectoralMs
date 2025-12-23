#!/bin/bash

# Script de verificación del deployment completo
echo "🚀 Verificando deployment del Sistema Electoral en Railway..."
echo "============================================================"

# URL base del gateway (ajusta según tu dominio de Railway)
GATEWAY_URL="https://sistemaelectoral-production-b648.up.railway.app"

echo ""
echo "📊 Probando servicios desplegados:"
echo ""

# Test 1: Gateway Health Check
echo "1. 🌐 Gateway Health Check"
curl -s "$GATEWAY_URL/health" | jq '.' 2>/dev/null || curl -s "$GATEWAY_URL/health"
echo ""

# Test 2: Gateway Status
echo "2. ⚙️ Gateway Status"  
curl -s "$GATEWAY_URL/api/status" | jq '.' 2>/dev/null || curl -s "$GATEWAY_URL/api/status"
echo ""

# Test 3: Gateway Root
echo "3. 🏠 Gateway Root"
curl -s "$GATEWAY_URL/" | jq '.' 2>/dev/null || curl -s "$GATEWAY_URL/"
echo ""

echo "✅ Verificación completada!"
echo ""
echo "🔗 URLs importantes:"
echo "   • Gateway: $GATEWAY_URL"
echo "   • Dashboard: $GATEWAY_URL/dashboard.html"
echo "   • Admin: $GATEWAY_URL/index.html"
echo ""
echo "📱 Para verificar servicios internos:"
echo "   • Auth Service: $GATEWAY_URL/api/auth/status"
echo "   • Padron Service: $GATEWAY_URL/api/padron/status"