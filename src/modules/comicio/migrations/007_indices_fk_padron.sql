-- DB-035: borrar un votante del padron obliga a Postgres a comprobar que ninguna mesa lo
-- use como limite (FK ON DELETE RESTRICT). Sin indice sobre esas dos columnas, cada
-- DELETE de votante recorre toda la tabla de mesas.
CREATE INDEX IF NOT EXISTS idx_mesas_padron_desde ON elecciones.mesas (padron_desde_dni);
CREATE INDEX IF NOT EXISTS idx_mesas_padron_hasta ON elecciones.mesas (padron_hasta_dni);
