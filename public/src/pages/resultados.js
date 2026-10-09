// "Reintentar" de los estados de error, delegado en vez de onclick= inline. "Volver" es un
// enlace (<a href>), no un botón que cambia location.
document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="reintentar"]')) location.reload();
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
            document.getElementById('resultados-container').innerHTML = estados.error({
                titulo: 'Acceso denegado',
                icono: 'fa-lock',
                texto: 'No tiene permisos para acceder a los resultados del relevamiento.',
                enlace: { texto: 'Volver al inicio', href: 'dashboard.html' }
            });
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
        container.innerHTML = estados.error({
            titulo: 'No se pudo cargar la aplicación',
            texto: error.message,
            reintentar: 'reintentar'
        });
    }
});

// Manejar errores globales
window.addEventListener('error', (event) => {
    console.error('❌ Error global:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('❌ Promesa rechazada:', event.reason);
});
