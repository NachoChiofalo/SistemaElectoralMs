// Configuración de módulos por rol
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

    // El encargado de relevamiento no tiene resultados.view -- los endpoints que
    // arma la vista de administrador/consultor le devolverían 403 -- así que tiene
    // su propia vista, con datos que sí le corresponden (padron.view).
    if (currentUserRole === 'encargado_relevamiento') {
        await loadVistaEncargado();
    } else {
        await loadVistaAdminConsultor();
    }
}

// Situación general, actividad del equipo y estado del comicio. Cada bloque se
// gatea por su propio permiso, no por el rol: así administrador ve los tres y
// consultor sólo el primero, sin tener que enumerar roles acá.
async function loadVistaAdminConsultor() {
    document.getElementById('vista-admin-consultor').hidden = false;

    // En paralelo (FE-053): son bloques independientes y cada uno maneja su propio error.
    await Promise.allSettled([
        hasPermission('resultados.view') ? loadQuickStats() : null,
        hasPermission('admin.system') ? loadActividadReciente() : null,
        hasPermission('comicio.view') ? loadEstadoComicio() : null,
    ]);
}

// Mi avance de relevamiento y acceso directo a seguir cargando.
async function loadVistaEncargado() {
    document.getElementById('vista-encargado').hidden = false;
    await loadResumenEncargado();
    await loadCondicionesPendientes();
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

    // Módulo Comicio: absorbe Fiscales (gestionar un comicio implica gestionar los
    // fiscales de sus mesas). Entra con cualquiera de los dos permisos; las secciones
    // de adentro se gatean cada una con el suyo.
    if (hasPermission('comicio.view') || hasPermission('fiscales.view')) {
        availableModules.push({
            id: 'comicio',
            title: 'Gestión de Comicio',
            description: 'Comicios, mesas, fiscales y su calendario, carga de votos y métricas.',
            icon: 'fa-building',
            href: 'comicio.html',
            status: 'available',
            features: [...getFeaturesByPermissions('comicio'), ...getFeaturesByPermissions('fiscales')]
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

/**
 * Tres píldoras de intención de voto (PJ/UCR/Indeciso), sobre el total ya
 * relevado. Sin gráfico: esta pantalla ya tiene una cifra grande dominando el
 * bloque de situación, y para el detalle está Resultados.
 */
function renderIntencionVoto({ pj, ucr, indeciso, totalRelevados }) {
    const total = Math.max(Number(totalRelevados) || 0, 1);
    const pct = valor => Math.round((Number(valor) || 0) / total * 100);

    return `
        <div class="intencion-voto">
            <span class="intencion-pill"><span class="intencion-dot pj"></span>PJ <strong>${pct(pj)}%</strong></span>
            <span class="intencion-pill"><span class="intencion-dot ucr"></span>UCR <strong>${pct(ucr)}%</strong></span>
            <span class="intencion-pill"><span class="intencion-dot indeciso"></span>Indeciso <strong>${pct(indeciso)}%</strong></span>
        </div>
    `;
}

/**
 * Situación del relevamiento, para administrador y consultor.
 *
 * Antes esta función devolvía datos inventados —1250 votantes, 890 relevados—
 * con un TODO al lado, y la sección que los mostraba estaba comentada. Ahora
 * consulta la misma API que el padrón.
 *
 * Requiere resultados.view, no padron.view: antes se gateaba con el permiso
 * equivocado y para un consultor (que tiene resultados.view pero no
 * padron.view) esto nunca fallaba porque nunca se llamaba a tiempo, pero para
 * cualquier rol futuro con esa misma combinación de permisos el fetch de acá
 * abajo hubiera vuelto 403.
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
                    ${renderIntencionVoto({ pj: d.votos_pj, ucr: d.votos_ucr, indeciso: d.votos_indeciso, totalRelevados: relevados })}
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

// Etiquetas cortas para el widget del dashboard. El listado completo, con ícono y
// clase por operación, vive en AuditoriaComponent.js -- acá alcanza con el texto.
const ETIQUETA_OPERACION = {
    CREAR_VOTANTE: 'dio de alta un votante',
    ACTUALIZAR_RELEVAMIENTO: 'actualizó un relevamiento',
    CREAR_DETALLE: 'cargó un detalle',
    ACTUALIZAR_DETALLE: 'actualizó un detalle',
    ELIMINAR_DETALLE: 'eliminó un detalle',
    IMPORTAR_CSV: 'importó un CSV',
    EXPORTAR_DATOS: 'exportó datos',
};

/**
 * Actividad reciente, sólo para quien tiene admin.system.
 *
 * Usa el mismo registro que Auditoría (`/api/padron/auditoria`) pero muestra
 * apenas las últimas 5 filas: es un vistazo de "¿pasó algo?", no un reemplazo
 * de la pantalla completa, que sigue siendo el lugar para filtrar y exportar.
 */
async function loadActividadReciente() {
    const contenedor = document.getElementById('actividad-reciente');
    if (!contenedor) return;

    try {
        const respuesta = await window.apiService.request('/api/padron/auditoria?limit=5');
        const registros = Array.isArray(respuesta?.data) ? respuesta.data : [];
        if (registros.length === 0) return;

        const fecha = valor => new Date(valor).toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });

        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Actividad reciente</h2>
            <ul class="actividad-lista">
                ${registros.map(r => `
                    <li class="actividad-item">
                        <span class="actividad-texto">
                            <strong>${escaparHtml(r.usuario_nombre || r.usuario_username || 'Alguien')}</strong>
                            ${ETIQUETA_OPERACION[r.operacion] || 'hizo un cambio'}
                        </span>
                        <span class="actividad-fecha">${fecha(r.created_at)}</span>
                    </li>
                `).join('')}
            </ul>
            <a class="ver-todo" href="auditoria.html">Ver auditoría completa →</a>
        `;
    } catch (error) {
        console.error('Error cargando la actividad reciente:', error);
    }
}

/**
 * Estado del comicio más reciente, sólo para quien tiene comicio.view.
 *
 * No hay noción de "próximo" comicio -- la tabla no tiene fecha, sólo
 * created_at -- así que se toma el último cargado, que es el que
 * `listarComicios` ya devuelve primero.
 */
async function loadEstadoComicio() {
    const contenedor = document.getElementById('comicio-widget');
    if (!contenedor) return;

    try {
        const listado = await window.apiService.request('/api/comicio?limite=1');
        const comicios = Array.isArray(listado?.data) ? listado.data : [];
        if (comicios.length === 0) return;

        const comicio = comicios[0];
        const metricas = await window.apiService.request(`/api/comicio/${comicio.id}/metricas`);
        const m = metricas?.data || {};
        const mesasTotal = Number(m.mesasTotal) || 0;
        const mesasConVotos = Number(m.mesasConVotos) || 0;
        const pct = mesasTotal > 0 ? Math.round((mesasConVotos / mesasTotal) * 100) : 0;

        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Comicio: ${escaparHtml(comicio.nombre)}</h2>
            <p class="titulo-ayuda">Mesas con resultado cargado.</p>
            <div class="comicio-avance">
                <div class="situacion-barra">
                    <div class="situacion-relleno" style="width: ${pct}%"></div>
                </div>
                <span class="comicio-cifra">${mesasConVotos} / ${mesasTotal} mesas (${pct}%)</span>
            </div>
            <a class="ver-todo" href="comicio.html">Ir a Comicio →</a>
        `;
    } catch (error) {
        console.error('Error cargando el estado del comicio:', error);
    }
}

/**
 * Avance de relevamiento para el encargado, sourced en /api/padron/estadisticas
 * (padron.view) en vez de /api/padron/resultados/estadisticas-avanzadas
 * (resultados.view), que este rol no tiene.
 *
 * Sin intención de voto: a diferencia de administrador y consultor, el
 * encargado no ve el desglose PJ/UCR/Indeciso en el dashboard.
 */
async function loadResumenEncargado() {
    const contenedor = document.getElementById('situacion-encargado');
    const numero = valor => Number(valor || 0).toLocaleString('es-AR');

    try {
        const respuesta = await window.apiService.request('/api/padron/estadisticas');
        const d = respuesta?.data || {};

        const total = Number(d.totalVotantes) || 0;
        const relevados = Number(d.totalRelevamientos) || 0;
        const pendientes = Number(d.sinRelevar) || Math.max(total - relevados, 0);
        const porcentaje = Math.round(Number(d.porcentajeRelevados) || 0);

        contenedor.innerHTML = `
            <div class="situacion-principal">
                <div class="situacion-porcentaje">${porcentaje}<span>%</span></div>
                <div class="situacion-detalle">
                    <p class="situacion-titulo">de tu padrón relevado</p>
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
    } catch (error) {
        console.error('Error cargando el resumen de relevamiento:', error);
        contenedor.innerHTML = '<p class="situacion-error">No se pudo cargar tu avance de relevamiento.</p>';
    }
}

/**
 * Cuántos relevamientos quedaron marcados con alguna condición especial
 * (nuevo votante, fallecido, empleado municipal, ayuda social). Mismo
 * endpoint que consulta Resultados, gateado por padron.view O resultados.view
 * a propósito para que le sirva también al encargado.
 */
async function loadCondicionesPendientes() {
    const contenedor = document.getElementById('condiciones-pendientes');
    if (!contenedor) return;

    try {
        const respuesta = await window.apiService.request('/api/padron/estadisticas-condiciones-especiales');
        const d = respuesta?.data || {};
        const total = Number(d.total_con_condiciones_especiales) || 0;
        if (total === 0) return;

        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Condiciones especiales</h2>
            <p class="titulo-ayuda">Relevamientos marcados como nuevo votante, fallecido, empleado municipal o con ayuda social.</p>
            <p class="condiciones-total">${total.toLocaleString('es-AR')}<span>de ${Number(d.total_relevamientos || 0).toLocaleString('es-AR')} relevamientos (${d.porcentaje_condiciones_especiales ?? 0}%)</span></p>
        `;
    } catch (error) {
        console.error('Error cargando condiciones especiales:', error);
    }
}

// Mostrar errores
function showError(message) {
    console.error('❌ Error:', message);
    // TODO: Implementar sistema de notificaciones
    alert('Error: ' + message);
}
