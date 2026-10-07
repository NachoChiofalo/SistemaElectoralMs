-- padron.auditoria pasa a ser de solo insercion tambien a nivel de motor: hasta ahora
-- la garantia dependia de que AuditoriaRepository no expusiera UPDATE/DELETE (DB-003).

CREATE OR REPLACE FUNCTION padron.bloquear_auditoria_mutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'padron.auditoria es de solo insercion: % no permitido sobre id=%',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON padron.auditoria;
CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON padron.auditoria
  FOR EACH ROW EXECUTE FUNCTION padron.bloquear_auditoria_mutable();

-- CURRENT_USER, no un nombre de rol hardcodeado: la migracion corre con la misma
-- conexion (mismo rol) que usa la aplicacion (ver core/db.js, un solo pool).
REVOKE UPDATE, DELETE ON padron.auditoria FROM CURRENT_USER;

COMMENT ON COLUMN padron.auditoria.usuario_id IS
  'Sin FK a usuarios a proposito: un DELETE sobre una cuenta no debe arrastrar en cascada su rastro de auditoria (DB-016).';

-- Restriccion de forma, no de contenido: no fija una lista cerrada de valores (el
-- vocabulario de operacion/entidad crece con el tiempo, como el REFRESH que este mismo
-- cambio agrega), solo evita que una variante en minuscula fragmente en silencio las
-- agregaciones de estadisticas() (DB-033). NOT VALID: no escanea las filas existentes (Render
-- corre las migraciones en cada arranque y una fila vieja en minuscula impediria arrancar).
ALTER TABLE padron.auditoria DROP CONSTRAINT IF EXISTS chk_auditoria_vocabulario;
ALTER TABLE padron.auditoria ADD CONSTRAINT chk_auditoria_vocabulario
  CHECK (operacion = UPPER(operacion) AND entidad = UPPER(entidad)) NOT VALID;
