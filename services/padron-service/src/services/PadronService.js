const fs = require('fs');
const csv = require('csv-parser');
const { v4: uuidv4 } = require('uuid');
const Database = require('../database/Database');

class PadronService {
    constructor() {
        this.db = new Database();
        this.csvCargado = false;
    }

    async inicializar() {
        try {
            await this.db.testConnection();
            console.log('✓ PadronService inicializado con base de datos');
            
            // Verificar si ya hay votantes en la base de datos
            const totalVotantes = await this.db.contarVotantes();
            if (totalVotantes > 0) {
                this.csvCargado = true;
                console.log(`✓ Base de datos ya contiene ${totalVotantes} votantes`);
            } else {
                // Si la base de datos está vacía, intentar cargar el CSV automáticamente
                await this.cargarCSVAutomaticamente();
            }
            
            return true;
        } catch (error) {
            console.error('❌ Error inicializando PadronService:', error);
            throw error;
        }
    }

    async cargarCSVAutomaticamente() {
        const path = require('path');
        const csvPath = path.join(__dirname, '../../padron_2019_municipal.csv');
        
        console.log('🔍 Buscando archivo CSV en:', csvPath);
        
        if (fs.existsSync(csvPath)) {
            console.log('📄 Encontrado archivo CSV, iniciando carga automática...');
            try {
                const resultado = await this.procesarCSV(csvPath);
                console.log('✅ CSV cargado automáticamente:', resultado.mensaje);
                console.log(`📊 Votantes cargados: ${resultado.totalVotantes}`);
            } catch (error) {
                console.error('❌ Error cargando CSV automáticamente:', error);
            }
        } else {
            console.log('⚠️ No se encontró archivo CSV para carga automática');
        }
    }

    async procesarCSV(archivoPath) {
        console.log('📄 Procesando archivo CSV:', archivoPath);
        
        if (this.csvCargado) {
            console.log('⚠️  CSV ya fue cargado previamente');
            const totalVotantes = await this.db.contarVotantes();
            return { mensaje: 'CSV ya cargado', totalVotantes };
        }

        return new Promise((resolve, reject) => {
            let votantesNuevos = 0;
            let errores = 0;

            fs.createReadStream(archivoPath)
                .pipe(csv())
                .on('data', async (fila) => {
                    try {
                        if (fila.DNI) {
                            await this.db.insertarVotante(fila);
                            votantesNuevos++;
                        }
                    } catch (error) {
                        console.error('Error insertando votante:', error);
                        errores++;
                    }
                })
                .on('end', async () => {
                    try {
                        this.csvCargado = true;
                        const totalVotantes = await this.db.contarVotantes();
                        console.log('✅ CSV procesado exitosamente:', votantesNuevos, 'votantes');
                        resolve({
                            mensaje: 'CSV procesado exitosamente',
                            totalVotantes,
                            votantesNuevos,
                            errores
                        });
                    } catch (error) {
                        reject(error);
                    }
                })
                .on('error', (error) => {
                    console.error('❌ Error procesando CSV:', error);
                    reject(error);
                });
        });
    }

    async obtenerVotantesPaginados(pagina = 1, filtros = {}) {
        const limite = parseInt(filtros.limite) || 50;
        
        const filtrosDB = {};
        if (filtros.dni) filtrosDB.dni = filtros.dni;
        if (filtros.nombre) filtrosDB.nombre = filtros.nombre;
        if (filtros.mesa) filtrosDB.mesa = filtros.mesa;
        
        return await this.db.obtenerVotantesPaginados(pagina, limite, filtrosDB);
    }

    async obtenerVotantePorDni(dni) {
        return await this.db.obtenerVotantePorDni(dni);
    }

    async actualizarRelevamiento(dni, relevamiento) {
        return await this.db.actualizarRelevamiento(dni, relevamiento);
    }

    async obtenerEstadisticas() {
        return await this.db.obtenerEstadisticas();
    }

    // Método para compatibilidad con controladores existentes
    async obtenerEstado() {
        const totalVotantes = await this.db.contarVotantes();
        const estadisticas = await this.db.obtenerEstadisticas();
        
        return {
            votantesCargados: totalVotantes,
            relevamientosRegistrados: parseInt(estadisticas.total_relevados || 0),
            opcionesPoliticasDisponibles: ['PJ', 'UCR', 'Indeciso'],
            csvCargado: this.csvCargado
        };
    }

    // Obtener filtros disponibles (circuitos, mesas, etc.)
    async obtenerFiltrosDisponibles() {
        try {
            const queryCircuitos = 'SELECT DISTINCT circuito FROM padron.votantes WHERE circuito IS NOT NULL ORDER BY circuito';
            const resultCircuitos = await this.db.query(queryCircuitos);
            
            const querySexos = 'SELECT DISTINCT sexo FROM padron.votantes WHERE sexo IS NOT NULL ORDER BY sexo';
            const resultSexos = await this.db.query(querySexos);
            
            return {
                circuitos: resultCircuitos.rows.map(row => row.circuito),
                mesas: [], // Los circuitos son como las mesas en este contexto
                sexos: resultSexos.rows.map(row => row.sexo),
                opcionesPoliticas: ['PJ', 'UCR', 'Indeciso']
            };
        } catch (error) {
            console.error('Error obteniendo filtros:', error);
            return {
                circuitos: [],
                mesas: [],
                sexos: ['M', 'F'],
                opcionesPoliticas: ['PJ', 'UCR', 'Indeciso']
            };
        }
    }

    // Compatibilidad con el frontend existente
    async obtenerConfiguracion() {
        return {
            opcionesPoliticas: ['PJ', 'UCR', 'Indeciso'],
            registrosPorPagina: 50
        };
    }

    // Métodos para estadísticas avanzadas (área de Resultados)
    async obtenerEstadisticasAvanzadas() {
        return await this.db.obtenerEstadisticasAvanzadas();
    }

    async obtenerEstadisticasPorSexo() {
        return await this.db.obtenerEstadisticasPorSexo();
    }

    async obtenerEstadisticasPorRangoEtario() {
        return await this.db.obtenerEstadisticasPorRangoEtario();
    }

    async obtenerEstadisticasPorCircuito() {
        return await this.db.obtenerEstadisticasPorCircuito();
    }
}

module.exports = PadronService;