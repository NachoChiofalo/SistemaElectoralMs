# Sistema de Roles y Permisos - Sistema Electoral

## Descripción General

Se ha implementado un sistema completo de roles y permisos que permite controlar el acceso a diferentes funcionalidades del sistema electoral según el tipo de usuario.

## Roles Disponibles

### 1. 👑 Administrador
- **Acceso**: Completo a todo el sistema
- **Permisos**:
  - `padron.view` - Ver padrón electoral
  - `padron.edit` - Editar padrón electoral
  - `padron.import` - Importar datos del padrón
  - `padron.export` - Exportar datos del padrón
  - `resultados.view` - Ver estadísticas y resultados
  - `fiscales.view` - Ver información de fiscales
  - `fiscales.edit` - Gestionar fiscales
  - `usuarios.view` - Ver usuarios del sistema
  - `usuarios.edit` - Gestionar usuarios
  - `reportes.generate` - Generar reportes
  - `reportes.view` - Ver reportes
  - `comicio.view` - Ver información de comicios
  - `comicio.edit` - Gestionar comicios

### 2. 📊 Consultor
- **Acceso**: Solo estadísticas y resultados
- **Permisos**:
  - `resultados.view` - Ver estadísticas y resultados
  - `reportes.view` - Ver reportes generados

### 3. 📝 Encargado de Relevamiento
- **Acceso**: Solo gestión del padrón electoral
- **Permisos**:
  - `padron.view` - Ver padrón electoral
  - `padron.edit` - Editar padrón electoral
  - `padron.import` - Importar datos del padrón
  - `padron.export` - Exportar datos del padrón

## Usuarios de Prueba

Para facilitar el desarrollo y testing, se han creado usuarios de ejemplo:

| Usuario    | Contraseña | Rol                     | Descripción                    |
|------------|------------|-------------------------|--------------------------------|
| `admin`    | `password` | Administrador          | Acceso completo al sistema     |
| `consultor`| `password` | Consultor              | Solo estadísticas y resultados |
| `encargado`| `password` | Encargado Relevamiento | Solo gestión del padrón        |

## Estructura de Base de Datos

### Tabla `roles`
```sql
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla `permisos`
```sql
CREATE TABLE permisos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    descripcion TEXT,
    modulo VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla `rol_permisos`
```sql
CREATE TABLE rol_permisos (
    id SERIAL PRIMARY KEY,
    rol_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permiso_id INTEGER REFERENCES permisos(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rol_id, permiso_id)
);
```

### Actualización tabla `usuarios`
```sql
ALTER TABLE usuarios 
ADD COLUMN rol_id INTEGER REFERENCES roles(id),
ADD COLUMN nombre_completo VARCHAR(200),
ADD COLUMN email VARCHAR(255);
```

## Implementación Frontend

### Sistema de Permisos en JavaScript

El frontend incluye validación de permisos en tiempo real:

```javascript
// Verificar si el usuario tiene un permiso específico
const hasPermission = (permission) => {
    return userPermissions.includes(permission);
};

// Configurar UI basada en permisos
const configureUIBasedOnPermissions = () => {
    // Ocultar/mostrar elementos según permisos
    const editButtons = document.querySelectorAll('[data-requires-permission="padron.edit"]');
    editButtons.forEach(button => {
        if (!hasPermission('padron.edit')) {
            button.style.display = 'none';
        }
    });
};
```

### Atributos HTML para Control de Permisos

Los elementos de la interfaz pueden usar atributos para especificar qué permisos requieren:

```html
<!-- Botón que solo pueden ver usuarios con permiso de edición -->
<button data-requires-permission="padron.edit">Editar</button>

<!-- Sección que requiere permiso de visualización -->
<div data-requires-permission="resultados.view">Estadísticas</div>
```

## Implementación Backend

### Middleware de Autorización

El gateway incluye middleware para validar permisos en las rutas de la API:

```javascript
// Verificar permiso específico
app.use('/api/padron', requirePermission('padron.view'));

// Verificar cualquier permiso de una lista
app.use('/api/admin', requireAnyPermission(['usuarios.edit', 'usuarios.view']));

// Verificar todos los permisos de una lista
app.use('/api/reports', requireAllPermissions(['reportes.generate', 'reportes.view']));
```

### JWT con Permisos Embebidos

