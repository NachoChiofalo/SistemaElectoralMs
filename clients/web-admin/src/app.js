/**
 * Aplicación principal del cliente web
 */
class App {
    constructor() {
        this.seccionActiva = 'padron';
        this.isAuthenticated = false;
        this.user = null;
    }

    async init() {
        console.log('🚀 Iniciando aplicación...');
        
        // Verificar autenticación
        const isAuthenticated = await window.authService.init();
        
        if (!isAuthenticated) {
            this.showLogin();
            return;
        }

        this.isAuthenticated = true;
        this.user = window.authService.getCurrentUser();
        
        // Inicializar aplicación principal
        await this.initMainApp();
        
        console.log('🎉 Aplicación iniciada');
    }

    /**
     * Mostrar pantalla de login
     */
    showLogin() {
        document.body.innerHTML = '';
        const loginElement = window.loginComponent.render();
        document.body.appendChild(loginElement);
    }

    /**
     * Inicializar aplicación principal (después de autenticación)
     */
    async initMainApp() {
        // Agregar información del usuario autenticado
        this.addUserInfo();
        
        // Inicializar eventos de navegación
        this.initNavigation();
        
        // Inicializar componente de padrón
        try {
            const inicializado = await window.padronComponent.init();
            if (inicializado) {
                console.log('✅ Padrón inicializado correctamente');
            } else {
                console.warn('⚠️ Problemas al inicializar padrón');
            }
        } catch (error) {
            console.error('❌ Error al inicializar padrón:', error);
            this.showError('Error al cargar los datos del padrón');
        }
    }

    /**
     * Agregar información del usuario en la interfaz
     */
    addUserInfo() {
        const usernameElement = document.getElementById('username');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (usernameElement && this.user) {
            usernameElement.textContent = this.user.nombre_completo || this.user.username;
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.handleLogout();
            });
        }
    }

    /**
     * Manejar cierre de sesión
     */
    async handleLogout() {
        const confirmed = confirm('¿Está seguro que desea cerrar sesión?');
        if (confirmed) {
            try {
                await window.authService.logout();
            } catch (error) {
                console.error('Error en logout:', error);
                // Continuar con logout local aunque falle el servidor
                window.location.reload();
            }
        }
    }

    /**
     * Mostrar mensaje de error
     */
    showError(message) {
        // Crear un toast o modal de error
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-toast';
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            ${message}
        `;
        
        document.body.appendChild(errorDiv);
        
        // Auto-remove después de 5 segundos
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    initNavigation() {
        const navButtons = document.querySelectorAll('.nav-btn');
        
        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                if (button.classList.contains('disabled')) {
                    e.preventDefault();
                    return;
                }
                
                const seccion = button.dataset.section;
                this.cambiarSeccion(seccion);
            });
        });
    }

    cambiarSeccion(nombreSeccion) {
        // Ocultar todas las secciones
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Desactivar todos los botones de navegación
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Mostrar sección seleccionada
        const seccion = document.getElementById(nombreSeccion);
        if (seccion) {
            seccion.classList.add('active');
            this.seccionActiva = nombreSeccion;
        }
        
        // Activar botón correspondiente
        const boton = document.querySelector(`[data-section="${nombreSeccion}"]`);
        if (boton) {
            boton.classList.add('active');
        }
        
        console.log(`📄 Cambio a sección: ${nombreSeccion}`);
    }
}

// Inicializar aplicación cuando se carga el DOM
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});

// Funciones globales para compatibilidad
window.cambiarSeccion = (seccion) => {
    if (window.app) {
        window.app.cambiarSeccion(seccion);
    }
};

console.log('🔧 App.js cargado');