-- Suplentes por candidato y notas libres. Antes había que abrir la lista para editarla;
-- ahora se edita inline en la pantalla de listado, y estos dos campos son lo que permite
-- cargar esa informacion sin salir de ahi.

ALTER TABLE elecciones.candidatos ADD COLUMN IF NOT EXISTS notas TEXT;

-- Tabla propia, no una fila mas en `candidatos`: un suplente no compite por el 1..N de
-- los titulares (esa numeracion ya la valida el service), tiene la suya propia por
-- candidato.
CREATE TABLE IF NOT EXISTS elecciones.suplentes (
    id           SERIAL PRIMARY KEY,
    candidato_id INTEGER      NOT NULL REFERENCES elecciones.candidatos(id) ON DELETE CASCADE,
    nombre       VARCHAR(200) NOT NULL,
    orden        INTEGER      NOT NULL,
    UNIQUE (candidato_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_suplentes_candidato_id ON elecciones.suplentes(candidato_id);
