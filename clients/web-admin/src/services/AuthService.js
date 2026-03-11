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
        this._showModal({
            headerBg: 'linear-gradient(135deg,#dc2626,#ef4444)',
            icon: 'fa-clock',
            title: 'Sesion Expirada',
            body: 'Su sesion ha expirado por inactividad.',
            sub: 'Sera redirigido al inicio de sesion...'
        });
    }

    /**
     * Mostrar mensaje de sesión cerrada por otro dispositivo
     */
    showSessionKickedMessage() {
        this._showModal({
            headerBg: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
            icon: 'fa-desktop',
            title: 'Sesion Cerrada',
            body: 'Su cuenta fue accedida desde otro dispositivo.',
            sub: 'Sera redirigido al inicio de sesion...'
        });
    }

    _showModal({ headerBg, icon, title, body, sub }) {
        const existing = document.getElementById('session-expired-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'session-expired-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';
        overlay.innerHTML = `
            <div style="background:white;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.25);max-width:440px;width:90%;overflow:hidden;">
                <div style="display:flex;align-items:center;gap:10px;padding:1.25rem 1.5rem;background:${headerBg};">
                    <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.2);color:white;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">
                        <i class="fas ${icon}"></i>
                    </div>
                    <h3 style="color:white;margin:0;font-size:1.1rem;">${title}</h3>
                </div>
                <div style="text-align:center;padding:2rem 1.5rem;">
                    <p style="font-size:1rem;color:#1e293b;margin:0 0 8px;">${body}</p>
                    <p style="font-size:0.9rem;color:#475569;margin:0;">${sub}</p>
                </div>
                <div style="display:flex;justify-content:center;padding:1rem 1.5rem;border-top:1px solid #e2e8f0;">
                    <button type="button" id="session-expired-login-btn" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:linear-gradient(135deg,#334e68,#102a43);color:white;border:none;border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;">
                        <i class="fas fa-sign-in-alt"></i> Iniciar Sesion
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const loginBtn = document.getElementById('session-expired-login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', function() {
                window.location.href = '/';
            });
        }

        // Auto-redirigir después de 5 segundos
        setTimeout(() => {
            window.location.href = '/';
        }, 5000);
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
                this._handleInvalidSession(response.message);
                return false;
            }
        } catch (error) {
            console.error('Error verificando token:', error);
            this._handleInvalidSession(error.message);
            return false;
        }
    }

    /**
     * Manejar sesión inválida/expirada (detecta causa para mostrar mensaje correcto)
     */
    _handleInvalidSession(message) {
        const isInactivity = message && (
            message.includes('inactividad') ||
            message.includes('expirada')
        );
        const isOtherDevice = message && message.includes('otro dispositivo');

        this.stopTokenVerification();
        this.token = null;
        this.user = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
        this.api.setAuthToken(null);

        if (isOtherDevice) {
            this.showSessionKickedMessage();
        } else {
            this.showSessionExpiredMessage();
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
        this.timeout = timeoutMinutes * 60 * 1000;
        this.warningTimeout = 2 * 60 * 1000; // Advertir 2 minutos antes
        this.timer = null;
        this.warningTimer = null;
        this.countdownInterval = null;
        this.warningModalEl = null;
        this.events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

        // Guardar referencia bound para poder remover los listeners
        this._boundResetTimer = this.resetTimer.bind(this);

        this.init();
    }

    init() {
        this.events.forEach(event => {
            document.addEventListener(event, this._boundResetTimer, true);
        });

        this.resetTimer();
    }

    resetTimer() {
        if (this.timer) clearTimeout(this.timer);
        if (this.warningTimer) clearTimeout(this.warningTimer);

        // Si el warning esta visible, cerrarlo
        this.dismissWarning();

        if (!this.authService.isAuthenticated()) return;

        // Timer de advertencia (se muestra 2 min antes del cierre)
        this.warningTimer = setTimeout(() => {
            this.showInactivityWarning();
        }, this.timeout - this.warningTimeout);

        // Timer de cierre de sesion
        this.timer = setTimeout(() => {
            this.handleInactivity();
        }, this.timeout);
    }

    dismissWarning() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        if (this.warningModalEl && this.warningModalEl.parentNode) {
            this.warningModalEl.remove();
            this.warningModalEl = null;
        }
    }

    showInactivityWarning() {
        // Evitar duplicados
        this.dismissWarning();

        const overlay = document.createElement('div');
        overlay.id = 'inactivity-warning-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';
        overlay.innerHTML = `
            <div style="background:white;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.25);max-width:440px;width:90%;overflow:hidden;">
                <div style="display:flex;align-items:center;gap:10px;padding:1.25rem 1.5rem;background:linear-gradient(135deg,#f59e0b,#d97706);">
                    <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.2);color:white;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">
                        <i class="fas fa-clock"></i>
                    </div>
                    <h3 style="color:white;margin:0;font-size:1.1rem;">Inactividad Detectada</h3>
                </div>
                <div style="text-align:center;padding:2rem 1.5rem;">
                    <p style="font-size:1rem;color:#1e293b;margin:0 0 12px;">
                        Su sesion se cerrara en <strong id="inactivity-countdown" style="font-size:1.3rem;color:#dc2626;">120</strong> segundos por inactividad.
                    </p>
                    <p style="font-size:0.9rem;color:#475569;margin:0;">Haga clic en el boton para continuar trabajando.</p>
                </div>
                <div style="display:flex;justify-content:center;padding:1rem 1.5rem;border-top:1px solid #e2e8f0;">
                    <button type="button" id="inactivity-continue-btn" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:linear-gradient(135deg,#334e68,#102a43);color:white;border:none;border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;">
                        <i class="fas fa-hand-pointer"></i> Continuar Trabajando
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.warningModalEl = overlay;

        // Boton "Continuar Trabajando"
        const continueBtn = document.getElementById('inactivity-continue-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', () => {
                this.resetTimer();
            });
        }

        // Countdown
        let seconds = 120;
        const countdownEl = overlay.querySelector('#inactivity-countdown');
        this.countdownInterval = setInterval(() => {
            seconds--;
            if (countdownEl) countdownEl.textContent = seconds;
            if (seconds <= 0) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
            }
        }, 1000);
    }

    async handleInactivity() {
        console.warn('Usuario inactivo - cerrando sesion');
        this.dismissWarning();

        try {
            if (this.authService.token) {
                await this.authService.api.request('/api/auth/logout', { method: 'POST' });
            }
        } catch (e) {
            // Ignorar errores de red al hacer logout por inactividad
        }

        // Usar el helper centralizado que limpia el estado y muestra el modal
        this.authService._handleInvalidSession('inactividad');
    }

    destroy() {
        if (this.timer) clearTimeout(this.timer);
        if (this.warningTimer) clearTimeout(this.warningTimer);
        this.dismissWarning();

        this.events.forEach(event => {
            document.removeEventListener(event, this._boundResetTimer, true);
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