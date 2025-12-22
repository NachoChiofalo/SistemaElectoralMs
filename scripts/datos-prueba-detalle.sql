-- Script para agregar datos de prueba para DetalleVotante
-- Ejecutar después de que el padrón esté cargado

-- Insertar algunos relevamientos de prueba con condiciones especiales
INSERT INTO padron.relevamientos (dni, opcion_politica, observacion, fecha_relevamiento, 
                                  es_nuevo_votante, esta_fallecido, es_empleado_municipal, 
                                  recibe_ayuda_social, observaciones_detalle, fecha_detalle)
VALUES 
-- Ejemplo 1: Nuevo votante que recibe ayuda social
('12345678', 'Indeciso', 'Primer votante en la familia', CURRENT_TIMESTAMP,
 TRUE, FALSE, FALSE, TRUE, 'Joven de 18 años, vive con la abuela que recibe AUH', CURRENT_TIMESTAMP),

-- Ejemplo 2: Empleado municipal
('87654321', 'PJ', 'Conoce bien los programas municipales', CURRENT_TIMESTAMP,
 FALSE, FALSE, TRUE, FALSE, 'Trabaja en la Secretaría de Obras Públicas desde 2019', CURRENT_TIMESTAMP),

-- Ejemplo 3: Múltiples condiciones
('11111111', 'UCR', 'Caso complejo', CURRENT_TIMESTAMP,
 FALSE, FALSE, TRUE, TRUE, 'Empleado municipal que también recibe subsidio por discapacidad', CURRENT_TIMESTAMP)

ON CONFLICT (dni) DO UPDATE SET
    opcion_politica = EXCLUDED.opcion_politica,
    observacion = EXCLUDED.observacion,
    es_nuevo_votante = EXCLUDED.es_nuevo_votante,
    esta_fallecido = EXCLUDED.esta_fallecido,
    es_empleado_municipal = EXCLUDED.es_empleado_municipal,
    recibe_ayuda_social = EXCLUDED.recibe_ayuda_social,
    observaciones_detalle = EXCLUDED.observaciones_detalle,
    fecha_detalle = CURRENT_TIMESTAMP;

-- Verificar que los datos se insertaron correctamente
SELECT 'Datos de prueba insertados correctamente' as resultado;

-- Mostrar estadísticas actualizadas
SELECT * FROM padron.estadisticas_condiciones_especiales;