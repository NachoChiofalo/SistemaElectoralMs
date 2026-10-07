-- DB-013: rangos razonables para anio_nac y edad, como ya tiene `sexo`.
-- NOT VALID: rige para filas nuevas o modificadas y no escanea las existentes. El
-- importador descarta las filas fuera de rango en vez de dejar que volteen el COPY.
ALTER TABLE padron.votantes DROP CONSTRAINT IF EXISTS chk_votantes_anio_nac;
ALTER TABLE padron.votantes ADD CONSTRAINT chk_votantes_anio_nac
  CHECK (anio_nac BETWEEN 1900 AND 2100) NOT VALID;

ALTER TABLE padron.votantes DROP CONSTRAINT IF EXISTS chk_votantes_edad;
ALTER TABLE padron.votantes ADD CONSTRAINT chk_votantes_edad
  CHECK (edad IS NULL OR edad BETWEEN 0 AND 130) NOT VALID;
