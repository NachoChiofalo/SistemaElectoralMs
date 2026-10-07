-- DB-011 / DB-012 / BE-029: el listado, el exportador (keyset) y las queries de rango de
-- mesa de comicio ordenan y comparan por la tupla (apellido, nombre, dni). Habia un indice
-- por (apellido, nombre) pero ninguno que cubriera el tercer componente.
--
-- Va sin CONCURRENTLY porque las migraciones corren dentro de una transaccion; con el
-- padron actual (~5.500 filas) el bloqueo dura milisegundos.
CREATE INDEX IF NOT EXISTS idx_votantes_orden ON padron.votantes (apellido, nombre, dni);

-- Redundante: cualquier consulta por apellido la cubre el indice compuesto de arriba, y
-- cada indice de mas encarece cada importacion del padron.
DROP INDEX IF EXISTS padron.idx_votantes_apellido;
