/**
 * Aplicación principal del cliente web
 */
class App {
    constructor() {
        this.seccionActiva = 'padron';
        this.isAuthenticated = false;
        this.user = null;
        this.userPermissions = [];
    }

    async init() {
        console.log('🚀 Iniciando aplicación...');
        console.log('📋 Servicios disponibles:', {
            authService: !!window.authService,
            apiService: !!window.apiService,
            padronComponent: !!window.padronComponent,
            loginComponent: !!window.loginComponent
        });
        
        // Verificar autenticación
        const isAuthenticated = await window.authService.init();
        console.log('🔐 Estado de autenticación:', isAuthenticated);
        
        if (!isAuthenticated) {
            console.log('❌ No autenticado - mostrando login');
            this.showLogin();
            return;
        }

        this.isAuthenticated = true;
        this.user = window.authService.getCurrentUser();
        console.log('👤 Usuario autenticado:', this.user?.username);
        
        // Cargar permisos del usuario
        await this.loadUserPermissions();
        console.log('🔑 Permisos cargados:', this.userPermissions);
        
        // Inicializar aplicación principal
        await this.initMainApp();
        
        console.log('🎉 Aplicación iniciada correctamente');
    }

    /**
     * Cargar permisos del usuario desde el backend
     */
    async loadUserPermissions() {
        try {
            console.log('🔑 Cargando permisos del usuario...');
            const userInfo = await window.apiService.request('/api/auth/me');
            
            if (userInfo.success && userInfo.data) {
                this.userPermissions = userInfo.data.permisos || [];
                this.user = userInfo.data; // Actualizar con información completa
                console.log('✅ Permisos del usuario cargados:', {
                    usuario: userInfo.data.username,
                    rol: userInfo.data.rol,
                    permisos: this.userPermissions.length,
                    lista: this.userPermissions
                });
            } else {
                console.warn('⚠️ Respuesta de API sin datos válidos:', userInfo);
                throw new Error('Respuesta de API inválida');
            }
        } catch (error) {
            console.error('❌ Error al cargar permisos del usuario:', error);
            // Asignar permisos por defecto si falla
            this.userPermissions = ['padron.view', 'padron.edit', 'padron.relevamiento', 'padron.export'];
            console.warn('🔧 Usando permisos por defecto:', this.userPermissions);
        }
    }

    /**
     * Verificar si el usuario tiene un permiso específico
     */
    hasPermission(permission) {
        return this.userPermissions.includes(permission);
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
        console.log('🚀 Iniciando aplicación principal...');
        
        // Configurar interfaz basada en permisos
        this.configureUIBasedOnPermissions();
        
        // Agregar información del usuario autenticado
        this.addUserInfo();
        
        // Inicializar eventos de navegación
        this.initNavigation();
        
        // Verificar permisos para padrón
        const tienePermisoPadronView = this.hasPermission('padron.view');
        const tienePermisoPadronEdit = this.hasPermission('padron.edit');
        
        console.log('🔐 Verificando permisos:', {
            'padron.view': tienePermisoPadronView,
            'padron.edit': tienePermisoPadronEdit,
            totalPermisos: this.userPermissions.length
        });
        
        // Inicializar componente de padrón solo si tiene permisos
        if (tienePermisoPadronView || tienePermisoPadronEdit) {
            console.log('✅ Usuario tiene permisos de padrón - inicializando componente...');
            try {
                const inicializado = await window.padronComponent.init();
                if (inicializado) {
                    console.log('✅ Padrón inicializado correctamente');
                } else {
                    console.warn('⚠️ Problemas al inicializar padrón - revisar logs del componente');
                    this.showError('Error al inicializar el módulo de padrón');
                }
            } catch (error) {
                console.error('❌ Error al inicializar padrón:', error);
                this.showError('Error al cargar los datos del padrón: ' + error.message);
            }
        } else {
            console.warn('❌ Usuario sin permisos de padrón - saltando inicialización');
            // Si no tiene permisos de padrón, intentar cambiar a resultados
            if (this.hasPermission('resultados.view')) {
                console.log('🔄 Cambiando a sección de resultados...');
                this.cambiarSeccion('resultados');
            } else {
                console.warn('❌ Usuario sin permisos para ningún módulo');
                this.showError('Usuario sin permisos para acceder a los módulos del sistema');
            }
        }
        
        console.log('🎯 Aplicación principal inicializada');
    }

