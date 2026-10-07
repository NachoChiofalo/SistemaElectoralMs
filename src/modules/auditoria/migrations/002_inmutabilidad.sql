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

-- DB-033 NO se resuelve con un CHECK de mayusculas, a proposito: el vocabulario real ya es
-- mixto (operacion en mayusculas, entidad en minusculas: 'votante', 'comicio', 'mesa'...) y
-- una restriccion asi rechazaria el registro de auditoria de casi todos los modulos, que
-- `registrar` descartaria en silencio. Si algun dia se quiere fijar el vocabulario, va con
-- una tabla de catalogo y una migracion de datos, no con un CHECK sobre lo que ya hay.
