document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (window.navbarComponent) {
            window.navbarComponent.init('navbar-container', 'comicio');
        }

        const isAuthenticated = await window.authService.init();
        if (!isAuthenticated) {
            window.location.href = 'index.html';
            return;
        }

        const userInfo = await window.apiService.request('/api/auth/me');
        const permisos = (userInfo && userInfo.data && Array.isArray(userInfo.data.permisos))
            ? userInfo.data.permisos
            : [];

        if (!permisos.includes('comicio.view') && !permisos.includes('fiscales.view')) {
            document.getElementById('comicio-container').innerHTML = estados.error({
                titulo: 'Acceso denegado',
                icono: 'fa-lock',
                texto: 'No tenés permisos para acceder a la gestión de comicio.',
                enlace: { texto: 'Ir al inicio', href: 'dashboard.html' }
            });
            return;
        }

        await window.comicioComponent.init('comicio-container', {
            comicioView: permisos.includes('comicio.view'),
            comicioEdit: permisos.includes('comicio.edit'),
            fiscalesView: permisos.includes('fiscales.view'),
            fiscalesEdit: permisos.includes('fiscales.edit'),
        });
    } catch (error) {
        console.error('Error iniciando página de comicio:', error);
        const container = document.getElementById('comicio-container');
        if (container) {
            container.innerHTML = estados.error({
                titulo: 'No se pudo cargar la página',
                texto: 'Revisá tu conexión y volvé a intentar.',
                reintentar: 'reintentar'
            });
        }
    }
});

// "Reintentar" del estado de error de la página entera.
document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="reintentar"]')) window.location.reload();
});
