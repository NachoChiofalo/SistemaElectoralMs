const DetalleVotante = require('../models/DetalleVotante');

/**
 * Servicio para gestionar DetalleVotante
 * 
 * Responsabilidades:
 * - CRUD de detalles de votantes
 * - Validaciones de negocio
 * - Estadísticas de condiciones especiales
 * - Integración con base de datos
 */
class DetalleVotanteService {
    constructor(database) {
        this.db = database;
    }

    /**
     * Crear o actualizar detalle de votante
     * @param {string} dni - DNI del votante
     * @param {Object} condiciones - Condiciones del votante
     * @returns {Promise<DetalleVotante>} Detalle creado/actualizado
     */
    async crearOActualizarDetalle(dni, condiciones) {
        try {
            // Validar datos
            const errores = DetalleVotante.validate({ dni, ...condiciones });
            if (errores.length > 0) {
                throw new Error(`Datos inválidos: ${errores.join(', ')}`);
            }

            // Verificar si el votante existe
            const votanteExiste = await this.verificarVotanteExiste(dni);
            if (!votanteExiste) {
                throw new Error(`Votante con DNI ${dni} no existe`);
            }

            // Verificar si ya tiene relevamiento
            let relevamientoExiste = await this.verificarRelevamientoExiste(dni);
            
            if (!relevamientoExiste) {
                // Crear relevamiento base si no existe
                await this.crearRelevamientoBase(dni);
            }

            // Actualizar con los detalles
            const queryUpdate = `
                UPDATE padron.relevamientos 
                SET 
                    es_nuevo_votante = $2,
                    esta_fallecido = $3,
                    es_empleado_municipal = $4,
                    recibe_ayuda_social = $5,
                    observaciones_detalle = $6,
                    fecha_detalle = CURRENT_TIMESTAMP
                WHERE dni = $1
                RETURNING *
            `;

            const values = [
                dni,
                condiciones.esNuevoVotante || false,
                condiciones.estaFallecido || false,
                condiciones.esEmpleadoMunicipal || false,
                condiciones.recibeAyudaSocial || false,
                condiciones.observacionesDetalle || ''
            ];

            const result = await this.db.query(queryUpdate, values);
            
            if (result.rows.length === 0) {
                throw new Error('No se pudo actualizar el detalle del votante');
            }

            return this.mapearDesdeDB(result.rows[0]);
        } catch (error) {
            console.error('Error al crear/actualizar detalle:', error);
            throw error;
        }
    }

    /**
     * Obtener detalle de votante por DNI
     * @param {string} dni - DNI del votante
     * @returns {Promise<DetalleVotante|null>} Detalle del votante o null
     */
    async obtenerDetallePorDni(dni) {
        try {
            const query = `
                SELECT r.*, v.apellido, v.nombre
                FROM padron.relevamientos r
                JOIN padron.votantes v ON r.dni = v.dni
                WHERE r.dni = $1
            `;

            const result = await this.db.query(query, [dni]);
            
            if (result.rows.length === 0) {
                return null;
            }

            return this.mapearDesdeDB(result.rows[0]);
        } catch (error) {
            console.error('Error al obtener detalle:', error);
            throw error;
        }
    }

    /**
     * Obtener votantes con condiciones especiales
     * @param {Object} filtros - Filtros de búsqueda
     * @returns {Promise<Array>} Lista de votantes con condiciones especiales
     */
    async obtenerVotantesConCondicionesEspeciales(filtros = {}) {
        try {
            let whereClause = 'WHERE (r.es_nuevo_votante = TRUE OR r.esta_fallecido = TRUE OR r.es_empleado_municipal = TRUE OR r.recibe_ayuda_social = TRUE)';
            const params = [];

            // Aplicar filtros específicos
            if (filtros.esNuevoVotante !== undefined) {
                params.push(filtros.esNuevoVotante);
                whereClause += ` AND r.es_nuevo_votante = $${params.length}`;
            }
            
            if (filtros.estaFallecido !== undefined) {
                params.push(filtros.estaFallecido);
                whereClause += ` AND r.esta_fallecido = $${params.length}`;
            }
            
            if (filtros.esEmpleadoMunicipal !== undefined) {
                params.push(filtros.esEmpleadoMunicipal);
                whereClause += ` AND r.es_empleado_municipal = $${params.length}`;
            }
            
            if (filtros.recibeAyudaSocial !== undefined) {
                params.push(filtros.recibeAyudaSocial);
                whereClause += ` AND r.recibe_ayuda_social = $${params.length}`;
            }

            const query = `
                SELECT 
                    v.dni, v.apellido, v.nombre, v.edad, v.sexo, v.circuito,
                    r.es_nuevo_votante, r.esta_fallecido, r.es_empleado_municipal, 
                    r.recibe_ayuda_social, r.observaciones_detalle, r.fecha_detalle,
                    r.opcion_politica, r.observacion
                FROM padron.votantes v
                JOIN padron.relevamientos r ON v.dni = r.dni
                ${whereClause}
                ORDER BY v.apellido, v.nombre
            `;

            const result = await this.db.query(query, params);
            
            return result.rows.map(row => ({
                votante: {
                    dni: row.dni,
                    apellido: row.apellido,
                    nombre: row.nombre,
                    edad: row.edad,
                    sexo: row.sexo,
                    circuito: row.circuito
                },
                detalle: this.mapearDesdeDB(row),
                relevamiento: {
                    opcionPolitica: row.opcion_politica,
                    observacion: row.observacion
                }
            }));
        } catch (error) {
            console.error('Error al obtener votantes con condiciones especiales:', error);
            throw error;
        }
    }

