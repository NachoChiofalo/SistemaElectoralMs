FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente
COPY src/ ./src/

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S authuser -u 1001

# Cambiar ownership de archivos
RUN chown -R authuser:nodejs /app
USER authuser

# Puerto configurable via variable de entorno
ENV PORT=3002
EXPOSE ${PORT}

# Comando por defecto
CMD ["node", "src/app.js"]