-- Opciones politicas configurables por instancia (021).
--
-- Hasta ahora las tres opciones estaban escritas en un CHECK de padron.relevamientos y en el
-- codigo ('PJ', 'UCR', 'Indeciso'). Cada cliente tiene las suyas, asi que pasan a ser filas.
--
--   codigo     lo que se guarda en relevamientos.opcion_politica; no se renombra.
--   etiqueta   lo que se muestra; editable.
--   color      1..8, indice a la paleta fija --ds-fuerza-N del frontend (nunca un hex libre).
--              La opcion neutra no lleva color: se pinta siempre con el gris de "indeciso".
--   es_neutra  la que se asigna sola a un relevamiento nuevo (antes, el valor magico 'Indeciso').
--              Hay exactamente una.
--
-- Compatible hacia atras: se siembran las tres opciones de siempre, asi que el codigo anterior
-- (que escribe 'PJ', 'UCR' o 'Indeciso' y valida contra su lista) sigue funcionando contra este
-- esquema mientras se despliega el codigo nuevo.

CREATE TABLE IF NOT EXISTS padron.opciones_politicas (
    codigo    VARCHAR(20) PRIMARY KEY,
    etiqueta  VARCHAR(50) NOT NULL,
    color     SMALLINT CHECK (color BETWEEN 1 AND 8),
    orden     SMALLINT NOT NULL DEFAULT 0,
    es_neutra BOOLEAN  NOT NULL DEFAULT FALSE,
    CONSTRAINT chk_opcion_color_o_neutra CHECK (es_neutra OR color IS NOT NULL)
);

-- Exactamente una neutra: el indice parcial impide dos; el servicio impide borrar la unica.
CREATE UNIQUE INDEX IF NOT EXISTS ux_opciones_politicas_neutra
    ON padron.opciones_politicas (es_neutra) WHERE es_neutra;

-- 'PJ' y 'pj' serian dos opciones distintas para la base y la misma para una persona.
CREATE UNIQUE INDEX IF NOT EXISTS ux_opciones_politicas_codigo_lower
    ON padron.opciones_politicas (LOWER(codigo));

INSERT INTO padron.opciones_politicas (codigo, etiqueta, color, orden, es_neutra) VALUES
    ('PJ',       'PJ',       1,    1, FALSE),
    ('UCR',      'UCR',      2,    2, FALSE),
    ('Indeciso', 'Indeciso', NULL, 3, TRUE)
ON CONFLICT (codigo) DO NOTHING;

-- El CHECK de la columna no tiene nombre explicito (lo autogenera Postgres), asi que se busca
-- por lo que dice en vez de asumir como se llama.
DO $$
DECLARE
    restriccion TEXT;
BEGIN
    FOR restriccion IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'padron.relevamientos'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%opcion_politica%'
    LOOP
        EXECUTE format('ALTER TABLE padron.relevamientos DROP CONSTRAINT %I', restriccion);
    END LOOP;
END $$;

-- Un relevamiento solo puede apuntar a una opcion que exista, y borrar una opcion con
-- relevamientos es un 409, no una perdida silenciosa (mismo criterio que G2).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_relevamientos_opcion_politica'
          AND conrelid = 'padron.relevamientos'::regclass
    ) THEN
        ALTER TABLE padron.relevamientos
            ADD CONSTRAINT fk_relevamientos_opcion_politica
            FOREIGN KEY (opcion_politica) REFERENCES padron.opciones_politicas (codigo)
            ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;

ALTER TABLE padron.relevamientos VALIDATE CONSTRAINT fk_relevamientos_opcion_politica;
