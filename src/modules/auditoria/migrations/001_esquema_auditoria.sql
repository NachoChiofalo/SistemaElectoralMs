-- Registro de auditoria del sistema.
--
-- Vive en el schema padron por razones historicas (la creaba padron-service), pero
-- audita tanto operaciones del padron como eventos de sesion del modulo auth. Por eso
-- ahora es un modulo propio, registrado antes que los dos que lo usan.

CREATE SCHEMA IF NOT EXISTS padron;

CREATE TABLE IF NOT EXISTS padron.auditoria (
    id               SERIAL PRIMARY KEY,
    usuario_id       VARCHAR(50),
    usuario_nombre   VARCHAR(200),
    usuario_username VARCHAR(100),
    operacion        VARCHAR(50) NOT NULL,
    entidad          VARCHAR(50) NOT NULL,
    entidad_id       VARCHAR(50),
    datos_anteriores JSONB,
    datos_nuevos     JSONB,
    detalles         TEXT,
    ip_address       VARCHAR(200),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_id ON padron.auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_operacion  ON padron.auditoria(operacion);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad    ON padron.auditoria(entidad);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad_id ON padron.auditoria(entidad_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_created_at ON padron.auditoria(created_at DESC);
