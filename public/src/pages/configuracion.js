document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (window.navbarComponent) {
            window.navbarComponent.init('navbar-container', 'configuracion');
        }

        if (window.authService && window.authService.init) {
            const autenticado = await window.authService.init();
            if (!autenticado) {
                window.location.href = 'index.html';
                return;
            }
        }

        // Solo el administrador de la instancia configura. El servidor lo exige igual
        // (requireAdmin en las rutas de escritura); esto evita mostrar una pantalla que daría 403.
        const respuesta = await window.apiService.request('/api/auth/me', { method: 'GET' });
        if (!respuesta.success || respuesta.data.rol !== 'administrador') {
            window.location.href = 'dashboard.html';
            return;
        }

        await window.opcionesPoliticasComponent.init('opciones-container');
    } catch (error) {
        console.error('Error iniciando la pagina de configuracion:', error);
        const contenedor = document.getElementById('opciones-container');
        if (contenedor) contenedor.textContent = 'Error al cargar la pagina: ' + error.message;
    }
});
