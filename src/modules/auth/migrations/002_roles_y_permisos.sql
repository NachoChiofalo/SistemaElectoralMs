-- Roles y permisos del sistema.
--
-- Antes esto se recreaba en cada arranque recorriendo arrays en JavaScript: unas 40
-- consultas SELECT-then-INSERT contra Supabase cada vez que levantaba el servicio.
-- Es data de referencia, no logica: su lugar es una migracion idempotente.

INSERT INTO roles (nombre, descripcion) VALUES
    ('administrador',          'Acceso completo al sistema electoral'),
    ('consultor',              'Acceso de solo lectura a estadisticas y resultados'),
    ('encargado_relevamiento', 'Acceso a gestion del padron electoral')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
    ('dashboard.view',      'Ver Dashboard',           'Acceso al panel principal',              'dashboard'),
    ('padron.view',         'Ver Padron',              'Consultar padron electoral',             'padron'),
    ('padron.edit',         'Editar Padron',           'Modificar datos del padron',             'padron'),
    ('padron.relevamiento', 'Relevamiento',            'Realizar relevamientos del padron',      'padron'),
    ('padron.export',       'Exportar Padron',         'Exportar datos del padron',              'padron'),
    ('resultados.view',     'Ver Resultados',          'Consultar estadisticas y resultados',    'resultados'),
    ('resultados.export',   'Exportar Resultados',     'Exportar reportes estadisticos',         'resultados'),
    ('fiscales.view',       'Ver Fiscales',            'Consultar fiscales de mesa',             'fiscales'),
    ('fiscales.edit',       'Gestionar Fiscales',      'Administrar fiscales de mesa',           'fiscales'),
    ('comicio.view',        'Ver Comicio',             'Consultar lugares de votacion',          'comicio'),
    ('comicio.edit',        'Gestionar Comicio',       'Administrar lugares de votacion',        'comicio'),
    ('admin.users',         'Gestion de Usuarios',     'Administrar usuarios del sistema',       'admin'),
    ('admin.roles',         'Gestion de Roles',        'Administrar roles y permisos',           'admin'),
    ('admin.system',        'Configuracion Sistema',   'Configurar parametros del sistema',      'admin')
ON CONFLICT (codigo) DO NOTHING;

-- El administrador tiene todos los permisos, incluidos los que se agreguen despues
-- de esta migracion (por eso el SELECT sin lista fija).
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permisos p
WHERE r.nombre = 'administrador'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo IN ('dashboard.view', 'resultados.view', 'resultados.export')
WHERE r.nombre = 'consultor'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo IN ('dashboard.view', 'padron.view', 'padron.edit', 'padron.relevamiento', 'padron.export')
WHERE r.nombre = 'encargado_relevamiento'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;