Los tokens JWT incluyen los permisos del usuario para validación en el cliente:

```json
{
  "id": 1,
  "username": "admin",
  "rol": "administrador",
  "permisos": [
    "padron.view",
    "padron.edit",
    "resultados.view",
    "usuarios.edit"
  ]
}
```

## Rutas Protegidas por Permisos

### API Gateway - Rutas del Padrón
- `GET /api/padron/votantes` - Requiere: `padron.view` o `padron.edit`
- `POST /api/padron/detalle` - Requiere: `padron.edit`
- `PUT /api/padron/detalle` - Requiere: `padron.edit`

### API Gateway - Rutas de Resultados
- `GET /api/resultados/*` - Requiere: `resultados.view`

## Extensibilidad del Sistema

### Agregar Nuevos Permisos

Para agregar un nuevo permiso:

1. **Base de datos**:
```sql
INSERT INTO permisos (nombre, descripcion, modulo) 
VALUES ('nuevo_modulo.nueva_accion', 'Descripción del permiso', 'nuevo_modulo');
```

2. **Asignar a roles**:
```sql
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id 
FROM roles r, permisos p 
WHERE r.nombre = 'administrador' 
AND p.nombre = 'nuevo_modulo.nueva_accion';
```

3. **Frontend**: Usar atributo `data-requires-permission="nuevo_modulo.nueva_accion"`

4. **Backend**: Usar middleware `requirePermission('nuevo_modulo.nueva_accion')`

### Agregar Nuevos Roles

1. **Crear rol**:
```sql
INSERT INTO roles (nombre, descripcion) 
VALUES ('nuevo_rol', 'Descripción del nuevo rol');
```

2. **Asignar permisos**:
```sql
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id 
FROM roles r, permisos p 
WHERE r.nombre = 'nuevo_rol' 
AND p.nombre IN ('permiso1', 'permiso2', 'permiso3');
```

## Scripts de Desarrollo

### Inicializar Sistema con Usuarios de Prueba

**Windows**:
```cmd
scripts\dev-roles.bat
```

**Linux/Mac**:
```bash
chmod +x scripts/dev-roles.sh
./scripts/dev-roles.sh
```

### Crear Solo Usuarios de Ejemplo
```bash
psql -h localhost -p 5432 -U postgres -d sistema_electoral -f scripts/crear-usuarios-ejemplo.sql
```

## Testing del Sistema

### Flujo de Pruebas

1. **Iniciar sistema**: Ejecutar `dev-roles.bat` o `dev-roles.sh`
2. **Crear usuarios**: Opción 2 del menú de desarrollo
3. **Probar roles**:
   - Login como `admin` - Debe ver todos los módulos
   - Login como `consultor` - Solo debe ver resultados/estadísticas
   - Login como `encargado` - Solo debe ver gestión del padrón
4. **Verificar restricciones**: Los botones y secciones sin permisos deben estar ocultos

### URLs de Prueba

- **Dashboard principal**: http://localhost:8080/dashboard.html
- **Resultados**: http://localhost:8080/resultados.html (solo consultores y administradores)
- **API de usuario**: http://localhost:8080/api/auth/me (devuelve permisos)

## Seguridad

### Validación Doble

El sistema implementa validación tanto en frontend como backend:

- **Frontend**: Oculta elementos y valida acceso a páginas
- **Backend**: Valida permisos en cada request de API
- **Base de datos**: Constraints de integridad referencial

### Tokens Seguros

- JWT tokens con expiración configurable
- Refresh tokens para sesiones largas
- Permisos embebidos para validación rápida en cliente

## Logs y Debugging

El sistema registra eventos importantes:

```javascript
// Carga de permisos
console.log('✅ Permisos del usuario cargados:', userPermissions);

// Validación de acceso
console.log('❌ Usuario sin permisos para ver resultados');

// Cambios de sección
console.log('📄 Cambio a sección: resultados');
```

---

## Soporte Futuro

El sistema está diseñado para soportar:

- ✅ Roles jerárquicos (roles que heredan permisos de otros)
- ✅ Permisos temporales (con fechas de vencimiento)
- ✅ Permisos a nivel de registro (acceso a datos específicos)
- ✅ Auditoría de acciones por usuario
- ✅ Integración con sistemas externos de autenticación (LDAP, AD)