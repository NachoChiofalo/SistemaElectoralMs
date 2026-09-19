document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (window.navbarComponent) {
            window.navbarComponent.init('navbar-container', 'fiscales');
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

        if (!permisos.includes('fiscales.view')) {
            document.getElementById('fiscales-container').innerHTML = `
                <div class="fiscales-empty" style="padding: 60px 20px;">
                    <i class="fas fa-lock"></i>
                    <p>No tenés permisos para acceder a la gestión de fiscales.</p>
                </div>
            `;
            return;
        }

        await window.fiscalesComponent.init('fiscales-container');
    } catch (error) {
        console.error('Error iniciando página de fiscales:', error);
        const container = document.getElementById('fiscales-container');
        if (container) {
            container.innerHTML = `<p>Error al cargar la página: ${escaparHtml(error.message)}</p>`;
        }
    }
});
