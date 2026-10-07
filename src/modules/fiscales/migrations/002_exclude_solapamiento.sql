-- Respaldo a nivel de base de la garantia que ya valida el service
-- (_validarSinSolapamiento): un fiscal no puede tener dos asignaciones que se crucen en
-- horario, y una mesa no puede tener dos fiscales asignados en el mismo horario. Hoy es
-- check-then-insert sin transaccion ni lock (dos requests concurrentes pueden pasar
-- ambos el SELECT y ambos el INSERT); esto lo cierra de raiz con dos EXCLUDE
-- constraints. No reemplazan la validacion de aplicacion: esta solo devuelve un 409
-- generico, mientras que el service sigue dando el mensaje con el nombre del
-- fiscal/numero de mesa en conflicto.
--
-- desde/hasta son TIME, y Postgres no trae un range type nativo sobre TIME (solo para
-- int4, int8, numeric, timestamp, timestamptz y date). Se ancla a una fecha fija
-- arbitraria para poder usar tsrange -- es seguro porque el CHECK existente de la tabla
-- ya obliga desde >= '08:00' AND hasta <= '18:00', sin cruce de medianoche que ese
-- anclaje pudiera esconder.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fiscal_asignaciones_sin_solape_mesa'
          AND conrelid = 'elecciones.fiscal_asignaciones'::regclass
    ) THEN
        ALTER TABLE elecciones.fiscal_asignaciones
            ADD CONSTRAINT fiscal_asignaciones_sin_solape_mesa
            EXCLUDE USING gist (
                mesa_id WITH =,
                tsrange('2000-01-01'::date + desde, '2000-01-01'::date + hasta) WITH &&
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fiscal_asignaciones_sin_solape_fiscal'
          AND conrelid = 'elecciones.fiscal_asignaciones'::regclass
    ) THEN
        ALTER TABLE elecciones.fiscal_asignaciones
            ADD CONSTRAINT fiscal_asignaciones_sin_solape_fiscal
            EXCLUDE USING gist (
                fiscal_id WITH =,
                tsrange('2000-01-01'::date + desde, '2000-01-01'::date + hasta) WITH &&
            );
    END IF;
END $$;
