/**
 * Aplicación principal del cliente web (pantalla del padrón).
 *
 * Esta clase arrastraba la navegación del diseño anterior (botones `.nav-btn`, secciones
 * `.section`, `cambiarSeccion`, un `confirm()` de logout): nada de eso existe desde que la
 * barra es NavbarComponent, que además es la dueña del logout. Quedó lo que de verdad hace:
 * autenticar, cargar permisos, mostrar el login o inicializar el padrón.
 */
class App {
    constructor() {
        this.isAuthenticated = false;
        this.user = null;
        this.userPermissions = [];
    }

    async init() {
        // Verificar autenticación
        const isAuthenticated = await window.authService.init();

        if (!isAuthenticated) {
            this.showLogin();
            return;
        }

        this.isAuthenticated = true;
        this.user = window.authService.getCurrentUser();

        // Cargar permisos del usuario; sin ellos no se sabe qué mostrar.
        if (!(await this.loadUserPermissions())) return;

        // Inicializar aplicación principal
        await this.initMainApp();
    }

    /**
     * Cargar permisos del usuario desde el backend.
     *
     * Si falla NO se inventan permisos: antes se asumían los cuatro de padrón (incluido
     * `padron.edit`), de modo que una llamada caída le mostraba los botones de edición a
     * cualquiera. El servidor igual rechaza lo que no corresponde, pero una pantalla que
     * se equivoca de perfil en silencio es difícil de depurar. Un fallo es un estado de
     * error con "Reintentar".
     *
     * @returns {Promise<boolean>} true si se pudieron cargar.
     */
    async loadUserPermissions() {
        try {
            const userInfo = await window.apiService.request('/api/auth/me');

            if (!(userInfo.success && userInfo.data)) {
                throw new Error('Respuesta de API inválida');
            }
            this.userPermissions = userInfo.data.permisos || [];
            this.user = userInfo.data; // Actualizar con información completa
            return true;
        } catch (error) {
            console.error('Error al cargar permisos del usuario:', error);
            this.mostrarEstado(estados.error({
                titulo: 'No se pudo verificar tu acceso',
                texto: 'Revisá tu conexión y volvé a intentar.',
                reintentar: 'reintentar'
            }));
            return false;
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
     * Reemplaza el contenido de la pantalla por un estado (error, sin acceso).
     */
    mostrarEstado(html) {
        const contenedor = document.getElementById('padron-container');
        if (contenedor) contenedor.innerHTML = html;
    }

    /**
     * Inicializar aplicación principal (después de autenticación)
     */
    async initMainApp() {
        // Los botones que requieren un permiso que no se tiene se ocultan en cuanto el
        // componente dibuja su interfaz (no 500 ms después: se veían un instante y desaparecían).
        window.padronComponent.alCrearInterfaz = () => this.configurePadronPermissions();

        // Inicializar componente de padrón solo si tiene permisos
        if (this.hasPermission('padron.view') || this.hasPermission('padron.edit')) {
            try {
                const inicializado = await window.padronComponent.init();
                if (!inicializado) {
                    console.warn('Problemas al inicializar el padrón: revisar el componente');
                }
            } catch (error) {
                console.error('Error al inicializar el padrón:', error);
                this.mostrarEstado(estados.error({
                    titulo: 'No se pudo cargar el padrón',
                    texto: 'Revisá tu conexión y volvé a intentar.',
                    reintentar: 'reintentar'
                }));
            }
        } else {
            // Sin permiso de padrón la pantalla no tiene nada que mostrar: se dice y se ofrece
            // el camino (antes caía a una sección "resultados" que ya no existe).
            this.mostrarEstado(estados.error({
                titulo: 'Sin acceso al padrón',
                icono: 'fa-lock',
                texto: 'Tu cuenta no tiene permiso para ver el padrón.',
                enlace: { texto: 'Ir al inicio', href: 'dashboard.html' }
            }));
        }
    }

    /**
     * Oculta los controles del padrón que requieren un permiso que no se tiene.
     * Usa el atributo `hidden` (design-system.css lo respeta con !important), no estilos.
     */
    configurePadronPermissions() {
        const exige = (permiso, ocultar) => {
            document.querySelectorAll(`[data-requires-permission="${permiso}"]`).forEach(el => {
                if (ocultar) el.hidden = true;
            });
        };

        exige('padron.edit', !this.hasPermission('padron.edit'));
        exige('padron.view', !this.hasPermission('padron.view') && !this.hasPermission('padron.edit'));
        exige('padron.export', !this.hasPermission('padron.export'));
    }
}

// "Reintentar" de los estados de error de esta pantalla.
document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="reintentar"]')) window.location.reload();
});

// Inicializar aplicación cuando se carga el DOM
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});
