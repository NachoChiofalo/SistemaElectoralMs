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
        console.log('🖥️ Inicializando componente de Padrón...');
        console.log('  - Container ID:', containerId);
        
        this.container = document.getElementById(containerId);
        if (!this.container) {
            const error = `Contenedor ${containerId} no encontrado`;
            console.error('❌ Error:', error);
            throw new Error(error);
        }
        console.log('✅ Container encontrado:', this.container);

        // Verificar conexión con API
        console.log('🔍 Verificando conexión con API...');
        try {
            const apiDisponible = await window.apiService.verificarEstado();
            console.log('📡 Estado API:', apiDisponible ? '✅ DISPONIBLE' : '❌ NO DISPONIBLE');
            
            if (!apiDisponible) {
                const mensaje = 'No se puede conectar con el servicio de padrón. Verifique que esté ejecutándose.';
                console.error('❌ API no disponible:', mensaje);
                this.mostrarError(mensaje);
                return false;
            }
        } catch (error) {
            console.error('❌ Error al verificar API:', error);
            this.mostrarError('Error al verificar la conexión con la API: ' + error.message);
            return false;
        }

        console.log('🎨 Creando interfaz del padrón...');
        try {
            this.crearInterfaz();
            console.log('✅ Interfaz creada');
        } catch (error) {
            console.error('❌ Error al crear interfaz:', error);
            return false;
        }

        console.log('🎪 Inicializando eventos...');
        try {
            this.inicializarEventos();
            console.log('✅ Eventos inicializados');
        } catch (error) {
            console.error('❌ Error al inicializar eventos:', error);
        }

        console.log('📊 Cargando datos...');
        try {
            await this.cargarDatos();
            console.log('✅ Datos cargados');
        } catch (error) {
            console.error('❌ Error al cargar datos:', error);
            // No fallar completamente si los datos no cargan
        }

        // Se arranca al final y no antes: sin tabla dibujada no hay filas que marcar.
        this.iniciarVigilanciaDeCambios();

        console.log('✅ Componente de Padrón inicializado correctamente');
        return true;
    }

    /**
     * Crear la interfaz del componente
     */
    crearInterfaz() {
        this.container.innerHTML = `
            <div class="padron-header">
                <div class="padron-title">
                    <h2><i class="fas fa-users-cog"></i> Padrón Electoral</h2>
                    <p class="padron-subtitle">Gestión y relevamiento del padrón electoral</p>
                </div>
                <div class="padron-actions">
                    <button id="btn-nuevo-votante" class="btn btn-success" data-requires-permission="padron.edit" title="Agregar nuevo votante al padrón">
                        <i class="fas fa-user-plus"></i> <span class="btn-text">Nuevo Votante</span>
                    </button>
                    <button id="btn-exportar" class="btn btn-secondary" data-requires-permission="padron.export" title="Exportar relevamientos CSV">
                        <i class="fas fa-download"></i> <span class="btn-text">Exportar</span>
                    </button>
                    <button id="btn-exportar-padron" class="btn btn-secondary" data-requires-permission="padron.export" title="Exportar padron completo CSV">
                        <i class="fas fa-file-csv"></i> <span class="btn-text">Exportar Padron</span>
                    </button>
                    <button id="btn-filtros-mobile" class="btn btn-outline mobile-only" title="Mostrar/ocultar filtros">
                        <i class="fas fa-filter"></i>
                    </button>
                </div>
            </div>

            <div id="estadisticas-rapidas" class="padron-estadisticas-rapidas">
                <!-- Estadísticas se cargan dinámicamente -->
            </div>

            <div id="padron-rate-banner" class="padron-banner hidden" role="status" aria-live="polite">
                <div class="padron-banner-content">
                    <i class="fas fa-hourglass-half"></i>
                    <span id="padron-rate-banner-text">Limite de solicitudes alcanzado.</span>
                </div>
                <button id="padron-rate-banner-retry" class="btn btn-secondary btn-sm">Reintentar</button>
            </div>

            <div class="padron-filtros" id="filtros-container">
                <div class="filtros-header mobile-only">
                    <h3><i class="fas fa-filter"></i> Filtros</h3>
                    <button id="btn-cerrar-filtros" class="btn-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="filtros-row">
                    <div class="filtro-item">
                        <label for="filtro-busqueda">
                            Buscar
                        </label>
                        <input type="text" id="filtro-busqueda" placeholder="DNI, nombre, apellido..." aria-label="Buscar por DNI, nombre o apellido">
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-circuito">
                            Circuito
                        </label>
                        <select id="filtro-circuito" aria-label="Filtrar por circuito">
                            <option value="">Todos los circuitos</option>
                        </select>
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-sexo">
                            Sexo
                        </label>
                        <select id="filtro-sexo" aria-label="Filtrar por sexo">
                            <option value="">Todos</option>
                            <option value="M">Masculino</option>
                            <option value="F">Femenino</option>
                        </select>
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-opcion-politica">
                            Opción política
                        </label>
                        <select id="filtro-opcion-politica" aria-label="Filtrar por opción política">
                            <option value="">Todas</option>
                            <option value="PJ">PJ</option>
                            <option value="UCR">UCR</option>
                            <option value="Indeciso">Indeciso</option>
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
                        <button id="btn-aplicar-filtros" class="btn btn-primary btn-sm">Filtrar</button>
                        <button id="btn-limpiar-filtros" class="btn btn-secondary btn-sm">Limpiar</button>
                    </div>
                    </div>
                </div>
            </div>

            <div class="padron-tabla-container">
                <div class="tabla-header">
                    <div class="tabla-info" id="tabla-info">
                        Cargando...
                    </div>
                    <div class="tabla-acciones">
                        <label>Mostrar</label>
                        <select id="registros-por-pagina">
                            <option value="25">25</option>
                            <option value="50" selected>50</option>
                            <option value="100">100</option>
                            <option value="200">200</option>
                        </select>
                        <label>registros</label>
                    </div>
                </div>

                <div class="tabla-responsive">
                    <table class="tabla-padron" id="tabla-padron">
                        <thead>
                            <tr>
                                <th class="sortable" data-campo="dni">
                                    DNI <i class="fas fa-sort"></i>
                                </th>
                                <th class="sortable" data-campo="apellido">
                                    Apellido <i class="fas fa-sort"></i>
                                </th>
                                <th class="sortable" data-campo="nombre">
                                    Nombre <i class="fas fa-sort"></i>
                                </th>
                                <th class="sortable" data-campo="edad">
                                    Edad <i class="fas fa-sort"></i>
                                </th>
                                <th class="sortable" data-campo="circuito">
                                    Circuito <i class="fas fa-sort"></i>
                                </th>
                                <th class="sortable" data-campo="sexo">
                                    Sexo <i class="fas fa-sort"></i>
                                </th>
                                <th>Opción Política</th>
                                <!-- Observación, Teléfono y Condiciones dejaron de ser
                                     columnas: eran seis controles por fila que sólo se
                                     usan en una minoría de los registros. Ahora se
                                     cargan en el panel lateral, y acá queda una marca
                                     de sólo lectura con lo que ya está cargado. -->
                                <th>Datos</th>
                                <th><span class="sr-only">Abrir</span></th>
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

            <!-- Modal para importar CSV -->
            <div id="modal-importar" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Importar Padrón desde CSV</h3>
                        <button class="modal-close" onclick="padronComponent.cerrarModalImportar()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="import-zone">
                            <i class="fas fa-cloud-upload-alt"></i>
                            <p>Seleccione archivo CSV con datos del padrón</p>
                            <input type="file" id="archivo-csv" accept=".csv" style="display: none;">
                            <button onclick="document.getElementById('archivo-csv').click()" class="btn btn-primary">
                                Seleccionar Archivo
                            </button>
                        </div>
                        <div class="import-format">
                            <h4>Formato esperado:</h4>
                            <code>DNI,AÑO NAC,APELLIDO,NOMBRE,DOMICILIO,TIPO_EJEMPL,CIRCUITO,S</code>
                        </div>
                    </div>
                </div>
            </div>


            <!-- Modal para nuevo votante -->
            <div id="modal-nuevo-votante" class="modal-overlay" style="display: none;" onclick="padronComponent.cerrarModalNuevoVotanteOverlay(event)">
                <div class="modal-content modal-nuevo-votante">
                    <div class="modal-header">
                        <div class="modal-header-title">
                            <div class="modal-header-icon">
                                <i class="fas fa-user-plus"></i>
                            </div>
                            <div>
                                <h3>Nuevo Votante</h3>
                                <p class="modal-subtitle">Completá los datos para registrar un nuevo elector</p>
                            </div>
                        </div>
                        <button class="modal-close" onclick="padronComponent.cerrarModalNuevoVotante()" title="Cerrar (Esc)">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="form-nuevo-votante" onsubmit="return false;">
                            <!-- Sección: Identificación -->
                            <div class="form-section">
                                <div class="form-section-header">
                                    <i class="fas fa-id-card"></i>
                                    <span>Identificación</span>
                                    <span class="form-section-badge required-badge">Obligatorio</span>
                                </div>
                                <div class="form-group">
                                    <label for="nuevo-dni">DNI <span class="required">*</span></label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-fingerprint input-icon"></i>
                                        <input type="text" id="nuevo-dni" class="form-input has-icon" placeholder="Ej: 12345678" required maxlength="10" inputmode="numeric" autocomplete="off">
                                        <span class="input-validation-icon" id="dni-validation-icon"></span>
                                    </div>
                                    <span class="form-helper" id="dni-helper">Solo números, sin puntos ni espacios</span>
                                </div>
                            </div>

                            <!-- Sección: Datos Personales -->
                            <div class="form-section">
                                <div class="form-section-header">
                                    <i class="fas fa-user"></i>
                                    <span>Datos Personales</span>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="nuevo-apellido">Apellido <span class="required">*</span></label>
                                        <div class="input-wrapper">
                                            <i class="fas fa-user input-icon"></i>
                                            <input type="text" id="nuevo-apellido" class="form-input has-icon" placeholder="Ej: García" required autocomplete="off">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="nuevo-nombre">Nombre <span class="required">*</span></label>
                                        <div class="input-wrapper">
                                            <i class="fas fa-user input-icon"></i>
                                            <input type="text" id="nuevo-nombre" class="form-input has-icon" placeholder="Ej: Juan Carlos" required autocomplete="off">
                                        </div>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label for="nuevo-anio-nac">Año Nacimiento</label>
                                        <div class="input-wrapper">
                                            <i class="fas fa-calendar-alt input-icon"></i>
                                            <input type="number" id="nuevo-anio-nac" class="form-input has-icon" placeholder="Ej: 1990" min="1900" max="2010">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label for="nuevo-sexo">Sexo</label>
                                        <div class="input-wrapper">
                                            <i class="fas fa-venus-mars input-icon"></i>
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
                                    <i class="fas fa-map-marker-alt"></i>
                                    <span>Ubicación</span>
                                    <span class="form-section-badge optional-badge">Opcional</span>
                                </div>
                                <div class="form-group">
                                    <label for="nuevo-domicilio">Domicilio</label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-home input-icon"></i>
                                        <input type="text" id="nuevo-domicilio" class="form-input has-icon" placeholder="Ej: Av. San Martín 1234">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label for="nuevo-circuito">Circuito Electoral</label>
                                    <div class="input-wrapper">
                                        <i class="fas fa-map-signs input-icon"></i>
                                        <select id="nuevo-circuito" class="form-input has-icon">
                                            <option value="">Seleccionar circuito</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div id="error-nuevo-votante" class="form-error" style="display: none;">
                                <i class="fas fa-exclamation-circle"></i>
                                <span id="error-nuevo-votante-text"></span>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" onclick="padronComponent.cerrarModalNuevoVotante()">
                                    <i class="fas fa-times"></i> Cancelar
                                </button>
                                <button type="button" id="btn-guardar-votante" class="btn btn-primary" onclick="padronComponent.guardarNuevoVotante()">
                                    <i class="fas fa-save"></i> Guardar Votante
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
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
        on('btn-importar',      'click', () => this.abrirModalImportar());
        on('btn-exportar',      'click', () => this.exportarDatos());
        on('btn-exportar-padron', 'click', () => this.exportarPadron());
        on('padron-rate-banner-retry', 'click', () => this.reintentarRateLimit());

        // Botones móviles
        on('btn-filtros-mobile', 'click', () => this.toggleFiltrosMobile());
        on('btn-cerrar-filtros', 'click', () => this.cerrarFiltrosMobile());

        // Filtros
        on('btn-aplicar-filtros', 'click', () => this.aplicarFiltros());
        on('btn-limpiar-filtros', 'click', () => this.limpiarFiltros());
        on('filtro-busqueda', 'keypress', (e) => { if (e.key === 'Enter') this.aplicarFiltros(); });

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

        // Importar CSV
        on('archivo-csv', 'change', (e) => this.manejarArchivoCSV(e));

        // Evento de redimensionado de ventana
        window.addEventListener('resize', () => this.handleResize());

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

        // Validación en tiempo real del formulario nuevo votante
        this.inicializarValidacionNuevoVotante();

        // Ordenamiento de tabla
        if (this.elementos.tabla) {
            this.elementos.tabla.addEventListener('click', (e) => {
                if (e.target.closest('.sortable')) {
                    const campo = e.target.closest('.sortable').dataset.campo;
                    this.cambiarOrdenamiento(campo);
                }
            });
        }
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

            if (!respuesta || !Array.isArray(respuesta.data)) {
                if (respuesta?.rateLimited) {
                    this.programarReintentoRateLimit(
                        'Limite de solicitudes alcanzado.',
                        () => this.actualizarTabla()
                    );
                } else {
                    this.mostrarError('No se pudo cargar la lista de votantes.');
                }

                this.renderizarTabla([]);
                this.renderizarPaginacion({ paginaActual: 1, totalPaginas: 1 });
                this.actualizarInfoTabla({ inicio: 0, fin: 0, totalRegistros: 0 });
                return false;
            }
            
            const detallesIncluidos = respuesta?.detallesIncluidos === true;
            const votantesConDetalles = detallesIncluidos
                ? respuesta.data
                : await this.enriquecerConDetalles(respuesta.data);
            
            this.renderizarTabla(votantesConDetalles);
            this.renderizarPaginacion(respuesta.paginacion);
            this.actualizarInfoTabla(respuesta.paginacion);
            this.resetRateLimitState();
            return true;
            
        } catch (error) {
            this.mostrarError(`Error al cargar votantes: ${error.message}`);
            return false;
        } finally {
            this.mostrarCargando(false);
        }
    }

    /**
     * Renderizar tabla con datos
     */
    renderizarTabla(votantes) {
        if (!Array.isArray(votantes) || votantes.length === 0) {
            this.elementos.tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="sin-datos">
                        <i class="fas fa-users"></i>
                        No se encontraron votantes con los criterios seleccionados
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
        // esta página. Incluye los atributos —`title`, `data-dni`, el `onclick`—, que es
        // justo lo que el truco de textContent/innerHTML no cubre.
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
                    <td data-label="Opción Política">
                        <div class="radio-group">
                            ${this.renderizarRadioButtons(votante.dni, opcionPolitica)}
                        </div>
                    </td>
                    <td data-label="Datos" class="marcas-cell">
                        ${this.renderizarMarcas(item)}
                    </td>
                    <td class="acciones" data-label="Abrir">
                        <button class="btn-abrir-panel"
                                onclick="padronComponent.abrirPanel('${dni}')"
                                title="Abrir ficha de ${apellido}, ${nombre}"
                                aria-label="Abrir ficha de ${apellido}, ${nombre}">
                            <i class="fas fa-chevron-right"></i>
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

        if (marcas.length === 0) return '<span class="sin-marcas">—</span>';

        return `<div class="marcas">${marcas.map(m =>
            `<i class="fas ${m.icono} marca${m.variante ? ' marca-' + m.variante : ''}" title="${m.texto}" aria-label="${m.texto}"></i>`
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

        const { votante } = item;

        // Los datos cargables se releen del servidor; del listado sólo sale la identidad
        // del votante, que no cambia. Antes la ficha se armaba entera con el snapshot de
        // la última vez que se tocó un filtro: una pestaña abierta hace veinte minutos
        // mostraba —y guardaba encima de— veinte minutos de trabajo ajeno.
        let relevamiento = item.relevamiento;
        let detalle = item.detalle;
        let firma = null;

        // La ficha vieja se cierra antes de esperar: sin esto, la página se queda un
        // instante mostrando la anterior como si nada hubiera pasado.
        this.cerrarPanel();

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
        panel.setAttribute('aria-label', `Ficha de ${votante.apellido}, ${votante.nombre}`);
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
                    <h3>${escaparHtml(votante.apellido)}, ${escaparHtml(votante.nombre)}</h3>
                    <p class="panel-dni">DNI ${escaparHtml(votante.dni)}</p>
                </div>
                <button class="panel-cerrar" onclick="padronComponent.cerrarPanel()" title="Cerrar" aria-label="Cerrar ficha">
                    <i class="fas fa-times"></i>
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
                       placeholder="Sin teléfono cargado">
            </div>

            <div class="panel-campo">
                <label for="panel-observacion">Observación</label>
                <textarea id="panel-observacion" rows="4"
                          placeholder="Sin observaciones">${escaparHtml(relevamiento?.observacion)}</textarea>
            </div>

            <fieldset class="panel-condiciones">
                <legend>Condiciones</legend>
                <label><input type="checkbox" name="esNuevoVotante" ${marcado(cond.esNuevoVotante)}> Nuevo votante</label>
                <label><input type="checkbox" name="estaFallecido" ${marcado(cond.estaFallecido)}> Fallecido</label>
                <label><input type="checkbox" name="esEmpleadoMunicipal" ${marcado(cond.esEmpleadoMunicipal)}> Empleado municipal</label>
                <label><input type="checkbox" name="recibeAyudaSocial" ${marcado(cond.recibeAyudaSocial)}> Recibe ayuda social</label>
            </fieldset>

            <footer class="panel-acciones">
                <button class="btn btn-secondary" onclick="padronComponent.cerrarPanel()">Cancelar</button>
                <button class="btn btn-primary" id="panel-guardar" data-requires-permission="padron.edit"
                        onclick="padronComponent.guardarPanel()">Guardar</button>
            </footer>
        `;

        document.body.appendChild(panel);
        document.querySelector(`tr[data-dni="${dni}"]`)?.classList.add('fila-abierta');

        // El foco entra al panel para que se pueda cargar sin tocar el mouse, y Escape
        // lo cierra, que es lo que espera cualquiera frente a algo que se abre encima.
        panel.querySelector('#panel-telefono')?.focus();
        this._cerrarConEscape = (evento) => { if (evento.key === 'Escape') this.cerrarPanel(); };
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
                <i class="fas fa-exclamation-triangle"></i>
                ${quien} modificó esta ficha mientras la editabas
            </p>
            ${campos.map(campo => `
                <div class="conflicto-campo">
                    <span class="conflicto-etiqueta">${campo === 'telefono' ? 'Teléfono' : 'Observación'} en el servidor</span>
                    <p class="conflicto-valor">${escaparHtml(suyo[campo]) || '<em>vacío</em>'}</p>
                </div>
            `).join('')}
            <div class="conflicto-acciones">
                <button class="btn btn-secondary" onclick="padronComponent.descartarMisCambios()">
                    Quedarme con lo del servidor
                </button>
                <button class="btn btn-primary" onclick="padronComponent.guardarPanel()">
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

        this.cerrarPanel();
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
        const fila = document.querySelector(`tr[data-dni="${dni}"]`);
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

    cerrarPanel() {
        // Cerrar también cancela cualquier apertura en vuelo: si alguien cierra mientras
        // la ficha se está leyendo, no tiene que aparecer sola medio segundo después.
        this.fichaPedida = null;

        document.getElementById('panel-votante')?.remove();
        document.querySelector('tr.fila-abierta')?.classList.remove('fila-abierta');
        if (this._cerrarConEscape) {
            document.removeEventListener('keydown', this._cerrarConEscape);
            this._cerrarConEscape = null;
        }
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
        const textoOriginal = boton.textContent;

        boton.disabled = true;
        boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';

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
                boton.disabled = false;
                boton.textContent = textoOriginal;
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
            this.cerrarPanel();
            await this.actualizarTabla();
        } catch (error) {
            this.mostrarError(`No se pudo guardar: ${error.message}`);
            boton.disabled = false;
            boton.textContent = textoOriginal;
        }
    }

    /**
     * Renderizar radio buttons para opciones políticas
     */
    renderizarRadioButtons(dni, opcionSeleccionada) {
        const opciones = ['PJ', 'UCR', 'Indeciso'];
        // El DNI viene del CSV importado, así que es dato de usuario aunque parezca un
        // número. Las opciones salen de esta lista de acá, no de la base.
        const dniSeguro = escaparHtml(dni);

        return opciones.map(opcion => `
            <label class="radio-label ${opcionSeleccionada === opcion ? 'selected' : ''}">
                <input type="radio"
                       name="opcion_${dniSeguro}"
                       value="${opcion}"
                       ${opcionSeleccionada === opcion ? 'checked' : ''}
                       onchange="padronComponent.cambiarOpcionPolitica('${dniSeguro}', '${opcion}')">
                <span class="radio-custom ${opcion.toLowerCase()}">${opcion}</span>
            </label>
        `).join('');
    }

    /**
     * Renderizar controles de paginación
     */
    renderizarPaginacion(paginacion) {
        const { paginaActual, totalPaginas } = paginacion;
        
        if (totalPaginas <= 1) {
            this.elementos.paginacion.innerHTML = '';
            return;
        }

        let html = '<div class="paginacion">';
        
        // Botón anterior
        if (paginaActual > 1) {
            html += `<button class="btn-paginacion" onclick="padronComponent.irAPagina(${paginaActual - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>`;
        }

        // Números de página
        const inicio = Math.max(1, paginaActual - 2);
        const fin = Math.min(totalPaginas, paginaActual + 2);

        if (inicio > 1) {
            html += `<button class="btn-paginacion" onclick="padronComponent.irAPagina(1)">1</button>`;
            if (inicio > 2) html += '<span class="paginacion-dots">...</span>';
        }

        for (let i = inicio; i <= fin; i++) {
            html += `<button class="btn-paginacion ${i === paginaActual ? 'active' : ''}" 
                     onclick="padronComponent.irAPagina(${i})">${i}</button>`;
        }

        if (fin < totalPaginas) {
            if (fin < totalPaginas - 1) html += '<span class="paginacion-dots">...</span>';
            html += `<button class="btn-paginacion" onclick="padronComponent.irAPagina(${totalPaginas})">${totalPaginas}</button>`;
        }

        // Botón siguiente
        if (paginaActual < totalPaginas) {
            html += `<button class="btn-paginacion" onclick="padronComponent.irAPagina(${paginaActual + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>`;
        }

        html += '</div>';
        this.elementos.paginacion.innerHTML = html;
    }

    /**
     * Actualizar información de la tabla
     */
    actualizarInfoTabla(paginacion) {
        const inicio = paginacion?.inicio ?? 0;
        const fin = paginacion?.fin ?? 0;
        const totalRegistros = typeof paginacion?.totalRegistros === 'number' ? paginacion.totalRegistros : 0;
        this.elementos.info.textContent = 
            `Mostrando ${inicio} a ${fin} de ${totalRegistros.toLocaleString()} registros`;
    }

    /**
     * Cargar estadísticas rápidas
     */
    async actualizarEstadisticasRapidas() {
        try {
            const respuesta = await window.apiService.obtenerEstadisticas();
            if (respuesta?.rateLimited) {
                this.programarReintentoRateLimit(
                    'Limite de solicitudes alcanzado.',
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
                        <div class="avance-relleno" style="width: ${porcentajeCompletado}%"></div>
                    </div>
                    <div class="avance-porcentaje">${porcentajeCompletado}%</div>
                    <a class="avance-enlace" href="resultados.html">Ver resultados</a>
                </div>
            `;
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
            const fila = document.querySelector(`tr[data-dni="${dni}"]`);
            if (fila) {
                // Desseleccionar todos los labels de opciones políticas
                fila.querySelectorAll('.radio-label').forEach(label => {
                    label.classList.remove('selected');
                });

                // Seleccionar el label clickeado
                const inputSeleccionado = fila.querySelector(`input[name="opcion_${dni}"][value="${opcionPolitica}"]`);
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
                    `${quien} ya había marcado ${respuesta.actual?.opcionPolitica} en esta fila`,
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
            this.actualizarTabla();
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
        document.querySelectorAll('.sortable i').forEach(icon => {
            icon.className = 'fas fa-sort';
        });

        const columnaActiva = document.querySelector(`[data-campo="${this.estado.ordenamiento.campo}"] i`);
        if (columnaActiva) {
            columnaActiva.className = `fas fa-sort-${this.estado.ordenamiento.direccion === 'asc' ? 'up' : 'down'}`;
        }
    }

    /**
     * Aplicar filtros
     */
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
                    'Limite de solicitudes alcanzado.',
                    () => this.cargarDatos()
                );
                return false;
            }
            const filtros = respuesta?.data;

            const selectCircuito = document.getElementById('filtro-circuito');
            const circuitos = Array.isArray(filtros?.circuitos) ? filtros.circuitos : [];
            selectCircuito.innerHTML = '<option value="">Todos los circuitos</option>' +
                circuitos.map(c => `<option value="${c}">${c}</option>`).join('');
            return true;
        } catch (error) {
            console.error('Error al cargar filtros:', error);
            return true;
        }
    }

    // ==================== MODALES ====================

    abrirModalImportar() {
        document.getElementById('modal-importar').style.display = 'flex';
    }

    cerrarModalImportar() {
        document.getElementById('modal-importar').style.display = 'none';
        document.getElementById('archivo-csv').value = '';
    }

    async manejarArchivoCSV(event) {
        const archivo = event.target.files[0];
        if (!archivo) return;

        try {
            this.mostrarNotificacion('Importando archivo CSV...', 'info');
            const respuesta = await window.apiService.importarCSV(archivo);
            
            this.mostrarNotificacion(respuesta.message, 'success');
            this.cerrarModalImportar();
            await this.cargarDatos();
            
        } catch (error) {
            this.mostrarError(`Error al importar CSV: ${error.message}`);
        }
    }

    // Acá vivían mostrarEstadisticas() y cerrarModalEstadisticas(). El modal repetía
    // total de votantes, relevamientos y porcentaje: los mismos tres datos que la
    // franja de avance muestra sin abrir nada, y el análisis completo está en
    // Resultados, que ahora es un destino de la barra de navegación.

    abrirModalNuevoVotante() {
        // Poblar circuitos en el select del modal
        const selectCircuito = document.getElementById('nuevo-circuito');
        const filtroCircuito = document.getElementById('filtro-circuito');
        if (filtroCircuito && selectCircuito) {
            selectCircuito.innerHTML = '<option value="">Seleccionar circuito</option>';
            Array.from(filtroCircuito.options).forEach(opt => {
                if (opt.value) {
                    selectCircuito.innerHTML += `<option value="${opt.value}">${opt.textContent}</option>`;
                }
            });
        }

        // Limpiar formulario y estados de validación
        document.getElementById('form-nuevo-votante').reset();
        document.getElementById('error-nuevo-votante').style.display = 'none';
        document.getElementById('btn-guardar-votante').disabled = false;
        this.limpiarEstadosValidacion();

        document.getElementById('modal-nuevo-votante').style.display = 'flex';

        // Focus en el primer campo después de la animación
        setTimeout(() => {
            document.getElementById('nuevo-dni').focus();
        }, 300);
    }

    cerrarModalNuevoVotante() {
        document.getElementById('modal-nuevo-votante').style.display = 'none';
    }

    cerrarModalNuevoVotanteOverlay(event) {
        if (event.target === event.currentTarget) {
            this.cerrarModalNuevoVotante();
        }
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
            dniHelper.className = 'form-helper';

            if (val.length === 0) {
                dniHelper.textContent = 'Solo números, sin puntos ni espacios';
                return;
            }

            if (!/^\d*$/.test(val)) {
                dniInput.classList.add('input-invalid');
                dniValidationIcon.classList.add('is-invalid');
                dniHelper.textContent = 'Solo se permiten números';
                dniHelper.classList.add('helper-error');
            } else if (val.length < 7) {
                dniHelper.textContent = `${val.length} dígitos — mínimo 7`;
            } else {
                dniInput.classList.add('input-valid');
                dniValidationIcon.classList.add('is-valid');
                dniHelper.textContent = `${val.length} dígitos — DNI válido`;
                dniHelper.classList.add('helper-success');
            }
        });

        // Filtrar caracteres no numéricos en DNI
        dniInput.addEventListener('keypress', (e) => {
            if (!/\d/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab') {
                e.preventDefault();
            }
        });

        // Validación de campos requeridos on blur
        const validarRequerido = (input) => {
            input.addEventListener('blur', () => {
                if (input.value.trim() === '') {
                    input.classList.add('input-invalid');
                } else {
                    input.classList.remove('input-invalid');
                    input.classList.add('input-valid');
                }
            });
            input.addEventListener('input', () => {
                if (input.value.trim() !== '') {
                    input.classList.remove('input-invalid');
                }
            });
        };

        validarRequerido(apellidoInput);
        validarRequerido(nombreInput);

        // Cerrar modal con ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('modal-nuevo-votante');
                if (modal.style.display === 'flex') {
                    this.cerrarModalNuevoVotante();
                }
            }
        });
    }

    /**
     * Limpiar estados visuales de validación del formulario
     */
    limpiarEstadosValidacion() {
        const inputs = document.querySelectorAll('#form-nuevo-votante .form-input');
        inputs.forEach(input => {
            input.classList.remove('input-valid', 'input-invalid');
        });

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
        const errorDiv = document.getElementById('error-nuevo-votante');
        const errorText = document.getElementById('error-nuevo-votante-text');
        const btnGuardar = document.getElementById('btn-guardar-votante');
        errorDiv.style.display = 'none';

        const dni = document.getElementById('nuevo-dni').value.trim();
        const apellido = document.getElementById('nuevo-apellido').value.trim();
        const nombre = document.getElementById('nuevo-nombre').value.trim();
        const anioNac = document.getElementById('nuevo-anio-nac').value.trim();
        const sexo = document.getElementById('nuevo-sexo').value;
        const domicilio = document.getElementById('nuevo-domicilio').value.trim();
        const circuito = document.getElementById('nuevo-circuito').value;

        // Validar campos requeridos con feedback visual
        let hayError = false;
        if (!dni) {
            document.getElementById('nuevo-dni').classList.add('input-invalid');
            hayError = true;
        }
        if (!apellido) {
            document.getElementById('nuevo-apellido').classList.add('input-invalid');
            hayError = true;
        }
        if (!nombre) {
            document.getElementById('nuevo-nombre').classList.add('input-invalid');
            hayError = true;
        }

        if (hayError) {
            errorText.textContent = 'Completá los campos obligatorios: DNI, Apellido y Nombre';
            errorDiv.style.display = 'flex';
            // Scroll al primer campo con error
            const primerError = document.querySelector('#form-nuevo-votante .input-invalid');
            if (primerError) primerError.focus();
            return;
        }

        if (!/^\d+$/.test(dni)) {
            document.getElementById('nuevo-dni').classList.add('input-invalid');
            errorText.textContent = 'El DNI debe contener solo números';
            errorDiv.style.display = 'flex';
            document.getElementById('nuevo-dni').focus();
            return;
        }

        try {
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

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
            this.mostrarNotificacion('Votante creado exitosamente', 'success');
            await this.actualizarEstadisticasRapidas();
            await this.actualizarTabla();

        } catch (error) {
            errorText.textContent = error.message || 'Error al crear el votante';
            errorDiv.style.display = 'flex';
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = '<i class="fas fa-save"></i> Guardar Votante';
        }
    }

    async exportarDatos() {
        try {
            this.mostrarNotificacion('Generando exportacion CSV...', 'info');
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
            this.mostrarNotificacion('Generando exportacion del padron completo...', 'info');
            const blob = await window.apiService.exportarPadron();
            const nombreArchivo = `padron_completo_${new Date().toISOString().slice(0, 10)}.csv`;

            window.apiService.descargarArchivo(blob, nombreArchivo);
            this.mostrarNotificacion('Padron exportado correctamente', 'success');

        } catch (error) {
            this.mostrarError(`Error al exportar padron: ${error.message}`);
        }
    }

    verDetalles(dni) {
        // Usar el nuevo componente de detalles
        if (window.detalleVotanteComponent) {
            window.detalleVotanteComponent.abrirModalDetalles(dni);
        } else {
            this.mostrarNotificacion('Componente de detalles no disponible', 'error');
        }
    }

    // ==================== FUNCIONALIDAD MÓVIL ====================

    /**
     * Toggle filtros móviles
     */
    toggleFiltrosMobile() {
        const filtrosContainer = document.getElementById('filtros-container');
        filtrosContainer.classList.toggle('show');
        
        // Prevent body scroll when filters are open
        if (filtrosContainer.classList.contains('show')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    /**
     * Cerrar filtros móviles
     */
    cerrarFiltrosMobile() {
        const filtrosContainer = document.getElementById('filtros-container');
        filtrosContainer.classList.remove('show');
        document.body.style.overflow = '';
        
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
     * Detectar si es dispositivo táctil
     */
    isTouchDevice() {
        return (('ontouchstart' in window) ||
                (navigator.maxTouchPoints > 0) ||
                (navigator.msMaxTouchPoints > 0));
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
        // Aquí se podría agregar un spinner o indicador de carga
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
            this.mostrarBannerRateLimit(`${motivo} Intenta de nuevo en unos minutos.`, true);
            return;
        }

        const baseDelay = 2000;
        const delay = Math.min(20000, baseDelay * 2 ** this.rateLimit.retries);
        const jitter = Math.floor(Math.random() * 500);
        const delayMs = delay + jitter;
        const segundos = Math.ceil(delayMs / 1000);

        this.mostrarBannerRateLimit(`${motivo} Reintentando en ${segundos}s...`, true);

        this.rateLimit.timerId = setTimeout(async () => {
            this.rateLimit.timerId = null;
            this.rateLimit.retries += 1;
            await accion();
        }, delayMs);
    }

    mostrarNotificacion(mensaje, tipo = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${tipo}`;

        // El mensaje entra como texto, no como HTML. Media docena de llamadores le
        // interpolan cosas que no controlan —`error.message`, el nombre de quien editó
        // una ficha—, así que armar esto con innerHTML dejaba abierta una segunda puerta,
        // más difícil de ver que la de la tabla porque acá el dato no parece un dato.
        const contenido = document.createElement('div');
        contenido.className = 'notification-content';

        const icono = document.createElement('i');
        icono.className = `fas ${this.getIconoTipo(tipo)}`;

        contenido.appendChild(icono);
        contenido.appendChild(document.createTextNode(` ${mensaje}`));
        notification.appendChild(contenido);

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
        }, 5000);
    }

    mostrarError(mensaje) {
        this.mostrarNotificacion(mensaje, 'error');
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

    getIconoTipo(tipo) {
        const iconos = {
            info: 'fa-info-circle',
            success: 'fa-check-circle',
            warning: 'fa-exclamation-triangle',
            error: 'fa-times-circle'
        };
        return iconos[tipo] || iconos.info;
    }
}

// Instancia global del componente
window.padronComponent = new PadronComponent();
console.log('🖥️ PadronComponent cargado correctamente');

// Función de diagnóstico
window.padronComponent.diagnosticar = function() {
    console.log('🔍 Diagnóstico PadronComponent:');
    console.log('  - Componente creado:', !!this);
    console.log('  - Container asignado:', !!this.container);
    console.log('  - Estado:', this.estado);
};