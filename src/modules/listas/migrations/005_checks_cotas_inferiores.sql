-- DB-039: cantidad de lugares y posicion de candidatos/suplentes sin cota inferior en el
-- esquema (el service ya exige >= 1 y una secuencia sin huecos desde 1).
-- NOT VALID: rige para filas nuevas o modificadas, no escanea las existentes.
ALTER TABLE elecciones.listas DROP CONSTRAINT IF EXISTS chk_listas_cantidad_lugares;
ALTER TABLE elecciones.listas ADD CONSTRAINT chk_listas_cantidad_lugares
  CHECK (cantidad_lugares >= 1) NOT VALID;

ALTER TABLE elecciones.candidatos DROP CONSTRAINT IF EXISTS chk_candidatos_orden;
ALTER TABLE elecciones.candidatos ADD CONSTRAINT chk_candidatos_orden
  CHECK (orden >= 1) NOT VALID;

ALTER TABLE elecciones.suplentes DROP CONSTRAINT IF EXISTS chk_suplentes_orden;
ALTER TABLE elecciones.suplentes ADD CONSTRAINT chk_suplentes_orden
  CHECK (orden >= 1) NOT VALID;
