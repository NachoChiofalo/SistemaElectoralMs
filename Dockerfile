# Imagen unica del Sistema Electoral.
#
# Antes eran cuatro: gateway, auth, padron y un contenedor con `serve` para el
# frontend estatico. Cada una con su propio node_modules y su propio runtime de Node
# en memoria.

# ---------- etapa de dependencias ----------
FROM node:20-alpine AS deps

WORKDIR /app

# Se copian solo los manifiestos: mientras no cambien, Docker reusa la capa de
# node_modules y el build no vuelve a bajar nada.
COPY package.json package-lock.json ./

# npm ci respeta el lockfile exacto. --omit=dev deja fuera lo que solo sirve para tests.
RUN npm ci --omit=dev && npm cache clean --force


# ---------- imagen final ----------
FROM node:20-alpine

# tini se encarga de reenviar SIGTERM al proceso de Node y de cosechar zombies.
# Sin un init, Node corre como PID 1 y el apagado ordenado no llega a ejecutarse.
RUN apk add --no-cache tini

WORKDIR /app

ENV NODE_ENV=production

# Techo de heap acorde a un servidor chico: V8 recolecta antes de que el OOM killer
# del sistema mate el proceso. Ajustar con la RAM real del host.
ENV NODE_OPTIONS="--max-old-space-size=256"

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY public/ ./public/

# El usuario 'node' viene en la imagen oficial. Correr como root no aporta nada aca.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
