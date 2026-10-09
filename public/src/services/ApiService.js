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
            }
        };

        // Agregar token de autenticación si está disponible
        if (this.authToken && !endpoint.includes('/api/auth/login')) {
            defaultOptions.headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        // `timeout` no es una opcion de fetch: se aplica con un AbortController (FE-027).
        // Una peticion puntual lenta, como importar un CSV, lo sube con options.timeout.
        const { timeout: timeoutPropio, ...opcionesFetch } = options;
        const finalOptions = { ...defaultOptions, ...opcionesFetch };
        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), timeoutPropio ?? this.timeout);
        finalOptions.signal = controlador.signal;

        try {
            console.log(`🌐 API Request: ${finalOptions.method} ${url}`);
            
            const response = await fetch(url, finalOptions);
            
            if (!response.ok) {
                // El login es la excepción: ahí un 401 significa "credenciales inválidas", no
                // "sesión vencida". Sin esto, escribir mal la contraseña disparaba logout() y
                // recargaba la página: la persona nunca llegaba a leer el motivo del rechazo
                // y el formulario se vaciaba. Cae al manejo genérico, que lee el mensaje del
                // cuerpo ("Credenciales inválidas") y lo lanza como Error.
                if (response.status === 401 && !endpoint.includes('/api/auth/login')) {
                    // Token expirado o inválido - redirigir automáticamente
                    console.warn('🔒 Token expirado - redirigiendo a login');
                    // logout() es el unico que redirige (FE-046): antes lo hacian los dos.
                    if (window.authService) {
                        await window.authService.logout();
                    } else {
                        window.location.href = '/';
                    }
                    // Devuelve un objeto y no undefined: los llamadores hacen `response.success`
                    // y un undefined lanzaba un TypeError engañoso justo al expirar (FE-014).
                    return { success: false, sesionExpirada: true, message: 'Sesión expirada' };
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

                // 409 al escribir un relevamiento: otra persona modificó la ficha entre
                // que ésta la leyó y la guardó. No es un error de red ni un bug, y la UI
                // necesita el estado del servidor para mostrar los dos valores — así que
                // el cuerpo se devuelve en vez de perderse dentro de un Error.
                //
                // Acotado a esta ruta a propósito: un 409 en otro endpoint (crear un
                // votante con un DNI que ya existe) tiene que seguir siendo una excepción,
                // o quien lo llama creería que la operación salió bien.
                if (response.status === 409 && endpoint.includes('/api/padron/relevamientos/')) {
                    const cuerpo = await response.json().catch(() => ({}));
                    return {
                        success: false,
                        conflicto: true,
                        actual: cuerpo?.errors?.actual || null,
                        message: cuerpo?.message || 'Otra persona modificó esta ficha'
                    };
                }

                // Manejo suave de rate limiting para no romper la UI
                if (response.status === 429) {
                    console.warn('⚠️ Límite de solicitudes alcanzado en gateway');
                    const retryAfterHeader = response.headers.get('Retry-After');
                    const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;
                    return {
                        success: false,
                        data: null,
                        rateLimited: true,
                        retryAfter: Number.isFinite(retryAfter) ? retryAfter : null
                    };
                }

                // El resto de los errores (400 de validacion, 403, 409 fuera del caso
                // especial de relevamientos, etc.) traen el motivo real en el cuerpo
                // ({ success:false, message }). Sin esto, cualquier 400/409 llegaba a
                // la UI como "HTTP 400: Bad Request", perdiendo el mensaje que el
                // service ya habia armado con la validacion concreta.
                let mensaje = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const cuerpo = await response.json();
                    if (cuerpo?.message) mensaje = cuerpo.message;
                } catch {
                    // Sin cuerpo JSON (o vacio): se mantiene el mensaje generico.
                }
                throw new Error(mensaje);
            }

            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Error en la respuesta de la API');
            }

            return data;
        } catch (error) {
            console.error('❌ Error en API:', error);
            if (error.name === 'AbortError') {
                throw new Error('La solicitud tardó demasiado y se canceló. Probá de nuevo.');
            }
            throw error;
        } finally {
            clearTimeout(temporizador);
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
     * Actualizar relevamiento. Sólo viajan los campos presentes en `campos`.
     *
     * Antes recibía los tres por separado y los mandaba siempre, así que para cambiar
     * uno había que leer los otros dos y reenviarlos — y lo que hubiera guardado otra
     * persona entre la lectura y el envío se perdía. Un campo que no está en `campos`
     * no se manda, y el servidor no lo toca. Mandar `''` sí lo vacía.
     */
    async actualizarRelevamiento(dni, campos = {}) {
        const cuerpo = {};
        for (const nombre of ['opcionPolitica', 'observacion', 'telefono', 'version']) {
            if (campos[nombre] !== undefined) cuerpo[nombre] = campos[nombre];
        }

        return await this.request(`/api/padron/relevamientos/${dni}`, {
            method: 'PUT',
            body: JSON.stringify(cuerpo)
        });
    }

    /**
     * Obtener relevamiento por DNI
     */
    async obtenerRelevamiento(dni) {
        return await this.request(`/api/padron/relevamientos/${dni}`);
    }

    /**
     * Obtener el detalle (condiciones especiales) de un votante.
     *
     * Responde 200 con `data: null` cuando el votante todavía no tiene detalle: que no
     * lo tenga es lo normal, no un error.
     */
    async obtenerDetalleVotante(dni) {
        return await this.request(`/api/padron/detalle-votante/${dni}`);
    }

    /**
     * Qué fichas cambiaron desde un momento dado, para marcar las filas que otra
     * persona movió mientras la página estaba abierta.
     */
    async obtenerCambios(desde) {
        return await this.request(`/api/padron/cambios?desde=${encodeURIComponent(desde)}`);
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
     * Apellidos que se repiten en el padron (019). `minimo` y `limite` son opcionales.
     */
    async obtenerEstadisticasPorFamilia({ minimo, limite } = {}) {
        const parametros = new URLSearchParams();
        if (minimo) parametros.set('minimo', minimo);
        if (limite) parametros.set('limite', limite);
        const consulta = parametros.toString();
        return await this.request(`/api/padron/resultados/por-familia${consulta ? `?${consulta}` : ''}`);
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

    // ==================== METODOS DE LISTAS ELECTORALES ====================

    /**
     * Listado paginado de listas (borradores)
     */
    async obtenerListas(parametros = {}) {
        const queryParams = new URLSearchParams();
        Object.entries(parametros).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });
        return await this.request(`/api/listas?${queryParams.toString()}`);
    }

    /**
     * Una lista con sus candidatos
     */
    async obtenerLista(id) {
        return await this.request(`/api/listas/${id}`);
    }

    /**
     * Crear una lista (datos + candidatos)
     */
    async crearLista(data) {
        return await this.request('/api/listas', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * Editar una lista: reemplaza datos y el set completo de candidatos
     */
    async actualizarLista(id, data) {
        return await this.request(`/api/listas/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    /**
     * Borrar una lista
     */
    async eliminarLista(id) {
        return await this.request(`/api/listas/${id}`, { method: 'DELETE' });
    }

    // ==================== METODOS DE COMICIO ====================

    async obtenerFuerzas() {
        return await this.request('/api/comicio/fuerzas');
    }

    async crearFuerza(data) {
        return await this.request('/api/comicio/fuerzas', { method: 'POST', body: JSON.stringify(data) });
    }

    async actualizarFuerza(id, data) {
        return await this.request(`/api/comicio/fuerzas/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    }

    async eliminarFuerza(id) {
        return await this.request(`/api/comicio/fuerzas/${id}`, { method: 'DELETE' });
    }

    async obtenerComicios(parametros = {}) {
        const queryParams = new URLSearchParams();
        Object.entries(parametros).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });
        return await this.request(`/api/comicio?${queryParams.toString()}`);
    }

    async obtenerComicio(id) {
        return await this.request(`/api/comicio/${id}`);
    }

    async crearComicio(data) {
        return await this.request('/api/comicio', { method: 'POST', body: JSON.stringify(data) });
    }

    async actualizarComicio(id, data) {
        return await this.request(`/api/comicio/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    }

    async eliminarComicio(id) {
        return await this.request(`/api/comicio/${id}`, { method: 'DELETE' });
    }

    async metricasComicio(id) {
        return await this.request(`/api/comicio/${id}/metricas`);
    }

    async crearMesa(comicioId, data) {
        return await this.request(`/api/comicio/${comicioId}/mesas`, { method: 'POST', body: JSON.stringify(data) });
    }

    async actualizarMesa(comicioId, mesaId, data) {
        return await this.request(`/api/comicio/${comicioId}/mesas/${mesaId}`, { method: 'PUT', body: JSON.stringify(data) });
    }

    async eliminarMesa(comicioId, mesaId) {
        return await this.request(`/api/comicio/${comicioId}/mesas/${mesaId}`, { method: 'DELETE' });
    }

    async obtenerVotosMesa(comicioId, mesaId) {
        return await this.request(`/api/comicio/${comicioId}/mesas/${mesaId}/votos`);
    }

    async cargarVotosMesa(comicioId, mesaId, data) {
        return await this.request(`/api/comicio/${comicioId}/mesas/${mesaId}/votos`, { method: 'PUT', body: JSON.stringify(data) });
    }

    // ==================== METODOS DE FISCALES ====================

    async obtenerFiscales(parametros = {}) {
        const queryParams = new URLSearchParams();
        Object.entries(parametros).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                queryParams.append(key, value);
            }
        });
        return await this.request(`/api/fiscales?${queryParams.toString()}`);
    }

    async crearFiscal(data) {
        return await this.request('/api/fiscales', { method: 'POST', body: JSON.stringify(data) });
    }

    async actualizarFiscal(id, data) {
        return await this.request(`/api/fiscales/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    }

    async eliminarFiscal(id) {
        return await this.request(`/api/fiscales/${id}`, { method: 'DELETE' });
    }

    async asignacionesDeMesa(mesaId) {
        return await this.request(`/api/fiscales/mesas/${mesaId}/asignaciones`);
    }

    async crearAsignacionFiscal(mesaId, data) {
        return await this.request(`/api/fiscales/mesas/${mesaId}/asignaciones`, { method: 'POST', body: JSON.stringify(data) });
    }

    async actualizarAsignacionFiscal(id, data) {
        return await this.request(`/api/fiscales/asignaciones/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    }

    async eliminarAsignacionFiscal(id) {
        return await this.request(`/api/fiscales/asignaciones/${id}`, { method: 'DELETE' });
    }

    async agendaDeComicio(comicioId, hora) {
        return await this.request(`/api/fiscales/comicio/${comicioId}/agenda?hora=${encodeURIComponent(hora)}`);
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