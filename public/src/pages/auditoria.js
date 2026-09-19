document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Inicializar navbar
        if (window.navbarComponent) {
            window.navbarComponent.init('navbar-container', 'auditoria');
        }

        // Verificar autenticacion
        if (window.authService && window.authService.init) {
            const isAuthenticated = await window.authService.init();
            if (!isAuthenticated) {
                window.location.href = 'index.html';
                return;
            }
        }

        // Verificar que es administrador
        const response = await window.apiService.request('/api/auth/me', { method: 'GET' });
        if (!response.success || response.data.rol !== 'administrador') {
            alert('Acceso denegado: se requieren permisos de administrador');
            window.location.href = 'dashboard.html';
            return;
        }

        // Inicializar componente de auditoria
        await window.auditoriaComponent.init('auditoria-container');

    } catch (error) {
        console.error('Error iniciando pagina de auditoria:', error);
        alert('Error al cargar la pagina: ' + error.message);
    }
});
