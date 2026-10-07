-- DB-020, DB-021, DB-023, DB-024.
-- Render corre las migraciones en cada arranque: los CHECK van NOT VALID (rigen para filas
-- nuevas o modificadas, no escanean las existentes) y todo es idempotente.

-- DB-020: el color de una fuerza es un indice 1-8 atado a tokens CSS fijos.
ALTER TABLE elecciones.fuerzas DROP CONSTRAINT IF EXISTS chk_fuerzas_color;
ALTER TABLE elecciones.fuerzas ADD CONSTRAINT chk_fuerzas_color
  CHECK (color BETWEEN 1 AND 8) NOT VALID;

-- DB-024: tipo de eleccion con el mismo dominio que valida el service.
ALTER TABLE elecciones.comicios DROP CONSTRAINT IF EXISTS chk_comicios_tipo_eleccion;
ALTER TABLE elecciones.comicios ADD CONSTRAINT chk_comicios_tipo_eleccion
  CHECK (tipo_eleccion IN ('provincial', 'municipal', 'nacional')) NOT VALID;

-- DB-021: cada uno es prefijo de la PK compuesta de su tabla, asi que no agrega cobertura
-- de lectura y si costo en cada INSERT/DELETE. (idx_mesas_comicio NO es redundante: mesas
-- tiene PK simple.)
DROP INDEX IF EXISTS elecciones.idx_comicio_listas_comicio;
DROP INDEX IF EXISTS elecciones.idx_votos_lista_mesa;
DROP INDEX IF EXISTS elecciones.idx_comicio_fuerzas_comicio;
DROP INDEX IF EXISTS elecciones.idx_votos_fuerza_mesa;

-- DB-023: cuando se cargo o corrigio por ultima vez una mesa (los votos se reemplazan con
-- DELETE + INSERT y no dejaban rastro temporal). El repository la actualiza en cada UPDATE.
ALTER TABLE elecciones.mesas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
