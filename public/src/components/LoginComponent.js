/**
 * Componente de Login para autenticación
 *
 * Accesibilidad: es un <main> con su <h1> (antes el h1 contenía solo el logo), cada campo
 * tiene su error en línea enlazado con aria-describedby / aria-invalid, y el mensaje del
 * servidor es una región `role="alert"` que PERMANECE hasta el próximo intento (antes se
 * borraba solo a los 5 s: un lector de pantalla podía no alcanzar a leerlo). El éxito va en
 * otra región, `role="status"`, porque no es un error y no debe interrumpir.
 */
class LoginComponent {
    constructor() {
        this.element = null;
        this.isLoading = false;
        this.cooldownTimerId = null;
        this.cooldownRemaining = 0;
    }

    /**
     * Renderizar componente de login
     */
    render() {
        // Composición dividida: a la izquierda la marca (solo en pantallas anchas), a la derecha
        // el formulario. El logo es una máscara tokenizada, igual que en la barra lateral.
        const html = `
            <main class="login-container" id="contenido">
                <aside class="login-marca">
                    <span class="login-logo login-logo--marca" role="img" aria-label="ÁGORA"></span>
                    <p class="login-lema">Padrón, relevamiento, mesas y resultados de la elección, en un solo lugar.</p>
                    <p class="login-pie">Acceso solo para personal autorizado. Cada cuenta es personal.</p>
                </aside>

                <div class="login-card">
                    <div class="login-header">
                        <span class="login-logo login-logo--card" role="img" aria-label="ÁGORA"></span>
                        <h1 class="login-titulo">Iniciar sesión</h1>
                        <p class="login-sub">Ingresá con tu usuario y contraseña.</p>
                    </div>

                    <form id="loginForm" class="login-form" novalidate>
                        <div class="campo">
                            <label class="campo-etiqueta" for="username">Usuario</label>
                            <input
                                type="text"
                                id="username"
                                name="username"
                                autocomplete="username"
                                autocapitalize="none"
                                spellcheck="false"
                                aria-describedby="username-error"
                            >
                            <p class="campo-error" id="username-error"></p>
                        </div>

                        <div class="campo">
                            <label class="campo-etiqueta" for="password">Contraseña</label>
                            <input
                                type="password"
                                id="password"
                                name="password"
                                autocomplete="current-password"
                                aria-describedby="password-error"
                            >
                            <p class="campo-error" id="password-error"></p>
                        </div>

                        <button type="submit" class="btn btn-primary btn-lg login-btn" id="loginBtn">
                            <i class="fas fa-sign-in-alt" aria-hidden="true"></i>
                            Iniciar sesión
                        </button>

                        <div id="loginError" class="error-message" role="alert"></div>
                        <div id="loginExito" class="exito-message" role="status"></div>
                    </form>
                </div>

                <!-- Interruptor oscuro/claro: en el login todavía no hay barra lateral que lo lleve. -->
                <button type="button" class="login-tema" id="login-tema" aria-label="Cambiar tema">
                    <i class="fas" id="login-tema-icono" aria-hidden="true"></i>
                </button>
            </main>
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

        // Al corregir un campo, su error deja de aplicar.
        this.element.querySelectorAll('input').forEach((input) => {
            input.addEventListener('input', () => this.limpiarCampo(input));
        });

        this.initTema();

        // Auto-focus en el campo de usuario
        setTimeout(() => {
            const usernameInput = this.element.querySelector('#username');
            usernameInput?.focus();
        }, 100);
    }

    /**
     * Interruptor oscuro/claro. Alterna entre los dos temas según el que se ve ahora (si estaba en
     * "Sistema", el que resuelva el sistema). El icono muestra el tema actual, igual que la barra
     * lateral, y el nombre accesible dice qué pasa al activarlo.
     */
    initTema() {
        const boton = this.element.querySelector('#login-tema');
        if (!boton || !window.tema) {
            boton?.remove();
            return;
        }

        const pintar = () => {
            const oscuro = window.tema.efectivo() === 'dark';
            this.element.querySelector('#login-tema-icono').className = `fas ${oscuro ? 'fa-moon' : 'fa-sun'}`;
            const accion = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
            boton.setAttribute('aria-label', accion);
            boton.title = accion;
        };

        pintar();
        boton.addEventListener('click', () => {
            window.tema.establecer(window.tema.efectivo() === 'dark' ? 'light' : 'dark');
            pintar();
        });
    }

    /**
     * Validar los dos campos. Marca cada uno con su error en línea y deja el foco en el
     * primero que falla. Devuelve true si se puede enviar.
     */
    validar(username, password) {
        const faltantes = [];
        if (!username) faltantes.push(['username', 'Ingresá tu usuario.']);
        if (!password) faltantes.push(['password', 'Ingresá tu contraseña.']);

        ['username', 'password'].forEach((id) => this.limpiarCampo(this.element.querySelector('#' + id)));
        faltantes.forEach(([id, mensaje]) => {
            const input = this.element.querySelector('#' + id);
            input.setAttribute('aria-invalid', 'true');
            this.element.querySelector('#' + id + '-error').textContent = mensaje;
        });

        if (faltantes.length) this.element.querySelector('#' + faltantes[0][0]).focus();
        return faltantes.length === 0;
    }

    limpiarCampo(input) {
        if (!input) return;
        input.removeAttribute('aria-invalid');
        const error = this.element.querySelector('#' + input.id + '-error');
        if (error) error.textContent = '';
    }

    /**
     * Manejar intento de login
     */
    async handleLogin(e) {
        e.preventDefault();

        if (this.isLoading || this.cooldownTimerId) return;

        const form = e.target.closest('form');
        const formData = new FormData(form);
        const username = formData.get('username').trim();
        const password = formData.get('password');

        if (!this.validar(username, password)) return;

        this.setLoading(true);
        this.hideError();

        let cooldownSeconds = null;

        try {
            const result = await window.authService.login(username, password);

            // Mostrar mensaje de éxito
            this.showSuccess(`¡Bienvenido/a, ${result.user.nombre_completo}!`);

            // Esperar un momento y luego redirigir al dashboard
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1500);

        } catch (error) {
            this.showError(error.message || 'Error al iniciar sesión');
            // No dejar una clave ya rechazada lista para reenviarse (FE-051).
            const campoPassword = document.getElementById('password');
            if (campoPassword) { campoPassword.value = ''; campoPassword.focus(); }
            if (error.rateLimited) {
                cooldownSeconds = Number.isFinite(error.retryAfter) ? error.retryAfter : 10;
            }
        } finally {
            this.setLoading(false);
            if (cooldownSeconds) {
                this.startRateLimitCooldown(cooldownSeconds);
            }
        }
    }

    /**
     * Configurar estado de carga.
     *
     * Los campos NO se deshabilitan: un input deshabilitado pierde el foco y un lector de
     * pantalla deja de leer el formulario justo cuando hay algo que anunciar. `aria-busy`
     * le dice al botón que está en curso y `isLoading` evita el doble envío.
     */
    setLoading(loading) {
        this.isLoading = loading;
        const btn = this.element.querySelector('#loginBtn');

        if (loading) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Iniciando sesión…';
            btn.setAttribute('aria-busy', 'true');
        } else {
            btn.innerHTML = '<i class="fas fa-sign-in-alt" aria-hidden="true"></i> Iniciar sesión';
            btn.removeAttribute('aria-busy');
        }
    }

    startRateLimitCooldown(seconds) {
        const btn = this.element.querySelector('#loginBtn');
        if (!btn) return;

        if (this.cooldownTimerId) {
            clearInterval(this.cooldownTimerId);
            this.cooldownTimerId = null;
        }

        this.cooldownRemaining = Math.max(1, Math.ceil(seconds));
        btn.disabled = true;

        const updateButton = () => {
            if (this.cooldownRemaining <= 0) {
                clearInterval(this.cooldownTimerId);
                this.cooldownTimerId = null;
                btn.innerHTML = '<i class="fas fa-sign-in-alt" aria-hidden="true"></i> Iniciar sesión';
                btn.disabled = false;
                return;
            }

            // El mensaje del error ya dice cuánto esperar (se anuncia una vez); la cuenta
            // regresiva del botón es visual, no una región viva que hable cada segundo.
            btn.innerHTML = `<i class="fas fa-hourglass-half" aria-hidden="true"></i> Reintentar en ${this.cooldownRemaining} s`;
            this.cooldownRemaining -= 1;
        };

        updateButton();
        this.cooldownTimerId = setInterval(updateButton, 1000);
    }

    /**
     * Mostrar error. Permanece hasta el próximo intento: ocultarlo solo a los 5 s dejaba a
     * quien lo lee con un lector de pantalla (o con la vista cansada) sin saber qué falló.
     */
    showError(message) {
        this.element.querySelector('#loginExito').textContent = '';
        this.element.querySelector('#loginError').textContent = message;
    }

    /**
     * Ocultar error
     */
    hideError() {
        this.element.querySelector('#loginError').textContent = '';
    }

    /**
     * Mostrar mensaje de éxito (región propia, `role="status"`).
     */
    showSuccess(message) {
        this.hideError();
        this.element.querySelector('#loginExito').textContent = message;
    }
}

// Inicializar componente de login
window.loginComponent = new LoginComponent();
