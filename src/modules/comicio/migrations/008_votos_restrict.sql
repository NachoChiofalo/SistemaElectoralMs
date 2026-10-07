-- G2 / DB-009: borrar una mesa arrastraba en cascada los votos cargados, mientras que borrar una
-- fuerza con votos ya estaba bloqueado (votos_fuerza -> fuerzas es RESTRICT): la proteccion solo
-- existia de un lado. El service ahora responde 409 antes de llegar aca; esto es la red de
-- seguridad en la base. Reemplazar los votos de una mesa sigue funcionando: lo hace con un DELETE
-- explicito de sus propias filas, que RESTRICT no impide.
ALTER TABLE elecciones.votos_fuerza DROP CONSTRAINT IF EXISTS votos_fuerza_mesa_id_fkey;
ALTER TABLE elecciones.votos_fuerza
  ADD CONSTRAINT votos_fuerza_mesa_id_fkey
  FOREIGN KEY (mesa_id) REFERENCES elecciones.mesas(id) ON DELETE RESTRICT;
