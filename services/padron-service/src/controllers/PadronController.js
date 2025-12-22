const PadronService = require('../services/PadronService');
const DetalleVotanteService = require('../services/DetalleVotanteService');
const Database = require('../database/Database');
const path = require('path');
const fs = require('fs');

class PadronController {
    constructor() {
        this.padronService = new PadronService();
        this.database = new Database();
        this.detalleVotanteService = new DetalleVotanteService(this.database);
        this.inicializando = false;
        this.inicializado = false;
    }

    async inicializar() {
        if (this.inicializando) return;
        if (this.inicializado) return;
        
        this.inicializando = true;
        try {
            await this.padronService.inicializar();
            this.inicializado = true;
            console.log('✓ PadronController inicializado');
        } catch (error) {
            console.error('❌ Error inicializando PadronController:', error);
            throw error;
        } finally {
            this.inicializando = false;
        }
    }

    async cargarCSV(req, res) {
        try {
            await this.inicializar();
            
            if (!req.file) {
                return res.status(400).json({ error: 'No se ha subido ningún archivo' });
            }

            console.log('📁 Archivo recibido:', req.file.originalname);
            const resultado = await this.padronService.procesarCSV(req.file.path);

            // Limpiar archivo temporal
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupError) {
                console.warn('No se pudo eliminar el archivo temporal:', cleanupError);
            }

            res.json({
                success: true,
                ...resultado
            });

        } catch (error) {
            console.error('❌ Error cargando CSV:', error);
            
            // Limpiar archivo en caso de error
            if (req.file && req.file.path) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (cleanupError) {
                    console.warn('No se pudo eliminar el archivo temporal:', cleanupError);
                }
            }
            
