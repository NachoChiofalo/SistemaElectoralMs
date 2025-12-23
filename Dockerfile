# Usar imagen base de Node.js
FROM node:18-alpine

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración de la raíz
COPY package*.json ./

# Instalar dependencias básicas
RUN npm install

# Copiar todos los servicios
COPY services/ ./services/
COPY clients/ ./clients/
COPY scripts/ ./scripts/

# Exponer puerto del gateway (punto de entrada)
EXPOSE 8080

# Comando por defecto - ejecutar gateway service
CMD ["node", "services/gateway-service/src/app.js"]