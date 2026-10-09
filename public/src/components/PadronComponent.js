/**
 * Componente de Padrón Electoral para el cliente web
 */
class PadronComponent {
    constructor() {
        this.container = null;
        this.estado = {
            paginaActual: 1,
            filtros: {},
            ordenamiento: { campo: 'apellido', direccion: 'asc' },
            cargando: false
        };
        this.elementos = {};
        // Timer de la vigilancia de cambios ajenos. Uno solo: reiniciarla lo reemplaza.
        this.vigilanciaId = null;
        // DNI de la ficha que se está pidiendo al servidor, para descartar la respuesta
        // de un clic que quedó viejo.
        this.fichaPedida = null;
        // Numero de la ultima peticion de tabla: una respuesta vieja que llega tarde no
        // pisa a una mas nueva (FE-008), mismo criterio que fichaPedida.
        this.peticionTabla = 0;
        this.rateLimit = {
            retries: 0,
            timerId: null,
            lastAction: null
        };
    }

    /**
     * Inicializar el componente
     */
    async init(containerId = 'padron-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Contenedor ${containerId} no encontrado`);
        }

        // Verificar conexión con API
        try {
            const apiDisponible = await window.apiService.verificarEstado();
            if (!apiDisponible) {
                this.mostrarError('No se puede conectar con el servicio del padrón. Revisá tu conexión y volvé a intentar.');
                return false;
            }
        } catch (error) {
            console.error('Error al verificar la API:', error);
            this.mostrarError('No se pudo verificar la conexión con el servidor. Revisá tu conexión y volvé a intentar.');
            return false;
        }

        try {
            this.crearInterfaz();
        } catch (error) {
            console.error('Error al crear la interfaz:', error);
            this.mostrarError('No se pudo armar la pantalla del padrón.');
            return false;
        }

        try {
            this.inicializarEventos();
        } catch (error) {
            console.error('Error al inicializar eventos:', error);
        }

        // En un teléfono cada fila es una tarjeta de ~160 px: con 50 por página son más de
        // 8000 px de scroll. Se arranca con 10 y se puede subir.
        if (window.innerWidth <= 768) {
            document.getElementById('registros-por-pagina').value = '10';
        }

        // El dashboard del encargado de relevamiento linkea aca con
        // "?sinRelevar=1" para arrancar directo en la lista de pendientes.
        this.aplicarFiltroDesdeUrl();

        try {
            await this.cargarDatos();
        } catch (error) {
            console.error('Error al cargar datos:', error);
            // No fallar completamente si los datos no cargan
        }

        // Ficha pedida desde la URL: solo se puede abrir una que este en el listado ya cargado.
        if (this.dniAAbrir) {
            await this.abrirPanel(this.dniAAbrir);
            this.dniAAbrir = null;
        }

        // Se arranca al final y no antes: sin tabla dibujada no hay filas que marcar.
        this.iniciarVigilanciaDeCambios();