            res.status(500).json({ error: error.message });
        }
    }

    async obtenerVotantes(req, res) {
        try {
            await this.inicializar();
            
            const pagina = parseInt(req.query.pagina) || 1;
            const limite = parseInt(req.query.limite) || 50;
            
            const filtros = {
                dni: req.query.dni,
                nombre: req.query.nombre,
                mesa: req.query.mesa,
                limite: limite
            };

            const resultado = await this.padronService.obtenerVotantesPaginados(pagina, filtros);
            
            // Formatear datos para el frontend: separar votante y relevamiento
            const votantesFormateados = resultado.votantes.map(row => ({
                votante: {
                    dni: row.dni,
                    anioNac: row.anio_nac,
                    apellido: row.apellido,
                    nombre: row.nombre,
                    domicilio: row.domicilio,
                    tipoEjempl: row.tipo_ejemplar,
                    circuito: row.circuito,
                    sexo: row.sexo,
                    edad: row.edad
                },
                relevamiento: row.opcion_politica ? {
                    opcionPolitica: row.opcion_politica,
                    observacion: row.observacion || '',
                    fechaRelevamiento: row.fecha_relevamiento
                } : null
            }));
            
            // Formatear respuesta compatible con frontend original
            res.json({
                success: true,
                data: votantesFormateados,
                paginacion: {
                    paginaActual: resultado.pagina,
                    totalPaginas: resultado.totalPaginas,
                    totalRegistros: resultado.total,
                    registrosPorPagina: resultado.limite,
                    inicio: (resultado.pagina - 1) * resultado.limite + 1,
                    fin: Math.min(resultado.pagina * resultado.limite, resultado.total)
                }
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo votantes:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async obtenerVotantePorDni(req, res) {
        try {
            await this.inicializar();
            
            const { dni } = req.params;
            const votante = await this.padronService.obtenerVotantePorDni(dni);
            
            if (!votante) {
                return res.status(404).json({ error: 'Votante no encontrado' });
            }
            
            res.json(votante);
            
        } catch (error) {
            console.error('❌ Error obteniendo votante:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async obtenerRelevamiento(req, res) {
        try {
            await this.inicializar();

            const { dni } = req.params;
            const votante = await this.padronService.obtenerVotantePorDni(dni);

            if (!votante) {
                return res.status(404).json({ success: false, message: 'Votante no encontrado' });
            }

            // Extraer solo la información del relevamiento
            const relevamiento = {
                dni: votante.dni,
                opcionPolitica: votante.opcion_politica || 'Indeciso',
                observacion: votante.observacion || '',
                fechaRelevamiento: votante.fecha_relevamiento || null,
                fechaModificacion: votante.fecha_modificacion || votante.fecha_relevamiento || null
            };

            res.json({ success: true, data: relevamiento });
        } catch (error) {
            console.error('❌ Error obteniendo relevamiento:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async actualizarRelevamiento(req, res) {
        try {
            await this.inicializar();
            
            const { dni } = req.params;
            const { opcionPolitica, observacion } = req.body;

            if (!opcionPolitica) {
                return res.status(400).json({ error: 'El campo opcionPolitica es requerido' });
            }

            const relevamiento = {
                voto: opcionPolitica,  // Mapear al campo interno
                observaciones: observacion || ''
            };

            const resultado = await this.padronService.actualizarRelevamiento(dni, relevamiento);
            res.json({
                success: true,
                relevamiento: resultado
            });
            
        } catch (error) {
            console.error('❌ Error actualizando relevamiento:', error);
            res.status(500).json({ error: error.message });
        }
    }

    async obtenerEstadisticas(req, res) {
        try {
            await this.inicializar();
            
            const estadisticas = await this.padronService.obtenerEstadisticas();
            console.log('📊 Estadísticas DB:', estadisticas);
            
            // Asegurar que todos los campos existen con valores por defecto
            const totalVotantes = parseInt(estadisticas?.total_votantes || 0);
            const totalRelevados = parseInt(estadisticas?.total_relevados || 0);
            const votosPJ = parseInt(estadisticas?.votos_pj || 0);
            const votosUCR = parseInt(estadisticas?.votos_ucr || 0);
            const votosIndeciso = parseInt(estadisticas?.votos_indeciso || 0);
            
            // Formatear estadísticas compatible con frontend original
            const estadisticasFormateadas = {
                totalVotantes: totalVotantes,
                totalRelevamientos: totalRelevados,
                porcentajeRelevados: totalVotantes > 0 ? 
                    parseFloat(((totalRelevados / totalVotantes) * 100).toFixed(2)) : 0,
                estadisticasPoliticas: {
                    PJ: votosPJ,
                    UCR: votosUCR,
                    Indeciso: votosIndeciso
                },
                sinRelevar: Math.max(0, totalVotantes - totalRelevados)
            };
            
            console.log('📊 Estadísticas formateadas:', JSON.stringify(estadisticasFormateadas, null, 2));
            
            res.json({
                success: true,
                data: estadisticasFormateadas
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas:', error);
            // Return safe default values even on error
            res.status(200).json({
                success: true,
                data: {
                    totalVotantes: 0,
                    totalRelevamientos: 0,
                    porcentajeRelevados: 0,
                    estadisticasPoliticas: {
                        PJ: 0,
                        UCR: 0,
                        Indeciso: 0
                    },
                    sinRelevar: 0
                }
            });
        }
    }

    async obtenerEstado(req, res) {
        try {
            await this.inicializar();
            
            const estado = await this.padronService.obtenerEstado();
            res.json({
                success: true,
                data: estado
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo estado:', error);
            res.status(500).json({
                success: false, 
                error: error.message,
                inicializado: this.inicializado 
            });
        }
    }

    async healthCheck(req, res) {
        try {
            const estado = this.inicializado ? 
                await this.padronService.obtenerEstado() : 
                { inicializado: false };
                
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'padron-service',
                inicializado: this.inicializado,
                ...estado
            });
        } catch (error) {
            res.status(500).json({
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    async obtenerFiltrosDisponibles(req, res) {
        try {
            await this.inicializar();
            
            const filtros = await this.padronService.obtenerFiltrosDisponibles();
            res.json({
                success: true,
                data: filtros
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo filtros:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async obtenerConfiguracion(req, res) {
        try {
            await this.inicializar();
            
            const configuracion = await this.padronService.obtenerConfiguracion();
            res.json({
                success: true,
                data: configuracion
            });
            
        } catch (error) {
            console.error('❌ Error obteniendo configuración:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // ==================== MÉTODOS PARA RESULTADOS ====================

    async obtenerEstadisticasAvanzadas(req, res) {
        try {
            await this.inicializar();
            
            const estadisticas = await this.padronService.obtenerEstadisticasAvanzadas();
            res.json({
                success: true,
                data: estadisticas
            });
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas avanzadas:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    async obtenerEstadisticasPorSexo(req, res) {
        try {
            await this.inicializar();
            
            const estadisticas = await this.padronService.obtenerEstadisticasPorSexo();
            res.json({
                success: true,
                data: estadisticas
            });
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas por sexo:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    async obtenerEstadisticasPorRangoEtario(req, res) {
        try {
            await this.inicializar();
            
            const estadisticas = await this.padronService.obtenerEstadisticasPorRangoEtario();
            res.json({
                success: true,
                data: estadisticas
            });
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas por rango etario:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    async obtenerEstadisticasPorCircuito(req, res) {
        try {
            await this.inicializar();
            
            const estadisticas = await this.padronService.obtenerEstadisticasPorCircuito();
            res.json({
                success: true,
                data: estadisticas
            });
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas por circuito:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // ==================== ENDPOINTS DETALLE VOTANTE ====================

    /**
     * POST /padron/detalle-votante
     * Crear o actualizar detalle de votante
     */
    async crearOActualizarDetalleVotante(req, res) {
        try {
            await this.inicializar();
            
            const { dni, condiciones } = req.body;
            
            if (!dni) {
                return res.status(400).json({
                    success: false,
                    message: 'DNI es requerido'
                });
            }

            const detalle = await this.detalleVotanteService.crearOActualizarDetalle(dni, condiciones);
            
            res.json({
                success: true,
                data: detalle
            });
        } catch (error) {
            console.error('❌ Error creando/actualizando detalle votante:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * GET /padron/detalle-votante/:dni
     * Obtener detalle de votante por DNI
     */
    async obtenerDetalleVotante(req, res) {
        try {
            await this.inicializar();
            
            const { dni } = req.params;
            const detalle = await this.detalleVotanteService.obtenerDetallePorDni(dni);
            
            if (!detalle) {
                return res.status(404).json({
                    success: false,
                    message: 'Detalle de votante no encontrado'
                });
            }

            res.json({
                success: true,
                data: detalle
            });
        } catch (error) {
            console.error('❌ Error obteniendo detalle votante:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * GET /padron/condiciones-especiales
     * Obtener votantes con condiciones especiales
     */
    async obtenerVotantesCondicionesEspeciales(req, res) {
        try {
            await this.inicializar();
            
            const filtros = {
                esNuevoVotante: req.query.esNuevoVotante === 'true' ? true : req.query.esNuevoVotante === 'false' ? false : undefined,
                estaFallecido: req.query.estaFallecido === 'true' ? true : req.query.estaFallecido === 'false' ? false : undefined,
                esEmpleadoMunicipal: req.query.esEmpleadoMunicipal === 'true' ? true : req.query.esEmpleadoMunicipal === 'false' ? false : undefined,
                recibeAyudaSocial: req.query.recibeAyudaSocial === 'true' ? true : req.query.recibeAyudaSocial === 'false' ? false : undefined
            };

            const votantes = await this.detalleVotanteService.obtenerVotantesConCondicionesEspeciales(filtros);
            
            res.json({
                success: true,
                data: votantes
            });
        } catch (error) {
            console.error('❌ Error obteniendo votantes con condiciones especiales:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * GET /padron/estadisticas-condiciones-especiales
     * Obtener estadísticas de condiciones especiales
     */
    async obtenerEstadisticasCondicionesEspeciales(req, res) {
        try {
            await this.inicializar();
            
            const estadisticas = await this.detalleVotanteService.obtenerEstadisticasCondicionesEspeciales();
            
            res.json({
                success: true,
                data: estadisticas
            });
        } catch (error) {
            console.error('❌ Error obteniendo estadísticas de condiciones especiales:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    /**
     * DELETE /padron/detalle-votante/:dni
     * Eliminar detalle de votante (resetear condiciones)
     */
    async eliminarDetalleVotante(req, res) {
        try {
            await this.inicializar();
            
            const { dni } = req.params;
            const eliminado = await this.detalleVotanteService.eliminarDetalle(dni);
            
            if (!eliminado) {
                return res.status(404).json({
                    success: false,
                    message: 'No se encontró el detalle a eliminar'
                });
            }

            res.json({
                success: true,
                message: 'Detalle eliminado correctamente'
            });
        } catch (error) {
            console.error('❌ Error eliminando detalle votante:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
    }
    


module.exports = PadronController;