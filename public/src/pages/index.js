// Inicializar barra de navegación unificada
document.addEventListener('DOMContentLoaded', function() {
    if (window.navbarComponent && typeof window.navbarComponent.init === 'function') {
        window.navbarComponent.init('navbar-container', 'padron');
    }
});
