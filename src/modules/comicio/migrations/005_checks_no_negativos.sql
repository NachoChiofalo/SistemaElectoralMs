-- G7 / DB-025 / DB-037: votos en blanco/nulos y numero de mesa sin cota inferior a nivel
-- de esquema. Hoy lo unico que lo impide es la validacion de service.js; cualquier
-- escritura futura que no pase por ahi podria guardar un valor negativo.
--
-- NOT VALID: la restriccion rige para toda fila nueva o modificada, pero NO escanea las
-- existentes. Render corre las migraciones en cada arranque contra la unica base que hay,
-- asi que un CHECK sobre datos que no revisamos podria impedir el arranque.

ALTER TABLE elecciones.mesas DROP CONSTRAINT IF EXISTS chk_mesas_votos_blancos_no_negativo;
ALTER TABLE elecciones.mesas ADD CONSTRAINT chk_mesas_votos_blancos_no_negativo
  CHECK (votos_blancos IS NULL OR votos_blancos >= 0) NOT VALID;

ALTER TABLE elecciones.mesas DROP CONSTRAINT IF EXISTS chk_mesas_votos_nulos_no_negativo;
ALTER TABLE elecciones.mesas ADD CONSTRAINT chk_mesas_votos_nulos_no_negativo
  CHECK (votos_nulos IS NULL OR votos_nulos >= 0) NOT VALID;

ALTER TABLE elecciones.mesas DROP CONSTRAINT IF EXISTS chk_mesas_numero_positivo;
ALTER TABLE elecciones.mesas ADD CONSTRAINT chk_mesas_numero_positivo
  CHECK (numero > 0) NOT VALID;
