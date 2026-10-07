-- G2: borrar una mesa se llevaba en cascada las asignaciones de sus fiscales, sin que nadie lo
-- viera. El service de comicio ahora responde 409 antes de llegar aca; esto es la red de
-- seguridad en la base. Borrar un FISCAL sigue arrastrando sus propias asignaciones
-- (fiscal_id queda en CASCADE a proposito: sin el fiscal no tienen sentido).
ALTER TABLE elecciones.fiscal_asignaciones DROP CONSTRAINT IF EXISTS fiscal_asignaciones_mesa_id_fkey;
ALTER TABLE elecciones.fiscal_asignaciones
  ADD CONSTRAINT fiscal_asignaciones_mesa_id_fkey
  FOREIGN KEY (mesa_id) REFERENCES elecciones.mesas(id) ON DELETE RESTRICT;
