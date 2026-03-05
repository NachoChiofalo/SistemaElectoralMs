FROM node:18-alpine

WORKDIR /app

# Copiar e instalar dependencias del gateway
COPY services/gateway-service/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar codigo fuente del gateway
COPY services/gateway-service/src/ ./src/

# Copiar archivos estaticos del web-admin
COPY clients/web-admin/*.html ./public/
COPY clients/web-admin/src/ ./public/src/

# Crear usuario no-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S appuser -u 1001
RUN chown -R appuser:nodejs /app
USER appuser

ENV PORT=8080
EXPOSE ${PORT}

CMD ["node", "src/app.js"]
