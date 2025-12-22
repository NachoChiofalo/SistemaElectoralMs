-- ==========================================
-- EXTENSIÓN DE BASE DE DATOS PARA DETALLE VOTANTE
-- Script para agregar funcionalidad de información cualitativa
-- ==========================================

-- 1. Agregar columnas para condiciones especiales a la tabla relevamientos
ALTER TABLE padron.relevamientos 
ADD COLUMN IF NOT EXISTS es_nuevo_votante BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS esta_fallecido BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS es_empleado_municipal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS recibe_ayuda_social BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS observaciones_detalle TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS fecha_detalle TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 2. Crear índices para mejorar rendimiento en consultas por condiciones especiales
CREATE INDEX IF NOT EXISTS idx_relevamientos_nuevo_votante ON padron.relevamientos (es_nuevo_votante) WHERE es_nuevo_votante = TRUE;
CREATE INDEX IF NOT EXISTS idx_relevamientos_fallecido ON padron.relevamientos (esta_fallecido) WHERE esta_fallecido = TRUE;
CREATE INDEX IF NOT EXISTS idx_relevamientos_empleado_municipal ON padron.relevamientos (es_empleado_municipal) WHERE es_empleado_municipal = TRUE;
CREATE INDEX IF NOT EXISTS idx_relevamientos_ayuda_social ON padron.relevamientos (recibe_ayuda_social) WHERE recibe_ayuda_social = TRUE;

-- 3. Crear índice compuesto para condiciones especiales
CREATE INDEX IF NOT EXISTS idx_relevamientos_condiciones_especiales 
ON padron.relevamientos (es_nuevo_votante, esta_fallecido, es_empleado_municipal, recibe_ayuda_social);

-- 4. Crear trigger para actualizar automáticamente fecha_detalle
CREATE OR REPLACE FUNCTION padron.actualizar_fecha_detalle()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo actualizar si alguna de las condiciones especiales cambió
    IF (NEW.es_nuevo_votante != OLD.es_nuevo_votante OR 
        NEW.esta_fallecido != OLD.esta_fallecido OR 
        NEW.es_empleado_municipal != OLD.es_empleado_municipal OR 
        NEW.recibe_ayuda_social != OLD.recibe_ayuda_social OR 
        NEW.observaciones_detalle != OLD.observaciones_detalle) THEN
        NEW.fecha_detalle = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger si no existe
DROP TRIGGER IF EXISTS trigger_actualizar_fecha_detalle ON padron.relevamientos;
CREATE TRIGGER trigger_actualizar_fecha_detalle
    BEFORE UPDATE ON padron.relevamientos
    FOR EACH ROW
    EXECUTE FUNCTION padron.actualizar_fecha_detalle();

-- 5. Crear vista para estadísticas de condiciones especiales
CREATE OR REPLACE VIEW padron.estadisticas_condiciones_especiales AS
SELECT 
    COUNT(CASE WHEN es_nuevo_votante = TRUE THEN 1 END) as total_nuevos_votantes,
    COUNT(CASE WHEN esta_fallecido = TRUE THEN 1 END) as total_fallecidos,
    COUNT(CASE WHEN es_empleado_municipal = TRUE THEN 1 END) as total_empleados_municipales,
    COUNT(CASE WHEN recibe_ayuda_social = TRUE THEN 1 END) as total_ayuda_social,
    COUNT(CASE WHEN (es_nuevo_votante = TRUE OR esta_fallecido = TRUE OR 
                     es_empleado_municipal = TRUE OR recibe_ayuda_social = TRUE) THEN 1 END) as total_con_condiciones_especiales,
    COUNT(*) as total_relevamientos,
    ROUND(
        (COUNT(CASE WHEN (es_nuevo_votante = TRUE OR esta_fallecido = TRUE OR 
                         es_empleado_municipal = TRUE OR recibe_ayuda_social = TRUE) THEN 1 END)::numeric / 
         NULLIF(COUNT(*), 0)) * 100, 2
    ) as porcentaje_condiciones_especiales
FROM padron.relevamientos;

