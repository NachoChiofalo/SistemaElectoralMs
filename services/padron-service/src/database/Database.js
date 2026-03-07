const { Pool } = require('pg');

class Database {
    constructor() {
        const poolConfig = process.env.DATABASE_URL
            ? {
                  connectionString: process.env.DATABASE_URL,
                  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
              }
            : {
                  host: process.env.DB_HOST,
                  port: process.env.DB_PORT,
                  database: process.env.DB_NAME,
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
              };

        this.pool = new Pool(poolConfig);

        // Configurar manejo de errores
        this.pool.on('error', (err) => {
            console.error('Error inesperado en el pool de conexiones:', err);
        });
    }

    async initializeSchema() {
        try {
            await this.query(`CREATE SCHEMA IF NOT EXISTS padron`);

            await this.query(`
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
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS padron.relevamientos (
                    id SERIAL PRIMARY KEY,
                    dni VARCHAR(20) REFERENCES padron.votantes(dni) ON DELETE CASCADE,
                    opcion_politica VARCHAR(20) CHECK (opcion_politica IN ('PJ', 'UCR', 'Indeciso')),
                    observacion TEXT,
                    fecha_relevamiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    fecha_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    es_nuevo_votante BOOLEAN DEFAULT FALSE,
                    esta_fallecido BOOLEAN DEFAULT FALSE,
                    es_empleado_municipal BOOLEAN DEFAULT FALSE,
                    recibe_ayuda_social BOOLEAN DEFAULT FALSE,
                    observaciones_detalle TEXT,
                    fecha_detalle TIMESTAMP,
                    UNIQUE(dni)
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS padron.auditoria (
                    id SERIAL PRIMARY KEY,
                    usuario_id VARCHAR(50),
                    usuario_nombre VARCHAR(200),
                    usuario_username VARCHAR(100),
                    operacion VARCHAR(50),
                    entidad VARCHAR(50),
                    entidad_id VARCHAR(50),
                    datos_anteriores JSONB,
                    datos_nuevos JSONB,
                    detalles TEXT,
                    ip_address VARCHAR(50),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await this.query(`CREATE INDEX IF NOT EXISTS idx_votantes_apellido ON padron.votantes(apellido)`);
            await this.query(`CREATE INDEX IF NOT EXISTS idx_votantes_circuito ON padron.votantes(circuito)`);
            await this.query(`CREATE INDEX IF NOT EXISTS idx_votantes_sexo ON padron.votantes(sexo)`);
            await this.query(`CREATE INDEX IF NOT EXISTS idx_relevamientos_opcion ON padron.relevamientos(opcion_politica)`);
            await this.query(`CREATE INDEX IF NOT EXISTS idx_relevamientos_fecha ON padron.relevamientos(fecha_relevamiento)`);

            console.log('✓ Schema padron inicializado correctamente');
        } catch (error) {
            console.error('✗ Error inicializando schema padron:', error.message);
            throw error;
        }
    }

    async testConnection() {
        try {
            const client = await this.pool.connect();
            const result = await client.query('SELECT NOW()');
            client.release();
            console.log('✓ Conexión a base de datos exitosa:', result.rows[0].now);
            return true;
        } catch (error) {
            console.error('✗ Error conectando a base de datos:', error.message);
            throw error;
        }
    }

    async query(text, params = []) {
        try {
            const result = await this.pool.query(text, params);
            return result;
        } catch (error) {
            console.error('Error en query:', error.message);
            throw error;
        }
    }

    async obtenerVotantesPaginados(pagina = 1, limite = 50, filtros = {}) {
        const offset = (pagina - 1) * limite;
        let whereClause = 'WHERE 1=1';
        const params = [];

        // Busqueda general (DNI, nombre, apellido)
        if (filtros.busqueda) {
            params.push(`%${filtros.busqueda.toLowerCase()}%`);
            whereClause += ` AND (v.dni LIKE $${params.length} OR LOWER(v.nombre) LIKE $${params.length} OR LOWER(v.apellido) LIKE $${params.length})`;
        }

        // Filtro por circuito
        if (filtros.circuito) {
            params.push(filtros.circuito);
            whereClause += ` AND v.circuito = $${params.length}`;
        }

        // Filtro por sexo
        if (filtros.sexo) {
            params.push(filtros.sexo);
            whereClause += ` AND v.sexo = $${params.length}`;
        }

        // Filtro por opcion politica
        if (filtros.opcionPolitica) {
            params.push(filtros.opcionPolitica);
            whereClause += ` AND r.opcion_politica = $${params.length}`;
        }

        // Filtro sin relevamiento
        if (filtros.sinRelevamiento) {
            whereClause += ` AND r.dni IS NULL`;
        }

        // Ordenamiento dinamico (whitelist de campos validos)
        const camposValidos = {
            dni: 'v.dni',
            apellido: 'v.apellido',
            nombre: 'v.nombre',
            edad: 'v.edad',
            circuito: 'v.circuito',
            sexo: 'v.sexo'
        };
        const ordenCampo = camposValidos[filtros.ordenCampo] || 'v.apellido';
        const ordenDir = filtros.ordenDireccion === 'desc' ? 'DESC' : 'ASC';
        const orderBy = `${ordenCampo} ${ordenDir}, v.nombre ASC`;

        params.push(limite, offset);

        const queryText = `
            SELECT v.*, r.opcion_politica, r.fecha_relevamiento, r.observacion
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;

        const result = await this.query(queryText, params);

        // Obtener total de registros (mismos filtros, sin LIMIT/OFFSET)
        const countQuery = `
            SELECT COUNT(*) as total
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            ${whereClause}
        `;
        const countResult = await this.query(countQuery, params.slice(0, -2));

        return {
            votantes: result.rows,
            total: parseInt(countResult.rows[0].total),
            pagina,
            limite,
            totalPaginas: Math.ceil(countResult.rows[0].total / limite)
        };
    }

    async insertarVotante(votante) {
        const query = `
            INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (dni) DO UPDATE SET
                anio_nac = EXCLUDED.anio_nac,
                apellido = EXCLUDED.apellido,
                nombre = EXCLUDED.nombre,
                domicilio = EXCLUDED.domicilio,
                tipo_ejemplar = EXCLUDED.tipo_ejemplar,
                circuito = EXCLUDED.circuito,
                sexo = EXCLUDED.sexo,
                edad = EXCLUDED.edad
            RETURNING *
        `;
        
        const params = [
            votante.DNI || votante.dni,
            votante['AÑO NAC'] || votante.anio_nac || votante.anioNac,
            votante.APELLIDO || votante.apellido,
            votante.NOMBRE || votante.nombre,
            votante.DOMICILIO || votante.domicilio,
            votante.TIPO_EJEMPL || votante.tipo_ejemplar || votante.tipoEjempl,
            votante.CIRCUITO || votante.circuito,
            votante.S || votante.sexo,
            new Date().getFullYear() - (votante['AÑO NAC'] || votante.anio_nac || votante.anioNac)
        ];

        const result = await this.query(query, params);
        return result.rows[0];
    }

    async actualizarRelevamiento(dni, relevamiento) {
        const query = `
            INSERT INTO padron.relevamientos (dni, opcion_politica, observacion)
            VALUES ($1, $2, $3)
            ON CONFLICT (dni) DO UPDATE SET
                opcion_politica = EXCLUDED.opcion_politica,
                observacion = EXCLUDED.observacion,
                fecha_modificacion = CURRENT_TIMESTAMP
            RETURNING *
        `;

        const params = [dni, relevamiento.opcion_politica || relevamiento.voto, relevamiento.observacion || relevamiento.observaciones];
        const result = await this.query(query, params);
        return result.rows[0];
    }

    async obtenerEstadisticas() {
        const query = `
            SELECT 
                COUNT(*) as total_votantes,
                COUNT(r.dni) as total_relevados,
                SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as votos_pj,
                SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as votos_ucr,
                SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as votos_indeciso
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
        `;

        const result = await this.query(query);
        return result.rows[0];
    }

    async obtenerVotantePorDni(dni) {
        const query = `
            SELECT v.*, r.opcion_politica, r.fecha_relevamiento, r.observacion, r.fecha_modificacion
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            WHERE v.dni = $1
        `;

        const result = await this.query(query, [dni]);
        return result.rows[0];
    }

    async contarVotantes() {
        const query = 'SELECT COUNT(*) as total FROM padron.votantes';
        const result = await this.query(query);
        return parseInt(result.rows[0].total);
    }

    async obtenerEstadisticasAvanzadas() {
        const query = `
            SELECT 
                COUNT(*) as total_votantes,
                COUNT(r.dni) as total_relevados,
                ROUND(COUNT(r.dni) * 100.0 / COUNT(*), 2) as porcentaje_participacion,
                SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as votos_pj,
                SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as votos_ucr,
                SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as votos_indeciso,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_pj,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_ucr,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_indeciso
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
        `;

        const result = await this.query(query);
        return result.rows[0];
    }

    async obtenerEstadisticasPorSexo() {
        const query = `
            SELECT 
                v.sexo,
                COUNT(*) as total_votantes,
                COUNT(r.dni) as total_relevados,
                ROUND(COUNT(r.dni) * 100.0 / COUNT(*), 2) as porcentaje_participacion,
                SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as votos_pj,
                SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as votos_ucr,
                SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as votos_indeciso,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_pj,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_ucr,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_indeciso
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            GROUP BY v.sexo
            ORDER BY v.sexo
        `;

        const result = await this.query(query);
        return result.rows;
    }

    async obtenerEstadisticasPorRangoEtario() {
        const query = `
            SELECT 
                CASE 
                    WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                    WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                    WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                    WHEN v.edad > 60 THEN '60+'
                    ELSE 'Sin definir'
                END as rango_etario,
                COUNT(*) as total_votantes,
                COUNT(r.dni) as total_relevados,
                ROUND(COUNT(r.dni) * 100.0 / COUNT(*), 2) as porcentaje_participacion,
                SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as votos_pj,
                SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as votos_ucr,
                SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as votos_indeciso,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_pj,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_ucr,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_indeciso
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            GROUP BY 
                CASE 
                    WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                    WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                    WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                    WHEN v.edad > 60 THEN '60+'
                    ELSE 'Sin definir'
                END
            ORDER BY 
                CASE 
                    WHEN (CASE 
                        WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                        WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                        WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                        WHEN v.edad > 60 THEN '60+'
                        ELSE 'Sin definir'
                    END) = '18-30' THEN 1
                    WHEN (CASE 
                        WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                        WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                        WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                        WHEN v.edad > 60 THEN '60+'
                        ELSE 'Sin definir'
                    END) = '31-45' THEN 2
                    WHEN (CASE 
                        WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                        WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                        WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                        WHEN v.edad > 60 THEN '60+'
                        ELSE 'Sin definir'
                    END) = '46-60' THEN 3
                    WHEN (CASE 
                        WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                        WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                        WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                        WHEN v.edad > 60 THEN '60+'
                        ELSE 'Sin definir'
                    END) = '60+' THEN 4
                    ELSE 5
                END
        `;

        const result = await this.query(query);
        return result.rows;
    }

    async obtenerEstadisticasPorCircuito() {
        const query = `
            SELECT 
                v.circuito,
                COUNT(*) as total_votantes,
                COUNT(r.dni) as total_relevados,
                ROUND(COUNT(r.dni) * 100.0 / COUNT(*), 2) as porcentaje_participacion,
                SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as votos_pj,
                SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as votos_ucr,
                SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as votos_indeciso,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_pj,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_ucr,
                ROUND(SUM(CASE WHEN r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(r.dni), 0), 2) as porcentaje_indeciso
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            GROUP BY v.circuito
            ORDER BY v.circuito
        `;

        const result = await this.query(query);
        return result.rows;
    }

    async obtenerEstadisticasCondicionesDetalladas() {
        const query = `
            SELECT
                COUNT(r.dni) as total_relevados,
                SUM(CASE WHEN r.es_empleado_municipal = TRUE THEN 1 ELSE 0 END) as total_empleados_municipales,
                SUM(CASE WHEN r.recibe_ayuda_social = TRUE THEN 1 ELSE 0 END) as total_ayuda_social,
                SUM(CASE WHEN r.esta_fallecido = TRUE THEN 1 ELSE 0 END) as total_fallecidos,
                SUM(CASE WHEN r.es_nuevo_votante = TRUE THEN 1 ELSE 0 END) as total_nuevos_votantes,
                -- Empleados municipales por opcion politica
                SUM(CASE WHEN r.es_empleado_municipal = TRUE AND r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as empleados_pj,
                SUM(CASE WHEN r.es_empleado_municipal = TRUE AND r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as empleados_ucr,
                SUM(CASE WHEN r.es_empleado_municipal = TRUE AND r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as empleados_indeciso,
                -- Ayuda social por opcion politica
                SUM(CASE WHEN r.recibe_ayuda_social = TRUE AND r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as ayuda_social_pj,
                SUM(CASE WHEN r.recibe_ayuda_social = TRUE AND r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as ayuda_social_ucr,
                SUM(CASE WHEN r.recibe_ayuda_social = TRUE AND r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as ayuda_social_indeciso,
                -- Nuevos votantes por opcion politica
                SUM(CASE WHEN r.es_nuevo_votante = TRUE AND r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as nuevos_pj,
                SUM(CASE WHEN r.es_nuevo_votante = TRUE AND r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as nuevos_ucr,
                SUM(CASE WHEN r.es_nuevo_votante = TRUE AND r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as nuevos_indeciso,
                -- Fallecidos por opcion politica
                SUM(CASE WHEN r.esta_fallecido = TRUE AND r.opcion_politica = 'PJ' THEN 1 ELSE 0 END) as fallecidos_pj,
                SUM(CASE WHEN r.esta_fallecido = TRUE AND r.opcion_politica = 'UCR' THEN 1 ELSE 0 END) as fallecidos_ucr,
                SUM(CASE WHEN r.esta_fallecido = TRUE AND r.opcion_politica = 'Indeciso' THEN 1 ELSE 0 END) as fallecidos_indeciso,
                -- Empleados municipales por sexo
                SUM(CASE WHEN r.es_empleado_municipal = TRUE AND v.sexo = 'M' THEN 1 ELSE 0 END) as empleados_masculino,
                SUM(CASE WHEN r.es_empleado_municipal = TRUE AND v.sexo = 'F' THEN 1 ELSE 0 END) as empleados_femenino,
                -- Ayuda social por sexo
                SUM(CASE WHEN r.recibe_ayuda_social = TRUE AND v.sexo = 'M' THEN 1 ELSE 0 END) as ayuda_social_masculino,
                SUM(CASE WHEN r.recibe_ayuda_social = TRUE AND v.sexo = 'F' THEN 1 ELSE 0 END) as ayuda_social_femenino
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
        `;

        const result = await this.query(query);
        return result.rows[0];
    }

    async exportarRelevamientosCSV() {
        const query = `
            SELECT
                v.dni, v.apellido, v.nombre, v.anio_nac, v.domicilio,
                v.tipo_ejemplar, v.circuito, v.sexo, v.edad,
                r.opcion_politica, r.observacion, r.fecha_relevamiento,
                r.fecha_modificacion, r.es_nuevo_votante, r.esta_fallecido,
                r.es_empleado_municipal, r.recibe_ayuda_social,
                r.observaciones_detalle, r.fecha_detalle
            FROM padron.votantes v
            INNER JOIN padron.relevamientos r ON v.dni = r.dni
            ORDER BY v.apellido ASC, v.nombre ASC
        `;

        const result = await this.query(query);
        return result.rows;
    }

    async exportarPadronCSV() {
        const query = `
            SELECT
                v.dni, v.apellido, v.nombre, v.anio_nac, v.domicilio,
                v.tipo_ejemplar, v.circuito, v.sexo, v.edad,
                r.opcion_politica, r.observacion, r.fecha_relevamiento,
                r.fecha_modificacion, r.es_nuevo_votante, r.esta_fallecido,
                r.es_empleado_municipal, r.recibe_ayuda_social,
                r.observaciones_detalle, r.fecha_detalle
            FROM padron.votantes v
            LEFT JOIN padron.relevamientos r ON v.dni = r.dni
            ORDER BY v.apellido ASC, v.nombre ASC
        `;

        const result = await this.query(query);
        return result.rows;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = Database;