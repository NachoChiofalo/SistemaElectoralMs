-- Esquema de listas electorales (borradores).
--
-- Va en un schema propio, no en `padron`: una lista de candidatos no es un dato del
-- votante. Separarla deja lugar a que 015 (modulo de comicio) sume `elecciones.comicios`
-- y `elecciones.mesas` sin pisar decisiones de esquema ya tomadas aca.

CREATE SCHEMA IF NOT EXISTS elecciones;

CREATE TABLE IF NOT EXISTS elecciones.listas (
    id               SERIAL PRIMARY KEY,
    nombre           VARCHAR(200) NOT NULL,
    tipo_eleccion    VARCHAR(20)  NOT NULL,
    cantidad_lugares INTEGER      NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elecciones.candidatos (
    id       SERIAL PRIMARY KEY,
    lista_id INTEGER      NOT NULL REFERENCES elecciones.listas(id) ON DELETE CASCADE,
    nombre   VARCHAR(200) NOT NULL,
    orden    INTEGER      NOT NULL,
    UNIQUE (lista_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_candidatos_lista_id ON elecciones.candidatos(lista_id);
