// NavbarComponent.js
// Barra de navegación unificada para todas las páginas

(function(global) {
    const NAV_ITEMS = [
        { href: 'index.html', icon: 'fa-users-cog', label: 'Padrón Electoral', key: 'padron' },
        { href: 'fiscales.html', icon: 'fa-user-shield', label: 'Fiscales', key: 'fiscales' },
        { href: 'comicio.html', icon: 'fa-building', label: 'Comicio', key: 'comicio' }
    ];

    function renderNavbar(activeKey) {
        const user = (window.authService && window.authService.getCurrentUser && window.authService.getCurrentUser()) || { username: 'Usuario' };
        const username = user.nombre_completo || user.username || 'Usuario';
        return `
        <nav class="navbar-unified">
            <div class="navbar-content">
                <div class="navbar-brand">
                    <i class="fas fa-vote-yea"></i>
                    <span class="brand-text">Sistema Electoral</span>
                </div>
                
                <div class="navbar-nav">
                    ${NAV_ITEMS.map(item => `
                        <a href="${item.href}" class="nav-item${activeKey === item.key ? ' active' : ''}">
                            <i class="fas ${item.icon}"></i>
                            <span class="nav-text">${item.label}</span>
                        </a>
                    `).join('')}
                </div>
                
                <div class="navbar-user">
                    <div class="user-info">
                        <i class="fas fa-user-circle"></i>
                        <span class="username" id="username">${username}</span>
                    </div>
                    <button class="logout-btn" id="logout-btn" title="Cerrar Sesión">
                        <i class="fas fa-sign-out-alt"></i>
                        <span class="logout-text">Salir</span>
                    </button>
                </div>
            </div>
        </nav>
        `;
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
        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }
    }

    global.navbarComponent = {
        init: initNavbar
    };
})(window);
