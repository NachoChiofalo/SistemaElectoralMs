-- Script de inicialización de base de datos PostgreSQL
-- Para uso futuro cuando se migre de memoria a base de datos

-- Crear esquema principal
CREATE SCHEMA IF NOT EXISTS padron;

-- Tabla de votantes
CREATE TABLE IF NOT EXISTS padron.votantes (
    dni VARCHAR(20) PRIMARY KEY,
    anio_nac INTEGER NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    domicilio TEXT,
    tipo_ejemplar VARCHAR(20),
    circuito VARCHAR(50),
    sexo CHAR(1) CHECK (sexo IN ('M', 'F')),
    edad INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de relevamientos
CREATE TABLE IF NOT EXISTS padron.relevamientos (
    id SERIAL PRIMARY KEY,
    dni VARCHAR(20) REFERENCES padron.votantes(dni) ON DELETE CASCADE,
    opcion_politica VARCHAR(20) CHECK (opcion_politica IN ('PJ', 'UCR', 'Indeciso')),
    observacion TEXT,
    fecha_relevamiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dni)
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_votantes_apellido ON padron.votantes(apellido);
CREATE INDEX IF NOT EXISTS idx_votantes_circuito ON padron.votantes(circuito);
CREATE INDEX IF NOT EXISTS idx_votantes_sexo ON padron.votantes(sexo);
CREATE INDEX IF NOT EXISTS idx_relevamientos_opcion ON padron.relevamientos(opcion_politica);
CREATE INDEX IF NOT EXISTS idx_relevamientos_fecha ON padron.relevamientos(fecha_relevamiento);

-- Trigger para actualizar fecha de modificación
CREATE OR REPLACE FUNCTION update_modified_time()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_votantes_modified_time
    BEFORE UPDATE ON padron.votantes
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_time();

CREATE OR REPLACE FUNCTION update_relevamiento_modified_time()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_modificacion = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_relevamientos_modified_time
    BEFORE UPDATE ON padron.relevamientos
    FOR EACH ROW
    EXECUTE FUNCTION update_relevamiento_modified_time();

-- Insertar datos de prueba (opcional)
--INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad)
--VALUES 
--    ('12345678', 1980, 'PÉREZ', 'JUAN CARLOS', 'RIVADAVIA 123', 'DNI-EA', '162 - ALCIRA', 'M', 44),
--    ('87654321', 1995, 'GONZÁLEZ', 'MARÍA ELENA', 'SAN MARTÍN 456', 'DNI-EA', '163 - CENTRO', 'F', 29)
--ON CONFLICT (dni) DO NOTHING;

-- Comentarios para documentación
COMMENT ON SCHEMA padron IS 'Esquema para gestión del padrón electoral';
COMMENT ON TABLE padron.votantes IS 'Datos básicos de los votantes del padrón electoral';
COMMENT ON TABLE padron.relevamientos IS 'Información de relevamiento político por votante';
COMMENT ON COLUMN padron.votantes.dni IS 'Documento Nacional de Identidad - Clave primaria';
COMMENT ON COLUMN padron.relevamientos.opcion_politica IS 'Opción política relevada: PJ, UCR o Indeciso';