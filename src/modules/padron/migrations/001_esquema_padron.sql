-- Esquema del padron electoral.
--
-- Consolida lo que estaba repartido entre el initializeSchema() de Database.js (que
-- corria en cada arranque) y el script suelto extend-db-detalle-votante.sql.

CREATE SCHEMA IF NOT EXISTS padron;

CREATE TABLE IF NOT EXISTS padron.votantes (
    dni           VARCHAR(20) PRIMARY KEY,
    anio_nac      INTEGER NOT NULL,
    apellido      VARCHAR(100) NOT NULL,
    nombre        VARCHAR(100) NOT NULL,
    domicilio     TEXT,
    tipo_ejemplar VARCHAR(20),
    circuito      VARCHAR(50),
    sexo          CHAR(1) CHECK (sexo IN ('M', 'F')),
    edad          INTEGER,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Relacion 1:1 con votantes: el UNIQUE(dni) es lo que sostiene el ON CONFLICT (dni)
-- del upsert de relevamiento, y de paso indexa la foreign key.
CREATE TABLE IF NOT EXISTS padron.relevamientos (
    id                    SERIAL PRIMARY KEY,
    dni                   VARCHAR(20) REFERENCES padron.votantes(dni) ON DELETE CASCADE,
    opcion_politica       VARCHAR(20) CHECK (opcion_politica IN ('PJ', 'UCR', 'Indeciso')),
    observacion           TEXT,
    fecha_relevamiento    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    es_nuevo_votante      BOOLEAN DEFAULT FALSE,
    esta_fallecido        BOOLEAN DEFAULT FALSE,
    es_empleado_municipal BOOLEAN DEFAULT FALSE,
    recibe_ayuda_social   BOOLEAN DEFAULT FALSE,
    observaciones_detalle TEXT DEFAULT '',
    fecha_detalle         TIMESTAMP,
    telefono              VARCHAR(50) DEFAULT '',
    UNIQUE (dni)
);

CREATE INDEX IF NOT EXISTS idx_votantes_apellido      ON padron.votantes(apellido);
CREATE INDEX IF NOT EXISTS idx_votantes_circuito      ON padron.votantes(circuito);
CREATE INDEX IF NOT EXISTS idx_votantes_sexo          ON padron.votantes(sexo);
CREATE INDEX IF NOT EXISTS idx_relevamientos_opcion   ON padron.relevamientos(opcion_politica);
CREATE INDEX IF NOT EXISTS idx_relevamientos_fecha    ON padron.relevamientos(fecha_relevamiento);

-- Indices parciales: solo indexan las filas en TRUE, que son la minoria.
CREATE INDEX IF NOT EXISTS idx_relevamientos_nuevo_votante      ON padron.relevamientos (es_nuevo_votante)      WHERE es_nuevo_votante = TRUE;
CREATE INDEX IF NOT EXISTS idx_relevamientos_fallecido          ON padron.relevamientos (esta_fallecido)        WHERE esta_fallecido = TRUE;
CREATE INDEX IF NOT EXISTS idx_relevamientos_empleado_municipal ON padron.relevamientos (es_empleado_municipal) WHERE es_empleado_municipal = TRUE;
CREATE INDEX IF NOT EXISTS idx_relevamientos_ayuda_social       ON padron.relevamientos (recibe_ayuda_social)   WHERE recibe_ayuda_social = TRUE;

-- Mantiene fecha_detalle al dia cuando cambia alguna condicion especial.
CREATE OR REPLACE FUNCTION padron.actualizar_fecha_detalle()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.es_nuevo_votante      IS DISTINCT FROM OLD.es_nuevo_votante OR
        NEW.esta_fallecido        IS DISTINCT FROM OLD.esta_fallecido OR
        NEW.es_empleado_municipal IS DISTINCT FROM OLD.es_empleado_municipal OR
        NEW.recibe_ayuda_social   IS DISTINCT FROM OLD.recibe_ayuda_social OR
        NEW.observaciones_detalle IS DISTINCT FROM OLD.observaciones_detalle) THEN
        NEW.fecha_detalle = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_actualizar_fecha_detalle ON padron.relevamientos;
CREATE TRIGGER trigger_actualizar_fecha_detalle
    BEFORE UPDATE ON padron.relevamientos
    FOR EACH ROW
    EXECUTE FUNCTION padron.actualizar_fecha_detalle();

CREATE OR REPLACE VIEW padron.estadisticas_condiciones_especiales AS
SELECT
    COUNT(*) FILTER (WHERE es_nuevo_votante)      AS total_nuevos_votantes,
    COUNT(*) FILTER (WHERE esta_fallecido)        AS total_fallecidos,
    COUNT(*) FILTER (WHERE es_empleado_municipal) AS total_empleados_municipales,
    COUNT(*) FILTER (WHERE recibe_ayuda_social)   AS total_ayuda_social,
    COUNT(*) FILTER (
        WHERE es_nuevo_votante OR esta_fallecido OR es_empleado_municipal OR recibe_ayuda_social
    ) AS total_con_condiciones_especiales,
    COUNT(*) AS total_relevamientos,
    ROUND(
        COUNT(*) FILTER (
            WHERE es_nuevo_votante OR esta_fallecido OR es_empleado_municipal OR recibe_ayuda_social
        )::numeric / NULLIF(COUNT(*), 0) * 100, 2
    ) AS porcentaje_condiciones_especiales
FROM padron.relevamientos;
