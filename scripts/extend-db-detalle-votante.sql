-- Script de extensión de base de datos para DetalleVotante
-- Este script agrega los campos necesarios para almacenar información cualitativa adicional

-- Agregar campos para DetalleVotante en la tabla de relevamientos
ALTER TABLE padron.relevamientos 
ADD COLUMN IF NOT EXISTS es_nuevo_votante BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS esta_fallecido BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS es_empleado_municipal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recibe_ayuda_social BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS observaciones_detalle TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS fecha_detalle TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Crear índices para mejorar consultas de condiciones especiales
CREATE INDEX IF NOT EXISTS idx_relevamientos_nuevo_votante 
    ON padron.relevamientos(es_nuevo_votante) 
    WHERE es_nuevo_votante = TRUE;

CREATE INDEX IF NOT EXISTS idx_relevamientos_fallecido 
    ON padron.relevamientos(esta_fallecido) 
    WHERE esta_fallecido = TRUE;

CREATE INDEX IF NOT EXISTS idx_relevamientos_empleado_municipal 
    ON padron.relevamientos(es_empleado_municipal) 
    WHERE es_empleado_municipal = TRUE;

CREATE INDEX IF NOT EXISTS idx_relevamientos_ayuda_social 
    ON padron.relevamientos(recibe_ayuda_social) 
    WHERE recibe_ayuda_social = TRUE;

-- Índice compuesto para búsquedas de condiciones especiales
CREATE INDEX IF NOT EXISTS idx_relevamientos_condiciones_especiales 
    ON padron.relevamientos(es_nuevo_votante, esta_fallecido, es_empleado_municipal, recibe_ayuda_social)
    WHERE (es_nuevo_votante = TRUE OR esta_fallecido = TRUE OR 
           es_empleado_municipal = TRUE OR recibe_ayuda_social = TRUE);

-- Función para actualizar la fecha de detalle automáticamente
CREATE OR REPLACE FUNCTION update_detalle_modified_time()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo actualizar si algún campo de detalle cambió
    IF (OLD.es_nuevo_votante IS DISTINCT FROM NEW.es_nuevo_votante OR
        OLD.esta_fallecido IS DISTINCT FROM NEW.esta_fallecido OR
        OLD.es_empleado_municipal IS DISTINCT FROM NEW.es_empleado_municipal OR
        OLD.recibe_ayuda_social IS DISTINCT FROM NEW.recibe_ayuda_social OR
        OLD.observaciones_detalle IS DISTINCT FROM NEW.observaciones_detalle) THEN
        NEW.fecha_detalle = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar fecha cuando cambien los detalles
DROP TRIGGER IF EXISTS update_detalle_timestamp ON padron.relevamientos;
CREATE TRIGGER update_detalle_timestamp
    BEFORE UPDATE ON padron.relevamientos
    FOR EACH ROW
    EXECUTE FUNCTION update_detalle_modified_time();

-- Vista para estadísticas de condiciones especiales
CREATE OR REPLACE VIEW padron.estadisticas_condiciones_especiales AS
SELECT 
    COUNT(*) FILTER (WHERE es_nuevo_votante = TRUE) as total_nuevos_votantes,
    COUNT(*) FILTER (WHERE esta_fallecido = TRUE) as total_fallecidos,
    COUNT(*) FILTER (WHERE es_empleado_municipal = TRUE) as total_empleados_municipales,
    COUNT(*) FILTER (WHERE recibe_ayuda_social = TRUE) as total_ayuda_social,
    COUNT(*) FILTER (WHERE es_nuevo_votante = TRUE OR esta_fallecido = TRUE OR 
                            es_empleado_municipal = TRUE OR recibe_ayuda_social = TRUE) as total_con_condiciones_especiales,
    COUNT(*) as total_relevamientos
FROM padron.relevamientos;

-- Comentarios para documentación
COMMENT ON COLUMN padron.relevamientos.es_nuevo_votante IS 'Indica si el votante es nuevo en el padrón';
COMMENT ON COLUMN padron.relevamientos.esta_fallecido IS 'Indica si el votante está fallecido';
COMMENT ON COLUMN padron.relevamientos.es_empleado_municipal IS 'Indica si el votante es empleado municipal';
COMMENT ON COLUMN padron.relevamientos.recibe_ayuda_social IS 'Indica si el votante recibe ayuda social';
COMMENT ON COLUMN padron.relevamientos.observaciones_detalle IS 'Observaciones adicionales sobre las condiciones especiales';
COMMENT ON COLUMN padron.relevamientos.fecha_detalle IS 'Fecha de última modificación de los detalles del votante';

COMMENT ON VIEW padron.estadisticas_condiciones_especiales IS 'Vista con estadísticas agregadas de condiciones especiales de votantes';

-- Datos de ejemplo (opcional, para testing)
-- UPDATE padron.relevamientos 
-- SET es_nuevo_votante = TRUE, observaciones_detalle = 'Votante registrado este año'
-- WHERE dni IN (SELECT dni FROM padron.votantes WHERE edad BETWEEN 18 AND 20 LIMIT 5);

-- UPDATE padron.relevamientos 
-- SET es_empleado_municipal = TRUE, observaciones_detalle = 'Trabajador de la municipalidad'
-- WHERE dni IN (SELECT dni FROM padron.votantes WHERE apellido LIKE 'A%' LIMIT 3);