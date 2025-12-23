# Usar imagen base de Node.js
FROM node:18-alpine

# Establecer directorio de trabajo
WORKDIR /app

# Copiar package.json del gateway service (servicio principal)
COPY services/gateway-service/package*.json ./

# Instalar dependencias
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente del gateway service
COPY services/gateway-service/src/ ./src/

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S appuser -u 1001

# Cambiar ownership de archivos
RUN chown -R appuser:nodejs /app
USER appuser

# Exponer puerto del gateway (punto de entrada)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Comando por defecto - ejecutar gateway service simplificado
CMD ["node", "src/app-simple.js"]