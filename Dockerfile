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

# Puerto configurable via variable de entorno
ENV PORT=8080
EXPOSE ${PORT}

# Comando por defecto - ejecutar gateway service completo
CMD ["node", "src/app.js"]