        return true;
    }

    /**
     * Crear la interfaz del componente
     */
    crearInterfaz() {
        // Los nombres de los botones de acción llevan `aria-label`: en un teléfono el texto
        // (`.btn-text`) se oculta con display:none, y un botón sin texto visible quedaba sin
        // nombre accesible.
        this.container.innerHTML = `
            <div class="padron-header">
                <div class="padron-title">
                    <h1><i class="fas fa-list" aria-hidden="true"></i> Padrón electoral</h1>
                    <p class="padron-subtitle">Gestión y relevamiento del padrón electoral</p>
                </div>
                <div class="padron-actions">
                    <button type="button" id="btn-nuevo-votante" class="btn btn-primary" data-requires-permission="padron.edit"
                            aria-label="Nuevo votante" title="Agregar un votante al padrón">
                        <i class="fas fa-user-plus" aria-hidden="true"></i> <span class="btn-text">Nuevo votante</span>
                    </button>
                    <button type="button" id="btn-exportar" class="btn btn-secondary" data-requires-permission="padron.export"
                            aria-label="Exportar relevamientos en CSV" title="Exportar relevamientos en CSV">
                        <i class="fas fa-download" aria-hidden="true"></i> <span class="btn-text">Exportar</span>
                    </button>
                    <button type="button" id="btn-exportar-padron" class="btn btn-secondary" data-requires-permission="padron.export"
                            aria-label="Exportar el padrón completo en CSV" title="Exportar el padrón completo en CSV">
                        <i class="fas fa-file-csv" aria-hidden="true"></i> <span class="btn-text">Exportar padrón</span>
                    </button>
                    <button type="button" id="btn-filtros-mobile" class="btn btn-outline mobile-only"
                            aria-label="Mostrar filtros" aria-expanded="false" aria-controls="filtros-container">
                        <i class="fas fa-filter" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            <div id="estadisticas-rapidas" class="padron-estadisticas-rapidas">
                <!-- Estadísticas se cargan dinámicamente -->
            </div>

            <div id="padron-rate-banner" class="padron-banner hidden" role="status" aria-live="polite">
                <div class="padron-banner-content">
                    <i class="fas fa-hourglass-half" aria-hidden="true"></i>
                    <span id="padron-rate-banner-text">Límite de solicitudes alcanzado.</span>
                </div>
                <button type="button" id="padron-rate-banner-retry" class="btn btn-secondary btn-sm">Reintentar</button>
            </div>

            <div class="padron-filtros" id="filtros-container">
                <div class="filtros-header mobile-only">
                    <h2><i class="fas fa-filter" aria-hidden="true"></i> Filtros</h2>
                    <button type="button" id="btn-cerrar-filtros" class="btn-close" aria-label="Cerrar filtros">
                        <i class="fas fa-times" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="filtros-row">
                    <div class="filtro-item">
                        <label for="filtro-busqueda">Buscar</label>
                        <input type="search" id="filtro-busqueda" placeholder="DNI, nombre o apellido…" autocomplete="off" spellcheck="false">
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-circuito">Circuito</label>
                        <select id="filtro-circuito">
                            <option value="">Todos los circuitos</option>
                        </select>
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-sexo">Sexo</label>
                        <select id="filtro-sexo">
                            <option value="">Todos</option>
                            <option value="M">Masculino</option>
                            <option value="F">Femenino</option>
                        </select>
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-opcion-politica">Opción política</label>
                        <select id="filtro-opcion-politica">
                            <option value="">Todas</option>
                        </select>
                    </div>
                    <!-- Sin <span class="checkmark">: era el resto de un patrón de casilla
                         personalizada que acá nunca se conectó. La casilla nativa no
                         estaba oculta, así que se dibujaban las dos —la real y el cuadro
                         vacío del span— una al lado de la otra. -->
                    <div class="filtro-item filtro-checkbox">
                        <label for="filtro-sin-relevamiento">
                            <input type="checkbox" id="filtro-sin-relevamiento">
                            Sin relevar
                        </label>
                    </div>
                    <div class="filtro-acciones">
                        <button type="button" id="btn-aplicar-filtros" class="btn btn-primary btn-sm">Filtrar</button>
                        <button type="button" id="btn-limpiar-filtros" class="btn btn-secondary btn-sm">Limpiar</button>
                    </div>
                </div>
            </div>

            <div class="padron-tabla-container">
                <div class="tabla-header">
                    <!-- Región viva: el resumen ("Mostrando 1 a 50 de 400") se anuncia al
                         cambiar de página o de filtro, que es lo único que dice que algo pasó. -->
                    <div class="tabla-info" id="tabla-info" role="status">
                        Cargando…
                    </div>
                    <div class="tabla-acciones">
                        <label for="registros-por-pagina">Mostrar</label>
                        <select id="registros-por-pagina">
                            <option value="10">10</option>
                            <option value="25">25</option>
                            <option value="50" selected>50</option>
                            <option value="100">100</option>
                            <option value="200">200</option>
                        </select>
                        <span>registros</span>
                    </div>
                </div>

                <!-- Región enfocable y con nombre: sin eso el teclado no puede desplazar la
                     tabla cuando es más ancha que la pantalla. -->
                <div class="tabla-responsive" role="region" aria-label="Listado del padrón" tabindex="0">
                    <table class="tabla-padron" id="tabla-padron">
                        <caption class="sr-only">Padrón electoral: votantes y su opción política relevada</caption>
                        <thead>
                            <tr>
                                <!-- Las columnas ordenables son botones dentro del <th>, y el
                                     estado va en aria-sort: antes eran <th> con clic, que el
                                     teclado no podía operar ni un lector de pantalla anunciar. -->
                                <th scope="col" class="sortable" aria-sort="none"><button type="button" class="th-orden" data-campo="dni">DNI</button></th>
                                <th scope="col" class="sortable" aria-sort="ascending"><button type="button" class="th-orden" data-campo="apellido">Apellido</button></th>
                                <th scope="col" class="sortable" aria-sort="none"><button type="button" class="th-orden" data-campo="nombre">Nombre</button></th>
                                <th scope="col" class="sortable" aria-sort="none"><button type="button" class="th-orden" data-campo="edad">Edad</button></th>
                                <th scope="col" class="sortable" aria-sort="none"><button type="button" class="th-orden" data-campo="circuito">Circuito</button></th>
                                <th scope="col" class="sortable" aria-sort="none"><button type="button" class="th-orden" data-campo="sexo">Sexo</button></th>
                                <th scope="col">Opción política</th>
                                <!-- Observación, Teléfono y Condiciones dejaron de ser
                                     columnas: eran seis controles por fila que sólo se
                                     usan en una minoría de los registros. Ahora se
                                     cargan en el panel lateral, y acá queda una marca
                                     de sólo lectura con lo que ya está cargado. -->
                                <th scope="col">Datos</th>
                                <th scope="col"><span class="sr-only">Abrir ficha</span></th>
                            </tr>
                        </thead>
                        <tbody id="tabla-body">
                            <!-- Los datos se cargan dinámicamente -->
                        </tbody>
                    </table>
                </div>

                <div class="paginacion-container" id="paginacion-container">
                    <!-- Paginación se carga dinámicamente -->
                </div>
            </div>

            <!-- Nuevo votante: <dialog> nativo (foco atrapado, Escape, fondo inerte). Es un
                 <form> de verdad: Enter envía, y los errores se muestran junto a cada campo. -->
            <dialog id="modal-nuevo-votante" class="dialogo dialogo--ancho" aria-labelledby="nuevo-votante-titulo">
                <form id="form-nuevo-votante" novalidate>
                    <div class="dialogo-cabecera">
                        <span class="dialogo-icono"><i class="fas fa-user-plus" aria-hidden="true"></i></span>
                        <div>
                            <h2 class="dialogo-titulo" id="nuevo-votante-titulo">Nuevo votante</h2>
                            <p class="modal-subtitle">Completá los datos para registrar un nuevo elector</p>
                        </div>
                        <button type="button" class="btn btn-ghost btn-icono btn-sm dialogo-cerrar" data-action="cerrarModalNuevoVotante" aria-label="Cerrar">
                            <i class="fas fa-times" aria-hidden="true"></i>
                        </button>
                    </div>
                    <div class="dialogo-cuerpo">
                        <!-- Sección: Identificación -->
                        <div class="form-section">
                            <div class="form-section-header">
                                <i class="fas fa-id-card" aria-hidden="true"></i>
                                <span>Identificación</span>
                                <span class="form-section-badge required-badge">Obligatorio</span>
                            </div>
                            <div class="form-group">
                                <label for="nuevo-dni">DNI <span class="required" aria-hidden="true">*</span></label>
                                <div class="input-wrapper">
                                    <i class="fas fa-fingerprint input-icon" aria-hidden="true"></i>
                                    <input type="text" id="nuevo-dni" class="form-input has-icon" placeholder="Ej: 12345678" required aria-required="true"
                                           maxlength="10" inputmode="numeric" autocomplete="off" spellcheck="false" autofocus
                                           aria-describedby="dni-helper nuevo-dni-error">
                                    <span class="input-validation-icon" id="dni-validation-icon" aria-hidden="true"></span>
                                </div>
                                <span class="form-helper" id="dni-helper">Solo números, sin puntos ni espacios</span>
                                <p class="campo-error" id="nuevo-dni-error"></p>
                            </div>
                        </div>

                        <!-- Sección: Datos Personales -->
                        <div class="form-section">
                            <div class="form-section-header">
                                <i class="fas fa-user" aria-hidden="true"></i>
                                <span>Datos personales</span>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="nuevo-apellido">Apellido <span class="required" aria-hidden="true">*</span></label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-user input-icon" aria-hidden="true"></i>
                                        <input type="text" id="nuevo-apellido" class="form-input has-icon" placeholder="Ej: García" required aria-required="true"
                                               autocomplete="off" aria-describedby="nuevo-apellido-error">
                                    </div>
                                    <p class="campo-error" id="nuevo-apellido-error"></p>
                                </div>
                                <div class="form-group">
                                    <label for="nuevo-nombre">Nombre <span class="required" aria-hidden="true">*</span></label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-user input-icon" aria-hidden="true"></i>
                                        <input type="text" id="nuevo-nombre" class="form-input has-icon" placeholder="Ej: Juan Carlos" required aria-required="true"
                                               autocomplete="off" aria-describedby="nuevo-nombre-error">
                                    </div>
                                    <p class="campo-error" id="nuevo-nombre-error"></p>
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="nuevo-anio-nac">Año de nacimiento <span class="required" aria-hidden="true">*</span></label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-calendar-alt input-icon" aria-hidden="true"></i>
                                        <input type="number" id="nuevo-anio-nac" class="form-input has-icon" placeholder="Ej: 1990" required aria-required="true"
                                               min="1900" max="${new Date().getFullYear()}" inputmode="numeric" autocomplete="off"
                                               aria-describedby="nuevo-anio-nac-error">
                                    </div>
                                    <p class="campo-error" id="nuevo-anio-nac-error"></p>
                                </div>
                                <div class="form-group">
                                    <label for="nuevo-sexo">Sexo</label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-venus-mars input-icon" aria-hidden="true"></i>
                                        <select id="nuevo-sexo" class="form-input has-icon">
                                            <option value="">Seleccionar</option>
                                            <option value="M">Masculino</option>
                                            <option value="F">Femenino</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Sección: Ubicación -->
                        <div class="form-section">
                            <div class="form-section-header">
                                <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
                                <span>Ubicación</span>
                                <span class="form-section-badge optional-badge">Opcional</span>
                            </div>
                            <div class="form-group">
                                <label for="nuevo-domicilio">Domicilio</label>
                                <div class="input-wrapper">
                                    <i class="fas fa-home input-icon" aria-hidden="true"></i>
                                    <input type="text" id="nuevo-domicilio" class="form-input has-icon" placeholder="Ej: Av. San Martín 1234" autocomplete="off">
                                </div>
                            </div>
                            <div class="form-group">
                                <label for="nuevo-circuito">Circuito electoral</label>
                                <div class="input-wrapper">
                                    <i class="fas fa-map-signs input-icon" aria-hidden="true"></i>
                                    <select id="nuevo-circuito" class="form-input has-icon">
                                        <option value="">Seleccionar circuito</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div id="error-nuevo-votante" class="form-error" role="alert" hidden>
                            <i class="fas fa-exclamation-circle" aria-hidden="true"></i>
                            <span id="error-nuevo-votante-text"></span>
                        </div>
                    </div>
                    <div class="dialogo-pie">
                        <button type="button" class="btn btn-secondary" data-action="cerrarModalNuevoVotante">Cancelar</button>
                        <button type="submit" id="btn-guardar-votante" class="btn btn-primary">
                            <i class="fas fa-save" aria-hidden="true"></i> Guardar votante
                        </button>
                    </div>
                </form>
            </dialog>
        `;

        // Guardar referencias a elementos importantes
        this.elementos = {
            tabla: document.getElementById('tabla-padron'),
            tbody: document.getElementById('tabla-body'),
            info: document.getElementById('tabla-info'),
            paginacion: document.getElementById('paginacion-container'),
            estadisticasRapidas: document.getElementById('estadisticas-rapidas'),
            rateBanner: document.getElementById('padron-rate-banner'),
            rateBannerText: document.getElementById('padron-rate-banner-text'),
            rateBannerRetry: document.getElementById('padron-rate-banner-retry')
        };

        // Gancho de app.js: oculta los controles que requieren un permiso que no se tiene.
        if (typeof this.alCrearInterfaz === 'function') this.alCrearInterfaz();
    }

    /**
     * Inicializar eventos
     */
    inicializarEventos() {
        // Helper para asignar eventos de forma segura (soporta botones ocultos por permisos)
        const on = (id, event, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(event, handler);
        };

        // Botones principales (pueden ser null si el usuario no tiene el permiso requerido)
        on('btn-nuevo-votante', 'click', () => this.abrirModalNuevoVotante());
        on('btn-exportar',      'click', () => this.exportarDatos());
        on('btn-exportar-padron', 'click', () => this.exportarPadron());
        on('padron-rate-banner-retry', 'click', () => this.reintentarRateLimit());

        // Botones móviles
        on('btn-filtros-mobile', 'click', () => this.toggleFiltrosMobile());
        on('btn-cerrar-filtros', 'click', () => this.cerrarFiltrosMobile());

        // Filtros
        on('btn-aplicar-filtros', 'click', () => this.aplicarFiltros());
        on('btn-limpiar-filtros', 'click', () => this.limpiarFiltros());
        on('filtro-busqueda', 'keydown', (e) => { if (e.key === 'Enter') this.aplicarFiltros(); });

        // Auto-aplicar filtros en móvil cuando cambian
        if (window.innerWidth <= 768) {
            on('filtro-busqueda',        'input',  this.debounce(() => this.aplicarFiltros(), 500));
            on('filtro-circuito',        'change', () => this.aplicarFiltros());
            on('filtro-sexo',            'change', () => this.aplicarFiltros());
            on('filtro-opcion-politica', 'change', () => this.aplicarFiltros());
            on('filtro-sin-relevamiento','change', () => this.aplicarFiltros());
        }

        // Cambiar registros por página
        on('registros-por-pagina', 'change', () => this.cambiarRegistrosPorPagina());

        // El formulario de nuevo votante es un <form> de verdad: Enter en cualquier campo lo
        // envía (antes el submit estaba bloqueado y solo guardaba el clic en el botón).
        on('form-nuevo-votante', 'submit', (e) => {
            e.preventDefault();
            this.guardarNuevoVotante();
        });

        // Validación en tiempo real del formulario nuevo votante
        this.inicializarValidacionNuevoVotante();

        // Ordenamiento de tabla: los encabezados ordenables son botones.
        if (this.elementos.tabla) {
            this.elementos.tabla.addEventListener('click', (e) => {
                const boton = e.target.closest('.th-orden');
                if (boton) this.cambiarOrdenamiento(boton.dataset.campo);
            });
        }

        // Lo que sigue se cuelga de `document` / `window` y por eso se registra UNA vez:
        // si el componente se reinicializara, cada init sumaría un listener más y una sola
        // acción se despacharía varias veces.
        if (this._eventosGlobales) return;
        this._eventosGlobales = true;

        // Despacho delegado de las acciones que antes eran onclick= inline: el
        // modal de nuevo votante y la tabla están dentro de this.container, pero el
        // panel de ficha se cuelga de document.body (ver abrirPanel), así que el
        // listener va en document y se filtra por pertenencia a cualquiera de los dos.
        document.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            if (!(this.container?.contains(el) || el.closest('#panel-votante'))) return;

            const accion = el.dataset.action;
            if (typeof this[accion] !== 'function') return;

            // El radio de opción política despacha por 'change', no por 'click': el
            // propio click en el radio dispara los dos eventos, y despachar acá
            // también mandaba una segunda escritura con la opción sin definir.
            if (accion === 'cambiarOpcionPolitica') return;

            if ('dni' in el.dataset) this[accion](el.dataset.dni);
            else if ('pagina' in el.dataset) this[accion](Number(el.dataset.pagina));
            else this[accion]();
        });

        // Igual, pero para el 'change' del radio de opción política.
        document.addEventListener('change', (e) => {
            const el = e.target.closest('[data-action]');
            if (!el || !this.container?.contains(el)) return;
            const accion = el.dataset.action;
            if (accion === 'cambiarOpcionPolitica') {
                this.cambiarOpcionPolitica(el.dataset.dni, el.dataset.opcion);
            }
        });

        // Evento de redimensionado de ventana
        window.addEventListener('resize', () => this.handleResize());

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (document.getElementById('filtros-container')?.classList.contains('show')) {
                this.cerrarFiltrosMobile({ devolverFoco: true });
            }
        });

        // Cerrar filtros móviles al tocar fuera (en el overlay)
        document.addEventListener('click', (e) => {
            const filtrosContainer = document.getElementById('filtros-container');
            const btnFiltrosMobile = document.getElementById('btn-filtros-mobile');
            if (filtrosContainer && filtrosContainer.classList.contains('show') &&
                !filtrosContainer.contains(e.target) &&
                (!btnFiltrosMobile || !btnFiltrosMobile.contains(e.target))) {
                this.cerrarFiltrosMobile();
            }
        });
    }

    /**
     * Cargar datos iniciales
     */
    async cargarDatos() {
        try {
            this.mostrarCargando(true);
            
            // Cargar filtros disponibles
            const filtrosOk = await this.cargarFiltrosDisponibles();
            if (filtrosOk === false) return;
            
            // Cargar estadísticas rápidas
            const statsOk = await this.actualizarEstadisticasRapidas();
            if (statsOk === false) return;
            
            // Cargar votantes
            const tablaOk = await this.actualizarTabla();
            if (tablaOk === false) return;
            
        } catch (error) {
            this.mostrarError(`Error al cargar datos: ${error.message}`);
        } finally {
            this.mostrarCargando(false);
        }
    }

    /**
     * Actualizar tabla de votantes
     */
    async actualizarTabla() {
        const peticion = ++this.peticionTabla;
        try {
            this.mostrarCargando(true);

            const parametros = {
                pagina: this.estado.paginaActual,
                limite: document.getElementById('registros-por-pagina').value,
                ...this.estado.filtros,
                ordenCampo: this.estado.ordenamiento.campo,
                ordenDireccion: this.estado.ordenamiento.direccion,
                includeDetalles: true
            };

            const respuesta = await window.apiService.obtenerVotantes(parametros);
            if (peticion !== this.peticionTabla) return false;

            if (!respuesta || !Array.isArray(respuesta.data)) {
                if (respuesta?.rateLimited) {
                    this.programarReintentoRateLimit(
                        'Límite de solicitudes alcanzado.',
                        () => this.actualizarTabla()
                    );
                    this.renderizarTabla([]);
                    this.renderizarPaginacion({ paginaActual: 1, totalPaginas: 1 });
                    this.actualizarInfoTabla({ inicio: 0, fin: 0, totalRegistros: 0 });
                } else {
                    this.renderizarErrorTabla('No se pudo cargar la lista de votantes. Revisá tu conexión y volvé a intentar.');
                }
                return false;
            }

            const detallesIncluidos = respuesta?.detallesIncluidos === true;
            // El backend siempre manda los detalles con includeDetalles: si esto aparece, el
            // fallback N+1 de abajo esta corriendo y conviene saber por que (FE-032).
            if (!detallesIncluidos) console.warn('El backend no incluyo los detalles: se pide uno por uno (N+1).');
            const votantesConDetalles = detallesIncluidos
                ? respuesta.data
                : await this.enriquecerConDetalles(respuesta.data);
            if (peticion !== this.peticionTabla) return false;

            this.renderizarTabla(votantesConDetalles);
            this.renderizarPaginacion(respuesta.paginacion);
            this.actualizarInfoTabla(respuesta.paginacion);
            this.resetRateLimitState();
            return true;

        } catch (error) {
            if (peticion !== this.peticionTabla) return false;
            console.error('Error al cargar votantes:', error);
            this.renderizarErrorTabla('No se pudieron cargar los votantes. Revisá tu conexión y volvé a intentar.');
            return false;
        } finally {
            if (peticion === this.peticionTabla) this.mostrarCargando(false);
        }
    }

    /**
     * La carga de la tabla falló: el error ocupa su lugar, con salida. Antes era un toast
     * de cinco segundos sobre una tabla vacía o con datos viejos, sin forma de reintentar.
     */
    renderizarErrorTabla(texto) {
        this.elementos.tbody.innerHTML = `
            <tr>
                <td colspan="9" class="sin-datos">
                    ${estados.error({ texto, reintentar: 'actualizarTabla' })}
                </td>
            </tr>
        `;
        this.renderizarPaginacion({ paginaActual: 1, totalPaginas: 1 });
        this.actualizarInfoTabla({ inicio: 0, fin: 0, totalRegistros: 0 });
    }

    /**
     * Renderizar tabla con datos
     */
    renderizarTabla(votantes) {
        if (!Array.isArray(votantes) || votantes.length === 0) {
            this.elementos.tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="sin-datos">
                        ${estados.vacio({
                            icono: 'fa-users',
                            titulo: 'No se encontraron votantes',
                            texto: 'Probá con otros filtros o limpiá la búsqueda.',
                            accion: { texto: 'Limpiar filtros', accion: 'limpiarFiltros' }
                        })}
                    </td>
                </tr>
            `;
            return;
        }

        // Se guarda lo que hay en pantalla para saber qué filas marcar cuando otra
        // persona toque una de ellas. La ficha ya no se arma con esto: `abrirPanel`
        // relee del servidor, porque este snapshot envejece sin avisar.
        this.estado.votantesEnPantalla = votantes;

        // Desde acá se cuentan los cambios ajenos: lo que se acaba de dibujar está al
        // día por definición, así que las marcas viejas dejan de tener sentido.
        this.estado.tablaCargadaEn = new Date().toISOString();

        // Todo dato de votante pasa por escaparHtml antes de entrar al markup. Los
        // datos llegan por carga manual y por importación de CSV: una observación con
        // `</textarea><script>` se ejecutaba en la pantalla de cualquiera que abriera
        // esta página. Incluye los atributos —`title`, `data-dni`—, que es justo lo que
        // el truco de textContent/innerHTML no cubre.
        this.elementos.tbody.innerHTML = votantes.map(item => {
            const { votante, relevamiento } = item;
            const opcionPolitica = relevamiento?.opcionPolitica || '';
            const dni = escaparHtml(votante.dni);
            const apellido = escaparHtml(votante.apellido);
            const nombre = escaparHtml(votante.nombre);

            return `
                <tr class="fila-votante ${relevamiento ? 'con-relevamiento' : 'sin-relevamiento'}" data-dni="${dni}">
                    <td class="dni" data-label="DNI">${dni}</td>
                    <td class="apellido" data-label="Apellido">${apellido}</td>
                    <td data-label="Nombre">${nombre}</td>
                    <td class="edad" data-label="Edad">${escaparHtml(votante.edad)}</td>
                    <td data-label="Circuito">${escaparHtml(votante.circuito)}</td>
                    <td data-label="Sexo">${escaparHtml(votante.sexo)}</td>
                    <td data-label="Opción política">
                        <div class="radio-group" role="radiogroup" aria-label="Opción política de ${apellido}, ${nombre}">
                            ${this.renderizarRadioButtons(votante.dni, opcionPolitica)}
                        </div>
                    </td>
                    <td data-label="Datos" class="marcas-cell">
                        ${this.renderizarMarcas(item)}
                    </td>
                    <td class="acciones" data-label="Abrir">
                        <button type="button" class="btn-abrir-panel"
                                data-action="abrirPanel" data-dni="${dni}"
                                title="Abrir ficha de ${apellido}, ${nombre}"
                                aria-label="Abrir ficha de ${apellido}, ${nombre}">
                            <i class="fas fa-chevron-right" aria-hidden="true"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Marcas de sólo lectura de la fila: qué hay cargado, sin poder editarlo.
     *
     * Reemplaza a las tres columnas de carga. La diferencia no es sólo de espacio: una
     * columna de checkboxes obliga a leer cuatro casillas para saber si alguna está
     * marcada, mientras que acá sólo aparece lo que efectivamente aplica. Una fila sin
     * nada cargado no muestra nada, que es la información correcta.
     */
    renderizarMarcas(item) {
        const { relevamiento, detalle } = item;
        const marcas = [];

        if (relevamiento?.telefono) marcas.push({ icono: 'fa-id-card', texto: 'Tiene teléfono' });
        if (relevamiento?.observacion) marcas.push({ icono: 'fa-comment', texto: 'Tiene observación' });

        const condiciones = [
            ['esNuevoVotante', 'fa-user-plus', 'Nuevo votante', 'nuevo'],
            ['estaFallecido', 'fa-cross', 'Fallecido', 'fallecido'],
            ['esEmpleadoMunicipal', 'fa-building', 'Empleado municipal', 'empleado'],
            ['recibeAyudaSocial', 'fa-hands-helping', 'Recibe ayuda social', 'ayuda'],
        ];

        for (const [clave, icono, texto, variante] of condiciones) {
            if (detalle?.[clave]) marcas.push({ icono, texto, variante });
        }

        if (marcas.length === 0) {
            return '<span class="sin-marcas"><span aria-hidden="true">—</span><span class="sr-only">Sin datos cargados</span></span>';
        }

        // role="img": un <i> con aria-label y sin rol no tiene nombre válido (axe: 34 nodos
        // por página), así que el lector de pantalla no leía qué marca era cada ícono.
        return `<div class="marcas">${marcas.map(m =>
            `<i class="fas ${m.icono} marca${m.variante ? ' marca-' + m.variante : ''}" role="img" title="${m.texto}" aria-label="${m.texto}"></i>`
        ).join('')}</div>`;
    }

    /**
     * Abre la ficha del votante en el panel lateral.
     *
     * Acá va todo lo que antes vivía repetido en cada fila: teléfono, observación y las
     * cuatro condiciones. El cambio de fondo es que la carga deja de competir con la
     * lectura — la tabla sirve para encontrar a alguien, el panel para cargarle datos—,
     * y de paso la página pasa de unos 350 controles de formulario a unos 45.
     */
    async abrirPanel(dni) {
        const item = (this.estado.votantesEnPantalla || []).find(v => String(v.votante.dni) === String(dni));
        if (!item) return;

        // Abrir otra ficha con cambios sin guardar en la actual los perdía en silencio.
        if (!(await this.confirmarDescarte())) return;

        const { votante } = item;

        // Hacia dónde vuelve el foco al cerrar: el botón que se tocó para abrir.
        const disparador = document.activeElement;
        this._disparadorPanel = disparador && disparador.classList?.contains('btn-abrir-panel') ? disparador : null;

        // Los datos cargables se releen del servidor; del listado sólo sale la identidad
        // del votante, que no cambia. Antes la ficha se armaba entera con el snapshot de
        // la última vez que se tocó un filtro: una pestaña abierta hace veinte minutos
        // mostraba —y guardaba encima de— veinte minutos de trabajo ajeno.
        let relevamiento = item.relevamiento;
        let detalle = item.detalle;
        let firma = null;

        // La ficha vieja se cierra antes de esperar: sin esto, la página se queda un
        // instante mostrando la anterior como si nada hubiera pasado.
        this.cerrarPanel({ devolverFoco: false });

        // Ahora que abrir implica esperar al servidor, dos clics seguidos son dos
        // lecturas en vuelo. Si la primera vuelve última, dibujaría la ficha equivocada
        // sobre el DNI que la persona realmente eligió — que es peor que no abrir nada.
        this.fichaPedida = dni;

        try {
            const [respuestaRelevamiento, respuestaDetalle] = await Promise.all([
                window.apiService.obtenerRelevamiento(dni),
                window.apiService.obtenerDetalleVotante(dni),
            ]);

            if (respuestaRelevamiento?.data) {
                relevamiento = respuestaRelevamiento.data;
                firma = respuestaRelevamiento.data.actualizadoPor || null;
            }
            if (respuestaDetalle?.data) detalle = respuestaDetalle.data;
        } catch (error) {
            // Si la relectura falla se abre igual con lo que hay en pantalla: no poder
            // refrescar no es razón para dejar a alguien sin poder cargar. Lo que no se
            // hace es fingir que el dato es fresco.
            console.warn('No se pudo releer la ficha del servidor, se abre con el listado', error);
            this.mostrarNotificacion('No se pudo verificar si la ficha cambió', 'warning');
        }

        // Entre el clic y esta línea la persona pudo haber elegido otra ficha.
        if (this.fichaPedida !== dni) return;

        const cond = detalle || {};
        const marcado = valor => (valor ? 'checked' : '');

        const panel = document.createElement('aside');
        panel.className = 'panel-votante';
        panel.id = 'panel-votante';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'panel-titulo');
        panel.dataset.dni = votante.dni;
        // La versión que esta persona realmente vio. Es lo que el servidor compara al
        // guardar: si otra escribió en el medio, no coincide y la escritura no se aplica.
        // Sale de la relectura de arriba y no del listado — mandar la versión de una
        // página cargada hace veinte minutos haría saltar el conflicto siempre, y un
        // aviso que salta siempre se aprende a ignorar.
        panel.dataset.version = relevamiento?.version ?? 0;

        panel.innerHTML = `
            <header class="panel-header">
                <div>
                    <h2 id="panel-titulo">${escaparHtml(votante.apellido)}, ${escaparHtml(votante.nombre)}</h2>
                    <p class="panel-dni">DNI ${escaparHtml(votante.dni)}</p>
                </div>
                <button type="button" class="panel-cerrar" data-action="pedirCerrarPanel" title="Cerrar" aria-label="Cerrar ficha">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </header>

            ${this.renderizarFirma(firma, relevamiento?.fechaModificacion)}

            <dl class="panel-datos">
                <div><dt>Edad</dt><dd>${escaparHtml(votante.edad)}</dd></div>
                <div><dt>Circuito</dt><dd>${escaparHtml(votante.circuito)}</dd></div>
                <div><dt>Sexo</dt><dd>${votante.sexo === 'F' ? 'Femenino' : 'Masculino'}</dd></div>
            </dl>

            <div class="panel-campo">
                <label for="panel-telefono">Teléfono</label>
                <input type="tel" id="panel-telefono" value="${escaparHtml(relevamiento?.telefono)}"
                       inputmode="tel" autocomplete="off" placeholder="Sin teléfono cargado">
            </div>

            <div class="panel-campo">
                <label for="panel-observacion">Observación</label>
                <textarea id="panel-observacion" rows="4" autocomplete="off"
                          placeholder="Sin observaciones">${escaparHtml(relevamiento?.observacion)}</textarea>
            </div>

            <fieldset class="panel-condiciones">
                <legend>Condiciones</legend>
                <label><input type="checkbox" name="esNuevoVotante" ${marcado(cond.esNuevoVotante)}> Nuevo votante</label>
                <label><input type="checkbox" name="estaFallecido" ${marcado(cond.estaFallecido)}> Fallecido</label>
                <label><input type="checkbox" name="esEmpleadoMunicipal" ${marcado(cond.esEmpleadoMunicipal)}> Empleado municipal</label>
                <label><input type="checkbox" name="recibeAyudaSocial" ${marcado(cond.recibeAyudaSocial)}> Recibe ayuda social</label>
            </fieldset>

            <!-- Error de guardado junto al botón que lo causó, no un toast que se va solo. -->
            <p class="campo-error panel-error" id="panel-error" role="alert"></p>

            <footer class="panel-acciones">
                <button type="button" class="btn btn-secondary" data-action="pedirCerrarPanel">Cancelar</button>
                <button type="button" class="btn btn-primary" id="panel-guardar" data-requires-permission="padron.edit"
                        data-action="guardarPanel">Guardar</button>
            </footer>
        `;

        document.body.appendChild(panel);
        document.querySelector(`tr[data-dni="${CSS.escape(String(dni))}"]`)?.classList.add('fila-abierta');

        // Lo que había al abrir: contra esto se decide si hay cambios sin guardar.
        this._panelInicial = this.leerPanel(panel);

        // El foco entra al panel para que se pueda cargar sin tocar el mouse, y Escape
        // lo cierra, que es lo que espera cualquiera frente a algo que se abre encima.
        panel.querySelector('#panel-telefono')?.focus();
        this._cerrarConEscape = (evento) => {
            if (evento.key !== 'Escape') return;
            // Si ya hay un diálogo encima (el de "descartar cambios"), Escape es suyo.
            if (document.querySelector('dialog[open]')) return;
            // Consumir el Escape: el diálogo de "descartar cambios" se abre DENTRO de este
            // keydown, y si el evento sigue su curso el navegador se lo aplica al diálogo
            // recién abierto y lo cierra al instante (la confirmación nunca se veía).
            evento.preventDefault();
            this.pedirCerrarPanel();
        };
        document.addEventListener('keydown', this._cerrarConEscape);
    }

    /**
     * La versión que el panel leyó, como entero.
     *
     * Ante cualquier cosa rara cae en 0, que significa "leí que esto no existía". No es
     * un default cómodo: es el valor que **no coincide** con ninguna fila existente, así
     * que en la duda el servidor responde 409 y la persona ve lo que hay. Un default
     * optimista guardaría encima.
     */
    versionDelPanel(panel) {
        const version = Number.parseInt(panel.dataset.version, 10);
        return Number.isInteger(version) && version >= 0 ? version : 0;
    }

    /**
     * Muestra un conflicto de edición dentro del panel, sin cerrarlo.
     *
     * La regla de acá: **lo que la persona escribió no se pierde por ningún camino.** Se
     * queda en los campos, y al lado aparece lo que hay en el servidor con quién lo puso.
     * Decide una persona: nadie mergea dos textos automáticamente, porque concatenarlos
     * inventaría contenido que no escribió ninguno de los dos.
     */
    mostrarConflicto(panel, actual) {
        panel.querySelector('.panel-conflicto')?.remove();

        const mio = {
            telefono: panel.querySelector('#panel-telefono').value,
            observacion: panel.querySelector('#panel-observacion').value,
        };

        const suyo = {
            telefono: actual?.telefono || '',
            observacion: actual?.observacion || '',
        };

        const quien = actual?.actualizadoPor ? escaparHtml(actual.actualizadoPor) : 'Otra persona';
        const campos = ['telefono', 'observacion'].filter(campo => mio[campo] !== suyo[campo]);

        const aviso = document.createElement('div');
        aviso.className = 'panel-conflicto';
        aviso.innerHTML = `
            <p class="conflicto-titulo">
                <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
                ${quien} modificó esta ficha mientras la editabas
            </p>
            ${campos.map(campo => `
                <div class="conflicto-campo">
                    <span class="conflicto-etiqueta">${campo === 'telefono' ? 'Teléfono' : 'Observación'} en el servidor</span>
                    <p class="conflicto-valor">${escaparHtml(suyo[campo]) || '<em>vacío</em>'}</p>
                </div>
            `).join('')}
            <div class="conflicto-acciones">
                <button type="button" class="btn btn-secondary" data-action="descartarMisCambios">
                    Quedarme con lo del servidor
                </button>
                <button type="button" class="btn btn-primary" data-action="guardarPanel">
                    Guardar lo mío igual
                </button>
            </div>
        `;

        // La versión se actualiza a la del servidor: si la persona decide pisar, el
        // próximo Guardar tiene que poder aplicarse. Lo que no puede es aplicarse sin
        // que lo haya visto — y para este punto ya lo vio.
        if (actual?.version !== undefined) panel.dataset.version = actual.version;

        panel.querySelector('.panel-acciones').before(aviso);
        this.mostrarNotificacion('La ficha cambió mientras la editabas', 'warning');
    }

    /** Descarta lo escrito y vuelve a abrir la ficha con lo que hay en el servidor. */
    async descartarMisCambios() {
        const dni = document.getElementById('panel-votante')?.dataset.dni;
        if (!dni) return;

        this.cerrarPanel({ devolverFoco: false });
        await this.abrirPanel(dni);
    }

    /**
     * Vigila las fichas que otra persona modificó mientras esta página está abierta.
     *
     * Es un GET cada 30 s contra un índice, que en el caso normal vuelve vacío. La
     * alternativa era una conexión persistente por usuario: `public/` es JS plano sin
     * build y el servidor es chico, así que no se paga sola para avisar de un cambio
     * cada varios minutos.
     *
     * La regla que no se rompe acá: **marcar, nunca redibujar**. Si esto reemplazara el
     * contenido de una fila, borraría lo que alguien está tipeando en ese momento — que
     * es la misma pérdida de datos que veníamos a arreglar, por otra puerta.
     */
    iniciarVigilanciaDeCambios(intervaloMs = 30000) {
        if (this.vigilanciaId) clearInterval(this.vigilanciaId);

        this.vigilanciaId = setInterval(() => {
            // Con la pestaña en segundo plano no hay nadie mirando: son requests que no
            // le sirven a nadie y el padrón se recarga entero al volver.
            if (document.hidden) return;
            this.revisarCambios();
        }, intervaloMs);
    }

    detenerVigilanciaDeCambios() {
        if (this.vigilanciaId) clearInterval(this.vigilanciaId);
        this.vigilanciaId = null;
    }

    async revisarCambios() {
        const desde = this.estado.tablaCargadaEn;
        if (!desde) return;

        try {
            const respuesta = await window.apiService.obtenerCambios(desde);
            const cambios = respuesta?.data?.cambios;
            if (!Array.isArray(cambios)) return;

            const propio = window.authService?.getCurrentUser()?.username || null;

            for (const cambio of cambios) {
                // Lo que cargó uno mismo no es una novedad. Sin este filtro, cambiar una
                // opción política marcaría la propia fila y la señal se volvería ruido.
                if (propio && cambio.actualizadoPor === propio) continue;
                this.marcarFilaCambiada(cambio.dni, cambio.actualizadoPor);
            }

            // El próximo tick pregunta desde acá: una ficha ya marcada no se reporta de
            // nuevo, y la marca se limpia sola cuando la tabla se vuelva a dibujar.
            if (respuesta.data.hasta) this.estado.tablaCargadaEn = respuesta.data.hasta;
        } catch (error) {
            // Que falle una ronda no es motivo de cartel: el sistema sigue usable y el
            // próximo tick lo reintenta.
            console.warn('No se pudo consultar los cambios del padrón', error);
        }
    }

    /** Marca una fila como tocada por otra persona. No toca su contenido. */
    marcarFilaCambiada(dni, usuario) {
        const fila = document.querySelector(`tr[data-dni="${CSS.escape(String(dni))}"]`);
        if (!fila) return;

        fila.classList.add('fila-cambiada');
        fila.title = usuario
            ? `${usuario} modificó esta ficha hace un momento`
            : 'Esta ficha se modificó hace un momento';
    }

    /**
     * La firma de la última edición, arriba de todo en la ficha.
     *
     * Va antes de los campos y no al pie: sirve para decidir si cargar encima, y eso se
     * decide antes de escribir, no después. Si nadie la tocó todavía, no se muestra nada
     * — una línea que dice "sin ediciones" es ruido en las 5.500 fichas sin relevar.
     */
    renderizarFirma(usuario, fecha) {
        if (!usuario) return '';

        const cuando = this.describirCuando(fecha);
        const nombre = escaparHtml(usuario);
        const detalle = cuando ? `${nombre}, ${cuando}` : nombre;

        return `
            <p class="panel-firma">
                <i class="fas fa-history"></i>
                Última edición: ${detalle}
            </p>
        `;
    }

    /** "hace 3 min" es más útil que una fecha cuando lo que importa es si es reciente. */
    describirCuando(fecha) {
        if (!fecha) return '';

        const momento = new Date(fecha);
        if (Number.isNaN(momento.getTime())) return '';

        const minutos = Math.floor((Date.now() - momento.getTime()) / 60000);

        if (minutos < 1) return 'recién';
        if (minutos < 60) return `hace ${minutos} min`;
        if (minutos < 60 * 24) return `hace ${Math.floor(minutos / 60)} h`;

        return momento.toLocaleDateString('es-AR');
    }

    cerrarPanel({ devolverFoco = true } = {}) {
        const dni = document.getElementById('panel-votante')?.dataset.dni;

        // Cerrar también cancela cualquier apertura en vuelo: si alguien cierra mientras
        // la ficha se está leyendo, no tiene que aparecer sola medio segundo después.
        this.fichaPedida = null;
        this._panelInicial = null;

        document.getElementById('panel-votante')?.remove();
        document.querySelector('tr.fila-abierta')?.classList.remove('fila-abierta');
        if (this._cerrarConEscape) {
            document.removeEventListener('keydown', this._cerrarConEscape);
            this._cerrarConEscape = null;
        }

        // El foco vuelve a la fila que se abrió: sin esto cae al <body> y quien navega con
        // teclado tiene que recorrer la tabla desde arriba.
        if (devolverFoco && dni) this.enfocarFila(dni);
    }

    /** Foco al botón "abrir ficha" de una fila (si la fila está en pantalla). */
    enfocarFila(dni) {
        document.querySelector(`.btn-abrir-panel[data-dni="${CSS.escape(String(dni))}"]`)?.focus();
    }

    /** Estado del formulario de la ficha, para saber si hay algo sin guardar. */
    leerPanel(panel) {
        return JSON.stringify({
            telefono: panel.querySelector('#panel-telefono')?.value ?? '',
            observacion: panel.querySelector('#panel-observacion')?.value ?? '',
            condiciones: [...panel.querySelectorAll('.panel-condiciones input[type="checkbox"]')].map(c => c.checked),
        });
    }

    panelSucio() {
        const panel = document.getElementById('panel-votante');
        return !!panel && this._panelInicial !== null && this.leerPanel(panel) !== this._panelInicial;
    }

    /** true si se puede cerrar/reemplazar la ficha: sin cambios, o la persona los descarta. */
    async confirmarDescarte() {
        if (!this.panelSucio()) return true;
        return window.dialogo.confirmar({
            titulo: 'Descartar cambios',
            mensaje: 'Tenés cambios sin guardar en esta ficha. Si cerrás, se pierden.',
            confirmar: 'Descartar',
            cancelar: 'Seguir editando',
            tono: 'peligro'
        });
    }

    /** Cierre iniciado por la persona (botón, Cancelar, Escape): pregunta si hay cambios. */
    async pedirCerrarPanel() {
        if (await this.confirmarDescarte()) this.cerrarPanel();
    }

    /**
     * Guarda la ficha completa: teléfono y observación van al relevamiento; las cuatro
     * casillas, al detalle. Son dos endpoints distintos, y por eso dos llamadas.
     *
     * Antes eran cinco: teléfono y observación salían como dos escrituras separadas,
     * lanzadas en paralelo, y cada una leía la fila primero para reenviar el campo de la
     * otra. Las dos leían el mismo estado previo, así que la que llegaba última pisaba
     * el otro campo — cargar teléfono y observación juntos perdía uno de los dos, con un
     * solo usuario y respondiendo 200. Ahora es **un** PUT con los dos campos.
     */
    async guardarPanel() {
        const panel = document.getElementById('panel-votante');
        if (!panel) return;

        const dni = panel.dataset.dni;
        const boton = panel.querySelector('#panel-guardar');
        const errorPanel = panel.querySelector('#panel-error');
        errorPanel.textContent = '';

        // aria-busy en vez de deshabilitar y cambiar el texto: el botón sigue siendo el
        // mismo para un lector de pantalla y el spinner sale de design-system.css.
        boton.setAttribute('aria-busy', 'true');

        try {
            const condiciones = {};
            for (const casilla of panel.querySelectorAll('.panel-condiciones input[type="checkbox"]')) {
                condiciones[casilla.name] = casilla.checked;
            }

            // En secuencia, no en paralelo: los dos endpoints escriben la MISMA fila de
            // padron.relevamientos, cada uno sus columnas. Hoy no se pisarían —el upsert
            // sólo toca lo que le mandan—, pero dos escrituras simultáneas contra una
            // fila es exactamente la forma del bug que este cambio saca, y basta con que
            // alguien agregue una columna compartida para que vuelva. Cuesta un viaje.
            const respuesta = await window.apiService.actualizarRelevamiento(dni, {
                telefono: panel.querySelector('#panel-telefono').value,
                observacion: panel.querySelector('#panel-observacion').value,
                version: this.versionDelPanel(panel),
            });

            // Otra persona escribió entre que se abrió la ficha y este Guardar. El panel
            // NO se cierra: lo que esta persona escribió sigue en pantalla y decide ella.
            if (respuesta?.conflicto) {
                this.mostrarConflicto(panel, respuesta.actual);
                return;
            }

            if (respuesta?.relevamiento?.version !== undefined) {
                panel.dataset.version = respuesta.relevamiento.version;
            }

            await window.apiService.request('/api/padron/detalle-votante', {
                method: 'POST',
                body: JSON.stringify({ dni, condiciones }),
            });

            this.mostrarNotificacion('Ficha guardada', 'success');
            // La tabla se vuelve a dibujar: el foco no puede volver antes de eso, o se
            // pierde junto con el botón viejo.
            this.cerrarPanel({ devolverFoco: false });
            await this.actualizarTabla();
            this.enfocarFila(dni);
        } catch (error) {
            // Dentro del panel y no un toast: es lo que la persona tiene delante y es donde
            // va a reintentar. El panel sigue abierto con lo escrito.
            errorPanel.textContent = `No se pudo guardar: ${error.message}`;
        } finally {
            boton.removeAttribute('aria-busy');
        }
    }

    /**
     * Renderizar radio buttons para opciones políticas
     */
    renderizarRadioButtons(dni, opcionSeleccionada) {
        // El DNI viene del CSV importado, así que es dato de usuario aunque parezca un
        // número. El código y la etiqueta de cada opción los define el cliente (021): también
        // se escapan.
        const dniSeguro = escaparHtml(dni);

        return window.opcionesPoliticas.lista().map(opcion => {
            const codigo = escaparHtml(opcion.codigo);
            const elegida = opcionSeleccionada === opcion.codigo;

            return `
            <label class="radio-label ${elegida ? 'selected' : ''}">
                <input type="radio"
                       name="opcion_${dniSeguro}"
                       value="${codigo}"
                       ${elegida ? 'checked' : ''}
                       data-action="cambiarOpcionPolitica" data-dni="${dniSeguro}" data-opcion="${codigo}">
                <span class="radio-custom opcion ${window.opcionesPoliticas.clase(opcion)}">${escaparHtml(opcion.etiqueta)}</span>
            </label>
        `;
        }).join('');
    }

    /**
     * Renderizar controles de paginación
     */
    renderizarPaginacion(paginacion) {
        const { paginaActual, totalPaginas } = paginacion || {};

        // lib/paginacion.js: un <nav> con nombre, anterior/siguiente con nombre accesible y
        // la página actual con aria-current. Una sola página no dibuja nada.
        this.elementos.paginacion.innerHTML = window.paginacion.render({
            pagina: paginaActual,
            totalPaginas,
            etiqueta: 'Paginación del padrón',
            accion: 'irAPagina'
        });
    }

    /**
     * Actualizar información de la tabla
     */
    actualizarInfoTabla(paginacion) {
        const inicio = paginacion?.inicio ?? 0;
        const fin = paginacion?.fin ?? 0;
        const totalRegistros = typeof paginacion?.totalRegistros === 'number' ? paginacion.totalRegistros : 0;
        this.elementos.info.textContent =
            `Mostrando ${inicio} a ${fin} de ${totalRegistros.toLocaleString('es-AR')} registros`;
    }

    /**
     * Cargar estadísticas rápidas
     */
    async actualizarEstadisticasRapidas() {
        try {
            const respuesta = await window.apiService.obtenerEstadisticas();
            if (respuesta?.rateLimited) {
                this.programarReintentoRateLimit(
                    'Límite de solicitudes alcanzado.',
                    () => this.cargarDatos()
                );
                return false;
            }
            const stats = respuesta?.data || {};
            const estadisticasPoliticas = stats.estadisticasPoliticas || {};
            const totalVotantes = typeof stats.totalVotantes === 'number' ? stats.totalVotantes : 0;
            const totalRelevamientos = typeof stats.totalRelevamientos === 'number' ? stats.totalRelevamientos : 0;
            // `/api/padron/estadisticas` devuelve `porcentajeRelevados`, no
            // `porcentajeCompletado`: el nombre viejo nunca existio en la respuesta, asi
            // que este valor era siempre 0 y la barra de avance se veia vacia aunque
            // hubiera mil relevamientos cargados. Si el campo faltara, se calcula.
            const porcentajeCompletado = typeof stats.porcentajeRelevados === 'number'
                ? Math.round(stats.porcentajeRelevados)
                : (totalVotantes > 0 ? Math.round((totalRelevamientos / totalVotantes) * 100) : 0);

            // Franja de avance en lugar de cinco tarjetas.
            //
            // Mientras se releva, la unica pregunta que la pantalla tiene que responder
            // es cuanto falta. El reparto entre fuerzas es una pregunta de analisis y no
            // de carga: su lugar es Resultados. Tenerlo aca obligaba a elegir cual de las
            // tres pantallas que mostraban lo mismo era la buena.
            this.elementos.estadisticasRapidas.innerHTML = `
                <div class="avance">
                    <div class="avance-cifras">
                        <strong>${totalRelevamientos.toLocaleString('es-AR')}</strong>
                        <span>de ${totalVotantes.toLocaleString('es-AR')} relevados</span>
                    </div>
                    <div class="avance-barra" role="progressbar"
                         aria-valuenow="${porcentajeCompletado}" aria-valuemin="0" aria-valuemax="100"
                         aria-label="Avance del relevamiento">
                        <div class="avance-relleno" data-ancho="${porcentajeCompletado}"></div>
                    </div>
                    <div class="avance-porcentaje">${porcentajeCompletado}%</div>
                    <a class="avance-enlace" href="resultados.html">Ver resultados</a>
                </div>
            `;
            this.elementos.estadisticasRapidas.querySelectorAll('[data-ancho]').forEach(el => {
                el.style.width = `${Number(el.dataset.ancho) || 0}%`;
            });
            return true;
        } catch (error) {
            console.error('Error al cargar estadísticas:', error);
            return true;
        }
    }

    // ==================== EVENTOS Y ACCIONES ====================

    /**
     * Cambiar opción política de un votante
     */
    async cambiarOpcionPolitica(dni, opcionPolitica) {
        try {
            // Actualizar vista inmediatamente (feedback visual)
            const fila = document.querySelector(`tr[data-dni="${CSS.escape(String(dni))}"]`);
            if (fila) {
                // Desseleccionar todos los labels de opciones políticas
                fila.querySelectorAll('.radio-label').forEach(label => {
                    label.classList.remove('selected');
                });

                // Seleccionar el label clickeado
                const inputSeleccionado = fila.querySelector(`input[name="${CSS.escape('opcion_' + dni)}"][value="${CSS.escape(String(opcionPolitica))}"]`);
                if (inputSeleccionado) {
                    inputSeleccionado.checked = true;
                    inputSeleccionado.closest('.radio-label').classList.add('selected');
                }
            }

            // Sólo la opción política. No hace falta leer la observación ni el teléfono
            // para "preservarlos": lo que no se manda, el servidor no lo toca.
            //
            // La versión sale del listado, que es lo que esta persona tiene delante. Si
            // otra cambió la opción mientras tanto, esto no la pisa en silencio.
            const item = (this.estado.votantesEnPantalla || [])
                .find(v => String(v.votante.dni) === String(dni));

            const respuesta = await window.apiService.actualizarRelevamiento(dni, {
                opcionPolitica,
                version: item?.relevamiento?.version ?? 0,
            });

            if (respuesta?.conflicto) {
                const quien = respuesta.actual?.actualizadoPor || 'Otra persona';
                this.mostrarNotificacion(
                    `${quien} ya había marcado ${window.opcionesPoliticas.etiqueta(respuesta.actual?.opcionPolitica)} en esta fila`,
                    'warning'
                );
                // Se recarga para que la fila muestre lo que hay, no lo que se clickeó.
                await this.actualizarTabla();
                return;
            }

            this.mostrarNotificacion('Relevamiento actualizado', 'success');
            await this.actualizarEstadisticasRapidas();
        } catch (error) {
            this.mostrarError(`Error al actualizar relevamiento: ${error.message}`);
            // Revertir cambio visual en caso de error
            await this.actualizarTabla();
        }
    }

    /**
     * Ir a página específica
     */
    irAPagina(pagina) {
        this.estado.paginaActual = pagina;
        this.actualizarTabla();
    }

    /**
     * Cambiar ordenamiento
     */
    cambiarOrdenamiento(campo) {
        if (this.estado.ordenamiento.campo === campo) {
            this.estado.ordenamiento.direccion = 
                this.estado.ordenamiento.direccion === 'asc' ? 'desc' : 'asc';
        } else {
            this.estado.ordenamiento.campo = campo;
            this.estado.ordenamiento.direccion = 'asc';
        }
        
        this.estado.paginaActual = 1;
        this.actualizarTabla();
        this.actualizarIconosOrdenamiento();
    }

    /**
     * Actualizar iconos de ordenamiento
     */
    actualizarIconosOrdenamiento() {
        // El estado del orden va en aria-sort del <th> (lo anuncia el lector de pantalla y lo
        // dibuja la flecha de .th-orden en design-system.css). Antes eran clases de íconos.
        const { campo, direccion } = this.estado.ordenamiento;
        document.querySelectorAll('th.sortable').forEach(th => {
            const activa = th.querySelector('.th-orden')?.dataset.campo === campo;
            th.setAttribute('aria-sort', activa ? (direccion === 'asc' ? 'ascending' : 'descending') : 'none');
        });
    }

    /**
     * Aplicar filtros
     */
    /**
     * Preselecciona el filtro "sin relevar" cuando se llega con "?sinRelevar=1"
     * en la URL, para que el link del dashboard abra directo en la lista de
     * pendientes sin que haya que tocar el checkbox a mano.
     */
    aplicarFiltroDesdeUrl() {
        const params = new URLSearchParams(window.location.search);

        // "?dni=12345678" (desde la lista de una manzana del mapa, 018): se busca ese votante y, cuando el
        // listado carga, se abre su ficha. Un DNI que no existe deja el listado con la busqueda vacia de
        // resultados, que es honesto.
        const dni = params.get('dni');
        if (dni && /^\d{6,9}$/.test(dni)) {
            const busqueda = document.getElementById('filtro-busqueda');
            if (busqueda) busqueda.value = dni;
            this.estado.filtros = { ...this.estado.filtros, busqueda: dni };
            this.dniAAbrir = dni;
        }

        if (params.get('sinRelevar') !== '1') return;

        const checkbox = document.getElementById('filtro-sin-relevamiento');
        if (checkbox) checkbox.checked = true;
        this.estado.filtros = { ...this.estado.filtros, sinRelevamiento: true };
    }

    aplicarFiltros() {
        this.estado.filtros = {
            busqueda: document.getElementById('filtro-busqueda').value,
            circuito: document.getElementById('filtro-circuito').value,
            sexo: document.getElementById('filtro-sexo').value,
            opcionPolitica: document.getElementById('filtro-opcion-politica').value,
            sinRelevamiento: document.getElementById('filtro-sin-relevamiento').checked
        };
        
        this.estado.paginaActual = 1;
        this.actualizarTabla();
    }

    /**
     * Limpiar filtros
     */
    limpiarFiltros() {
        document.getElementById('filtro-busqueda').value = '';
        document.getElementById('filtro-circuito').value = '';
        document.getElementById('filtro-sexo').value = '';
        document.getElementById('filtro-opcion-politica').value = '';
        document.getElementById('filtro-sin-relevamiento').checked = false;
        
        this.estado.filtros = {};
        this.estado.paginaActual = 1;
        this.actualizarTabla();
    }

    /**
     * Cambiar registros por página
     */
    cambiarRegistrosPorPagina() {
        this.estado.paginaActual = 1;
        this.actualizarTabla();
    }

    /**
     * Cargar filtros disponibles
     */
    async cargarFiltrosDisponibles() {
        try {
            const respuesta = await window.apiService.obtenerFiltrosDisponibles();
            if (respuesta?.rateLimited) {
                this.programarReintentoRateLimit(
                    'Límite de solicitudes alcanzado.',
                    () => this.cargarDatos()
                );
                return false;
            }
            const filtros = respuesta?.data;

            // Las opciones políticas son de la instancia (021): alimentan el filtro y los
            // botones de cada fila, que se dibujan después de este paso.
            const opciones = await window.opcionesPoliticas.cargar();
            const selectOpcion = document.getElementById('filtro-opcion-politica');
            const elegida = selectOpcion.value;
            selectOpcion.innerHTML = '<option value="">Todas</option>' +
                opciones.map(o => `<option value="${escaparHtml(o.codigo)}">${escaparHtml(o.etiqueta)}</option>`).join('');
            selectOpcion.value = elegida;

            const selectCircuito = document.getElementById('filtro-circuito');
            const circuitos = Array.isArray(filtros?.circuitos) ? filtros.circuitos : [];
            selectCircuito.innerHTML = '<option value="">Todos los circuitos</option>' +
                circuitos.map(c => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join('');
            return true;
        } catch (error) {
            console.error('Error al cargar filtros:', error);
            return true;
        }
    }

    // ==================== MODALES ====================

    // Acá vivían mostrarEstadisticas() y cerrarModalEstadisticas(). El modal repetía
    // total de votantes, relevamientos y porcentaje: los mismos tres datos que la
    // franja de avance muestra sin abrir nada, y el análisis completo está en
    // Resultados, que ahora es un destino de la barra de navegación.

    abrirModalNuevoVotante() {
        // Poblar circuitos en el select del modal
        const selectCircuito = document.getElementById('nuevo-circuito');
        const filtroCircuito = document.getElementById('filtro-circuito');
        if (filtroCircuito && selectCircuito) {
            selectCircuito.replaceChildren(new Option('Seleccionar circuito', ''));
            Array.from(filtroCircuito.options).forEach(opt => {
                // Option() asigna texto y valor sin parsear HTML: un circuito con
                // comillas o `<` no puede salirse del <option> (FE-004).
                if (opt.value) selectCircuito.appendChild(new Option(opt.textContent, opt.value));
            });
        }

        // Limpiar formulario y estados de validación
        document.getElementById('form-nuevo-votante').reset();
        this.mostrarErrorFormulario('');
        document.getElementById('btn-guardar-votante').removeAttribute('aria-busy');
        this.limpiarEstadosValidacion();

        // <dialog> nativo: foco atrapado, Escape y fondo inerte. El foco va al DNI por el
        // atributo `autofocus`, y al cerrar vuelve al botón "Nuevo votante".
        window.dialogo.mostrar(document.getElementById('modal-nuevo-votante'));
    }

    cerrarModalNuevoVotante() {
        document.getElementById('modal-nuevo-votante')?.close();
    }

    /**
     * Inicializar validación en tiempo real para el formulario de nuevo votante
     */
    inicializarValidacionNuevoVotante() {
        const dniInput = document.getElementById('nuevo-dni');
        const apellidoInput = document.getElementById('nuevo-apellido');
        const nombreInput = document.getElementById('nuevo-nombre');
        const dniHelper = document.getElementById('dni-helper');
        const dniValidationIcon = document.getElementById('dni-validation-icon');

        // Validación en tiempo real del DNI
        dniInput.addEventListener('input', () => {
            const val = dniInput.value.trim();
            dniValidationIcon.className = 'input-validation-icon';
            dniInput.classList.remove('input-valid', 'input-invalid');
            dniInput.removeAttribute('aria-invalid');
            document.getElementById('nuevo-dni-error').textContent = '';
            dniHelper.className = 'form-helper';

            if (val.length === 0) {
                dniHelper.textContent = 'Solo números, sin puntos ni espacios';
                return;
            }

            if (!/^\d*$/.test(val)) {
                dniInput.classList.add('input-invalid');
                dniInput.setAttribute('aria-invalid', 'true');
                dniValidationIcon.classList.add('is-invalid');
                dniHelper.textContent = 'Solo se permiten números';
                dniHelper.classList.add('helper-error');
            } else if (val.length < 7 || val.length > 8) {
                dniHelper.textContent = `${val.length} dígitos: debe tener 7 u 8`;
            } else {
                dniInput.classList.add('input-valid');
                dniValidationIcon.classList.add('is-valid');
                dniHelper.textContent = `${val.length} dígitos: DNI válido`;
                dniHelper.classList.add('helper-success');
            }
        });

        // Filtrar caracteres no numéricos en DNI
        dniInput.addEventListener('keypress', (e) => {
            if (!/\d/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab' && e.key !== 'Enter') {
                e.preventDefault();
            }
        });

        // Validación de campos requeridos on blur
        const validarRequerido = (input, mensaje) => {
            input.addEventListener('blur', () => {
                if (input.value.trim() === '') {
                    this.marcarCampo(input, mensaje);
                } else {
                    this.marcarCampo(input, null);
                    input.classList.add('input-valid');
                }
            });
            input.addEventListener('input', () => {
                if (input.value.trim() !== '') this.marcarCampo(input, null);
            });
        };

        validarRequerido(apellidoInput, 'Ingresá el apellido.');
        validarRequerido(nombreInput, 'Ingresá el nombre.');
        validarRequerido(document.getElementById('nuevo-anio-nac'), 'Ingresá el año de nacimiento.');
    }

    /**
     * Marca un campo con error (o lo limpia con `null`): clase visual, aria-invalid y el
     * mensaje en línea (`#<id>-error`, enlazado por aria-describedby). El color solo no
     * alcanza: sin esto un lector de pantalla no sabía qué campo estaba mal ni por qué.
     */
    marcarCampo(input, mensaje) {
        if (!input) return;
        const error = document.getElementById(`${input.id}-error`);
        if (mensaje) {
            input.classList.add('input-invalid');
            input.classList.remove('input-valid');
            input.setAttribute('aria-invalid', 'true');
            if (error) error.textContent = mensaje;
        } else {
            input.classList.remove('input-invalid');
            input.removeAttribute('aria-invalid');
            if (error) error.textContent = '';
        }
    }

    /** Resumen de error del formulario (`role="alert"`); texto vacío lo oculta. */
    mostrarErrorFormulario(texto) {
        const div = document.getElementById('error-nuevo-votante');
        const span = document.getElementById('error-nuevo-votante-text');
        if (!div || !span) return;
        span.textContent = texto;
        div.hidden = !texto;
    }

    /**
     * Limpiar estados visuales de validación del formulario
     */
    limpiarEstadosValidacion() {
        const inputs = document.querySelectorAll('#form-nuevo-votante .form-input');
        inputs.forEach(input => {
            input.classList.remove('input-valid', 'input-invalid');
            input.removeAttribute('aria-invalid');
        });
        document.querySelectorAll('#form-nuevo-votante .campo-error').forEach(e => { e.textContent = ''; });

        const dniValidationIcon = document.getElementById('dni-validation-icon');
        if (dniValidationIcon) {
            dniValidationIcon.className = 'input-validation-icon';
        }

        const dniHelper = document.getElementById('dni-helper');
        if (dniHelper) {
            dniHelper.textContent = 'Solo números, sin puntos ni espacios';
            dniHelper.className = 'form-helper';
        }
    }

    async guardarNuevoVotante() {
        const btnGuardar = document.getElementById('btn-guardar-votante');
        this.mostrarErrorFormulario('');

        const dni = document.getElementById('nuevo-dni').value.trim();
        const apellido = document.getElementById('nuevo-apellido').value.trim();
        const nombre = document.getElementById('nuevo-nombre').value.trim();
        const anioNac = document.getElementById('nuevo-anio-nac').value.trim();
        const sexo = document.getElementById('nuevo-sexo').value;
        const domicilio = document.getElementById('nuevo-domicilio').value.trim();
        const circuito = document.getElementById('nuevo-circuito').value;

        // Errores en línea, uno por campo, y el foco al primero. El resumen de abajo no
        // reemplaza al mensaje del campo: lo acompaña.
        const problemas = [];
        if (!dni) problemas.push(['nuevo-dni', 'Ingresá el DNI.']);
        else if (!/^\d{7,8}$/.test(dni)) problemas.push(['nuevo-dni', 'El DNI debe tener 7 u 8 números.']);
        if (!apellido) problemas.push(['nuevo-apellido', 'Ingresá el apellido.']);
        if (!nombre) problemas.push(['nuevo-nombre', 'Ingresá el nombre.']);

        // El servidor exige el año (la columna es NOT NULL) y lo acota a 1900..año actual.
        // El formulario lo presentaba como opcional y el error llegaba recién al enviar.
        const anioActual = new Date().getFullYear();
        const anio = Number(anioNac);
        if (!anioNac) problemas.push(['nuevo-anio-nac', 'Ingresá el año de nacimiento.']);
        else if (!Number.isInteger(anio) || anio < 1900 || anio > anioActual) {
            problemas.push(['nuevo-anio-nac', `El año debe estar entre 1900 y ${anioActual}.`]);
        }

        ['nuevo-dni', 'nuevo-apellido', 'nuevo-nombre', 'nuevo-anio-nac'].forEach(id => this.marcarCampo(document.getElementById(id), null));
        if (problemas.length) {
            problemas.forEach(([id, mensaje]) => this.marcarCampo(document.getElementById(id), mensaje));
            this.mostrarErrorFormulario('Revisá los campos marcados.');
            document.getElementById(problemas[0][0]).focus();
            return;
        }

        try {
            // aria-busy y no `disabled`: el botón conserva el foco, y el spinner sale de
            // design-system.css.
            btnGuardar.setAttribute('aria-busy', 'true');

            await window.apiService.crearVotante({
                dni,
                apellido,
                nombre,
                anioNac: anioNac || undefined,
                sexo: sexo || undefined,
                domicilio: domicilio || undefined,
                circuito: circuito || undefined
            });

            this.cerrarModalNuevoVotante();
            this.mostrarNotificacion('Votante creado', 'success');
            await this.actualizarEstadisticasRapidas();
            await this.actualizarTabla();

        } catch (error) {
            this.mostrarErrorFormulario(error.message || 'No se pudo crear el votante. Probá de nuevo.');
        } finally {
            btnGuardar.removeAttribute('aria-busy');
        }
    }

    async exportarDatos() {
        try {
            this.mostrarNotificacion('Generando la exportación en CSV…', 'info');
            const blob = await window.apiService.exportarDatos();
            const nombreArchivo = `relevamientos_${new Date().toISOString().slice(0, 10)}.csv`;

            window.apiService.descargarArchivo(blob, nombreArchivo);
            this.mostrarNotificacion('Datos exportados correctamente', 'success');

        } catch (error) {
            this.mostrarError(`Error al exportar datos: ${error.message}`);
        }
    }

    async exportarPadron() {
        try {
            this.mostrarNotificacion('Generando la exportación del padrón completo…', 'info');
            const blob = await window.apiService.exportarPadron();
            const nombreArchivo = `padron_completo_${new Date().toISOString().slice(0, 10)}.csv`;

            window.apiService.descargarArchivo(blob, nombreArchivo);
            this.mostrarNotificacion('Padrón exportado correctamente', 'success');

        } catch (error) {
            this.mostrarError(`Error al exportar el padrón: ${error.message}`);
        }
    }

    // ==================== FUNCIONALIDAD MÓVIL ====================

    /**
     * Toggle filtros móviles
     */
    toggleFiltrosMobile() {
        const filtrosContainer = document.getElementById('filtros-container');
        this.fijarFiltrosMobile(!filtrosContainer.classList.contains('show'));
    }

    /**
     * Abre o cierra el panel de filtros del teléfono y lo dice con `aria-expanded` (el botón
     * lo declaraba pero nunca lo actualizaba). Escape lo cierra y devuelve el foco al botón.
     */
    fijarFiltrosMobile(abierto, { devolverFoco = false } = {}) {
        const filtrosContainer = document.getElementById('filtros-container');
        const boton = document.getElementById('btn-filtros-mobile');
        filtrosContainer.classList.toggle('show', abierto);

        if (boton) {
            boton.setAttribute('aria-expanded', String(abierto));
            boton.setAttribute('aria-label', abierto ? 'Ocultar filtros' : 'Mostrar filtros');
        }

        // Prevent body scroll when filters are open
        document.body.style.overflow = abierto ? 'hidden' : '';

        if (abierto) {
            document.getElementById('btn-cerrar-filtros')?.focus(); // no el buscador: en un teléfono abriría el teclado
        } else if (devolverFoco && boton) {
            boton.focus();
        }
    }

    /**
     * Cerrar filtros móviles
     */
    cerrarFiltrosMobile({ devolverFoco = false } = {}) {
        this.fijarFiltrosMobile(false, { devolverFoco });

        // Auto-aplicar filtros al cerrar en móvil
        if (window.innerWidth <= 768) {
            this.aplicarFiltros();
        }
    }

    /**
     * Debounce function para optimizar búsquedas
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Manejar eventos de redimensionado de ventana
     */
    handleResize() {
        const filtrosContainer = document.getElementById('filtros-container');
        if (window.innerWidth > 768 && filtrosContainer.classList.contains('show')) {
            this.cerrarFiltrosMobile();
        }
    }

    // ==================== UTILIDADES ====================

    mostrarCargando(mostrar) {
        this.estado.cargando = mostrar;
        // Antes era un stub (FE-025): ahora la tabla se atenua y se anuncia como ocupada,
        // para que un refresco lento no parezca una pantalla congelada.
        const tabla = this.elementos.tbody?.closest('table');
        if (tabla) {
            tabla.setAttribute('aria-busy', mostrar ? 'true' : 'false');
            tabla.classList.toggle('tabla-cargando', mostrar);
        }
    }

    mostrarBannerRateLimit(mensaje, mostrarBoton = true) {
        if (!this.elementos.rateBanner) return;
        if (this.elementos.rateBannerText) {
            this.elementos.rateBannerText.textContent = mensaje;
        }
        if (this.elementos.rateBannerRetry) {
            this.elementos.rateBannerRetry.style.display = mostrarBoton ? '' : 'none';
        }
        this.elementos.rateBanner.classList.remove('hidden');
    }

    ocultarBannerRateLimit() {
        if (!this.elementos.rateBanner) return;
        this.elementos.rateBanner.classList.add('hidden');
    }

    resetRateLimitState() {
        this.rateLimit.retries = 0;
        this.rateLimit.lastAction = null;
        if (this.rateLimit.timerId) {
            clearTimeout(this.rateLimit.timerId);
            this.rateLimit.timerId = null;
        }
        this.ocultarBannerRateLimit();
    }

    reintentarRateLimit() {
        const accion = this.rateLimit.lastAction || (() => this.cargarDatos());
        this.resetRateLimitState();
        accion();
    }

    programarReintentoRateLimit(motivo, accion) {
        const maxRetries = 3;
        this.rateLimit.lastAction = accion;

        if (this.rateLimit.timerId) {
            return;
        }

        if (this.rateLimit.retries >= maxRetries) {
            this.mostrarBannerRateLimit(`${motivo} Intentá de nuevo en unos minutos.`, true);
            return;
        }

        const baseDelay = 2000;
        const delay = Math.min(20000, baseDelay * 2 ** this.rateLimit.retries);
        const jitter = Math.floor(Math.random() * 500);
        const delayMs = delay + jitter;
        const segundos = Math.ceil(delayMs / 1000);

        this.mostrarBannerRateLimit(`${motivo} Reintentando en ${segundos} s…`, true);

        this.rateLimit.timerId = setTimeout(async () => {
            this.rateLimit.timerId = null;
            this.rateLimit.retries += 1;
            await accion();
        }, delayMs);
    }

    mostrarNotificacion(mensaje, tipo = 'info') {
        // lib/avisos.js: el mensaje entra como texto (no hace falta escapar) y se anuncia en
        // la región viva que corresponde. Antes cada pantalla tenía su propio toast, y ninguno
        // se anunciaba a un lector de pantalla.
        window.avisos.mostrar(mensaje, tipo);
    }

    mostrarError(mensaje) {
        // Sin la interfaz armada (la API no responde, o falló crearInterfaz) un aviso de unos
        // segundos dejaba la página en blanco para siempre: el error pasa a ser la pantalla.
        if (!this.elementos.tbody && this.container) {
            this.container.innerHTML = estados.error({ texto: mensaje, reintentar: 'recargarPagina' });
            return;
        }
        this.mostrarNotificacion(mensaje, 'error');
    }

    /** "Reintentar" del estado de error de pantalla completa. */
    recargarPagina() {
        window.location.reload();
    }

    /* Acá vivían renderizarCondicionesEspeciales, renderizarCondicionesInline,
       marcarCambioCondicion y guardarCondicionesInline: los controles de condiciones
       dentro de la tabla. Quedaron sin un solo llamador cuando la carga se mudó al panel
       lateral, y los cuatro interpolaban datos de votante sin escapar.

       Se borran en vez de escaparse. Código muerto que ya tiene el agujero adentro es
       peor que código muerto a secas: el día que alguien lo vuelva a enchufar, el agujero
       vuelve con él. */


    /**
     * Enriquecer votantes con sus detalles (condiciones especiales)
     * @private
     */
    async enriquecerConDetalles(votantes) {
        try {
            if (!Array.isArray(votantes) || votantes.length === 0) {
                return [];
            }

            const votantesConDetalles = [];
            
            // Procesar de a lotes para evitar sobrecarga
            const loteSize = 10;
            for (let i = 0; i < votantes.length; i += loteSize) {
                const lote = votantes.slice(i, i + loteSize);
                
                const promesasDetalle = lote.map(async (item) => {
                    try {
                        const response = await window.apiService.request(`/api/padron/detalle-votante/${item.votante.dni}`);

                        if (response?.success && response.data) {
                            return { ...item, detalle: response.data };
                        }

                        // Si no existe detalle, continuar sin lanzar error
                        if (response?.notFound) {
                            return { ...item, detalle: null };
                        }
                    } catch (error) {
                        // Silenciar errores individuales para no interrumpir el flujo
                        console.warn(`No se pudo cargar detalle para DNI ${item.votante.dni}`);
                    }
                    return { ...item, detalle: null };
                });

                const loteConDetalles = await Promise.all(promesasDetalle);
                votantesConDetalles.push(...loteConDetalles);
            }

            return votantesConDetalles;
        } catch (error) {
            console.warn('Error cargando detalles, continuando sin ellos:', error);
            if (!Array.isArray(votantes)) {
                return [];
            }
            return votantes.map(item => ({ ...item, detalle: null }));
        }
    }

}

// Instancia global del componente
window.padronComponent = new PadronComponent();
