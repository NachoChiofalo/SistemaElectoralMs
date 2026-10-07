-- Las FK de elecciones.mesas hacia padron.votantes no declaraban ON DELETE explicito.
-- El comportamiento hoy ya es "no borrar" (default NO ACTION de Postgres) -- esto no
-- cambia nada en la practica, solo lo hace legible desde el esquema: RESTRICT y
-- NO ACTION se comportan igual dentro de una misma sentencia/transaccion (ninguno de
-- los dos permite diferir la verificacion), asi que no hay migracion de datos ni riesgo
-- de romper un borrado que hoy funciona.
--
-- Nombres de constraint confirmados contra el esquema real antes de escribir el DROP
-- (no asumidos por convencion): mesas_padron_desde_dni_fkey, mesas_padron_hasta_dni_fkey.

ALTER TABLE elecciones.mesas
    DROP CONSTRAINT IF EXISTS mesas_padron_desde_dni_fkey,
    ADD CONSTRAINT mesas_padron_desde_dni_fkey
        FOREIGN KEY (padron_desde_dni) REFERENCES padron.votantes(dni) ON DELETE RESTRICT;

ALTER TABLE elecciones.mesas
    DROP CONSTRAINT IF EXISTS mesas_padron_hasta_dni_fkey,
    ADD CONSTRAINT mesas_padron_hasta_dni_fkey
        FOREIGN KEY (padron_hasta_dni) REFERENCES padron.votantes(dni) ON DELETE RESTRICT;
