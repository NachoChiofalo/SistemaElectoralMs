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
            tono: 'peligro',
            icon: 'fa-clock',
            title: 'Sesión expirada',
            body: 'Su sesión expiró por inactividad.',
            sub: 'Será redirigido al inicio de sesión…'
        });
    }

    /**
     * Mostrar mensaje de sesión cerrada por otro dispositivo
     */
    showSessionKickedMessage() {
        this._showModal({
            tono: 'info',
            icon: 'fa-desktop',
            title: 'Sesión cerrada',
            body: 'Su cuenta se abrió desde otro dispositivo.',
            sub: 'Será redirigido al inicio de sesión…'
        });
    }

    /**
     * Aviso de sesión terminada. Usa lib/dialogo.js: antes era un div armado a mano con
     * colores fijos (blanco en pleno modo oscuro), sin role="dialog", sin foco y sin
     * forma de que un lector de pantalla se enterara. No se puede cerrar: la sesión ya
     * terminó y la única salida es volver al inicio.
     */
    _showModal({ tono, icon, title, body, sub }) {
        const irAlInicio = () => { window.location.href = '/'; };
        if (!window.dialogo) { irAlInicio(); return; }

        if (this._dialogoSesion) this._dialogoSesion.cerrar();

        const parrafo = (texto) => { const p = document.createElement('p'); p.textContent = texto; return p; };
        this._dialogoSesion = window.dialogo.abrir({
            titulo: title,
            tono,
            icono: icon,
            rol: 'alertdialog',
            cerrable: false,
            cuerpo: [parrafo(body), parrafo(sub)],
            acciones: [{ id: 'login', texto: 'Iniciar sesión', tipo: 'primario', foco: true }]
        });
        this._dialogoSesion.resultado.then(irAlInicio);

        // Auto-redirigir después de 5 segundos
        setTimeout(irAlInicio, 5000);
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

            if (response?.rateLimited) {
                const retryAfter = Number.isFinite(response.retryAfter) ? response.retryAfter : null;
                const retryText = retryAfter ? ` Reintenta en ${retryAfter}s.` : ' Reintenta en unos segundos.';
                const error = new Error(`Limite de solicitudes alcanzado.${retryText}`);
                error.rateLimited = true;
                error.retryAfter = retryAfter;
                throw error;
            }

            if (!response) {
                throw new Error('No se pudo conectar con el servidor de autenticacion');
            }

            if (response.success) {
                this.token = response.data.accessToken;
                this.user = response.data.user;
                
                // Guardar en localStorage
                localStorage.setItem('authToken', this.token);
                localStorage.setItem('userData', JSON.stringify(this.user));
                
                // Configurar token en API service
                this.api.setAuthToken(this.token);

                // Reiniciar verificación periódica (limpiar antes: si ya había una
                // corriendo, este intervalo se acumula en vez de reemplazarla)
                this.stopTokenVerification();
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

            if (response?.rateLimited) {
                console.warn('⚠️ Verificacion de token limitada por el gateway');
                return true;
            }

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
        this.warningDialog = null;
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
        if (this.warningDialog) {
            const dialogo = this.warningDialog;
            this.warningDialog = null;
            dialogo.cerrar();
        }
    }

    showInactivityWarning() {
        // Evitar duplicados
        this.dismissWarning();
        if (!window.dialogo) return;

        const cuenta = document.createElement('strong');
        cuenta.className = 'dialogo-cuenta';
        cuenta.id = 'inactivity-countdown';
        cuenta.textContent = '120';

        const aviso = document.createElement('p');
        aviso.append('Su sesión se cerrará en ', cuenta, ' segundos por inactividad.');
        const ayuda = document.createElement('p');
        ayuda.textContent = 'Pulse el botón para continuar trabajando.';

        this.warningDialog = window.dialogo.abrir({
            titulo: 'Inactividad detectada',
            tono: 'aviso',
            icono: 'fa-clock',
            rol: 'alertdialog',
            cerrable: false,
            cuerpo: [aviso, ayuda],
            acciones: [{ id: 'continuar', texto: 'Continuar trabajando', tipo: 'primario', foco: true }]
        });
        // resetTimer() cierra este mismo diálogo por dismissWarning(); el resultado solo
        // llega con 'continuar' cuando fue la persona quien lo pulsó.
        this.warningDialog.resultado.then((id) => { if (id === 'continuar') this.resetTimer(); });

        // Cuenta regresiva (no es una región viva: anunciar cada segundo no ayuda a nadie)
        let seconds = 120;
        this.countdownInterval = setInterval(() => {
            seconds--;
            cuenta.textContent = seconds;
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