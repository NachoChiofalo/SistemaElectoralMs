// NavbarComponent.js
// Barra lateral de navegación (app shell) para todas las páginas.
// En escritorio es una columna fija a la izquierda, expandida (240 px) o colapsada a íconos
// (68 px); en móvil es una barra superior mínima y la columna pasa a ser un cajón.

(function(global) {
    /**
     * Destinos de la barra.
     *
     * Orden convencional —el inicio primero— y no por frecuencia de uso: en una barra
     * de navegación la previsibilidad vale más que el ahorro de un clic, porque se lee
     * decenas de veces por jornada.
     *
     * Resultados entra acá por primera vez. Antes se llegaba por un botón dentro del
     * padrón, lo que lo dejaba escondido detrás de otra pantalla siendo una sección
     * hermana, no una subsección.
     *
     * Las etiquetas se acortaron ("Padrón Electoral" → "Padrón"): en una barra la
     * palabra que distingue es la primera, y la segunda sólo gasta ancho. Ese ancho es
     * el que va a necesitar la barra cuando entren los módulos nuevos.
     */
    // En Mac el atajo es Cmd; en el resto, Ctrl. Solo cambia lo que se muestra: los dos funcionan.
    const TECLA_PALETA = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '\u2318K' : 'Ctrl K';

    const GRUPOS = [
        { id: 'operacion', titulo: 'Operación' },
        { id: 'eleccion', titulo: 'Elección' },
        { id: 'administracion', titulo: 'Administración' }
    ];

    const NAV_ITEMS = [
        { href: 'dashboard.html', icon: 'fa-tachometer-alt', label: 'Inicio', grupo: 'operacion', key: 'dashboard' },
        { href: 'index.html', icon: 'fa-list', label: 'Padrón', grupo: 'operacion', key: 'padron' },
        { href: 'resultados.html', icon: 'fa-chart-bar', label: 'Resultados', grupo: 'operacion', key: 'resultados' },
        // Por permiso y no por rol: en la etapa 1 solo lo tiene el administrador (018).
        { href: 'mapa.html', icon: 'fa-map', label: 'Mapa', grupo: 'operacion', key: 'mapa', permission: 'territorio.view' },
        // Gateado por permiso, no por rol: a diferencia de usuarios/auditoria (siempre
        // admin), listas.view puede terminar asignado a otro rol el dia de manana.
        { href: 'listas.html', icon: 'fa-list-ol', label: 'Listas', grupo: 'eleccion', key: 'listas', permission: 'listas.view' },
        // Comicio absorbio a Fiscales en una sola pantalla: gestionar un comicio implica
        // gestionar los fiscales de sus mesas, asi que no tiene sentido como item aparte.
        // Entra con cualquiera de los dos permisos -- alguien con solo fiscales.view no
        // puede quedar sin forma de llegar a la pantalla.
        { href: 'comicio.html', icon: 'fa-building', label: 'Comicio', grupo: 'eleccion', key: 'comicio', permissionAny: ['comicio.view', 'fiscales.view'] },
        { href: 'usuarios.html', icon: 'fa-users-gear', label: 'Usuarios', grupo: 'administracion', key: 'usuarios', adminOnly: true },
        { href: 'auditoria.html', icon: 'fa-clipboard-list', label: 'Auditoría', grupo: 'administracion', key: 'auditoria', adminOnly: true },
        { href: 'configuracion.html', icon: 'fa-sliders-h', label: 'Configuración', grupo: 'administracion', key: 'configuracion', adminOnly: true }
    ];

    // El rol llega como identificador (`encargado_relevamiento`). Con `text-transform:
    // capitalize` se mostraba "Encargado_relevamiento", con el guión bajo a la vista.
    const NOMBRE_ROL = {
        administrador: 'Administrador',
        encargado_relevamiento: 'Encargado de relevamiento',
        consultor: 'Consultor'
    };

    function nombreDeRol(rol) {
        if (!rol) return '';
        if (NOMBRE_ROL[rol]) return NOMBRE_ROL[rol];
        const texto = String(rol).replace(/_/g, ' ');
        return texto.charAt(0).toUpperCase() + texto.slice(1);
    }

    function renderNavbar(activeKey) {
        const user = (window.authService && window.authService.getCurrentUser && window.authService.getCurrentUser()) || { username: 'Usuario' };
        const username = user.nombre_completo || user.username || 'Usuario';
        const userRole = user.rol || '';
        const userPermisos = user.permisos || [];
        const visibleItems = visiblesParaPaleta = NAV_ITEMS.filter(item =>
            (!item.adminOnly || userRole === 'administrador') &&
            (!item.permission || userPermisos.includes(item.permission)) &&
            (!item.permissionAny || item.permissionAny.some(p => userPermisos.includes(p)))
        );
        const grupos = GRUPOS.map(grupo => {
            const items = visibleItems.filter(item => item.grupo === grupo.id);
            if (!items.length) return '';
            return `
                <div class="nav-grupo" role="group" aria-labelledby="nav-grupo-${grupo.id}">
                    <span class="nav-grupo-titulo" id="nav-grupo-${grupo.id}">${grupo.titulo}</span>
                    ${items.map(item => `
                    <a href="${item.href}" class="nav-item${activeKey === item.key ? ' active' : ''}" data-etiqueta="${item.label}"${activeKey === item.key ? ' aria-current="page"' : ''}>
                        <i class="fas ${item.icon}" aria-hidden="true"></i>
                        <span class="nav-text">${item.label}</span>
                    </a>`).join('')}
                </div>`;
        }).join('');

        return `
        <a class="skip-link" href="#contenido">Saltar al contenido</a>
        <nav class="navbar-unified" aria-label="Principal">
            <div class="navbar-content">
                <div class="navbar-brand">
                    <!-- El logo es una máscara: la tinta sale de --ds-text-primary y sigue al tema.
                         El PNG no se toca; el lockup completo se muestra expandida y el ícono, colapsada. -->
                    <span class="navbar-logo" role="img" aria-label="ÁGORA"></span>
                    <span class="navbar-logo-icono" role="img" aria-label="ÁGORA"></span>
                </div>

                <div class="navbar-mobile-actions">
                    <button class="navbar-toggle" id="navbar-toggle" type="button" aria-label="Abrir menú de navegación" aria-expanded="false" aria-controls="navbar-collapse">
                        <span class="hamburger-line"></span>
                        <span class="hamburger-line"></span>
                        <span class="hamburger-line"></span>
                    </button>
                </div>

                <div class="navbar-collapse" id="navbar-collapse">
                    <button type="button" class="nav-buscar" id="nav-buscar" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
                        <i class="fas fa-search" aria-hidden="true"></i>
                        <span class="nav-text">Ir a…</span>
                        <kbd class="nav-kbd" aria-hidden="true">${TECLA_PALETA}</kbd>
                    </button>
                    <div class="navbar-nav">${grupos}</div>

                    <div class="navbar-user">
                        <!-- El nombre es contexto, no una acción: va como texto y no como
                             botón, y el rol debajo responde "por qué veo lo que veo". -->
                        <div class="user-info">
                            <span class="username" id="username">${escaparHtml(username)}</span>
                            <span class="user-role">${escaparHtml(nombreDeRol(userRole))}</span>
                        </div>
                        <div class="navbar-acciones">
                            <button class="tema-btn" id="tema-btn" type="button" aria-label="Cambiar tema">
                                <i class="fas" id="tema-icono" aria-hidden="true"></i>
                            </button>
                            <button class="logout-btn" id="logout-btn" type="button" title="Cerrar sesión" aria-label="Cerrar sesión">
                                <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="nav-densidad" id="nav-densidad" aria-pressed="false" aria-label="Usar vista compacta" title="Usar vista compacta">
                                <i class="fas fa-compress-alt" aria-hidden="true"></i>
                            </button>
                            <button class="nav-colapsar" id="nav-colapsar" type="button" aria-controls="navbar-collapse" aria-expanded="true" aria-label="Contraer menú lateral" title="Contraer menú lateral">
                                <i class="fas fa-chevron-left" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
        <div class="navbar-overlay" id="navbar-overlay"></div>
        `;
    }

    /**
     * Estado visible del botón de tema.
     *
     * El icono muestra lo que está viéndose; el texto, de dónde viene esa decisión. La
     * distinción importa en "Automático": ahí el usuario no eligió nada y el tema puede
     * cambiar solo cuando el sistema pasa a modo noche.
     */
    const TEMAS = {
        sistema: { icono: 'fa-desktop', texto: 'Automático' },
        light: { icono: 'fa-sun', texto: 'Claro' },
        dark: { icono: 'fa-moon', texto: 'Oscuro' },
    };

    function pintarBotonTema() {
        if (!global.tema) return;

        const elegido = global.tema.elegido();
        const estado = TEMAS[elegido] || TEMAS.sistema;
        const icono = document.getElementById('tema-icono');
        const boton = document.getElementById('tema-btn');

        // En "Automático" el icono muestra el tema que se está viendo, no un monitor:
        // lo que importa saber de un vistazo es si estás en claro o en oscuro.
        if (icono) icono.className = `fas ${elegido === 'sistema' ? TEMAS[global.tema.efectivo()].icono : estado.icono}`;
        if (boton) {
            // El nombre accesible incluye el estado: con solo "Cambiar tema" un lector de
            // pantalla no sabe en qué tema está ni cuál viene después.
            boton.title = `Tema: ${estado.texto}. Clic para cambiar.`;
            boton.setAttribute('aria-label', `Cambiar tema. Actual: ${estado.texto}`);
        }
    }

    function initTema() {
        const boton = document.getElementById('tema-btn');
        if (!boton || !global.tema) return;

        pintarBotonTema();
        boton.addEventListener('click', () => {
            global.tema.cambiar();
            pintarBotonTema();
        });

        // En "Automático" el tema efectivo cambia sin que nadie toque el botón: hay que
        // repintar el icono cuando el sistema pasa de claro a oscuro.
        if (global.matchMedia) {
            global.matchMedia('(prefers-color-scheme: dark)')
                .addEventListener('change', pintarBotonTema);
        }
    }

    async function handleLogout() {
        // dialogo.confirmar() reemplaza a confirm(): no bloquea el hilo, sigue el tema y
        // es un diálogo de verdad para el lector de pantalla.
        const confirmed = global.dialogo
            ? await global.dialogo.confirmar({
                titulo: 'Cerrar sesión',
                mensaje: '¿Está seguro que desea cerrar sesión?',
                confirmar: 'Cerrar sesión'
            })
            : true;
        if (confirmed) {
            if (window.authService && window.authService.logout) {
                window.authService.logout().finally(() => {
                    window.location.href = '/';
                });
            } else {
                window.location.href = '/';
            }
        }
    }

    // Destinos visibles para quien está logueado: los comparten la barra y la paleta de comandos.
    let visiblesParaPaleta = [];

    function initNavbar(containerId, activeKey) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = renderNavbar(activeKey);
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }
        initTema();
        initColapso();
        initDensidad();
        initPaleta(visiblesParaPaleta);
        initCajon();
    }

    /**
     * Colapsar la barra a íconos (solo escritorio). La preferencia vive en localStorage
     * —con try/catch: puede estar bloqueado— y se refleja en `data-nav` del <html>, que es
     * de donde el CSS toma el ancho de la columna y el margen del contenido. Colapsada, el
     * texto de cada destino sale de pantalla pero sigue en el DOM, y `title` hace de
     * tooltip.
     */
    const CLAVE_NAV = 'sistema-electoral:nav';

    function initColapso() {
        const boton = document.getElementById('nav-colapsar');
        if (!boton) return;

        function fijar(colapsada) {
            document.documentElement.dataset.nav = colapsada ? 'colapsada' : 'expandida';
            const texto = colapsada ? 'Expandir menú lateral' : 'Contraer menú lateral';
            boton.setAttribute('aria-expanded', String(!colapsada));
            boton.setAttribute('aria-label', texto);
            boton.title = texto;
            document.querySelectorAll('.navbar-unified .nav-item').forEach(a => {
                if (colapsada) a.title = a.dataset.etiqueta;
                else a.removeAttribute('title');
            });
        }

        let guardada = false;
        try { guardada = localStorage.getItem(CLAVE_NAV) === 'colapsada'; } catch (e) { /* sin persistencia */ }
        fijar(guardada);

        alternarColapso = () => {
            const colapsar = document.documentElement.dataset.nav !== 'colapsada';
            fijar(colapsar);
            try { localStorage.setItem(CLAVE_NAV, colapsar ? 'colapsada' : 'expandida'); } catch (e) { /* idem */ }
        };
        boton.addEventListener('click', () => alternarColapso());
    }

    /** Vista cómoda / compacta. El estado vive en tema.js (se aplica antes del primer pintado). */
    function initDensidad() {
        const boton = document.getElementById('nav-densidad');
        if (!boton || !global.densidad) { boton?.remove(); return; }

        const pintar = () => {
            const compacta = global.densidad.elegida() === 'compacta';
            boton.setAttribute('aria-pressed', String(compacta));
            const texto = compacta ? 'Usar vista cómoda' : 'Usar vista compacta';
            boton.setAttribute('aria-label', texto);
            boton.title = texto;
            // El ícono muestra lo que pasará: desplegar si hoy es compacta, plegar si hoy es cómoda.
            boton.querySelector('i').className = `fas ${compacta ? 'fa-expand-alt' : 'fa-compress-alt'}`;
        };
        alternarDensidad = () => {
            global.densidad.establecer(global.densidad.elegida() === 'compacta' ? 'comoda' : 'compacta');
            pintar();
        };
        pintar();
        boton.addEventListener('click', () => alternarDensidad());
    }

    // ------------------------------------------------------------ paleta de comandos (Ctrl/Cmd + K)

    let alternarColapso = () => {};
    let alternarDensidad = () => {};

    /** Sin tildes y en minúscula: "auditoria" encuentra "Auditoría". */
    const normalizar = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    /**
     * Paleta de comandos: un <dialog> modal con un campo de búsqueda y una lista de destinos y
     * acciones. Patrón combobox: el foco queda en el campo, la opción activa se anuncia con
     * aria-activedescendant y las flechas la mueven; Enter la ejecuta y Escape cierra. Los
     * destinos son los mismos que la barra (con sus permisos); las acciones, las del pie de la barra.
     */
    function initPaleta(destinos) {
        const abrirBtn = document.getElementById('nav-buscar');
        let dlg = null;

        function comandos() {
            const oscuro = global.tema && global.tema.efectivo() === 'dark';
            const colapsada = document.documentElement.dataset.nav === 'colapsada';
            const compacta = global.densidad && global.densidad.elegida() === 'compacta';
            const lista = destinos.map(d => ({
                texto: d.label, grupo: 'Ir a', icono: d.icon, claves: `${d.label} ${d.key}`,
                ejecutar: () => { window.location.href = d.href; },
            }));
            if (global.tema) {
                lista.push({
                    texto: oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro', grupo: 'Acciones', icono: oscuro ? 'fa-sun' : 'fa-moon',
                    claves: 'tema modo claro oscuro apariencia',
                    ejecutar: () => { global.tema.establecer(oscuro ? 'light' : 'dark'); pintarBotonTema(); },
                });
            }
            lista.push({
                texto: colapsada ? 'Expandir el menú lateral' : 'Contraer el menú lateral', grupo: 'Acciones', icono: 'fa-chevron-left',
                claves: 'menu lateral barra colapsar contraer expandir', ejecutar: () => alternarColapso(),
            });
            if (global.densidad) {
                lista.push({
                    texto: compacta ? 'Usar vista cómoda' : 'Usar vista compacta', grupo: 'Acciones', icono: compacta ? 'fa-expand-alt' : 'fa-compress-alt',
                    claves: 'densidad vista compacta comoda filas', ejecutar: () => alternarDensidad(),
                });
            }
            lista.push({ texto: 'Cerrar sesión', grupo: 'Acciones', icono: 'fa-sign-out-alt', claves: 'salir logout sesion', ejecutar: () => handleLogout() });
            return lista;
        }

        function construir() {
            dlg = document.createElement('dialog');
            dlg.className = 'paleta';
            dlg.setAttribute('aria-label', 'Paleta de comandos');
            dlg.innerHTML = `
                <div class="paleta-campo">
                    <i class="fas fa-search" aria-hidden="true"></i>
                    <input type="text" class="paleta-input" role="combobox" aria-expanded="true" aria-controls="paleta-lista"
                           aria-autocomplete="list" aria-label="Buscar una pantalla o una acción" placeholder="Buscar una pantalla o una acción…"
                           autocomplete="off" spellcheck="false">
                </div>
                <ul class="paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados"></ul>
                <p class="paleta-vacio" hidden>No hay resultados.</p>
                <p class="paleta-estado sr-only" role="status" aria-live="polite"></p>
                <p class="paleta-ayuda" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> moverse <kbd>Enter</kbd> elegir <kbd>Esc</kbd> cerrar</p>`;
            document.body.appendChild(dlg);

            const input = dlg.querySelector('.paleta-input');
            const lista = dlg.querySelector('.paleta-lista');
            const vacio = dlg.querySelector('.paleta-vacio');
            const estado = dlg.querySelector('.paleta-estado');
            let visibles = [];
            let activo = 0;

            function marcar(i) {
                activo = visibles.length ? (i + visibles.length) % visibles.length : 0;
                [...lista.children].forEach((li, n) => li.setAttribute('aria-selected', String(n === activo)));
                const li = lista.children[activo];
                if (li) {
                    input.setAttribute('aria-activedescendant', li.id);
                    li.scrollIntoView({ block: 'nearest' });
                } else {
                    input.removeAttribute('aria-activedescendant');
                }
            }

            function filtrar() {
                const q = normalizar(input.value.trim());
                visibles = comandos().filter(c => !q || normalizar(`${c.texto} ${c.claves}`).includes(q));
                lista.replaceChildren(...visibles.map((c, n) => {
                    const li = document.createElement('li');
                    li.id = `paleta-op-${n}`;
                    li.setAttribute('role', 'option');
                    li.className = 'paleta-opcion';
                    const i = document.createElement('i');
                    i.className = `fas ${c.icono}`;
                    i.setAttribute('aria-hidden', 'true');
                    const t = document.createElement('span');
                    t.className = 'paleta-texto';
                    t.textContent = c.texto;
                    const g = document.createElement('span');
                    g.className = 'paleta-grupo';
                    g.textContent = c.grupo;
                    li.append(i, t, g);
                    li.addEventListener('click', () => ejecutar(c));
                    li.addEventListener('mousemove', () => { if (activo !== n) marcar(n); });
                    return li;
                }));
                vacio.hidden = visibles.length > 0;
                estado.textContent = visibles.length ? `${visibles.length} resultado${visibles.length === 1 ? '' : 's'}` : 'No hay resultados';
                marcar(0);
            }

            function ejecutar(c) {
                dlg.close();
                c.ejecutar();
            }

            input.addEventListener('input', filtrar);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); marcar(activo + 1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(activo - 1); }
                else if (e.key === 'Home') { e.preventDefault(); marcar(0); }
                else if (e.key === 'End') { e.preventDefault(); marcar(visibles.length - 1); }
                else if (e.key === 'Enter') { e.preventDefault(); if (visibles[activo]) ejecutar(visibles[activo]); }
            });
            // Un clic en el fondo cierra (acá no hay nada que perder).
            dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
            dlg.addEventListener('close', () => { dlg.remove(); dlg = null; });
            dlg.refrescar = () => { input.value = ''; filtrar(); };
        }

        function abrir() {
            if (dlg) return;
            const disparador = document.activeElement;
            construir();
            dlg.refrescar();
            dlg.addEventListener('close', () => {
                if (disparador && disparador.isConnected && typeof disparador.focus === 'function') disparador.focus();
            }, { once: true });
            dlg.showModal();
            dlg.querySelector('.paleta-input').focus();
        }

        if (abrirBtn) abrirBtn.addEventListener('click', abrir);
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                if (dlg) dlg.close();
                else abrir();
            }
        });
    }

    /**
     * Cajón de navegación en móvil (<= 768px). Abrir mueve el foco al primer destino,
     * Escape lo cierra y devuelve el foco al botón, y al ensanchar la ventana se cierra
     * solo (en escritorio la barra es horizontal y el cajón no existe).
     */
    function initCajon() {
        const toggleBtn = document.getElementById('navbar-toggle');
        const collapseEl = document.getElementById('navbar-collapse');
        const overlayEl = document.getElementById('navbar-overlay');
        if (!toggleBtn || !collapseEl) return;

        function fijar(abierto, { devolverFoco = false } = {}) {
            collapseEl.classList.toggle('open', abierto);
            toggleBtn.classList.toggle('open', abierto);
            toggleBtn.setAttribute('aria-expanded', String(abierto));
            toggleBtn.setAttribute('aria-label', abierto ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
            if (overlayEl) overlayEl.classList.toggle('open', abierto);
            document.body.style.overflow = abierto ? 'hidden' : '';
            if (abierto) {
                const primero = collapseEl.querySelector('.nav-item');
                if (primero) primero.focus();
            } else if (devolverFoco) {
                toggleBtn.focus();
            }
        }

        const estaAbierto = () => collapseEl.classList.contains('open');

        toggleBtn.addEventListener('click', () => fijar(!estaAbierto()));
        if (overlayEl) overlayEl.addEventListener('click', () => fijar(false));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && estaAbierto()) fijar(false, { devolverFoco: true });
        });

        if (global.matchMedia) {
            global.matchMedia('(min-width: 769px)').addEventListener('change', (e) => {
                if (e.matches && estaAbierto()) fijar(false);
            });
        }
    }

    global.navbarComponent = {
        init: initNavbar
    };
})(window);
