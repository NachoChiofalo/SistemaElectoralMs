// Configuración de módulos por rol
const MODULES_CONFIG = {
    administrador: [
        {
            id: 'padron',
            title: 'Padrón Electoral',
            description: 'Gestión completa del padrón electoral municipal con herramientas de relevamiento.',
            icon: 'fa-users-cog',
            href: 'index.html',
            status: 'available',
            features: [
                'Consulta de votantes',
                'Relevamiento de preferencias',
                'Gestión de condiciones especiales',
                'Exportación de datos'
            ]
        },
        {
            id: 'resultados',
            title: 'Resultados y Estadísticas',
            description: 'Análisis detallado de resultados del relevamiento con gráficos interactivos.',
            icon: 'fa-chart-pie',
            href: 'resultados.html',
            status: 'available',
            features: [
                'Gráficos interactivos',
                'Estadísticas por barrio',
                'Análisis de tendencias',
                'Reportes automáticos'
            ]
        },
        {
            id: 'listas',
            title: 'Armado de Listas',
            description: 'Borradores de listas electorales: candidatos, orden y tipo de elección.',
            icon: 'fa-list-ol',
            href: 'listas.html',
            status: 'available',
            features: [
                'Alta de listas y candidatos',
                'Orden de candidatos por posición',
                'Edición y baja de borradores'
            ]
        },
        {
            id: 'fiscales',
            title: 'Gestión de Fiscales',
            description: 'Administración de fiscales de mesa y coordinadores de comicio.',
            icon: 'fa-user-shield',
            href: 'fiscales.html',
            status: 'coming-soon',
            features: [
                'Registro de fiscales',
                'Asignación de mesas',
                'Capacitación online',
                'Control de asistencia'
            ]
        },
        {
            id: 'comicio',
            title: 'Gestión de Comicio',
            description: 'Configuración y administración de lugares de votación y mesas electorales.',
            icon: 'fa-building',
            href: 'comicio.html',
            status: 'coming-soon',
            features: [
                'Configuración de escuelas',
                'Distribución de mesas',
                'Logística electoral',
                'Materiales de votación'
            ]
        }
    ],
    encargado_relevamiento: [
        {
            id: 'padron',
            title: 'Relevamiento de Padrón',
            description: 'Acceso a las herramientas de relevamiento del padrón electoral.',
            icon: 'fa-clipboard-check',
            href: 'index.html',
            status: 'available',
            features: [
                'Carga de relevamientos',
                'Actualización de datos',
                'Consulta de votantes',
                'Reportes de progreso'
            ]
        }
    ],
    consultor: [
        {
            id: 'resultados',
            title: 'Estadísticas y Reportes',
            description: 'Consulta de estadísticas y análisis de datos electorales.',
            icon: 'fa-chart-bar',
            href: 'resultados.html',
            status: 'available',
            features: [
                'Dashboards interactivos',
                'Reportes estadísticos',
                'Análisis de tendencias',
                'Exportación de gráficos'
            ]
        }
    ]
};

// Estado de la aplicación
let currentUser = null;
let currentUserRole = null;
let userPermissions = [];

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Iniciando Dashboard...');
    console.log('📋 Servicios disponibles:', {
        authService: !!window.authService,
        apiService: !!window.apiService,
        navbarComponent: !!window.navbarComponent
    });

    try {
        // Inicializar navbar
        if (window.navbarComponent && typeof window.navbarComponent.init === 'function') {
            window.navbarComponent.init('navbar-container', 'dashboard');
            console.log('✅ Navbar inicializado');
        }

        // Verificar autenticación y obtener datos del usuario
        const isAuthenticated = await initAuth();
        console.log('🔐 Estado de autenticación:', isAuthenticated);

        if (!isAuthenticated) {
            console.warn('⚠️ No autenticado - redirigiendo a index.html');
            window.location.href = 'index.html';
            return;
        }

        // Obtener información completa del usuario
        await loadUserInfo();
        console.log('👤 Usuario actual:', {
            user: currentUser?.username,
            role: currentUserRole,
            permissions: userPermissions.length
        });

        // Cargar dashboard
        await loadDashboard();
        console.log('📊 Dashboard cargado con', userPermissions.length, 'permisos');

        console.log('✅ Dashboard iniciado correctamente');

    } catch (error) {
        console.error('❌ Error iniciando dashboard:', error);
        showError('Error al cargar el panel de control: ' + error.message);
    }
});

