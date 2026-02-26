FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar código fuente
COPY src/ ./src/

# Copiar archivo CSV para carga automática
COPY padron_2019_municipal.csv ./padron_2019_municipal.csv

# Crear directorio para uploads
RUN mkdir -p uploads

# Puerto configurable via variable de entorno
ENV PORT=3001
EXPOSE ${PORT}

# Usuario no privilegiado
RUN addgroup -g 1001 -S nodejs
RUN adduser -S padron -u 1001
USER padron

# Comando para iniciar la aplicación
CMD ["node", "src/app.js"]