-- Quien toco por ultima vez un relevamiento, y un indice para preguntar que cambio
-- desde un momento dado.
--
-- Hasta aca la fila no guardaba autor: la unica forma de saber quien cargo un dato era
-- buscar en padron.auditoria por entidad_id. Sirve para investigar, no para mostrar
-- "ultima edicion: Juan, hace 3 min" al abrir una ficha, que es lo que evita que alguien
-- cargue encima de trabajo ajeno sin enterarse.
--
-- Sin foreign key a usuarios y con el username desnormalizado al lado del id, igual que
-- padron.auditoria (usuario_id, usuario_nombre, usuario_username). Dos razones: el panel
-- necesita mostrar un nombre y no un numero, y un JOIN entre esquemas en el camino del
-- listado del padron es justo lo que este repo evita. El costo es el de siempre en una
-- desnormalizacion: si alguien se renombra, las filas viejas siguen diciendo el nombre
-- anterior. Para una firma de "quien toco esto" eso es correcto, no un defecto.

ALTER TABLE padron.relevamientos
    ADD COLUMN IF NOT EXISTS actualizado_por          INTEGER,
    ADD COLUMN IF NOT EXISTS actualizado_por_username VARCHAR(100);

-- GET /api/padron/cambios?desde= pregunta por las filas tocadas despues de un momento.
-- Sin indice eso es un scan de toda la tabla cada 30 segundos y por cada persona.
--
-- fecha_detalle va en el mismo indice porque las condiciones especiales se guardan por
-- otro endpoint y solo mueven esa columna: una ficha puede cambiar sin que
-- fecha_modificacion se toque.
CREATE INDEX IF NOT EXISTS idx_relevamientos_modificacion
    ON padron.relevamientos (fecha_modificacion DESC);

CREATE INDEX IF NOT EXISTS idx_relevamientos_fecha_detalle
    ON padron.relevamientos (fecha_detalle DESC);