-- 6. Crear vista para resumen detallado por votante con condiciones especiales
CREATE OR REPLACE VIEW padron.votantes_condiciones_especiales AS
SELECT 
    v.dni,
    v.apellido,
    v.nombre,
    v.edad,
    v.sexo,
    v.circuito,
    r.es_nuevo_votante,
    r.esta_fallecido,
    r.es_empleado_municipal,
    r.recibe_ayuda_social,
    r.observaciones_detalle,
    r.fecha_detalle,
    r.opcion_politica,
    r.observacion as observacion_relevamiento,
    -- Campos calculados para facilitar consultas
    CASE 
        WHEN r.es_nuevo_votante THEN 'Nuevo Votante'
        WHEN r.esta_fallecido THEN 'Fallecido'
        WHEN r.es_empleado_municipal THEN 'Empleado Municipal'
        WHEN r.recibe_ayuda_social THEN 'Recibe Ayuda Social'
        ELSE 'Sin Condiciones Especiales'
    END as condicion_principal,
    -- Contador de condiciones especiales
    (CASE WHEN r.es_nuevo_votante THEN 1 ELSE 0 END +
     CASE WHEN r.esta_fallecido THEN 1 ELSE 0 END +
     CASE WHEN r.es_empleado_municipal THEN 1 ELSE 0 END +
     CASE WHEN r.recibe_ayuda_social THEN 1 ELSE 0 END) as numero_condiciones_especiales
FROM padron.votantes v
JOIN padron.relevamientos r ON v.dni = r.dni
WHERE (r.es_nuevo_votante = TRUE OR r.esta_fallecido = TRUE OR 
       r.es_empleado_municipal = TRUE OR r.recibe_ayuda_social = TRUE);

-- 7. Crear función para obtener resumen de condiciones por circuito
CREATE OR REPLACE FUNCTION padron.obtener_resumen_condiciones_por_circuito()
RETURNS TABLE(
    circuito VARCHAR,
    total_votantes BIGINT,
    nuevos_votantes BIGINT,
    fallecidos BIGINT,
    empleados_municipales BIGINT,
    ayuda_social BIGINT,
    total_condiciones_especiales BIGINT,
    porcentaje_especiales NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.circuito,
        COUNT(*) as total_votantes,
        COUNT(CASE WHEN r.es_nuevo_votante = TRUE THEN 1 END) as nuevos_votantes,
        COUNT(CASE WHEN r.esta_fallecido = TRUE THEN 1 END) as fallecidos,
        COUNT(CASE WHEN r.es_empleado_municipal = TRUE THEN 1 END) as empleados_municipales,
        COUNT(CASE WHEN r.recibe_ayuda_social = TRUE THEN 1 END) as ayuda_social,
        COUNT(CASE WHEN (r.es_nuevo_votante = TRUE OR r.esta_fallecido = TRUE OR 
                         r.es_empleado_municipal = TRUE OR r.recibe_ayuda_social = TRUE) THEN 1 END) as total_condiciones_especiales,
        ROUND(
            (COUNT(CASE WHEN (r.es_nuevo_votante = TRUE OR r.esta_fallecido = TRUE OR 
                             r.es_empleado_municipal = TRUE OR r.recibe_ayuda_social = TRUE) THEN 1 END)::numeric / 
             NULLIF(COUNT(*), 0)) * 100, 2
        ) as porcentaje_especiales
    FROM padron.votantes v
    LEFT JOIN padron.relevamientos r ON v.dni = r.dni
    GROUP BY v.circuito
    ORDER BY v.circuito;
END;
$$ LANGUAGE plpgsql;

-- 8. Comentarios en las tablas para documentar la funcionalidad
COMMENT ON COLUMN padron.relevamientos.es_nuevo_votante IS 'Indica si es un votante que no apareció en elecciones anteriores';
COMMENT ON COLUMN padron.relevamientos.esta_fallecido IS 'Indica si el votante ha fallecido según información obtenida';
COMMENT ON COLUMN padron.relevamientos.es_empleado_municipal IS 'Indica si el votante es empleado municipal';
COMMENT ON COLUMN padron.relevamientos.recibe_ayuda_social IS 'Indica si el votante recibe algún tipo de ayuda social del municipio';
COMMENT ON COLUMN padron.relevamientos.observaciones_detalle IS 'Observaciones adicionales sobre las condiciones especiales del votante';
COMMENT ON COLUMN padron.relevamientos.fecha_detalle IS 'Timestamp de la última actualización de los detalles del votante';

COMMENT ON VIEW padron.estadisticas_condiciones_especiales IS 'Vista que proporciona estadísticas agregadas de todas las condiciones especiales';
COMMENT ON VIEW padron.votantes_condiciones_especiales IS 'Vista que muestra solo los votantes que tienen al menos una condición especial';

-- 9. Crear permisos para las nuevas funcionalidades (opcional, ajustar según sea necesario)
-- GRANT SELECT ON padron.estadisticas_condiciones_especiales TO padron_reader;
-- GRANT SELECT ON padron.votantes_condiciones_especiales TO padron_reader;
-- GRANT EXECUTE ON FUNCTION padron.obtener_resumen_condiciones_por_circuito() TO padron_reader;

-- ==========================================
-- Script completado exitosamente
-- ==========================================

SELECT 'Extensión de base de datos para DetalleVotante completada exitosamente' as resultado;