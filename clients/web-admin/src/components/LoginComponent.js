/**
 * Componente de Login para autenticación
 */
class LoginComponent {
    constructor() {
        this.element = null;
        this.isLoading = false;
    }

    /**
     * Renderizar componente de login
     */
    render() {
        const html = `
            <div class="login-container">
                <div class="login-card">
                    <div class="login-header">
                        <h1>
                            <i class="fas fa-vote-yea"></i>
                            Sistema Electoral
                        </h1>
                        <h2>Relevamiento de Votantes</h2>
                        <p>Ingrese sus credenciales para acceder al sistema</p>
                    </div>

                    <form id="loginForm" class="login-form">
                        <div class="form-group">
                            <label for="username">
                                <i class="fas fa-user"></i>
                                Usuario
                            </label>
                            <input 
                                type="text" 
                                id="username" 
                                name="username" 
                                required
                                autocomplete="username"
                                placeholder="Ingrese su usuario"
                            >
                        </div>

                        <div class="form-group">
                            <label for="password">
                                <i class="fas fa-lock"></i>
                                Contraseña
                            </label>
                            <input 
                                type="password" 
                                id="password" 
                                name="password" 
                                required
                                autocomplete="current-password"
                                placeholder="Ingrese su contraseña"
                            >
                        </div>

                        <button type="submit" class="login-btn" id="loginBtn">
                            <i class="fas fa-sign-in-alt"></i>
                            Iniciar Sesión
                        </button>

                        <div id="loginError" class="error-message" style="display: none;"></div>
                    </form>

                    <div class="login-footer">
                        <div class="credentials-info">
                            <h4><i class="fas fa-info-circle"></i> Credenciales de Prueba</h4>
                            <div class="credential-item">
                                <strong>Administrador:</strong>
                                <span>admin / admin123</span>
                            </div>
                            <div class="credential-item">
                                <strong>Encargado 1:</strong>
                                <span>encargado1 / enc123</span>
                            </div>
                            <div class="credential-item">
                                <strong>Encargado 2:</strong>
                                <span>encargado2 / enc123</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.element = document.createElement('div');
        this.element.innerHTML = html;
        
        this.initEventListeners();
        
        return this.element;
    }

    /**
     * Inicializar event listeners
     */
    initEventListeners() {
        const form = this.element.querySelector('#loginForm');
        form.addEventListener('submit', (e) => this.handleLogin(e));

        // Auto-focus en el campo de usuario
        setTimeout(() => {
            const usernameInput = this.element.querySelector('#username');
            usernameInput?.focus();
        }, 100);

        // Enter en password field
        const passwordInput = this.element.querySelector('#password');
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleLogin(e);
            }
        });
    }

    /**
     * Manejar intento de login
     */
    async handleLogin(e) {
        e.preventDefault();

        if (this.isLoading) return;

        const form = e.target.closest('form');
        const formData = new FormData(form);
        const username = formData.get('username').trim();
        const password = formData.get('password');

        if (!username || !password) {
            this.showError('Por favor complete todos los campos');
            return;
        }

        this.setLoading(true);
        this.hideError();

        try {
            const result = await window.authService.login(username, password);
            
            // Login exitoso
            console.log('✅ Login exitoso:', result.user);
            
            // Mostrar mensaje de éxito
            this.showSuccess(`¡Bienvenido/a, ${result.user.nombre_completo}!`);
            
            // Esperar un momento y luego recargar para mostrar la app
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            console.error('❌ Error en login:', error);
            this.showError(error.message || 'Error al iniciar sesión');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Configurar estado de carga
     */
    setLoading(loading) {
        this.isLoading = loading;
        const btn = this.element.querySelector('#loginBtn');
        const inputs = this.element.querySelectorAll('input');

        if (loading) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando sesión...';
            btn.disabled = true;
            inputs.forEach(input => input.disabled = true);
        } else {
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Iniciar Sesión';
            btn.disabled = false;
            inputs.forEach(input => input.disabled = false);
        }
    }

    /**
     * Mostrar error
     */
    showError(message) {
        const errorDiv = this.element.querySelector('#loginError');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        
        // Auto-hide después de 5 segundos
        setTimeout(() => this.hideError(), 5000);
    }

    /**
     * Ocultar error
     */
    hideError() {
        const errorDiv = this.element.querySelector('#loginError');
        errorDiv.style.display = 'none';
    }

    /**
     * Mostrar mensaje de éxito
     */
    showSuccess(message) {
        const errorDiv = this.element.querySelector('#loginError');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        errorDiv.style.background = '#d4edda';
        errorDiv.style.color = '#155724';
        errorDiv.style.borderColor = '#c3e6cb';
    }
}

// Inicializar componente de login
window.loginComponent = new LoginComponent();