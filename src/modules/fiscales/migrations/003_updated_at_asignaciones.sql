-- DB-023: cuando se modifico por ultima vez una asignacion de fiscal. El repository la
-- actualiza en cada UPDATE.
ALTER TABLE elecciones.fiscal_asignaciones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
