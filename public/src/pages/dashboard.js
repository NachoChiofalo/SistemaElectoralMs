// Estado de la aplicación
let currentUser = null;
let currentUserRole = null;
let userPermissions = [];

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Inicializar navbar
        if (window.navbarComponent && typeof window.navbarComponent.init === 'function') {
            window.navbarComponent.init('navbar-container', 'dashboard');
        }

        // Verificar autenticación y obtener datos del usuario
        const isAuthenticated = await initAuth();

        if (!isAuthenticated) {
            window.location.href = 'index.html';
            return;
        }

        // Obtener información completa del usuario
        await loadUserInfo();

        // Cargar dashboard
        await loadDashboard();

    } catch (error) {
        console.error('Error iniciando dashboard:', error);
        showError('No se pudo cargar el panel de control. Revisá tu conexión y volvé a intentar.');
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

// Obtener información completa del usuario desde el backend.
//
// Si falla NO se inventa un perfil: antes se asumía rol de administrador con un listado de
// permisos escrito a mano. Eso solo afectaba lo que se dibujaba (el servidor igual rechaza
// lo que no corresponde), pero mostrarle a una persona módulos que no son suyos porque una
// llamada falló es el tipo de error que después nadie recuerda por qué está. Un fallo acá
// es un estado de error con salida (ver showError), no un administrador por defecto.
async function loadUserInfo() {
    const response = await window.apiService.request('/api/auth/me', {
        method: 'GET'
    });

    if (!(response.success && response.data)) {
        throw new Error('No se pudo obtener información del usuario');
    }

    currentUser = response.data;
    currentUserRole = response.data.rol;
    userPermissions = response.data.permisos || [];

    updateUserInfo();
}

// El nombre y el rol del usuario ya los muestra la barra de navegación en todas
// las pantallas, así que el encabezado de esta dejó de repetirlos. Lo que sí
// aporta es la fecha: ubica el estado que se está mirando en el tiempo.
function updateUserInfo() {
    const fecha = document.getElementById('inicio-fecha');
    if (!fecha) return;
    const texto = new Date().toLocaleDateString('es-AR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    // En español los días y los meses van en minúscula ("viernes, 9 de octubre de 2026");
    // se pone mayúscula sólo a la primera letra, no a cada palabra.
    fecha.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
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

// Obtener módulos basados en los permisos del usuario.
//
// Tiene que coincidir con la barra de navegación (NavbarComponent): antes Mapa, Listas,
// Auditoría y Configuración existían en la barra pero no aparecían acá, así que el inicio
// no era un índice fiable de lo que el sistema ofrece. Mismas reglas de acceso que ella.
function getModulesForUser() {
    const availableModules = [];
    const esAdmin = currentUserRole === 'administrador';

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

    // Módulo Mapa (018): por permiso, hoy solo lo tiene el administrador.
    if (hasPermission('territorio.view')) {
        availableModules.push({
            id: 'mapa',
            title: 'Mapa por manzana',
            description: 'Avance del relevamiento por manzana y radio censal, sin exponer personas.',
            icon: 'fa-map',
            href: 'mapa.html',
            status: 'available',
            features: ['Avance por zona', 'Resultado por opción política', 'Umbral de privacidad']
        });
    }

    // Módulo Listas electorales
    if (hasPermission('listas.view')) {
        availableModules.push({
            id: 'listas',
            title: 'Listas electorales',
            description: 'Armado de listas de candidatos y suplentes, en borrador.',
            icon: 'fa-list-ol',
            href: 'listas.html',
            status: 'available',
            features: ['Candidatos y suplentes', 'Orden de la lista', 'Notas por candidato']
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
    if (hasPermission('usuarios.view') || hasPermission('usuarios.edit') || esAdmin) {
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

    // Auditoría y Configuración: solo administrador, igual que en la barra.
    if (esAdmin) {
        availableModules.push({
            id: 'auditoria',
            title: 'Auditoría',
            description: 'Quién tocó qué y cuándo: registro de operaciones sobre el padrón y las cuentas.',
            icon: 'fa-clipboard-list',
            href: 'auditoria.html',
            status: 'available',
            features: ['Filtro por operación y fecha', 'Detalle antes y después', 'Estadísticas de actividad']
        });
        availableModules.push({
            id: 'configuracion',
            title: 'Configuración',
            description: 'Opciones políticas de esta instancia: qué se puede marcar al relevar.',
            icon: 'fa-sliders-h',
            href: 'configuracion.html',
            status: 'available',
            features: ['Alta y baja de opciones', 'Color y orden', 'Opción neutra']
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

    // Los textos son literales de este archivo, pero se escapan igual: el día que alguno
    // venga de la base (un módulo configurable), el escape ya está.
    container.innerHTML = modules.map(module => `
        <a href="${escaparHtml(module.href)}" class="module-card ${escaparHtml(module.id)} ${module.status === 'coming-soon' ? 'disabled' : ''}">
            <div class="module-icon">
                <i class="fas ${escaparHtml(module.icon)}" aria-hidden="true"></i>
            </div>
            <div class="module-content">
                <h3>${escaparHtml(module.title)}</h3>
                <p>${escaparHtml(module.description)}</p>
                <ul class="module-features">
                    ${module.features.map(feature => `
                        <li><i class="fas fa-check-circle" aria-hidden="true"></i> ${escaparHtml(feature)}</li>
                    `).join('')}
                </ul>
                <span class="module-status ${escaparHtml(module.status)}">
                    <i class="fas ${module.status === 'available' ? 'fa-check-circle' : 'fa-clock'}" aria-hidden="true"></i>
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
    // "Reintentar" de los estados de error: recargar la pantalla.
    if (event.target.closest('[data-action="reintentar"]')) {
        location.reload();
    }
});

/**
 * Anchos de las barras de progreso. Se aplican desde JavaScript (CSSOM) y no con
 * `style="width: N%"` en el markup: un atributo `style` inline es lo que impide sacar
 * 'unsafe-inline' de la CSP de estilos, y las asignaciones por `element.style` no cuentan.
 * El markup lleva `data-ancho="N"`.
 */
function aplicarAnchos(raiz) {
    raiz.querySelectorAll('[data-ancho]').forEach((el) => {
        el.style.width = `${Number(el.dataset.ancho) || 0}%`;
    });
}

/**
 * Una píldora de intención de voto por cada opción política de la instancia, sobre el
 * total ya relevado. Sin gráfico: esta pantalla ya tiene una cifra grande dominando el
 * bloque de situación, y para el detalle está Resultados.
 *
 * `votos` es el objeto { codigo: cantidad } que devuelve la API. La etiqueta es texto del
 * cliente, así que se escapa.
 */
function renderIntencionVoto({ votos, totalRelevados }) {
    const total = Math.max(Number(totalRelevados) || 0, 1);
    const pct = valor => Math.round((Number(valor) || 0) / total * 100);

    const pildoras = window.opcionesPoliticas.lista().map(opcion => `
            <span class="intencion-pill ${window.opcionesPoliticas.clase(opcion)}"><span class="intencion-dot"></span>${escaparHtml(opcion.etiqueta)} <strong>${pct(votos?.[opcion.codigo])}%</strong></span>`).join('');

    return `
        <div class="intencion-voto">${pildoras}
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
        const [respuesta] = await Promise.all([
            window.apiService.request('/api/padron/resultados/estadisticas-avanzadas'),
            window.opcionesPoliticas.cargar(),
        ]);
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
                        <div class="situacion-relleno" data-ancho="${porcentaje}"></div>
                    </div>
                    ${renderIntencionVoto({ votos: d.votos, totalRelevados: relevados })}
                </div>
            </div>
            <dl class="situacion-cifras">
                <div><dt>Relevados</dt><dd>${numero(relevados)}</dd></div>
                <div><dt>Pendientes</dt><dd>${numero(pendientes)}</dd></div>
                <div><dt>Padrón total</dt><dd>${numero(total)}</dd></div>
            </dl>
        `;
        aplicarAnchos(contenedor);

        await cargarPorCircuito();
    } catch (error) {
        console.error('Error cargando la situacion:', error);
        contenedor.innerHTML = estados.error({
            titulo: 'No se pudo cargar el estado del relevamiento',
            reintentar: 'reintentar',
            compacto: true
        });
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
        if (filas.length === 0) {
            contenedor.innerHTML = `
                <h2 class="titulo-seccion">Avance por circuito</h2>
                ${estados.vacio({ titulo: 'Todavía no hay circuitos', texto: 'Aparecen cuando se carga el padrón.', icono: 'fa-map', compacto: true })}
            `;
            return;
        }

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
                        <span class="circuito-nombre">Circuito ${escaparHtml(c.circuito)}</span>
                        <span class="circuito-barra" role="progressbar" aria-valuenow="${c.pct}"
                              aria-valuemin="0" aria-valuemax="100" aria-label="Avance del circuito ${escaparHtml(c.circuito)}">
                            <span class="circuito-relleno" data-ancho="${c.pct}"></span>
                        </span>
                        <span class="circuito-cifra">${c.relevados.toLocaleString('es-AR')} / ${c.total.toLocaleString('es-AR')}</span>
                        <span class="circuito-pct">${c.pct}%</span>
                    </li>
                `).join('')}
            </ul>
        `;
        aplicarAnchos(contenedor);
    } catch (error) {
        console.error('Error cargando el avance por circuito:', error);
        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Avance por circuito</h2>
            ${estados.error({ titulo: 'No se pudo cargar el avance por circuito', reintentar: 'reintentar', compacto: true })}
        `;
    }
}

// Etiquetas cortas para el widget del dashboard. El listado completo, con ícono y
// clase por operación, vive en AuditoriaComponent.js -- acá alcanza con el texto.
//
// Tiene que cubrir las MISMAS operaciones que Auditoría: antes faltaban casi todas las de
// cuentas y sesión, y la actividad reciente decía "hizo un cambio" para cualquiera de ellas.
// Además tenía EXPORTAR_DATOS, que el sistema nunca registra (la operación es EXPORTAR_CSV).
const ETIQUETA_OPERACION = {
    CREAR: 'creó un registro',
    EDITAR: 'editó un registro',
    MODIFICAR: 'modificó un registro',
    ELIMINAR: 'eliminó un registro',
    CREAR_VOTANTE: 'dio de alta un votante',
    ACTUALIZAR_RELEVAMIENTO: 'actualizó un relevamiento',
    CREAR_DETALLE: 'cargó un detalle',
    ACTUALIZAR_DETALLE: 'actualizó un detalle',
    ELIMINAR_DETALLE: 'eliminó un detalle',
    IMPORTAR_CSV: 'importó un CSV',
    EXPORTAR_CSV: 'exportó un CSV',
    ACTIVAR: 'activó una cuenta',
    DESACTIVAR: 'desactivó una cuenta',
    LOGIN: 'inició sesión',
    LOGOUT: 'cerró sesión',
    LOGIN_FALLIDO: 'tuvo un intento de acceso fallido',
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
        if (registros.length === 0) {
            contenedor.innerHTML = `
                <h2 class="titulo-seccion">Actividad reciente</h2>
                ${estados.vacio({ titulo: 'Sin actividad registrada', icono: 'fa-clipboard-list', compacto: true })}
            `;
            return;
        }

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
                            ${escaparHtml(ETIQUETA_OPERACION[r.operacion] || 'hizo un cambio')}
                        </span>
                        <span class="actividad-fecha">${fecha(r.created_at)}</span>
                    </li>
                `).join('')}
            </ul>
            <a class="ver-todo" href="auditoria.html">Ver auditoría completa <span aria-hidden="true">→</span></a>
        `;
    } catch (error) {
        console.error('Error cargando la actividad reciente:', error);
        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Actividad reciente</h2>
            ${estados.error({ titulo: 'No se pudo cargar la actividad', reintentar: 'reintentar', compacto: true })}
        `;
    }
}

/**
 * Estado del comicio más reciente, sólo para quien tiene comicio.view.
 *
 * No hay noción de "próximo" comicio -- la tabla no tiene fecha, sólo
 * created_at -- así que se toma el último cargado, que es el que
 * `listarComicios` ya devuelve primero.
 *
 * Sin ningún comicio cargado el bloque no se dibuja: no hay nada que esperar, y un
 * "sin comicios" fijo en el inicio de quien nunca usa esa parte sería ruido.
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
                <div class="situacion-barra" role="progressbar" aria-valuenow="${pct}"
                     aria-valuemin="0" aria-valuemax="100" aria-label="Mesas con resultado cargado">
                    <div class="situacion-relleno" data-ancho="${pct}"></div>
                </div>
                <span class="comicio-cifra">${mesasConVotos} / ${mesasTotal} mesas (${pct}%)</span>
            </div>
            <a class="ver-todo" href="comicio.html">Ir a Comicio <span aria-hidden="true">→</span></a>
        `;
        aplicarAnchos(contenedor);
    } catch (error) {
        console.error('Error cargando el estado del comicio:', error);
        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Comicio</h2>
            ${estados.error({ titulo: 'No se pudo cargar el estado del comicio', reintentar: 'reintentar', compacto: true })}
        `;
    }
}

/**
 * Avance de relevamiento para el encargado, sourced en /api/padron/estadisticas
 * (padron.view) en vez de /api/padron/resultados/estadisticas-avanzadas
 * (resultados.view), que este rol no tiene.
 *
 * Sin intención de voto: a diferencia de administrador y consultor, el
 * encargado no ve el desglose por opción política en el dashboard.
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
                        <div class="situacion-relleno" data-ancho="${porcentaje}"></div>
                    </div>
                </div>
            </div>
            <dl class="situacion-cifras">
                <div><dt>Relevados</dt><dd>${numero(relevados)}</dd></div>
                <div><dt>Pendientes</dt><dd>${numero(pendientes)}</dd></div>
                <div><dt>Padrón total</dt><dd>${numero(total)}</dd></div>
            </dl>
        `;
        aplicarAnchos(contenedor);
    } catch (error) {
        console.error('Error cargando el resumen de relevamiento:', error);
        contenedor.innerHTML = estados.error({
            titulo: 'No se pudo cargar tu avance de relevamiento',
            reintentar: 'reintentar',
            compacto: true
        });
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
            <p class="condiciones-total">${total.toLocaleString('es-AR')}<span>de ${Number(d.total_relevamientos || 0).toLocaleString('es-AR')} relevamientos (${escaparHtml(d.porcentaje_condiciones_especiales ?? 0)}%)</span></p>
        `;
    } catch (error) {
        console.error('Error cargando condiciones especiales:', error);
        contenedor.innerHTML = `
            <h2 class="titulo-seccion">Condiciones especiales</h2>
            ${estados.error({ titulo: 'No se pudieron cargar las condiciones especiales', reintentar: 'reintentar', compacto: true })}
        `;
    }
}

/**
 * Error de toda la pantalla (no se pudo verificar la sesión o armar el panel). Reemplaza al
 * `alert()` que había: se cerraba con un clic y la página quedaba vacía, sin salida.
 */
function showError(message) {
    const contenedor = document.getElementById('dash-error');
    if (!contenedor) return;
    document.getElementById('vista-admin-consultor').hidden = true;
    document.getElementById('vista-encargado').hidden = true;
    document.getElementById('modules-grid').closest('section').hidden = true;
    contenedor.innerHTML = estados.error({ texto: message, reintentar: 'reintentar' });
    contenedor.hidden = false;
}
