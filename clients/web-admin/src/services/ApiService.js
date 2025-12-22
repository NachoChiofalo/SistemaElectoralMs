/**
 * Servicio para comunicación con la API del padrón electoral
 */
class ApiService {
    constructor() {
        // Cambiar a API Gateway en lugar de servicio directo
        this.baseURL = 'http://localhost:8080';
        this.timeout = 10000;
        this.authToken = null;
    }

    /**
     * Configurar token de autenticación
     */
    setAuthToken(token) {
        this.authToken = token;
    }

    /**
     * Realizar petición HTTP genérica
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: this.timeout
        };

        // Agregar token de autenticación si está disponible
        if (this.authToken && !endpoint.includes('/api/auth/login')) {
            defaultOptions.headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const finalOptions = { ...defaultOptions, ...options };

        try {
            console.log(`🌐 API Request: ${finalOptions.method} ${url}`);
            
            const response = await fetch(url, finalOptions);
            
            if (!response.ok) {
                if (response.status === 401) {
                    // Token expirado o inválido - redirigir automáticamente
                    console.warn('🔒 Token expirado - redirigiendo a login');
                    if (window.authService) {
                        await window.authService.logout();
                        // Redirigir a la página principal (que mostrará el login)
                        window.location.href = '/';
                    }
                    return; // No lanzar error, solo redirigir
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Error en la respuesta de la API');
            }

            return data;
        } catch (error) {
            console.error('❌ Error en API:', error);
            throw error;
        }
    }

    // ==================== MÉTODOS DEL PADRÓN ====================

    /**
     * Obtener votantes paginados
     */
    async obtenerVotantes(parametros = {}) {
        const queryParams = new URLSearchParams();
        
        Object.entries(parametros).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });

        const endpoint = `/padron/votantes?${queryParams.toString()}`;
        return await this.request(endpoint);
    }

    /**
     * Obtener votante por DNI
     */
    async obtenerVotantePorDNI(dni) {
        return await this.request(`/padron/votantes/${dni}`);
    }

    /**
     * Actualizar relevamiento
     */
    async actualizarRelevamiento(dni, opcionPolitica, observacion = '') {
        return await this.request(`/padron/relevamientos/${dni}`, {
            method: 'PUT',
            body: JSON.stringify({
                opcionPolitica,
                observacion
            })
        });
    }

    /**
     * Obtener relevamiento por DNI
     */
    async obtenerRelevamiento(dni) {
        return await this.request(`/padron/relevamientos/${dni}`);
    }

    /**
     * Obtener estadísticas
     */
    async obtenerEstadisticas() {
        return await this.request('/padron/estadisticas');
    }

    /**
     * Obtener filtros disponibles
     */
    async obtenerFiltrosDisponibles() {
        return await this.request('/padron/filtros');
    }

    /**
     * Importar archivo CSV
     */
    async importarCSV(archivo) {
        const formData = new FormData();
        formData.append('csv', archivo);

        return await this.request('/padron/importar-csv', {
            method: 'POST',
            headers: {
                // No establecer Content-Type para FormData
            },
            body: formData
        });
    }

    /**
     * Exportar datos
     */
    async exportarDatos() {
        const response = await fetch(`${this.baseURL}/padron/exportar`);
        
        if (!response.ok) {
            throw new Error(`Error al exportar: ${response.status}`);
        }

        return response.blob();
    }

    // ==================== MÉTODOS DE RESULTADOS ====================

    /**
     * Obtener estadísticas avanzadas
     */
    async obtenerEstadisticasAvanzadas() {
        return await this.request('/padron/resultados/estadisticas-avanzadas');
    }

    /**
     * Obtener estadísticas por sexo
     */
    async obtenerEstadisticasPorSexo() {
        return await this.request('/padron/resultados/por-sexo');
    }

    /**
     * Obtener estadísticas por rango etario
     */
    async obtenerEstadisticasPorRangoEtario() {
        return await this.request('/padron/resultados/por-rango-etario');
    }

    /**
     * Obtener estadísticas por circuito
     */
    async obtenerEstadisticasPorCircuito() {
        return await this.request('/padron/resultados/por-circuito');
    }

    // ==================== UTILIDADES ====================

    /**
     * Probar redirección con token inválido (solo para testing)
     */
    async testTokenExpiration() {
        console.log('🧪 Testeando redirección con token inválido...');
        const oldToken = this.authToken;
        this.setAuthToken('token-invalid-for-testing');
        
        try {
            await this.request('/padron/estadisticas');
        } catch (error) {
            console.log('🧪 Test completado');
        } finally {
            this.setAuthToken(oldToken);
        }
    }

    /**
     * Verificar estado de la API
     */
    async verificarEstado() {
        try {
            const response = await fetch(`${this.baseURL.replace('/api', '')}/health`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Descargar archivo
     */
    descargarArchivo(blob, nombreArchivo) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombreArchivo;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Instancia global del servicio
window.apiService = new ApiService();
console.log('🌐 ApiService inicializado');