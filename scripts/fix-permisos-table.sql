-- Script para corregir la estructura de la tabla permisos
-- Agregar columna 'codigo' y actualizar datos existentes

-- 1. Agregar columna codigo si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='permisos' AND column_name='codigo') THEN
        ALTER TABLE permisos ADD COLUMN codigo VARCHAR(50) UNIQUE;
    END IF;
END $$;

-- 2. Actualizar la columna codigo con valores basados en nombre
UPDATE permisos SET codigo = nombre WHERE codigo IS NULL;

-- 3. Hacer la columna codigo NOT NULL después de llenarla
ALTER TABLE permisos ALTER COLUMN codigo SET NOT NULL;

-- 4. Verificar la estructura actualizada
\echo 'Estructura de tabla permisos actualizada:'
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'permisos' 
ORDER BY ordinal_position;

\echo 'Permisos existentes:'
SELECT id, codigo, nombre, modulo FROM permisos ORDER BY modulo, codigo;