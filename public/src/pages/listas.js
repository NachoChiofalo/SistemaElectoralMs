document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (window.navbarComponent) {
            window.navbarComponent.init('navbar-container', 'listas');
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

        if (!permisos.includes('listas.view')) {
            document.getElementById('listas-container').innerHTML = `
                <div class="listas-empty" style="padding: 60px 20px;">
                    <i class="fas fa-lock"></i>
                    <p>No tenés permisos para acceder a las listas electorales.</p>
                </div>
            `;
            return;
        }

        await window.listasComponent.init('listas-container');
    } catch (error) {
        console.error('Error iniciando página de listas:', error);
        const container = document.getElementById('listas-container');
        if (container) {
            container.innerHTML = `<p>Error al cargar la página: ${escaparHtml(error.message)}</p>`;
        }
    }
});
