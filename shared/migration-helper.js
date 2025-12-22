/**
 * Script de migración de datos del sistema monolítico a microservicios
 * 
 * Este script ayuda a migrar los datos existentes desde localStorage
 * hacia el nuevo sistema de microservicios
 */

class MigrationHelper {
    constructor() {
        this.apiBaseUrl = 'http://localhost:3001/api';
    }

    /**
     * Migrar datos desde localStorage al microservicio
     */
    async migrarDatos() {
        console.log('🔄 Iniciando migración de datos...');
        
        try {
            // Obtener datos del localStorage
            const datosVotantes = localStorage.getItem('padron_votantes');
            const datosRelevamientos = localStorage.getItem('padron_relevamientos');
            
            if (!datosVotantes) {
                console.log('❌ No se encontraron datos de votantes en localStorage');
                return false;
            }
            
            const votantes = JSON.parse(datosVotantes);
            const relevamientos = datosRelevamientos ? JSON.parse(datosRelevamientos) : {};
            
            console.log(`📊 Encontrados: ${Object.keys(votantes).length} votantes`);
            console.log(`📝 Encontrados: ${Object.keys(relevamientos).length} relevamientos`);
            
            // Convertir datos al formato CSV para importar
            const csvData = this.convertirACSV(votantes);
            
            // Crear archivo CSV temporal
            const blob = new Blob([csvData], { type: 'text/csv' });
            const file = new File([blob], 'migracion_padron.csv', { type: 'text/csv' });
            
            // Importar CSV
            await this.importarCSV(file);
            
            // Migrar relevamientos
            await this.migrarRelevamientos(relevamientos);
            
            console.log('✅ Migración completada exitosamente');
            return true;
            
        } catch (error) {
            console.error('❌ Error durante la migración:', error);
            return false;
        }
    }
    
    /**
     * Convertir datos de votantes a formato CSV
     */
    convertirACSV(votantes) {
        const headers = 'DNI,AÑO NAC,APELLIDO,NOMBRE,DOMICILIO,TIPO_EJEMPL,CIRCUITO,S\n';
        
        const filas = Object.values(votantes).map(votante => {
            return [
                votante.dni,
                votante.anioNac,
                this.escaparCSV(votante.apellido),
                this.escaparCSV(votante.nombre),
                this.escaparCSV(votante.domicilio),
                this.escaparCSV(votante.tipoEjempl),
                this.escaparCSV(votante.circuito),
                votante.sexo
            ].join(',');
        }).join('\n');
        
        return headers + filas;
    }
    
    /**
     * Escapar valores para CSV
     */
    escaparCSV(valor) {
        if (!valor) return '';
        if (valor.includes(',') || valor.includes('"') || valor.includes('\n')) {
            return `"${valor.replace(/"/g, '""')}"`;
        }
        return valor;
    }
    
    /**
     * Importar archivo CSV al microservicio
     */
    async importarCSV(archivo) {
        const formData = new FormData();
        formData.append('csv', archivo);
        
        const response = await fetch(`${this.apiBaseUrl}/padron/importar-csv`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Error al importar CSV: ${response.status}`);
        }
        
        const resultado = await response.json();
        console.log('📁 CSV importado:', resultado.message);
        return resultado;
    }
    
    /**
     * Migrar relevamientos individuales
     */
    async migrarRelevamientos(relevamientos) {
        console.log('📝 Migrando relevamientos...');
        
        let migrados = 0;
        let errores = 0;
        
        for (const [dni, relevamiento] of Object.entries(relevamientos)) {
            try {
                const response = await fetch(`${this.apiBaseUrl}/padron/relevamientos/${dni}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        opcionPolitica: relevamiento.opcionPolitica,
                        observacion: relevamiento.observacion || ''
                    })
                });
                
                if (response.ok) {
                    migrados++;
                } else {
                    console.warn(`⚠️ Error migrando relevamiento para DNI ${dni}`);
                    errores++;
                }
                
            } catch (error) {
                console.error(`❌ Error con DNI ${dni}:`, error);
                errores++;
            }
            
            // Pequeña pausa para no sobrecargar la API
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        console.log(`✅ Relevamientos migrados: ${migrados}, errores: ${errores}`);
    }
    
    /**
     * Verificar estado de la migración
     */
    async verificarMigracion() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/padron/estadisticas`);
            if (!response.ok) {
                throw new Error('No se pudo conectar con el microservicio');
            }
            
            const data = await response.json();
            const stats = data.data;
            
            console.log('📊 Estado actual del microservicio:');
            console.log(`   Votantes: ${stats.totalVotantes}`);
            console.log(`   Relevamientos: ${stats.totalRelevamientos}`);
            console.log(`   Progreso: ${stats.porcentajeCompletado}%`);
            
            return stats;
            
        } catch (error) {
            console.error('❌ Error verificando migración:', error);
            return null;
        }
    }
    
    /**
     * Crear backup de datos actuales
     */
    crearBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const datosCompletos = {
            votantes: localStorage.getItem('padron_votantes'),
            relevamientos: localStorage.getItem('padron_relevamientos'),
            configuracion: localStorage.getItem('padron_configuracion'),
            timestamp: timestamp
        };
        
        const blob = new Blob([JSON.stringify(datosCompletos, null, 2)], 
                             { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_padron_${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('💾 Backup creado exitosamente');
    }
}

// Hacer disponible globalmente
window.MigrationHelper = MigrationHelper;

// Funciones de conveniencia
window.migrarPadron = async function() {
    const migrator = new MigrationHelper();
    
    // Crear backup antes de migrar
    migrator.crearBackup();
    
    // Ejecutar migración
    const exito = await migrator.migrarDatos();
    
    if (exito) {
        // Verificar resultado
        await migrator.verificarMigracion();
        alert('✅ Migración completada. Revisa la consola para detalles.');
    } else {
        alert('❌ Error durante la migración. Revisa la consola.');
    }
};

window.verificarMigracion = async function() {
    const migrator = new MigrationHelper();
    await migrator.verificarMigracion();
};

window.crearBackup = function() {
    const migrator = new MigrationHelper();
    migrator.crearBackup();
};

console.log('🔧 MigrationHelper cargado');
console.log('💡 Funciones disponibles:');
console.log('   - migrarPadron(): Migrar datos completos');
console.log('   - verificarMigracion(): Ver estado actual');
console.log('   - crearBackup(): Crear backup de localStorage');