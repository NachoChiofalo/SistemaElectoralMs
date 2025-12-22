# Microservicios del Sistema Electoral

Esta es la implementación en microservicios del Sistema Electoral, empezando con el módulo de Padrón Electoral.

## Arquitectura

```
microservicios/
├── services/                 # Servicios backend
│   └── padron-service/      # API REST para gestión de padrón
├── clients/                 # Clientes frontend  
│   └── web-admin/          # Interfaz web de administración
├── shared/                  # Código compartido (futuro)
└── docker-compose.yml       # Orquestación de servicios
```

## Servicios Disponibles

### 1. Padrón Service (Puerto 3001)
Microservicio para gestión del padrón electoral:
- **Tecnología**: Node.js + Express
- **API**: REST con endpoints para CRUD de votantes y relevamientos
- **Características**:
  - Importación de archivos CSV
  - Paginación y filtros avanzados
  - Estadísticas en tiempo real
  - Validaciones de datos
  - Manejo de errores centralizado

### 2. Web Admin Client (Puerto 3000)
Cliente web para administración:
- **Tecnología**: HTML5 + JavaScript vanilla + CSS3
- **Características**:
  - Interfaz responsive
  - Comunicación con APIs via fetch
  - Componentes reutilizables
  - Gestión de estado local

## Instalación y Ejecución

### Con Docker (Recomendado)

1. **Clonar y navegar al directorio**:
```bash
cd microservicios
```

2. **Ejecutar todos los servicios**:
```bash
docker-compose up -d
```

3. **Acceder a las aplicaciones**:
- Web Admin: http://localhost:3000
- API Padrón: http://localhost:3001/api/padron
- Health Check: http://localhost:3001/health

### Desarrollo Local

#### Servicio de Padrón:
```bash
cd services/padron-service
npm install
npm run dev
```

#### Cliente Web:
```bash
cd clients/web-admin
npm install
npm start
```

## API del Padrón Electoral

### Endpoints Principales

#### Votantes
- `GET /api/padron/votantes` - Lista paginada de votantes
- `GET /api/padron/votantes/:dni` - Obtener votante por DNI

#### Relevamientos
- `PUT /api/padron/relevamientos/:dni` - Actualizar relevamiento
- `GET /api/padron/relevamientos/:dni` - Obtener relevamiento

#### Utilidades
- `GET /api/padron/estadisticas` - Estadísticas del padrón
- `GET /api/padron/filtros` - Opciones para filtros
- `POST /api/padron/importar-csv` - Importar archivo CSV
- `GET /api/padron/exportar` - Exportar datos

### Ejemplo de Uso de la API

```javascript
// Obtener votantes con filtros
fetch('http://localhost:3001/api/padron/votantes?pagina=1&limite=50&circuito=162')
  .then(response => response.json())
  .then(data => console.log(data));

// Actualizar relevamiento
fetch('http://localhost:3001/api/padron/relevamientos/12345678', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    opcionPolitica: 'PJ',
    observacion: 'Simpatizante activo'
  })
});
```

## Estructura del Servicio de Padrón

```
padron-service/
├── src/
│   ├── controllers/         # Controladores de rutas
│   ├── models/             # Modelos de datos
│   ├── services/           # Lógica de negocio
│   ├── routes/             # Definición de rutas
│   ├── middleware/         # Middlewares
│   └── app.js             # Aplicación principal
├── package.json
├── Dockerfile
└── .env
```

## Modelos de Datos

### Votante
```javascript
{
  dni: string,
  anioNac: number,
  apellido: string,
  nombre: string,
  domicilio: string,
  tipoEjempl: string,
  circuito: string,
  sexo: string,
  edad: number
}
```

### Relevamiento
```javascript
{
  dni: string,
  opcionPolitica: 'PJ' | 'UCR' | 'Indeciso',
  observacion: string,
  fechaRelevamiento: string,
  fechaModificacion: string
}
```

## Próximos Microservicios

La arquitectura está preparada para agregar:

1. **Authentication Service** - Gestión de usuarios y autenticación
2. **Electoral Process Service** - Configuración de elecciones
3. **Candidate Service** - Gestión de candidatos
4. **Voting Service** - Proceso de votación
5. **Results Service** - Cálculo y gestión de resultados
6. **Notification Service** - Envío de notificaciones
7. **Audit Service** - Trazabilidad y logs

## Configuración

### Variables de Entorno (Padrón Service)
```env
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=padron_electoral
```

### Base de Datos (Futuro)
El servicio está preparado para migrar de almacenamiento en memoria a PostgreSQL:
- Conexión configurada en variables de entorno
- Modelos listos para ORM (Sequelize/Prisma)
- Migraciones preparadas

## Monitoreo y Logs

### Health Checks
- Endpoint: `GET /health`
- Docker health checks configurados
- Respuesta incluye timestamp y estado del servicio

### Logs
- Morgan para logs HTTP
- Console logs estructurados por módulo
- Preparado para centralización de logs

## Seguridad

### Implementadas
- CORS configurado
- Helmet para headers de seguridad
- Validación de datos de entrada
- Sanitización de archivos CSV

### Por Implementar
- Autenticación JWT
- Rate limiting
- Validación de esquemas con Joi/Zod
- Encriptación de datos sensibles

## Testing

Preparado para:
- Unit tests con Jest
- Integration tests
- API testing con Supertest

```bash
cd services/padron-service
npm test
```

## Desarrollo

### Agregar Nuevo Microservicio

1. Crear directorio en `services/`
2. Implementar estructura estándar
3. Agregar al `docker-compose.yml`
4. Configurar comunicación entre servicios

### Estándares de Código
- ESLint configurado
- Prettier para formateo
- Estructura de carpetas consistente
- Documentación inline

## Migración desde Monolito

Para migrar del sistema existente:

1. Los datos del localStorage pueden importarse via API
2. Los archivos CSS son compatibles
3. La lógica de negocio se mantiene
4. La interfaz es evolutiva (no breaking changes)

## Troubleshooting

### Puerto ocupado
```bash
# Verificar puertos
netstat -an | findstr "3000\|3001"

# Cambiar puertos en docker-compose.yml si es necesario
```

### Problemas de CORS
Verificar variable `CORS_ORIGIN` en `.env`

### Logs de contenedores
```bash
docker-compose logs padron-service
docker-compose logs web-admin
```

## Contribución

1. Fork del repositorio
2. Crear feature branch
3. Implementar con tests
4. Pull request con descripción detallada

---

**Nota**: Esta es la base de la arquitectura de microservicios. Cada servicio es independiente y escalable horizontalmente.