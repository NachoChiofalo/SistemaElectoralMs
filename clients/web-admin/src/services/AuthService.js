/**
 * Servicio de autenticación para el cliente web
 */
class AuthService {
    constructor(apiService) {
        this.api = apiService;
        this.token = localStorage.getItem('authToken');
        this.user = JSON.parse(localStorage.getItem('userData') || 'null');
        this.verifyInterval = null;
        
        // Iniciar verificación periódica del token
        this.startTokenVerification();
    }

    /**
     * Iniciar verificación periódica del token
     */
    startTokenVerification() {
        // Verificar cada 5 minutos para no sobrecargar el servidor
        this.verifyInterval = setInterval(async () => {
            if (this.isAuthenticated()) {
                console.log('🔍 Verificando token automáticamente...');
                const isValid = await this.verifyToken();
                if (!isValid) {
                    console.warn('⚠️ Token expirado - cerrando sesión automáticamente');
                    await this.logout(); // Esto ya redirigirá automáticamente
                }
            }
        }, 5 * 60 * 1000); // 5 minutos
    }

    /**
     * Detener verificación periódica
     */
    stopTokenVerification() {
        if (this.verifyInterval) {
            clearInterval(this.verifyInterval);
            this.verifyInterval = null;
        }
    }

    /**
     * Mostrar mensaje de sesión expirada
     */
    showSessionExpiredMessage() {
        // Crear modal o notificación
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title">⏰ Sesión Expirada</h5>
                    </div>
                    <div class="modal-body">
                        <p>Su sesión ha expirado por motivos de seguridad (15 minutos).</p>
                        <p>Por favor, inicie sesión nuevamente.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" onclick="location.reload()">
                            Iniciar Sesión
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Auto-recargar después de 3 segundos
        setTimeout(() => {
            location.reload();
        }, 3000);
    }

    /**
     * Verificar si el usuario está autenticado
     */
    isAuthenticated() {
        return !!(this.token && this.user);
    }

    /**
     * Obtener datos del usuario actual
     */
    getCurrentUser() {
        return this.user;
    }

    /**
     * Iniciar sesión
     */
    async login(username, password) {
        try {
            const response = await this.api.request('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });

            if (response.success) {
                this.token = response.data.accessToken;
                this.user = response.data.user;
                
                // Guardar en localStorage
                localStorage.setItem('authToken', this.token);
                localStorage.setItem('userData', JSON.stringify(this.user));
                
                // Configurar token en API service
                this.api.setAuthToken(this.token);
                
                // Reiniciar verificación periódica
                this.startTokenVerification();
                
                return response.data;
            } else {
                throw new Error(response.message || 'Error de autenticación');
            }
        } catch (error) {
            console.error('Error en login:', error);
            throw error;
        }
    }

    /**
     * Cerrar sesión
     */
    async logout() {
        this.stopTokenVerification(); // Detener verificación
        
        try {
            if (this.token) {
                await this.api.request('/api/auth/logout', {
                    method: 'POST'
                });
            }
        } catch (error) {
            console.error('Error en logout:', error);
        } finally {
            // Limpiar datos locales
            this.token = null;
            this.user = null;
            localStorage.removeItem('authToken');
            localStorage.removeItem('userData');
            
            // Limpiar token del API service
            this.api.setAuthToken(null);
            
            // Redirigir a la página principal en lugar de recargar
            console.log('🔒 Sesión cerrada - redirigiendo a login');
            window.location.href = '/';
        }
    }

    /**
     * Verificar si el token es válido
     */
    async verifyToken() {
        if (!this.token) {
            return false;
        }

        try {
            const response = await this.api.request('/api/auth/verify', {
                method: 'POST'
            });

            if (response.success && response.data) {
                // Actualizar datos del usuario
                this.user = response.data;
                localStorage.setItem('userData', JSON.stringify(this.user));
                return true;
            } else {
                // Token inválido, limpiar datos
                this.logout();
                return false;
            }
        } catch (error) {
            console.error('Error verificando token:', error);
            this.logout();
            return false;
        }
    }

    /**
     * Inicializar autenticación al cargar la página
     */
    async init() {
        if (this.token) {
            // Configurar token en API service
            this.api.setAuthToken(this.token);
            
            // Verificar si el token es válido
            const isValid = await this.verifyToken();
            return isValid;
        }
        
        return false;
    }
}

/**
 * Servicio para detectar inactividad del usuario
 */
class InactivityService {
    constructor(authService, timeoutMinutes = 10) {
        this.authService = authService;
        this.timeout = timeoutMinutes * 60 * 1000; // Convertir a ms
        this.warningTimeout = 2 * 60 * 1000; // Advertir 2 minutos antes
        this.timer = null;
        this.warningTimer = null;
        this.events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        
        this.init();
    }

    init() {
        // Agregar listeners de actividad
        this.events.forEach(event => {
            document.addEventListener(event, () => this.resetTimer(), true);
        });
        
        this.resetTimer();
    }

    resetTimer() {
        // Limpiar timers existentes
        if (this.timer) clearTimeout(this.timer);
        if (this.warningTimer) clearTimeout(this.warningTimer);
        
        // Solo si está autenticado
        if (!this.authService.isAuthenticated()) return;
        
        // Timer de advertencia
        this.warningTimer = setTimeout(() => {
            this.showInactivityWarning();
        }, this.timeout - this.warningTimeout);
        
        // Timer de cierre de sesión
        this.timer = setTimeout(() => {
            this.handleInactivity();
        }, this.timeout);
    }

    showInactivityWarning() {
        const modal = document.createElement('div');
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.id = 'inactivityWarning';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title">⏰ Inactividad Detectada</h5>
                    </div>
                    <div class="modal-body">
                        <p>Su sesión se cerrará en <span id="countdown">120</span> segundos por inactividad.</p>
                        <p>Haga clic en cualquier parte para continuar.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" onclick="this.closest('.modal').remove()">
                            Continuar Trabajando
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Countdown
        let seconds = 120;
        const countdownEl = modal.querySelector('#countdown');
        const countdownInterval = setInterval(() => {
            seconds--;
            if (countdownEl) countdownEl.textContent = seconds;
            if (seconds <= 0 || !document.getElementById('inactivityWarning')) {
                clearInterval(countdownInterval);
            }
        }, 1000);
        
        // Auto-cerrar modal al hacer clic
        modal.addEventListener('click', () => {
            modal.remove();
            this.resetTimer();
        });
    }

    async handleInactivity() {
        console.warn('⏰ Usuario inactivo - cerrando sesión');
        await this.authService.logout();
    }

    destroy() {
        if (this.timer) clearTimeout(this.timer);
        if (this.warningTimer) clearTimeout(this.warningTimer);
        
        this.events.forEach(event => {
            document.removeEventListener(event, () => this.resetTimer(), true);
        });
    }
}

// Inicializar servicio de auth
window.authService = new AuthService(window.apiService);

// Inicializar servicio de inactividad
window.addEventListener('load', () => {
    if (window.authService) {
        window.inactivityService = new InactivityService(window.authService, 10); // 10 minutos
        console.log('⏰ InactivityService inicializado');
    }
});
console.log('🔐 AuthService inicializado correctamente');

// Función de diagnóstico
window.authService.diagnosticar = function() {
    console.log('🔍 Diagnóstico AuthService:');
    console.log('  - Token almacenado:', !!this.token);
    console.log('  - Usuario cargado:', !!this.user);
    console.log('  - Autenticado:', this.isAuthenticated());
    if (this.user) {
        console.log('  - Usuario actual:', {
            username: this.user.username,
            nombre: this.user.nombre_completo
        });
    }
};