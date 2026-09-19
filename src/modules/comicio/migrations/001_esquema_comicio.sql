-- Esquema de comicios, mesas y votos.
--
-- Va en el schema `elecciones`, el mismo de 017 (listas): comicio referencia listas
-- directamente. El rango de cada mesa son dos DNIs, no una tabla de asignacion
-- votante-mesa: materializar esa asignacion obligaria a mantenerla sincronizada en cada
-- importacion de CSV (013). La cantidad de votantes de una mesa se calcula en el momento
-- contra padron.votantes, ordenado (apellido, nombre, dni) -- el mismo orden que ya usa
-- el listado del padron.

CREATE TABLE IF NOT EXISTS elecciones.comicios (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(200) NOT NULL,
    tipo_eleccion VARCHAR(20)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elecciones.comicio_listas (
    comicio_id INTEGER NOT NULL REFERENCES elecciones.comicios(id) ON DELETE CASCADE,
    lista_id   INTEGER NOT NULL REFERENCES elecciones.listas(id) ON DELETE RESTRICT,
    PRIMARY KEY (comicio_id, lista_id)
);

CREATE TABLE IF NOT EXISTS elecciones.mesas (
    id               SERIAL PRIMARY KEY,
    comicio_id       INTEGER     NOT NULL REFERENCES elecciones.comicios(id) ON DELETE CASCADE,
    numero           INTEGER     NOT NULL,
    padron_desde_dni VARCHAR(20) NOT NULL REFERENCES padron.votantes(dni),
    padron_hasta_dni VARCHAR(20) NOT NULL REFERENCES padron.votantes(dni),
    votos_blancos    INTEGER,
    votos_nulos      INTEGER,
    UNIQUE (comicio_id, numero)
);

CREATE TABLE IF NOT EXISTS elecciones.votos_lista (
    mesa_id  INTEGER NOT NULL REFERENCES elecciones.mesas(id) ON DELETE CASCADE,
    lista_id INTEGER NOT NULL REFERENCES elecciones.listas(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL CHECK (cantidad >= 0),
    PRIMARY KEY (mesa_id, lista_id)
);

CREATE INDEX IF NOT EXISTS idx_comicio_listas_comicio ON elecciones.comicio_listas(comicio_id);
CREATE INDEX IF NOT EXISTS idx_mesas_comicio           ON elecciones.mesas(comicio_id);
CREATE INDEX IF NOT EXISTS idx_votos_lista_mesa         ON elecciones.votos_lista(mesa_id);
