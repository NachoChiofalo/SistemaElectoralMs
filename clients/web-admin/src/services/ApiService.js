/**
 * Servicio para comunicación con la API del padrón electoral
 */
class ApiService {
    constructor() {
        // Usar origin actual (funciona en localhost y en produccion)
        this.baseURL = window.location.origin;
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

                // 404 esperado para detalle-votante cuando no existe aún
                if (response.status === 404 && endpoint.includes('/api/padron/detalle-votante')) {
                    console.warn('ℹ️ Detalle de votante no encontrado, se continúa sin detalle');
                    return { success: false, data: null, notFound: true };
                }

                // 500 puede ocurrir en consultas opcionales de detalle; degradar sin romper UI
                if (response.status === 500 && endpoint.includes('/api/padron/detalle-votante')) {
                    console.warn('ℹ️ Detalle de votante no disponible temporalmente, se continúa sin detalle');
                    return { success: false, data: null, degraded: true };
                }

                // Manejo suave de rate limiting para no romper la UI
                if (response.status === 429) {
                    console.warn('⚠️ Límite de solicitudes alcanzado en gateway');
                    return { success: false, data: null, rateLimited: true };
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

        const endpoint = `/api/padron/votantes?${queryParams.toString()}`;
        return await this.request(endpoint);
    }

    /**
     * Crear nuevo votante
     */
    async crearVotante(data) {
        return await this.request('/api/padron/votantes', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * Obtener votante por DNI
     */
    async obtenerVotantePorDNI(dni) {
        return await this.request(`/api/padron/votantes/${dni}`);
    }

    /**
     * Actualizar relevamiento
     */
    async actualizarRelevamiento(dni, opcionPolitica, observacion = '', telefono = '') {
        return await this.request(`/api/padron/relevamientos/${dni}`, {
            method: 'PUT',
            body: JSON.stringify({
                opcionPolitica,
                observacion,
                telefono
            })
        });
    }

    /**
     * Obtener relevamiento por DNI
     */
    async obtenerRelevamiento(dni) {
        return await this.request(`/api/padron/relevamientos/${dni}`);
    }

    /**
     * Obtener estadísticas
     */
    async obtenerEstadisticas() {
        return await this.request('/api/padron/estadisticas');
    }

    /**
     * Obtener filtros disponibles
     */
    async obtenerFiltrosDisponibles() {
        return await this.request('/api/padron/filtros');
    }

    /**
     * Importar archivo CSV
     */
    async importarCSV(archivo) {
        const formData = new FormData();
        formData.append('csv', archivo);

        return await this.request('/api/padron/importar-csv', {
            method: 'POST',
            headers: {
                // No establecer Content-Type para FormData
            },
            body: formData
        });
    }

    /**
     * Exportar relevamientos como CSV (admin-only)
     */
    async exportarDatos() {
        const url = `${this.baseURL}/api/padron/exportar-relevamientos`;

        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('Acceso denegado: solo administradores pueden exportar datos');
            }
            throw new Error(`Error al exportar: ${response.status}`);
        }

        return response.blob();
    }

    /**
     * Exportar padron completo como CSV (admin-only)
     */
    async exportarPadron() {
        const url = `${this.baseURL}/api/padron/exportar-padron`;

        const headers = {};
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('Acceso denegado: solo administradores pueden exportar el padron');
            }
            throw new Error(`Error al exportar padron: ${response.status}`);
        }

        return response.blob();
    }

    // ==================== MÉTODOS DE RESULTADOS ====================

    /**
     * Obtener estadísticas avanzadas
     */
    async obtenerEstadisticasAvanzadas() {
        return await this.request('/api/padron/resultados/estadisticas-avanzadas');
    }

    /**
     * Obtener estadísticas por sexo
     */
    async obtenerEstadisticasPorSexo() {
        return await this.request('/api/padron/resultados/por-sexo');
    }

    /**
     * Obtener estadísticas por rango etario
     */
    async obtenerEstadisticasPorRangoEtario() {
        return await this.request('/api/padron/resultados/por-rango-etario');
    }

    /**
     * Obtener estadísticas por circuito
     */
    async obtenerEstadisticasPorCircuito() {
        return await this.request('/api/padron/resultados/por-circuito');
    }

    async obtenerEstadisticasCondicionesDetalladas() {
        return await this.request('/api/padron/resultados/condiciones-detalladas');
    }

    // ==================== MÉTODOS DE USUARIOS ====================

    /**
     * Obtener lista de usuarios (admin)
     */
    async obtenerUsuarios() {
        return await this.request('/api/users');
    }

    /**
     * Crear nuevo usuario (admin)
     */
    async crearUsuario(data) {
        return await this.request('/api/users', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * Actualizar usuario (admin)
     */
    async actualizarUsuario(id, data) {
        return await this.request(`/api/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    /**
     * Activar/desactivar usuario (admin)
     */
    async toggleUsuario(id, activo) {
        return await this.request(`/api/users/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ activo })
        });
    }

    /**
     * Resetear contraseña de usuario (admin)
     */
    async resetearPassword(id, newPassword) {
        return await this.request(`/api/users/${id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ newPassword })
        });
    }

    /**
     * Obtener roles disponibles (admin)
     */
    async obtenerRoles() {
        return await this.request('/api/users/roles');
    }

    // ==================== METODOS DE AUDITORIA ====================

    async obtenerAuditoria(filtros = {}) {
        const queryParams = new URLSearchParams();
        Object.entries(filtros).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });
        return await this.request(`/api/padron/auditoria?${queryParams.toString()}`);
    }

    async obtenerEstadisticasAuditoria(filtros = {}) {
        const queryParams = new URLSearchParams();
        Object.entries(filtros).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });
        return await this.request(`/api/padron/auditoria/estadisticas?${queryParams.toString()}`);
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
            await this.request('/api/padron/estadisticas');
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
            console.log('🔍 Verificando estado de API...');
            
            // Intentar con el health endpoint del API Gateway
            let healthUrl = `${this.baseURL.replace('/api', '')}/health`;
            console.log('  - URL de health:', healthUrl);
            
            const response = await fetch(healthUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            
            console.log('  - Response status:', response.status);
            console.log('  - Response ok:', response.ok);
            
            if (response.ok) {
                const data = await response.json();
                console.log('  - Health data:', data);
                return true;
            }
            
            console.warn('  - Health check falló con status:', response.status);
            return false;
            
        } catch (error) {
            console.error('  - Error en health check:', error);
            // En caso de error, asumir que está disponible para no bloquear
            console.warn('  - Asumiendo API disponible debido al error');
            return true;
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
console.log('🌐 ApiService inicializado correctamente');

// Función de diagnóstico para verificar el estado
window.apiService.diagnosticar = async function() {
    console.log('🔍 Diagnóstico ApiService:');
    console.log('  - Base URL:', this.baseURL);
    console.log('  - Token configurado:', !!this.authToken);
    
    try {
        const healthCheck = await this.verificarEstado();
        console.log('  - Health check:', healthCheck ? '✅ OK' : '❌ FAILED');
        return healthCheck;
    } catch (error) {
        console.error('  - Health check error:', error);
        return false;
    }
};