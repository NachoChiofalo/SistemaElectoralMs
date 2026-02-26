# 🚀 Guía de Despliegue - Sistema Electoral (Railway)

> **Arquitectura Agnóstica**: Este proyecto usa Dockerfiles estándar y variables de entorno genéricas. Puede desplegarse en Railway, Render, Fly.io, AWS ECS o cualquier plataforma que soporte contenedores Docker sin modificar el código fuente.

## Requisitos Previos

- Cuenta en [Railway](https://railway.app)
- Repositorio en GitHub (rama `implementacion` o `main`)

## Paso 1: Crear Proyecto en Railway

1. Ir a [railway.app/dashboard](https://railway.app/dashboard) y hacer clic en **New Project**.
2. Seleccionar **Deploy from GitHub repo**.
3. Conectar tu cuenta de GitHub y seleccionar el repositorio `SistemaElectoralMs`.
4. Elegir la rama `implementacion` (o `main`).

## Paso 2: Provisionar PostgreSQL

1. Dentro del proyecto en Railway, hacer clic en **+ New** → **Database** → **Add PostgreSQL**.
2. Railway creará automáticamente las variables de conexión (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`).

## Paso 3: Crear los Servicios

Cada microservicio se despliega individualmente. Para cada uno:

1. **+ New** → **GitHub Repo** → seleccionar el mismo repositorio.
2. En **Settings** de cada servicio, configurar:
   - **Root Directory**: la ruta al servicio (ej: `services/auth-service`)
   - **Builder**: Dockerfile

Crear los siguientes servicios:

| Servicio | Root Directory | Puerto por defecto |
|----------|---------------|-------------------|
| auth-service | `services/auth-service` | 3002 |
| gateway-service | `services/gateway-service` | 8080 |
| padron-service | `services/padron-service` | 3001 |
| web-admin | `clients/web-admin` | 3000 |

## Paso 4: Configurar Variables de Entorno

En el panel de Railway, para cada servicio, ir a **Variables** y configurar:

### auth-service
```
NODE_ENV=production
JWT_SECRET=<genera-un-string-seguro-aleatorio-de-al-menos-32-caracteres>
JWT_EXPIRATION=24h
REFRESH_TOKEN_EXPIRATION=7d
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_NAME=${{Postgres.PGDATABASE}}
DB_USER=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
```

### gateway-service
```
NODE_ENV=production
AUTH_SERVICE_URL=http://${{auth-service.RAILWAY_PRIVATE_DOMAIN}}:${{auth-service.PORT}}
PADRON_SERVICE_URL=http://${{padron-service.RAILWAY_PRIVATE_DOMAIN}}:${{padron-service.PORT}}
WEB_ADMIN_URL=http://${{web-admin.RAILWAY_PRIVATE_DOMAIN}}:${{web-admin.PORT}}
FRONTEND_URL=https://${{gateway-service.RAILWAY_PUBLIC_DOMAIN}}
```

### padron-service
```
NODE_ENV=production
DB_HOST=${{Postgres.PGHOST}}
DB_PORT=${{Postgres.PGPORT}}
DB_NAME=${{Postgres.PGDATABASE}}
DB_USER=${{Postgres.PGUSER}}
DB_PASSWORD=${{Postgres.PGPASSWORD}}
```

### web-admin
```
NODE_ENV=production
```

> **Nota**: Railway asigna automáticamente la variable `PORT` a cada servicio. Los Dockerfiles y el código ya la respetan.

## Paso 5: Generar Dominio Público

1. En el servicio **gateway-service**, ir a **Settings** → **Networking** → **Generate Domain**.
2. Este será el punto de entrada público de tu aplicación.

## Paso 6: Inicializar la Base de Datos

La primera vez que se ejecute `auth-service`, creará automáticamente las tablas de usuarios, roles y permisos. El `init-db.sql` en `scripts/` se ejecuta al provisionar PostgreSQL si se monta como volumen.

Para ejecutarlo manualmente desde Railway:
```bash
railway connect postgres
\i scripts/init-db.sql
```

## Paso 7: Verificar Despliegue

Acceder a los health checks:
- `https://<tu-dominio>.railway.app/health` (Gateway)

## Desarrollo Local

```bash
# 1. Copiar variables de entorno
cp .env.example .env
# Editar .env con tus valores locales (especialmente JWT_SECRET)

# 2. Levantar con Docker Compose
docker-compose up -d

# 3. Acceder a http://localhost:8080
```

## Migración a Otras Plataformas

Este proyecto no tiene dependencias específicas de Railway. Para migrar:

1. Usa los Dockerfiles estándar de cada servicio.
2. Configura las variables de entorno listadas en `.env.example`.
3. Asegúrate de que cada servicio reciba la variable `PORT` (o usará su valor por defecto).
4. Provisiona una base de datos PostgreSQL y apunta las variables `DB_*` a ella.