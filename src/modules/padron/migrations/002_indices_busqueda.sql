-- Indices para las dos consultas mas caras del padron: el listado ordenado y la
-- busqueda por texto.
--
-- Nota: padron.relevamientos(dni) YA estaba indexado, por el UNIQUE(dni) de la tabla.
-- Lo que faltaba es lo de abajo.

-- El listado ordena siempre por (apellido, nombre). Con el indice solo sobre apellido,
-- Postgres tenia que ordenar el segundo campo en memoria en cada pagina.
CREATE INDEX IF NOT EXISTS idx_votantes_apellido_nombre
    ON padron.votantes (apellido, nombre);

-- La busqueda general hace LIKE '%texto%' sobre nombre y apellido. Un btree no sirve
-- con comodin al principio; pg_trgm si. Supabase trae la extension disponible.
--
-- Si el rol de la base no puede crear extensiones, esta migracion falla y hay que
-- habilitarla desde el panel de Supabase (Database > Extensions > pg_trgm) antes de
-- volver a correr migrate. La aplicacion funciona sin estos indices: la busqueda
-- simplemente hace scan secuencial.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_votantes_apellido_trgm
    ON padron.votantes USING gin (LOWER(apellido) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_votantes_nombre_trgm
    ON padron.votantes USING gin (LOWER(nombre) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_votantes_dni_trgm
    ON padron.votantes USING gin (dni gin_trgm_ops);