    /**
     * Obtener estadísticas de condiciones especiales
     * @returns {Promise<Object>} Estadísticas agregadas
     */
    async obtenerEstadisticasCondicionesEspeciales() {
        try {
            const query = `SELECT * FROM padron.estadisticas_condiciones_especiales`;
            const result = await this.db.query(query);
            
            if (result.rows.length === 0) {
                return {
                    totalNuevosVotantes: 0,
                    totalFallecidos: 0,
                    totalEmpleadosMunicipales: 0,
                    totalAyudaSocial: 0,
                    totalConCondicionesEspeciales: 0,
                    totalRelevamientos: 0
                };
            }

            const row = result.rows[0];
            return {
                totalNuevosVotantes: parseInt(row.total_nuevos_votantes) || 0,
                totalFallecidos: parseInt(row.total_fallecidos) || 0,
                totalEmpleadosMunicipales: parseInt(row.total_empleados_municipales) || 0,
                totalAyudaSocial: parseInt(row.total_ayuda_social) || 0,
                totalConCondicionesEspeciales: parseInt(row.total_con_condiciones_especiales) || 0,
                totalRelevamientos: parseInt(row.total_relevamientos) || 0
            };
        } catch (error) {
            console.error('Error al obtener estadísticas de condiciones especiales:', error);
            throw error;
        }
    }

    /**
     * Eliminar detalle de votante (resetear a valores por defecto)
     * @param {string} dni - DNI del votante
     * @returns {Promise<boolean>} True si se eliminó correctamente
     */
    async eliminarDetalle(dni) {
        try {
            const query = `
                UPDATE padron.relevamientos 
                SET 
                    es_nuevo_votante = FALSE,
                    esta_fallecido = FALSE,
                    es_empleado_municipal = FALSE,
                    recibe_ayuda_social = FALSE,
                    observaciones_detalle = '',
                    fecha_detalle = CURRENT_TIMESTAMP
                WHERE dni = $1
            `;

            const result = await this.db.query(query, [dni]);
            return result.rowCount > 0;
        } catch (error) {
            console.error('Error al eliminar detalle:', error);
            throw error;
        }
    }

    // ==================== MÉTODOS PRIVADOS ====================

    /**
     * Verificar si un votante existe en el padrón
     * @private
     */
    async verificarVotanteExiste(dni) {
        const query = 'SELECT 1 FROM padron.votantes WHERE dni = $1';
        const result = await this.db.query(query, [dni]);
        return result.rows.length > 0;
    }

    /**
     * Verificar si un votante ya tiene relevamiento
     * @private
     */
    async verificarRelevamientoExiste(dni) {
        const query = 'SELECT 1 FROM padron.relevamientos WHERE dni = $1';
        const result = await this.db.query(query, [dni]);
        return result.rows.length > 0;
    }

    /**
     * Crear relevamiento base para un votante
     * @private
     */
    async crearRelevamientoBase(dni) {
        const query = `
            INSERT INTO padron.relevamientos (dni, opcion_politica, observacion, fecha_relevamiento)
            VALUES ($1, 'Indeciso', '', CURRENT_TIMESTAMP)
        `;
        await this.db.query(query, [dni]);
    }

    /**
     * Mapear fila de base de datos a modelo DetalleVotante
     * @private
     */
    mapearDesdeDB(row) {
        return new DetalleVotante(row.dni, {
            esNuevoVotante: row.es_nuevo_votante || false,
            estaFallecido: row.esta_fallecido || false,
            esEmpleadoMunicipal: row.es_empleado_municipal || false,
            recibeAyudaSocial: row.recibe_ayuda_social || false,
            observacionesDetalle: row.observaciones_detalle || '',
            fechaCreacion: row.fecha_detalle || row.fecha_relevamiento,
            fechaModificacion: row.fecha_detalle || row.fecha_relevamiento
        });
    }
}

module.exports = DetalleVotanteService;