FROM node:18-alpine

WORKDIR /app

# Instalar serve para servir archivos estáticos
RUN npm install -g serve

# Copiar archivos del cliente (excluir node_modules si existe)
COPY package*.json ./
COPY src/ ./src/
COPY *.html ./

# Crear usuario no privilegiado
RUN addgroup -g 1001 -S nodejs && \
    adduser -S webuser -u 1001 && \
    chown -R webuser:nodejs /app

USER webuser

# Puerto configurable via variable de entorno
ENV PORT=3000
EXPOSE ${PORT}

# Comando para servir archivos estáticos
CMD ["sh", "-c", "serve . -l ${PORT}"]