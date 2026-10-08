document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (window.navbarComponent) {
            window.navbarComponent.init('navbar-container', 'mapa');
        }

        if (window.authService && window.authService.init) {
            const autenticado = await window.authService.init();
            if (!autenticado) {
                window.location.href = 'index.html';
                return;
            }
        }

        // Se pide el permiso, no el rol: abrir el mapa a otro rol (etapa 2) es darle territorio.view.
        // El servidor lo exige igual en cada ruta; esto solo evita mostrar una pantalla que daria 403.
        const respuesta = await window.apiService.request('/api/auth/me', { method: 'GET' });
        const permisos = (respuesta.success && respuesta.data.permisos) || [];
        if (!permisos.includes('territorio.view')) {
            window.location.href = 'dashboard.html';
            return;
        }

        await window.mapaComponent.init('mapa-container');
    } catch (error) {
        console.error('Error iniciando la pagina del mapa:', error);
        const contenedor = document.getElementById('mapa-container');
        if (contenedor) contenedor.textContent = 'Error al cargar la pagina: ' + error.message;
    }
});
