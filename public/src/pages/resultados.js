// Botón "volver" y los que arma el propio HTML de error, delegados en vez de
// onclick= inline (la CSP sin unsafe-inline ya no los ejecutaría).
document.addEventListener('click', (event) => {
    const accion = event.target.closest('[data-action]')?.dataset.action;
    if (accion === 'volver-dashboard') {
        window.location.href = 'dashboard.html';
    } else if (accion === 'reintentar') {
        location.reload();
    }
});

// Inicializar componente cuando la página esté lista
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Iniciando aplicación de Resultados...');

    // Inicializar navbar
    if (window.navbarComponent && typeof window.navbarComponent.init === 'function') {
        window.navbarComponent.init('navbar-container', 'resultados');
    }

    try {
        // Verificar autenticación
        const isAuthenticated = await window.authService.init();

        if (!isAuthenticated) {
            window.location.href = 'dashboard.html';
            return;
        }

        // Cargar permisos del usuario
        let userPermissions = [];
        try {
            const userInfo = await window.apiService.request('/api/auth/me');
            userPermissions = (userInfo && userInfo.data && Array.isArray(userInfo.data.permisos))
                ? userInfo.data.permisos
                : [];
            console.log('✅ Permisos del usuario cargados:', userPermissions);
        } catch (error) {
            console.error('❌ Error al cargar permisos del usuario:', error);
        }

        // Verificar si tiene permisos para ver resultados
        if (!userPermissions.includes('resultados.view')) {
            console.log('❌ Usuario sin permisos para ver resultados');
            document.getElementById('resultados-container').innerHTML = `
                <div class="error-container" style="display: block; max-width: 600px; margin: 50px auto; padding: 30px; background: var(--ds-bg-card); border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center;">
                    <div class="error-message" style="color: var(--ds-danger-500);">
                        <i class="fas fa-lock" style="font-size: 48px; margin-bottom: 20px;"></i>
                        <h3 style="margin: 0 0 15px; font-size: 24px;">Acceso Denegado</h3>
                        <p style="margin: 0 0 25px; font-size: 16px; color: var(--ds-text-secondary);">No tiene permisos para acceder a los resultados del relevamiento.</p>
                        <button data-action="volver-dashboard" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: var(--ds-gradient-primary); color: var(--ds-text-inverse); border: none; border-radius: var(--ds-radius-md); font-weight: 600; cursor: pointer; text-decoration: none;">
                            <i class="fas fa-arrow-left"></i> Volver al Dashboard
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        console.log('✅ Usuario autenticado con permisos para resultados');

        // Inicializar componente de resultados
        const exito = await window.resultadosComponent.init('resultados-container');

        if (exito) {
            console.log('✅ Aplicación de Resultados iniciada correctamente');
        } else {
            console.error('❌ Error iniciando la aplicación');
        }

    } catch (error) {
        console.error('❌ Error fatal:', error);

        // Mostrar error en la página
        const container = document.getElementById('resultados-container');
        container.innerHTML = `
            <div class="error-container" style="display: block;">
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Error Fatal</h3>
                    <p>No se pudo cargar la aplicación: ${error.message}</p>
                    <p style="margin-top: 15px;">
                        <button data-action="reintentar" class="btn btn-primary">
                            <i class="fas fa-redo"></i> Reintentar
                        </button>
                    </p>
                </div>
            </div>
        `;
    }
});

// Manejar errores globales
window.addEventListener('error', (event) => {
    console.error('❌ Error global:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Promesa rechazada:', event.reason);
});
