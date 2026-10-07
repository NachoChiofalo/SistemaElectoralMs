-- DB-024: mismo dominio que valida el service. NOT VALID: no escanea las filas existentes.
ALTER TABLE elecciones.listas DROP CONSTRAINT IF EXISTS chk_listas_tipo_eleccion;
ALTER TABLE elecciones.listas ADD CONSTRAINT chk_listas_tipo_eleccion
  CHECK (tipo_eleccion IN ('provincial', 'municipal', 'nacional')) NOT VALID;
