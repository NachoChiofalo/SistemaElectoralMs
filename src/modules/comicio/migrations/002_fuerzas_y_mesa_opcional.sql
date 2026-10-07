-- Reemplaza "lista participante" por "fuerza participante" como unidad de voto del
-- comicio, y hace opcional el rango de padron de una mesa.
--
-- Una fuerza es lo que efectivamente se vota en una mesa (PJ, UCR, etc.): nombre y sigla,
-- sin necesidad de armar una lista completa de candidatos en 017 antes de poder crear un
-- comicio. Enlazar una fuerza a una lista de 017 queda como dato opcional, para cuando
-- haga falta el detalle de candidatos -- no es un requisito para votar.
--
-- comicio_listas y votos_lista NO se borran: no hay migracion de datos (se confirmo que
-- la base no tiene comicios reales cargados todavia), pero borrar tablas es una accion
-- destructiva que no hace falta para que el codigo nuevo funcione. Quedan sin uso.

CREATE TABLE IF NOT EXISTS elecciones.fuerzas (
    id         SERIAL PRIMARY KEY,
    nombre     VARCHAR(200) NOT NULL,
    sigla      VARCHAR(20),
    lista_id   INTEGER REFERENCES elecciones.listas(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elecciones.comicio_fuerzas (
    comicio_id INTEGER NOT NULL REFERENCES elecciones.comicios(id) ON DELETE CASCADE,
    fuerza_id  INTEGER NOT NULL REFERENCES elecciones.fuerzas(id) ON DELETE RESTRICT,
    PRIMARY KEY (comicio_id, fuerza_id)
);

CREATE TABLE IF NOT EXISTS elecciones.votos_fuerza (
    mesa_id   INTEGER NOT NULL REFERENCES elecciones.mesas(id) ON DELETE CASCADE,
    fuerza_id INTEGER NOT NULL REFERENCES elecciones.fuerzas(id) ON DELETE RESTRICT,
    cantidad  INTEGER NOT NULL CHECK (cantidad >= 0),
    PRIMARY KEY (mesa_id, fuerza_id)
);

CREATE INDEX IF NOT EXISTS idx_comicio_fuerzas_comicio ON elecciones.comicio_fuerzas(comicio_id);
CREATE INDEX IF NOT EXISTS idx_votos_fuerza_mesa        ON elecciones.votos_fuerza(mesa_id);

-- El rango de padron de una mesa pasa a ser opcional: una mesa se puede crear solo con
-- numero, y cargarle el rango despues (o nunca, si no hace falta calcular participacion
-- contra el padron para esa mesa).
ALTER TABLE elecciones.mesas ALTER COLUMN padron_desde_dni DROP NOT NULL;
ALTER TABLE elecciones.mesas ALTER COLUMN padron_hasta_dni DROP NOT NULL;
