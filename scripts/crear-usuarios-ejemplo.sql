-- Script para crear usuarios de ejemplo con diferentes roles
-- Ejecutar después de que la base de datos esté inicializada

-- Nota: Este script debe ejecutarse después de que el AuthService haya inicializado
-- las tablas de roles y permisos, ya que usa el sistema automatizado del AuthService

-- Verificar que las tablas de roles existan
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'roles') THEN
        RAISE NOTICE 'ADVERTENCIA: Las tablas de roles no existen. Ejecute primero el servicio de auth para que se inicialicen automáticamente.';
    END IF;
END $$;

-- Solo proceder si las tablas existen
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'roles') THEN
        
        -- 1. Usuario Administrador (acceso completo)
        INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
        VALUES (
            'admin',
            '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: password (para testing)
            'Administrador del Sistema',
            'admin@electoral.com',
            (SELECT id FROM roles WHERE nombre = 'administrador')
        ) ON CONFLICT (username) DO UPDATE SET
            rol_id = (SELECT id FROM roles WHERE nombre = 'administrador'),
            nombre_completo = 'Administrador del Sistema',
            email = 'admin@electoral.com';

        -- 2. Usuario Consultor (solo estadísticas)
        INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
        VALUES (
            'consultor',
            '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: password
            'Consultor Electoral',
            'consultor@electoral.com',
            (SELECT id FROM roles WHERE nombre = 'consultor')
        ) ON CONFLICT (username) DO UPDATE SET
            rol_id = (SELECT id FROM roles WHERE nombre = 'consultor'),
            nombre_completo = 'Consultor Electoral',
            email = 'consultor@electoral.com';

        -- 3. Usuario Encargado de Relevamiento (solo padrón)
        INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
        VALUES (
            'encargado',
            '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password: password
            'Encargado de Relevamiento',
            'encargado@electoral.com',
            (SELECT id FROM roles WHERE nombre = 'encargado_relevamiento')
        ) ON CONFLICT (username) DO UPDATE SET
            rol_id = (SELECT id FROM roles WHERE nombre = 'encargado_relevamiento'),
            nombre_completo = 'Encargado de Relevamiento',
            email = 'encargado@electoral.com';

        RAISE NOTICE 'Usuarios de ejemplo creados correctamente.';
        RAISE NOTICE 'Credenciales: admin/password, consultor/password, encargado/password';
        
    END IF;
END $$;

-- Verificar que los usuarios fueron creados correctamente
SELECT 
    u.username,
    u.nombre_completo,
    u.email,
    r.nombre as rol,
    array_agg(p.nombre) as permisos
FROM usuarios u
LEFT JOIN roles r ON u.rol_id = r.id
LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
LEFT JOIN permisos p ON rp.permiso_id = p.id
WHERE u.username IN ('admin', 'consultor', 'encargado')
GROUP BY u.username, u.nombre_completo, u.email, r.nombre
ORDER BY u.username;