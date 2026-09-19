// NavbarComponent.js
// Barra de navegación unificada para todas las páginas

(function(global) {
    /**
     * Destinos de la barra.
     *
     * Orden convencional —el inicio primero— y no por frecuencia de uso: en una barra
     * de navegación la previsibilidad vale más que el ahorro de un clic, porque se lee
     * decenas de veces por jornada.
     *
     * Resultados entra acá por primera vez. Antes se llegaba por un botón dentro del
     * padrón, lo que lo dejaba escondido detrás de otra pantalla siendo una sección
     * hermana, no una subsección.
     *
     * Las etiquetas se acortaron ("Padrón Electoral" → "Padrón"): en una barra la
     * palabra que distingue es la primera, y la segunda sólo gasta ancho. Ese ancho es
     * el que va a necesitar la barra cuando entren los módulos nuevos.
     */
    const NAV_ITEMS = [
        { href: 'dashboard.html', icon: 'fa-tachometer-alt', label: 'Inicio', key: 'dashboard' },
        { href: 'index.html', icon: 'fa-list', label: 'Padrón', key: 'padron' },
        { href: 'resultados.html', icon: 'fa-chart-bar', label: 'Resultados', key: 'resultados' },
        { href: 'usuarios.html', icon: 'fa-users-gear', label: 'Usuarios', key: 'usuarios', adminOnly: true },
        { href: 'auditoria.html', icon: 'fa-clipboard-list', label: 'Auditoría', key: 'auditoria', adminOnly: true }
    ];

    function renderNavbar(activeKey) {
        const user = (window.authService && window.authService.getCurrentUser && window.authService.getCurrentUser()) || { username: 'Usuario' };
        const username = user.nombre_completo || user.username || 'Usuario';
        const userRole = user.rol || '';
        const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || userRole === 'administrador');
        return `
        <nav class="navbar-unified">
            <div class="navbar-content">
                <div class="navbar-brand">
                    <i class="fas fa-vote-yea"></i>
                    <span class="brand-text">Sistema Electoral</span>
                </div>

                <div class="navbar-mobile-actions">
                    <button class="logout-btn logout-btn-mobile" id="logout-btn-mobile" title="Cerrar Sesión">
                        <i class="fas fa-sign-out-alt"></i>
                    </button>
                    <button class="navbar-toggle" id="navbar-toggle" aria-label="Abrir menú de navegación" aria-expanded="false">
                        <span class="hamburger-line"></span>
                        <span class="hamburger-line"></span>
                        <span class="hamburger-line"></span>
                    </button>
                </div>

                <div class="navbar-collapse" id="navbar-collapse">
                    <div class="navbar-nav">
                        ${visibleItems.map(item => `
                            <a href="${item.href}" class="nav-item${activeKey === item.key ? ' active' : ''}">
                                <i class="fas ${item.icon}"></i>
                                <span class="nav-text">${item.label}</span>
                            </a>
                        `).join('')}
                    </div>

                    <div class="navbar-user">
                        <!-- El nombre es contexto, no una acción: va como texto y no como
                             botón, y el rol debajo responde "por qué veo lo que veo". -->
                        <div class="user-info">
                            <span class="username" id="username">${escaparHtml(username)}</span>
                            <span class="user-role">${escaparHtml(userRole)}</span>
                        </div>
                        <!-- Tema y salir son iconos: dicen lo mismo con un tercio del ancho,
                             y ese ancho es el que la barra va a necesitar al crecer. El texto
                             sobrevive en el title y en aria-label. -->
                        <button class="tema-btn" id="tema-btn" type="button" aria-label="Cambiar tema">
                            <i class="fas" id="tema-icono"></i>
                        </button>
                        <button class="logout-btn logout-btn-desktop" id="logout-btn" type="button" title="Cerrar sesión" aria-label="Cerrar sesión">
                            <i class="fas fa-sign-out-alt"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        <div class="navbar-overlay" id="navbar-overlay"></div>
        `;
    }

    /**
     * Estado visible del botón de tema.
     *
     * El icono muestra lo que está viéndose; el texto, de dónde viene esa decisión. La
     * distinción importa en "Automático": ahí el usuario no eligió nada y el tema puede
     * cambiar solo cuando el sistema pasa a modo noche.
     */
    const TEMAS = {
        sistema: { icono: 'fa-desktop', texto: 'Automático' },
        light: { icono: 'fa-sun', texto: 'Claro' },
        dark: { icono: 'fa-moon', texto: 'Oscuro' },
    };

    function pintarBotonTema() {
        if (!global.tema) return;

        const elegido = global.tema.elegido();
        const estado = TEMAS[elegido] || TEMAS.sistema;
        const icono = document.getElementById('tema-icono');
        const boton = document.getElementById('tema-btn');

        // En "Automático" el icono muestra el tema que se está viendo, no un monitor:
        // lo que importa saber de un vistazo es si estás en claro o en oscuro.
        if (icono) icono.className = `fas ${elegido === 'sistema' ? TEMAS[global.tema.efectivo()].icono : estado.icono}`;
        if (boton) boton.title = `Tema: ${estado.texto}. Clic para cambiar.`;
    }

    function initTema() {
        const boton = document.getElementById('tema-btn');
        if (!boton || !global.tema) return;

        pintarBotonTema();
        boton.addEventListener('click', () => {
            global.tema.cambiar();
            pintarBotonTema();
        });

        // En "Automático" el tema efectivo cambia sin que nadie toque el botón: hay que
        // repintar el icono cuando el sistema pasa de claro a oscuro.
        if (global.matchMedia) {
            global.matchMedia('(prefers-color-scheme: dark)')
                .addEventListener('change', pintarBotonTema);
        }
    }

    function handleLogout() {
        const confirmed = confirm('¿Está seguro que desea cerrar sesión?');
        if (confirmed) {
            if (window.authService && window.authService.logout) {
                window.authService.logout().finally(() => {
                    window.location.href = '/';
                });
            } else {
                window.location.href = '/';
            }
        }
    }

    function initNavbar(containerId, activeKey) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = renderNavbar(activeKey);
        // Set username if available
        const user = (window.authService && window.authService.getCurrentUser && window.authService.getCurrentUser()) || { username: 'Usuario' };
        const username = user.nombre_completo || user.username || 'Usuario';
        const usernameElement = document.getElementById('username');
        if (usernameElement) usernameElement.textContent = username;
        // Logout buttons (desktop inside menu + mobile in navbar)
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }
        const logoutBtnMobile = document.getElementById('logout-btn-mobile');
        if (logoutBtnMobile) {
            logoutBtnMobile.addEventListener('click', handleLogout);
        }
        initTema();
        // Mobile hamburger toggle
        const toggleBtn = document.getElementById('navbar-toggle');
        const collapseEl = document.getElementById('navbar-collapse');
        const overlayEl = document.getElementById('navbar-overlay');
        if (toggleBtn && collapseEl) {
            toggleBtn.addEventListener('click', function() {
                const isOpen = collapseEl.classList.toggle('open');
                toggleBtn.classList.toggle('open', isOpen);
                toggleBtn.setAttribute('aria-expanded', isOpen);
                if (overlayEl) overlayEl.classList.toggle('open', isOpen);
                document.body.style.overflow = isOpen ? 'hidden' : '';
            });
            if (overlayEl) {
                overlayEl.addEventListener('click', function() {
                    collapseEl.classList.remove('open');
                    toggleBtn.classList.remove('open');
                    toggleBtn.setAttribute('aria-expanded', 'false');
                    overlayEl.classList.remove('open');
                    document.body.style.overflow = '';
                });
            }
        }
    }

    global.navbarComponent = {
        init: initNavbar
    };
})(window);
