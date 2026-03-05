-- =====================================================
-- Tabla de Auditoria para el Padron Electoral
-- Registra todas las operaciones realizadas sobre el padron
-- =====================================================

CREATE TABLE IF NOT EXISTS padron.auditoria (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    usuario_nombre VARCHAR(100) NOT NULL,
    usuario_username VARCHAR(50) NOT NULL,
    operacion VARCHAR(50) NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    entidad_id VARCHAR(20),
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    detalles TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_id ON padron.auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_operacion ON padron.auditoria(operacion);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON padron.auditoria(entidad);
CREATE INDEX IF NOT EXISTS idx_auditoria_created_at ON padron.auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad_id ON padron.auditoria(entidad_id);

-- Comentarios
COMMENT ON TABLE padron.auditoria IS 'Registro de auditoria de operaciones sobre el padron electoral';
COMMENT ON COLUMN padron.auditoria.operacion IS 'Tipo de operacion: CREAR_VOTANTE, ACTUALIZAR_RELEVAMIENTO, CREAR_DETALLE, ACTUALIZAR_DETALLE, ELIMINAR_DETALLE, IMPORTAR_CSV, EXPORTAR_DATOS';
COMMENT ON COLUMN padron.auditoria.entidad IS 'Tipo de entidad afectada: votante, relevamiento, detalle_votante, csv, exportacion';
COMMENT ON COLUMN padron.auditoria.entidad_id IS 'DNI o identificador de la entidad afectada';
COMMENT ON COLUMN padron.auditoria.datos_anteriores IS 'Snapshot de los datos antes de la modificacion (JSON)';
COMMENT ON COLUMN padron.auditoria.datos_nuevos IS 'Snapshot de los datos despues de la modificacion (JSON)';
