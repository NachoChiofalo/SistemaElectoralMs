-- G2 / DB-006: borrar un votante arrastraba en cascada su relevamiento, es decir, trabajo de campo
-- real, sin dejar rastro. Ninguna ruta borra votantes, asi que esto cubre un DELETE directo o un
-- script futuro: ahora falla en vez de llevarse el relevamiento.
ALTER TABLE padron.relevamientos DROP CONSTRAINT IF EXISTS relevamientos_dni_fkey;
ALTER TABLE padron.relevamientos
  ADD CONSTRAINT relevamientos_dni_fkey
  FOREIGN KEY (dni) REFERENCES padron.votantes(dni) ON DELETE RESTRICT;
