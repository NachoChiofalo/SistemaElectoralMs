const Database = require('../database/Database');

class AuditoriaLog {
    constructor() {
        this.db = new Database();
        this.initialized = false;
    }

    async ensureTable() {
        if (this.initialized) return;
        try {
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS padron.auditoria (
                    id SERIAL PRIMARY KEY,
                    usuario_id VARCHAR(50),
                    usuario_nombre VARCHAR(200),
                    usuario_username VARCHAR(100),
                    operacion VARCHAR(50) NOT NULL,
                    entidad VARCHAR(50) NOT NULL,
                    entidad_id VARCHAR(50),
                    datos_anteriores JSONB,
                    datos_nuevos JSONB,
                    detalles TEXT,
                    ip_address VARCHAR(200),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            `);
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_id ON padron.auditoria(usuario_id)');
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_auditoria_operacion ON padron.auditoria(operacion)');
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_auditoria_entidad ON padron.auditoria(entidad)');
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_auditoria_created_at ON padron.auditoria(created_at DESC)');
            await this.db.query('CREATE INDEX IF NOT EXISTS idx_auditoria_entidad_id ON padron.auditoria(entidad_id)');

            // Asegurar que las columnas tengan tamaño suficiente
            // Se ejecutan por separado para que un fallo en una no impida las demas
            const alteraciones = [
                `ALTER TABLE padron.auditoria ALTER COLUMN usuario_id TYPE VARCHAR(50) USING usuario_id::VARCHAR(50)`,
                `ALTER TABLE padron.auditoria ALTER COLUMN usuario_nombre TYPE VARCHAR(200)`,
                `ALTER TABLE padron.auditoria ALTER COLUMN usuario_username TYPE VARCHAR(100)`,
                `ALTER TABLE padron.auditoria ALTER COLUMN entidad_id TYPE VARCHAR(50)`,
                `ALTER TABLE padron.auditoria ALTER COLUMN ip_address TYPE VARCHAR(200)`,
                `ALTER TABLE padron.auditoria ALTER COLUMN usuario_id DROP NOT NULL`,
                `ALTER TABLE padron.auditoria ALTER COLUMN usuario_nombre DROP NOT NULL`,
                `ALTER TABLE padron.auditoria ALTER COLUMN usuario_username DROP NOT NULL`,
            ];
            for (const sql of alteraciones) {
                await this.db.query(sql).catch(() => {});
            }

            this.initialized = true;
            console.log('✓ Tabla padron.auditoria verificada/creada');
        } catch (error) {
            console.error('Error inicializando tabla auditoria:', error.message);
            // Marcar como inicializada igualmente para no bloquear inserciones
            this.initialized = true;
        }
    }

    async registrar({ usuario_id, usuario_nombre, usuario_username, operacion, entidad, entidad_id, datos_anteriores, datos_nuevos, detalles, ip_address }) {
        await this.ensureTable();
        const query = `
            INSERT INTO padron.auditoria
                (usuario_id, usuario_nombre, usuario_username, operacion, entidad, entidad_id, datos_anteriores, datos_nuevos, detalles, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `;

        const params = [
            usuario_id,
            usuario_nombre,
            usuario_username,
            operacion,
            entidad,
            entidad_id || null,
            datos_anteriores ? JSON.stringify(datos_anteriores) : null,
            datos_nuevos ? JSON.stringify(datos_nuevos) : null,
            detalles || null,
            ip_address || null
        ];

        const result = await this.db.query(query, params);
        return result.rows[0];
    }

    async obtenerConFiltros({ usuario_id, operacion, entidad, fecha_desde, fecha_hasta, page = 1, limit = 25 }) {
        await this.ensureTable();
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (usuario_id) {
            params.push(usuario_id);
            whereClause += ` AND a.usuario_id = $${params.length}`;
        }

        if (operacion) {
            params.push(operacion);
            whereClause += ` AND a.operacion = $${params.length}`;
        }

        if (entidad) {
            params.push(entidad);
            whereClause += ` AND a.entidad = $${params.length}`;
        }

        if (fecha_desde) {
            params.push(fecha_desde);
            whereClause += ` AND a.created_at >= $${params.length}`;
        }

        if (fecha_hasta) {
            params.push(fecha_hasta);
            whereClause += ` AND a.created_at <= $${params.length}`;
        }

        const offset = (page - 1) * limit;
        params.push(limit, offset);

        const query = `
            SELECT a.*
            FROM padron.auditoria a
            ${whereClause}
            ORDER BY a.created_at DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;

        const result = await this.db.query(query, params);

        // Count total
        const countQuery = `
            SELECT COUNT(*) as total
            FROM padron.auditoria a
            ${whereClause}
        `;
        const countResult = await this.db.query(countQuery, params.slice(0, -2));

        const total = parseInt(countResult.rows[0].total);

        return {
            registros: result.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    async obtenerEstadisticas({ fecha_desde, fecha_hasta } = {}) {
        await this.ensureTable();
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (fecha_desde) {
            params.push(fecha_desde);
            whereClause += ` AND created_at >= $${params.length}`;
        }

        if (fecha_hasta) {
            params.push(fecha_hasta);
            whereClause += ` AND created_at <= $${params.length}`;
        }

        // Operaciones por usuario
        const porUsuarioQuery = `
            SELECT usuario_id, usuario_nombre, usuario_username, COUNT(*) as total_operaciones
            FROM padron.auditoria
            ${whereClause}
            GROUP BY usuario_id, usuario_nombre, usuario_username
            ORDER BY total_operaciones DESC
        `;

        // Operaciones por tipo
        const porTipoQuery = `
            SELECT operacion, COUNT(*) as total
            FROM padron.auditoria
            ${whereClause}
            GROUP BY operacion
            ORDER BY total DESC
        `;

        // Operaciones por dia
        const porDiaQuery = `
            SELECT DATE(created_at) as fecha, COUNT(*) as total
            FROM padron.auditoria
            ${whereClause}
            GROUP BY DATE(created_at)
            ORDER BY fecha DESC
            LIMIT 30
        `;

        // Total general
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM padron.auditoria
            ${whereClause}
        `;

        const [porUsuario, porTipo, porDia, totalResult] = await Promise.all([
            this.db.query(porUsuarioQuery, params),
            this.db.query(porTipoQuery, params),
            this.db.query(porDiaQuery, params),
            this.db.query(totalQuery, params)
        ]);

        return {
            totalOperaciones: parseInt(totalResult.rows[0].total),
            porUsuario: porUsuario.rows,
            porTipo: porTipo.rows,
            porDia: porDia.rows
        };
    }

    async obtenerPorId(id) {
        await this.ensureTable();
        const query = `SELECT * FROM padron.auditoria WHERE id = $1`;
        const result = await this.db.query(query, [id]);
        return result.rows[0] || null;
    }
}

module.exports = AuditoriaLog;