// Inicializar autenticación
async function initAuth() {
    try {
        if (window.authService && window.authService.init) {
            const isAuthenticated = await window.authService.init();
            if (isAuthenticated) {
                currentUser = window.authService.getCurrentUser();
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('Error en autenticación:', error);
        return false;
    }
}

// Obtener información completa del usuario desde el backend
async function loadUserInfo() {
    try {
        const response = await window.apiService.request('/api/auth/me', {
            method: 'GET'
        });

        if (response.success && response.data) {
            currentUser = response.data;
            currentUserRole = response.data.rol;
            userPermissions = response.data.permisos || [];

            console.log('✅ Usuario cargado:', {
                nombre: currentUser.nombre_completo,
                rol: currentUserRole,
                permisos: userPermissions
            });

            updateUserInfo();
        } else {
            throw new Error('No se pudo obtener información del usuario');
        }
    } catch (error) {
        console.error('❌ Error cargando información del usuario:', error);
        // Si falla, usar datos básicos del authService
        if (currentUser) {
            currentUserRole = 'administrador'; // Fallback por defecto
            // Asignar permisos por defecto para administrador
            userPermissions = ['padron.view', 'padron.edit', 'padron.relevamiento', 'padron.export',
                             'resultados.view', 'resultados.export', 'fiscales.view', 'fiscales.edit',
                             'comicio.view', 'comicio.edit', 'reportes.view'];
            updateUserInfo();
        }
    }
}

// El nombre y el rol del usuario ya los muestra la barra de navegación en todas
// las pantallas, así que el encabezado de esta dejó de repetirlos. Lo que sí
// aporta es la fecha: ubica el estado que se está mirando en el tiempo.
function updateUserInfo() {
    const fecha = document.getElementById('inicio-fecha');
    if (!fecha) return;
    fecha.textContent = new Date().toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
}

// Obtener nombre de rol para mostrar
function getRoleDisplayName(role) {
    const roleNames = {
        'administrador': 'Administrador',
        'encargado_relevamiento': 'Encargado de Relevamiento',
        'consultor': 'Consultor'
    };
    return roleNames[role] || 'Usuario';
}

// Cargar dashboard según rol y permisos
async function loadDashboard() {
    // Usar configuración basada en permisos
    const modules = getModulesForUser();
    renderModules(modules);

    // Cargar estadísticas si tiene permisos para ver padrón
    const hasAccessToPadron = hasPermission('padron.view');
    if (hasAccessToPadron) {
        await loadQuickStats();
    }
}

// Obtener módulos basados en los permisos del usuario
function getModulesForUser() {
    const availableModules = [];

    // Módulo Dashboard (siempre disponible)

    // Módulo Padrón
    if (hasPermission('padron.view')) {
        availableModules.push({
            id: 'padron',
            title: 'Padrón Electoral',
            description: 'Gestión del padrón electoral municipal con herramientas de relevamiento.',
            icon: 'fa-users-cog',
            href: 'index.html',
            status: 'available',
            features: getFeaturesByPermissions('padron')
        });
    }

    // Módulo Resultados/Estadísticas
    if (hasPermission('resultados.view')) {
        availableModules.push({
            id: 'resultados',
            title: 'Resultados y Estadísticas',
            description: 'Análisis detallado de resultados del relevamiento con gráficos interactivos.',
            icon: 'fa-chart-pie',
            href: 'resultados.html',
            status: 'available',
            features: getFeaturesByPermissions('resultados')
        });
    }

    // Módulo Fiscales (futuro)
    if (hasPermission('fiscales.view')) {
        availableModules.push({
            id: 'fiscales',
            title: 'Gestión de Fiscales',
            description: 'Administración de fiscales de mesa y coordinadores de comicio.',
            icon: 'fa-user-shield',
            href: 'fiscales.html',
            status: 'coming-soon',
            features: getFeaturesByPermissions('fiscales')
        });
    }

    // Módulo Comicio (futuro)
    if (hasPermission('comicio.view')) {
        availableModules.push({
            id: 'comicio',
            title: 'Gestión de Comicio',
            description: 'Configuración y administración de lugares de votación y mesas electorales.',
            icon: 'fa-building',
            href: 'comicio.html',
            status: 'coming-soon',
            features: getFeaturesByPermissions('comicio')
        });
    }

    // Módulo Usuarios (solo admin)
    if (hasPermission('usuarios.view') || hasPermission('usuarios.edit') || currentUserRole === 'administrador') {
        availableModules.push({
            id: 'usuarios',
            title: 'Gestión de Usuarios',
            description: 'Administración de cuentas de usuario, asignación de roles y permisos del sistema.',
            icon: 'fa-users-gear',
            href: 'usuarios.html',
            status: 'available',
            features: [
                'Crear y editar cuentas',
                'Asignación de roles',
                'Activar/desactivar usuarios',
                'Resetear contraseñas'
            ]
        });
    }

    return availableModules;
}

// Verificar si el usuario tiene un permiso específico
function hasPermission(permission) {
    return userPermissions.includes(permission);
}

// Obtener características del módulo según permisos
function getFeaturesByPermissions(module) {
    const featureMap = {
        padron: {
            'padron.view': 'Consulta de votantes',
            'padron.edit': 'Modificación de datos',
            'padron.relevamiento': 'Relevamiento de preferencias',
            'padron.export': 'Exportación de datos'
        },
        resultados: {
            'resultados.view': 'Gráficos interactivos',
            'resultados.export': 'Reportes automáticos'
        },
        fiscales: {
            'fiscales.view': 'Consulta de fiscales',
            'fiscales.edit': 'Gestión completa'
        },
        comicio: {
            'comicio.view': 'Consulta de lugares',
            'comicio.edit': 'Gestión completa'
        }
    };

    const moduleFeatures = featureMap[module] || {};
    const availableFeatures = [];

    for (const [permission, feature] of Object.entries(moduleFeatures)) {
        if (hasPermission(permission)) {
            availableFeatures.push(feature);
        }
    }

    return availableFeatures.length > 0 ? availableFeatures : ['Acceso básico'];
}

// Renderizar módulos
function renderModules(modules) {
    const container = document.getElementById('modules-grid');
    if (!container) return;

    container.innerHTML = modules.map(module => `
        <a href="${module.href}" class="module-card ${module.id} ${module.status === 'coming-soon' ? 'disabled' : ''}">
            <div class="module-icon">
                <i class="fas ${module.icon}"></i>
            </div>
            <div class="module-content">
                <h3>${module.title}</h3>
                <p>${module.description}</p>
                <ul class="module-features">
                    ${module.features.map(feature => `
                        <li><i class="fas fa-check-circle"></i> ${feature}</li>
                    `).join('')}
                </ul>
                <span class="module-status ${module.status}">
                    <i class="fas ${module.status === 'available' ? 'fa-check-circle' : 'fa-clock'}"></i>
                    ${module.status === 'available' ? 'Disponible' : 'Próximamente'}
                </span>
            </div>
        </a>
    `).join('');
}

// Bloquea la navegación de las tarjetas "próximamente": reemplaza al viejo
// onclick="return false" inline, que la CSP sin unsafe-inline ya no ejecuta.
document.addEventListener('click', (event) => {
    const tarjeta = event.target.closest('.module-card.disabled');
    if (tarjeta) {
        event.preventDefault();
    }
});

// Cargar estadísticas rápidas
/**
 * Situación del relevamiento.
 *
 * Antes esta función devolvía datos inventados —1250 votantes, 890 relevados—
 * con un TODO al lado, y la sección que los mostraba estaba comentada. Ahora
 * consulta la misma API que el padrón.
 */
async function loadQuickStats() {
    const contenedor = document.getElementById('situacion');
    const numero = valor => Number(valor || 0).toLocaleString('es-AR');

    try {
        const respuesta = await window.apiService.request('/api/padron/resultados/estadisticas-avanzadas');
        const d = respuesta?.data || {};

        const total = Number(d.total_votantes) || 0;
        const relevados = Number(d.total_relevados) || 0;
        const pendientes = Math.max(total - relevados, 0);
        const porcentaje = total > 0 ? Math.round((relevados / total) * 100) : 0;

        contenedor.innerHTML = `
            <div class="situacion-principal">
                <div class="situacion-porcentaje">${porcentaje}<span>%</span></div>
                <div class="situacion-detalle">
                    <p class="situacion-titulo">del padrón relevado</p>
                    <div class="situacion-barra" role="progressbar" aria-valuenow="${porcentaje}"
                         aria-valuemin="0" aria-valuemax="100" aria-label="Avance del relevamiento">
                        <div class="situacion-relleno" style="width: ${porcentaje}%"></div>
                    </div>
                </div>
            </div>
            <dl class="situacion-cifras">
                <div><dt>Relevados</dt><dd>${numero(relevados)}</dd></div>
                <div><dt>Pendientes</dt><dd>${numero(pendientes)}</dd></div>
                <div><dt>Padrón total</dt><dd>${numero(total)}</dd></div>
            </dl>
        `;

        await cargarPorCircuito();
    } catch (error) {
        console.error('Error cargando la situacion:', error);
        contenedor.innerHTML = '<p class="situacion-error">No se pudo cargar el estado del relevamiento.</p>';
    }
}

/**
 * Avance por circuito, ordenado de menos a más relevado.
 *
 * Este corte ya existía en la API y no se mostraba en ninguna pantalla. Es el
 * único que responde *dónde* falta trabajo, que es la pregunta que sigue a
 * "cuánto falta": el resto de los cortes —sexo, edad, condiciones— describen a
 * quién se relevó, pero no dicen adónde ir mañana.
 */
async function cargarPorCircuito() {
    const contenedor = document.getElementById('por-circuito');
    if (!contenedor) return;

    try {
        const respuesta = await window.apiService.request('/api/padron/resultados/por-circuito');
        const filas = Array.isArray(respuesta?.data) ? respuesta.data : [];
        if (filas.length === 0) return;

        const conAvance = filas.map(f => {
            const total = Number(f.total_votantes) || 0;
            const relevados = Number(f.total_relevados) || 0;
            return { circuito: f.circuito, total, relevados, pct: total > 0 ? Math.round((relevados / total) * 100) : 0 };
        }).sort((a, b) => a.pct - b.pct);

        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Avance por circuito</h2>
            <p class="titulo-ayuda">Ordenado de menor a mayor avance: los primeros son los que faltan.</p>
            <ul class="circuitos">
                ${conAvance.map(c => `
                    <li class="circuito">
                        <span class="circuito-nombre">Circuito ${c.circuito}</span>
                        <span class="circuito-barra">
                            <span class="circuito-relleno" style="width: ${c.pct}%"></span>
                        </span>
                        <span class="circuito-cifra">${c.relevados.toLocaleString('es-AR')} / ${c.total.toLocaleString('es-AR')}</span>
                        <span class="circuito-pct">${c.pct}%</span>
                    </li>
                `).join('')}
            </ul>
        `;
    } catch (error) {
        console.error('Error cargando el avance por circuito:', error);
    }
}

// Mostrar errores
function showError(message) {
    console.error('❌ Error:', message);
    // TODO: Implementar sistema de notificaciones
    alert('Error: ' + message);
}
