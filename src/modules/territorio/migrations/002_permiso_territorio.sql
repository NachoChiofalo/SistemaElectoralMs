-- Permiso del mapa (018). Va en una migracion propia, no en la de auth (ver docs/AGREGAR-MODULO.md).
--
-- En la etapa 1 el mapa es SOLO del administrador: el permiso no se asigna a ningun otro rol. Abrirlo al
-- encargado o al consultor (etapa 2) es asignarle este permiso, sin tocar codigo — y antes hay que resolver
-- que restando zonas visibles se puede deducir una oculta por el umbral (ver la tarea 024 del backlog).

INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
    ('territorio.view', 'Ver Mapa', 'Mapa por manzana y barrio, con estadisticas por zona y lista de votantes', 'territorio')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p
WHERE r.nombre = 'administrador' AND p.codigo = 'territorio.view'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;
