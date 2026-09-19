-- Esquema de fiscales y su calendario de asignaciones por mesa.
--
-- El fiscal es un registro de datos, no una cuenta del sistema: nunca se loguea. Va en
-- el schema `elecciones`, el mismo de listas (017) y comicio (015) -- fiscal_asignaciones
-- referencia elecciones.mesas.

CREATE TABLE IF NOT EXISTS elecciones.fiscales (
    id             SERIAL PRIMARY KEY,
    nombre         VARCHAR(200) NOT NULL,
    dni            VARCHAR(20),
    telefono       VARCHAR(50),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS elecciones.fiscal_asignaciones (
    id        SERIAL PRIMARY KEY,
    mesa_id   INTEGER NOT NULL REFERENCES elecciones.mesas(id) ON DELETE CASCADE,
    fiscal_id INTEGER NOT NULL REFERENCES elecciones.fiscales(id) ON DELETE CASCADE,
    desde     TIME NOT NULL,
    hasta     TIME NOT NULL,
    CHECK (desde >= '08:00' AND hasta <= '18:00' AND hasta > desde)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_asignaciones_mesa   ON elecciones.fiscal_asignaciones(mesa_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_asignaciones_fiscal ON elecciones.fiscal_asignaciones(fiscal_id);
