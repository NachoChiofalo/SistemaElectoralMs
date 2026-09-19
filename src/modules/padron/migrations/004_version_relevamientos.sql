-- Version de la ficha, para que dos personas no se pisen el mismo campo sin enterarse.
--
-- La escritura parcial (012 fase 0) ya evita que se pisen campos DISTINTOS: quien carga
-- un telefono no reescribe la observacion. Lo que queda es el mismo campo — dos personas
-- escribiendo la observacion del mismo votante. Ahi no hay SQL que salve a las dos:
-- alguien tiene que perder, y lo unico que se elige es si se entera.
--
-- Con esta columna, quien guarda manda la version que leyo y el UPDATE lleva
-- `WHERE version = $n`. Si otra persona escribio en el medio, la fila no se toca y la
-- respuesta es 409 con el estado actual. La comprobacion y la escritura son la MISMA
-- sentencia: un SELECT seguido de un UPDATE tendria la misma carrera que venimos a sacar.
--
-- Un entero y no fecha_modificacion: el timestamp ya existe, pero su resolucion no
-- garantiza distinguir dos escrituras seguidas, y compararlo obliga a viajar fechas
-- serializadas con su formato y su zona. Un entero es exacto.
--
-- Sin backfill: las filas existentes arrancan en 1, que es lo que hace falta.

ALTER TABLE padron.relevamientos
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
