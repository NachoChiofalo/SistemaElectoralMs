const { Pool } = require('pg');

class Database {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        });

        // Configurar manejo de errores
        this.pool.on('error', (err) => {
            console.error('Error inesperado en el pool de conexiones:', err);
        });
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

    async close() {
        await this.pool.end();
    }
}

module.exports = Database;