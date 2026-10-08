-- Esquema del mapa por manzana y barrio (018).
--
-- Las capas (calles, manzanas, radios censales) se copian a la base de cada instancia con
-- `npm run territorio:cargar`: ninguna ruta consulta el portal de Estadistica en uso. La ubicacion de
-- cada votante se calcula en lote y se guarda aca, en una tabla 1:1 con padron.votantes que vive en
-- este esquema para que el padron no sepa que existe un mapa (la dependencia va de territorio a padron).
--
-- Solo crea objetos nuevos: no toca ningun dato existente.

CREATE SCHEMA IF NOT EXISTS territorio;

-- Una sola fila: lo que es propio de la instancia.
CREATE TABLE IF NOT EXISTS territorio.configuracion (
    id                SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    localidad         TEXT,
    departamento      TEXT,
    -- Por debajo de esta cantidad de relevados, una zona no muestra desglose (privacidad).
    umbral_privacidad SMALLINT    NOT NULL DEFAULT 10 CHECK (umbral_privacidad BETWEEN 1 AND 1000),
    -- "Radio censal" mientras no se confirme que los radios sirven como barrio (tarea 022).
    etiqueta_barrio   VARCHAR(40) NOT NULL DEFAULT 'Radio censal',
    fuente            TEXT,
    cargado_en        TIMESTAMPTZ
);
INSERT INTO territorio.configuracion (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- El nivel "barrio". En la etapa 1 son los radios censales 2022 del INDEC.
CREATE TABLE IF NOT EXISTS territorio.sectores (
    id             SERIAL      PRIMARY KEY,
    codigo         VARCHAR(20) NOT NULL UNIQUE,
    nombre         VARCHAR(80) NOT NULL,
    tipo           VARCHAR(20) NOT NULL DEFAULT 'radio_censal' CHECK (tipo IN ('radio_censal', 'barrio')),
    anillos        JSONB       NOT NULL,
    poblacion_2022 INTEGER,
    viviendas_2022 INTEGER
);

-- El id es el de la capa de origen y se conserva entre cargas: la etapa 2 (manzanas visitadas) se apoya en el.
CREATE TABLE IF NOT EXISTS territorio.manzanas (
    id        BIGINT  PRIMARY KEY,
    anillos   JSONB   NOT NULL,
    sector_id INTEGER REFERENCES territorio.sectores (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_manzanas_sector ON territorio.manzanas (sector_id);

-- Un tramo por cuadra, con la altura inicial y final de cada lado (izquierdo = impares). El sentido de la
-- numeracion no se guarda: se deduce de los tramos en cada calculo, que es barato.
CREATE TABLE IF NOT EXISTS territorio.calles_tramos (
    id     SERIAL       PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    aii    INTEGER,
    afi    INTEGER,
    aid    INTEGER,
    afd    INTEGER,
    camino JSONB        NOT NULL
);

-- Donde quedo cada votante, o por que no se pudo ubicar. Un votante sin fila aca es "sin calcular".
CREATE TABLE IF NOT EXISTS territorio.ubicaciones (
    dni          VARCHAR(20)  PRIMARY KEY REFERENCES padron.votantes (dni) ON DELETE CASCADE,
    estado       VARCHAR(30)  NOT NULL CHECK (estado IN (
                     'ok', 'sin_domicilio', 'sin_numero', 'esquina', 'sin_altura', 'calle_no_encontrada',
                     'calle_parecida', 'sin_tramo', 'calle_ambigua', 'sentido_ambiguo', 'sin_manzana')),
    -- La calle o el rango que explica un pendiente (para la pantalla de "sin ubicar").
    detalle      TEXT,
    -- Si se recarga una capa, la ubicacion de esa manzana deja de valer: vuelve a "sin calcular".
    manzana_id   BIGINT       REFERENCES territorio.manzanas (id) ON DELETE CASCADE,
    lat          DOUBLE PRECISION,
    lon          DOUBLE PRECISION,
    calle        VARCHAR(120),
    numero       INTEGER,
    aproximada   BOOLEAN      NOT NULL DEFAULT FALSE,
    estimado     BOOLEAN      NOT NULL DEFAULT FALSE,
    calculado_en TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Ubicado <=> tiene manzana. Un pendiente nunca tiene una manzana inventada.
    CONSTRAINT chk_ubicacion_manzana CHECK ((estado = 'ok') = (manzana_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_ubicaciones_manzana ON territorio.ubicaciones (manzana_id) WHERE manzana_id IS NOT NULL;
