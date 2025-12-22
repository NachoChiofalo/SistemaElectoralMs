-- Script completo para inicializar el sistema de roles y permisos
-- Ejecutar manualmente en la base de datos

-- Verificar usuario actual
SELECT current_user, current_database();

-- 1. Crear tabla de roles
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Crear tabla de permisos
CREATE TABLE IF NOT EXISTS permisos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    descripcion TEXT,
    modulo VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Crear tabla de relación rol-permisos
CREATE TABLE IF NOT EXISTS rol_permisos (
    id SERIAL PRIMARY KEY,
    rol_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permiso_id INTEGER REFERENCES permisos(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rol_id, permiso_id)
);

-- 4. Actualizar tabla de usuarios para incluir referencia a roles
DO $$ 
BEGIN
    -- Agregar columna rol_id si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='usuarios' AND column_name='rol_id') THEN
        ALTER TABLE usuarios ADD COLUMN rol_id INTEGER REFERENCES roles(id);
    END IF;
    
    -- Agregar columna nombre_completo si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='usuarios' AND column_name='nombre_completo') THEN
        ALTER TABLE usuarios ADD COLUMN nombre_completo VARCHAR(200);
    END IF;
    
    -- Agregar columna email si no existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='usuarios' AND column_name='email') THEN
        ALTER TABLE usuarios ADD COLUMN email VARCHAR(255);
    END IF;
END $$;

-- 5. Insertar roles por defecto
INSERT INTO roles (nombre, descripcion) VALUES
    ('administrador', 'Administrador del sistema con acceso completo'),
    ('consultor', 'Consultor con acceso a estadísticas y resultados'),
    ('encargado_relevamiento', 'Encargado de relevamiento con acceso al padrón')
ON CONFLICT (nombre) DO NOTHING;

-- 6. Insertar permisos por defecto
INSERT INTO permisos (nombre, descripcion, modulo) VALUES
    ('padron.view', 'Ver padrón electoral', 'padron'),
    ('padron.edit', 'Editar padrón electoral', 'padron'),
    ('padron.import', 'Importar datos del padrón', 'padron'),
    ('padron.export', 'Exportar datos del padrón', 'padron'),
    ('resultados.view', 'Ver estadísticas y resultados', 'resultados'),
    ('fiscales.view', 'Ver información de fiscales', 'fiscales'),
    ('fiscales.edit', 'Gestionar fiscales', 'fiscales'),
    ('usuarios.view', 'Ver usuarios del sistema', 'usuarios'),
    ('usuarios.edit', 'Gestionar usuarios del sistema', 'usuarios'),
    ('reportes.generate', 'Generar reportes', 'reportes'),
    ('reportes.view', 'Ver reportes', 'reportes'),
    ('comicio.view', 'Ver información de comicios', 'comicio'),
    ('comicio.edit', 'Gestionar comicios', 'comicio')
ON CONFLICT (nombre) DO NOTHING;

-- 7. Asignar permisos a roles

-- Administrador: todos los permisos
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id 
FROM roles r, permisos p 
WHERE r.nombre = 'administrador'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Consultor: solo resultados y reportes de visualización
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id 
FROM roles r, permisos p 
WHERE r.nombre = 'consultor' 
AND p.nombre IN ('resultados.view', 'reportes.view')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Encargado de relevamiento: solo padrón
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id 
FROM roles r, permisos p 
WHERE r.nombre = 'encargado_relevamiento' 
AND p.nombre IN ('padron.view', 'padron.edit', 'padron.import', 'padron.export')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- 8. Crear usuarios de ejemplo
-- Nota: password hash para 'password' es: $2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi

-- Usuario administrador
INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id, activo)
VALUES (
    'admin',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'Administrador del Sistema',
    'admin@electoral.com',
    (SELECT id FROM roles WHERE nombre = 'administrador'),
    true
) ON CONFLICT (username) DO UPDATE SET
    rol_id = (SELECT id FROM roles WHERE nombre = 'administrador'),
    nombre_completo = 'Administrador del Sistema',
    email = 'admin@electoral.com',
    password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

-- Usuario consultor
INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id, activo)
VALUES (
    'consultor',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'Consultor Electoral',
    'consultor@electoral.com',
    (SELECT id FROM roles WHERE nombre = 'consultor'),
    true
) ON CONFLICT (username) DO UPDATE SET
    rol_id = (SELECT id FROM roles WHERE nombre = 'consultor'),
    nombre_completo = 'Consultor Electoral',
    email = 'consultor@electoral.com',
    password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

-- Usuario encargado
INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id, activo)
VALUES (
    'encargado',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'Encargado de Relevamiento',
    'encargado@electoral.com',
    (SELECT id FROM roles WHERE nombre = 'encargado_relevamiento'),
    true
) ON CONFLICT (username) DO UPDATE SET
    rol_id = (SELECT id FROM roles WHERE nombre = 'encargado_relevamiento'),
    nombre_completo = 'Encargado de Relevamiento',
    email = 'encargado@electoral.com',
    password_hash = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

-- 9. Verificar la instalación
\echo '=== VERIFICACIÓN DE INSTALACIÓN ==='

\echo 'Roles creados:'
SELECT id, nombre, descripcion FROM roles ORDER BY nombre;

\echo 'Permisos creados:'
SELECT id, nombre, modulo FROM permisos ORDER BY modulo, nombre;

\echo 'Usuarios creados:'
SELECT 
    u.username,
    u.nombre_completo,
    u.email,
    r.nombre as rol,
    u.activo
FROM usuarios u
LEFT JOIN roles r ON u.rol_id = r.id
WHERE u.username IN ('admin', 'consultor', 'encargado')
ORDER BY u.username;

\echo 'Permisos por usuario:'
SELECT 
    u.username,
    r.nombre as rol,
    array_agg(p.nombre ORDER BY p.nombre) as permisos
FROM usuarios u
LEFT JOIN roles r ON u.rol_id = r.id
LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
LEFT JOIN permisos p ON rp.permiso_id = p.id
WHERE u.username IN ('admin', 'consultor', 'encargado')
GROUP BY u.username, r.nombre
ORDER BY u.username;