    /**
     * Configurar interfaz basada en permisos del usuario
     */
    configureUIBasedOnPermissions() {
        // Ocultar/mostrar botón de resultados
        const resultsButton = document.getElementById('ver-resultados-btn');
        if (resultsButton) {
            if (this.hasPermission('resultados.view')) {
                resultsButton.style.display = 'flex';
                resultsButton.onclick = () => window.open('/resultados.html', '_blank');
            } else {
                resultsButton.style.display = 'none';
            }
        }

        // Configurar navegación basada en permisos
        this.configureNavigationPermissions();
        
        // Configurar elementos específicos del padrón
        this.configurePadronPermissions();
    }

    /**
     * Configurar navegación basada en permisos
     */
    configureNavigationPermissions() {
        const navButtons = document.querySelectorAll('.nav-btn');
        
        navButtons.forEach(button => {
            const section = button.dataset.section;
            let hasAccess = false;
            
            switch (section) {
                case 'padron':
                    hasAccess = this.hasPermission('padron.view') || this.hasPermission('padron.edit');
                    break;
                case 'resultados':
                    hasAccess = this.hasPermission('resultados.view');
                    break;
                case 'reportes':
                    hasAccess = this.hasPermission('reportes.generate') || this.hasPermission('reportes.view');
                    break;
                default:
                    hasAccess = true; // Secciones públicas por defecto
            }
            
            if (!hasAccess) {
                button.style.display = 'none';
            }
        });
    }

    /**
     * Configurar permisos específicos del padrón
     */
    configurePadronPermissions() {
        // Esta función será llamada después de que se inicialice el componente de padrón
        setTimeout(() => {
            const editButtons = document.querySelectorAll('[data-requires-permission="padron.edit"]');
            editButtons.forEach(button => {
                if (!this.hasPermission('padron.edit')) {
                    button.style.display = 'none';
                }
            });

            const viewElements = document.querySelectorAll('[data-requires-permission="padron.view"]');
            viewElements.forEach(element => {
                if (!this.hasPermission('padron.view') && !this.hasPermission('padron.edit')) {
                    element.style.display = 'none';
                }
            });

            const exportElements = document.querySelectorAll('[data-requires-permission="padron.export"]');
            exportElements.forEach(element => {
                if (!this.hasPermission('padron.export')) {
                    element.style.display = 'none';
                }
            });
        }, 500);
    }

    /**
     * Agregar información del usuario en la interfaz
     */
    addUserInfo() {
        const usernameElement = document.getElementById('username');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (usernameElement && this.user) {
            // Mostrar nombre completo y rol
            const displayName = this.user.nombre_completo || this.user.username;
            const role = this.user.rol || 'Usuario';
            usernameElement.innerHTML = `
                <div style="text-align: right;">
                    <div style="font-weight: 500;">${displayName}</div>
                    <div style="font-size: 0.8em; color: #666; text-transform: capitalize;">${role}</div>
                </div>
            `;
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
        // Verificar permisos antes de cambiar sección
        if (!this.canAccessSection(nombreSeccion)) {
            this.showError('No tiene permisos para acceder a esta sección');
            return;
        }
        
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

    /**
     * Verificar si el usuario puede acceder a una sección específica
     */
    canAccessSection(section) {
        switch (section) {
            case 'padron':
                return this.hasPermission('padron.view') || this.hasPermission('padron.edit');
            case 'resultados':
                return this.hasPermission('resultados.view');
            case 'reportes':
                return this.hasPermission('reportes.generate') || this.hasPermission('reportes.view');
            default:
                return true; // Secciones públicas por defecto
        }
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