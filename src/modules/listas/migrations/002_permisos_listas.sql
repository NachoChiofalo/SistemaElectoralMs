-- Permisos del modulo de listas. Van en una migracion propia, no en la de auth
-- (ver docs/AGREGAR-MODULO.md).

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
    ('listas.view', 'Ver Listas',      'Consultar listas electorales (borradores)', 'listas'),
    ('listas.edit', 'Gestionar Listas', 'Crear, editar y borrar listas electorales', 'listas')
ON CONFLICT (codigo) DO NOTHING;

-- El administrador recibe todo permiso nuevo automaticamente.
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p
WHERE r.nombre = 'administrador' AND p.codigo IN ('listas.view', 'listas.edit')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;
