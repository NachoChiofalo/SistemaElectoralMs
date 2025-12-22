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
    }

    /**
     * Inicializar el componente
     */
    async init(containerId = 'padron-container') {
        console.log('🖥️ Inicializando componente de Padrón...');
        
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Contenedor ${containerId} no encontrado`);
        }

        // Verificar conexión con API
        const apiDisponible = await window.apiService.verificarEstado();
        if (!apiDisponible) {
            this.mostrarError('No se puede conectar con el servicio de padrón. Verifique que esté ejecutándose en el puerto 3001.');
            return false;
        }

        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargarDatos();

        console.log('✅ Componente de Padrón inicializado');
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
                    <button id="btn-importar" class="btn btn-primary" title="Importar datos desde archivo CSV">
                        <i class="fas fa-upload"></i> <span class="btn-text">Importar CSV</span>
                    </button>
                    <button id="btn-exportar" class="btn btn-secondary" title="Exportar datos actuales">
                        <i class="fas fa-download"></i> <span class="btn-text">Exportar</span>
                    </button>
                    <button id="btn-estadisticas" class="btn btn-info" title="Ver estadísticas detalladas">
                        <i class="fas fa-chart-pie"></i> <span class="btn-text">Estadísticas</span>
                    </button>
                    <button id="btn-filtros-mobile" class="btn btn-outline mobile-only" title="Mostrar/ocultar filtros">
                        <i class="fas fa-filter"></i>
                    </button>
                </div>
            </div>

            <div id="estadisticas-rapidas" class="padron-estadisticas-rapidas">
                <!-- Estadísticas se cargan dinámicamente -->
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
                            <i class="fas fa-search"></i> Buscar
                        </label>
                        <input type="text" id="filtro-busqueda" placeholder="DNI, nombre, apellido..." aria-label="Buscar por DNI, nombre o apellido">
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-circuito">
                            <i class="fas fa-map-marker-alt"></i> Circuito
                        </label>
                        <select id="filtro-circuito" aria-label="Filtrar por circuito">
                            <option value="">Todos los circuitos</option>
                        </select>
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-sexo">
                            <i class="fas fa-venus-mars"></i> Sexo
                        </label>
                        <select id="filtro-sexo" aria-label="Filtrar por sexo">
                            <option value="">Todos</option>
                            <option value="M">Masculino</option>
                            <option value="F">Femenino</option>
                        </select>
                    </div>
                    <div class="filtro-item">
                        <label for="filtro-opcion-politica">
                            <i class="fas fa-poll"></i> Opción Política
                        </label>
                        <select id="filtro-opcion-politica" aria-label="Filtrar por opción política">
                            <option value="">Todas</option>
                            <option value="PJ">PJ</option>
                            <option value="UCR">UCR</option>
                            <option value="Indeciso">Indeciso</option>
                        </select>
                    </div>
                    <div class="filtro-item filtro-checkbox">
                        <label for="filtro-sin-relevamiento">
                            <input type="checkbox" id="filtro-sin-relevamiento" aria-label="Mostrar solo registros sin relevamiento">
                            <span class="checkmark"></span>
                            Sin Relevamiento
                        </label>
                    </div>
                    </div>
                    <div class="filtro-item">
                        <button id="btn-aplicar-filtros" class="btn btn-primary">Filtrar</button>
                        <button id="btn-limpiar-filtros" class="btn btn-secondary">Limpiar</button>
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
                                <th>Observación</th>
                                <th>Condiciones</th>
                                <th>Acciones</th>
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

            <!-- Modal para estadísticas -->
            <div id="modal-estadisticas" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-large">
                    <div class="modal-header">
                        <h3>Estadísticas del Padrón Electoral</h3>
                        <button class="modal-close" onclick="padronComponent.cerrarModalEstadisticas()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" id="estadisticas-completas">
                        <!-- Estadísticas se cargan dinámicamente -->
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
            estadisticasRapidas: document.getElementById('estadisticas-rapidas')
        };
    }

    /**
     * Inicializar eventos
     */
    inicializarEventos() {
        // Botones principales
        document.getElementById('btn-importar').addEventListener('click', () => this.abrirModalImportar());
        document.getElementById('btn-exportar').addEventListener('click', () => this.exportarDatos());
        document.getElementById('btn-estadisticas').addEventListener('click', () => this.mostrarEstadisticas());

        // Botones móviles
        const btnFiltrosMobile = document.getElementById('btn-filtros-mobile');
        if (btnFiltrosMobile) {
            btnFiltrosMobile.addEventListener('click', () => this.toggleFiltrosMobile());
        }

        const btnCerrarFiltros = document.getElementById('btn-cerrar-filtros');
        if (btnCerrarFiltros) {
            btnCerrarFiltros.addEventListener('click', () => this.cerrarFiltrosMobile());
        }

        // Filtros
        document.getElementById('btn-aplicar-filtros').addEventListener('click', () => this.aplicarFiltros());
        document.getElementById('btn-limpiar-filtros').addEventListener('click', () => this.limpiarFiltros());

        // Auto-aplicar filtros en móvil cuando cambian
        if (window.innerWidth <= 768) {
            document.getElementById('filtro-busqueda').addEventListener('input', this.debounce(() => this.aplicarFiltros(), 500));
            document.getElementById('filtro-circuito').addEventListener('change', () => this.aplicarFiltros());
            document.getElementById('filtro-sexo').addEventListener('change', () => this.aplicarFiltros());
            document.getElementById('filtro-opcion-politica').addEventListener('change', () => this.aplicarFiltros());
            document.getElementById('filtro-sin-relevamiento').addEventListener('change', () => this.aplicarFiltros());
        }

        // Evento de redimensionado de ventana
        window.addEventListener('resize', () => this.handleResize());

        // Cerrar filtros móviles al tocar fuera (en el overlay)
        document.addEventListener('click', (e) => {
            const filtrosContainer = document.getElementById('filtros-container');
            if (filtrosContainer.classList.contains('show') && 
                !filtrosContainer.contains(e.target) && 
                !document.getElementById('btn-filtros-mobile').contains(e.target)) {
                this.cerrarFiltrosMobile();
            }
        });

        // Cambiar registros por página
        document.getElementById('registros-por-pagina').addEventListener('change', () => this.cambiarRegistrosPorPagina());

        // Ordenamiento de tabla
        this.elementos.tabla.addEventListener('click', (e) => {
            if (e.target.closest('.sortable')) {
                const campo = e.target.closest('.sortable').dataset.campo;
                this.cambiarOrdenamiento(campo);
            }
        });

        // Importar CSV
        document.getElementById('archivo-csv').addEventListener('change', (e) => this.manejarArchivoCSV(e));

        // Enter en búsqueda
        document.getElementById('filtro-busqueda').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.aplicarFiltros();
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
            await this.cargarFiltrosDisponibles();
            
            // Cargar estadísticas rápidas
            await this.actualizarEstadisticasRapidas();
            
            // Cargar votantes
            await this.actualizarTabla();
            
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
                ordenDireccion: this.estado.ordenamiento.direccion
            };

            const respuesta = await window.apiService.obtenerVotantes(parametros);
            
            // Cargar detalles de votantes si están disponibles
            const votantesConDetalles = await this.enriquecerConDetalles(respuesta.data);
            
            this.renderizarTabla(votantesConDetalles);
            this.renderizarPaginacion(respuesta.paginacion);
            this.actualizarInfoTabla(respuesta.paginacion);
            
        } catch (error) {
            this.mostrarError(`Error al cargar votantes: ${error.message}`);
        } finally {
            this.mostrarCargando(false);
        }
    }

    /**
     * Renderizar tabla con datos
     */
    renderizarTabla(votantes) {
        if (votantes.length === 0) {
            this.elementos.tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="sin-datos">
                        <i class="fas fa-users"></i>
                        No se encontraron votantes con los criterios seleccionados
                    </td>
                </tr>
            `;
            return;
        }

        this.elementos.tbody.innerHTML = votantes.map(item => {
            const { votante, relevamiento, detalle } = item;
            const opcionPolitica = relevamiento?.opcionPolitica || '';
            const observacion = relevamiento?.observacion || '';

            return `
                <tr class="fila-votante ${relevamiento ? 'con-relevamiento' : 'sin-relevamiento'}" data-dni="${votante.dni}">
                    <td class="dni" data-label="DNI">${votante.dni}</td>
                    <td class="apellido" data-label="Apellido">${votante.apellido}</td>
                    <td data-label="Nombre">${votante.nombre}</td>
                    <td class="edad" data-label="Edad">${votante.edad}</td>
                    <td data-label="Circuito">${votante.circuito}</td>
                    <td data-label="Sexo">${votante.sexo}</td>
                    <td data-label="Opción Política">
                        <div class="radio-group">
                            ${this.renderizarRadioButtons(votante.dni, opcionPolitica)}
                        </div>
                    </td>
                    <td data-label="Observación">
                        <input type="text" 
                               class="observacion-input" 
                               placeholder="Observación..."
                               value="${observacion}"
                               onchange="padronComponent.actualizarObservacion('${votante.dni}', this.value)">
                    </td>
                    <td data-label="Condiciones" class="condiciones-cell">
                        ${this.renderizarCondicionesInline(votante.dni, detalle)}
                    </td>
                    <td class="acciones" data-label="Acciones">
                        <button class="btn-icon btn-sm btn-guardar-inline" onclick="padronComponent.guardarCondicionesInline('${votante.dni}')" title="Guardar condiciones especiales">
                            <i class="fas fa-save"></i> <span class="desktop-only">Guardar</span>
                        </button>
                        ${detalle && detalle.observaciones ? `<button class="btn-icon btn-sm btn-gestionar" onclick="padronComponent.verDetalles('${votante.dni}')" title="Ver observaciones detalladas">
                            <i class="fas fa-eye"></i>
                        </button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    /**
     * Renderizar radio buttons para opciones políticas
     */
    renderizarRadioButtons(dni, opcionSeleccionada) {
        const opciones = ['PJ', 'UCR', 'Indeciso'];
        
        return opciones.map(opcion => `
            <label class="radio-label ${opcionSeleccionada === opcion ? 'selected' : ''}">
                <input type="radio" 
                       name="opcion_${dni}" 
                       value="${opcion}"
                       ${opcionSeleccionada === opcion ? 'checked' : ''}
                       onchange="padronComponent.cambiarOpcionPolitica('${dni}', '${opcion}')">
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
        const { inicio, fin, totalRegistros } = paginacion;
        this.elementos.info.textContent = 
            `Mostrando ${inicio} a ${fin} de ${totalRegistros.toLocaleString()} registros`;
    }

    /**
     * Cargar estadísticas rápidas
     */
    async actualizarEstadisticasRapidas() {
        try {
            const respuesta = await window.apiService.obtenerEstadisticas();
            const stats = respuesta.data;

            this.elementos.estadisticasRapidas.innerHTML = `
                <div class="estadisticas-grid">
                    <div class="stat-card total">
                        <div class="stat-icon">
                            <i class="fas fa-users"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-number">${stats.totalVotantes.toLocaleString()}</div>
                            <div class="stat-label">Total Votantes</div>
                        </div>
                    </div>
                    
                    <div class="stat-card completados">
                        <div class="stat-icon">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-number">${stats.totalRelevamientos.toLocaleString()}</div>
                            <div class="stat-label">Relevamientos</div>
                            <div class="stat-progress">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${stats.porcentajeCompletado}%"></div>
                                </div>
                                <span class="progress-text">${stats.porcentajeCompletado}%</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="stat-card pj">
                        <div class="stat-icon">
                            <i class="fas fa-flag"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-number">${stats.estadisticasPoliticas.PJ || 0}</div>
                            <div class="stat-label">PJ</div>
                        </div>
                    </div>
                    
                    <div class="stat-card ucr">
                        <div class="stat-icon">
                            <i class="fas fa-flag"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-number">${stats.estadisticasPoliticas.UCR || 0}</div>
                            <div class="stat-label">UCR</div>
                        </div>
                    </div>
                    
                    <div class="stat-card indeciso">
                        <div class="stat-icon">
                            <i class="fas fa-question-circle"></i>
                        </div>
                        <div class="stat-content">
                            <div class="stat-number">${stats.estadisticasPoliticas.Indeciso || 0}</div>
                            <div class="stat-label">Indecisos</div>
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error al cargar estadísticas:', error);
        }
    }

    // ==================== EVENTOS Y ACCIONES ====================

    /**
     * Cambiar opción política de un votante
     */
    async cambiarOpcionPolitica(dni, opcionPolitica) {
        try {
            await window.apiService.actualizarRelevamiento(dni, opcionPolitica);
            this.mostrarNotificacion('Relevamiento actualizado', 'success');
            await this.actualizarEstadisticasRapidas();
        } catch (error) {
            this.mostrarError(`Error al actualizar relevamiento: ${error.message}`);
        }
    }

    /**
     * Actualizar observación de un votante
     */
    async actualizarObservacion(dni, observacion) {
        try {
            // Obtener opción política actual
            const relevamiento = await window.apiService.obtenerRelevamiento(dni);
            const opcionPolitica = relevamiento.data?.opcionPolitica || 'Indeciso';
            
            await window.apiService.actualizarRelevamiento(dni, opcionPolitica, observacion);
            this.mostrarNotificacion('Observación actualizada', 'success');
        } catch (error) {
            this.mostrarError(`Error al actualizar observación: ${error.message}`);
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
            const filtros = respuesta.data;

            const selectCircuito = document.getElementById('filtro-circuito');
            selectCircuito.innerHTML = '<option value="">Todos los circuitos</option>' +
                filtros.circuitos.map(c => `<option value="${c}">${c}</option>`).join('');
                
        } catch (error) {
            console.error('Error al cargar filtros:', error);
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

    async mostrarEstadisticas() {
        try {
            const respuesta = await window.apiService.obtenerEstadisticas();
            const stats = respuesta.data;

            // Renderizar estadísticas completas (implementación básica)
            document.getElementById('estadisticas-completas').innerHTML = `
                <div class="stats-row">
                    <div class="stats-col">
                        <h4>Resumen General</h4>
                        <div class="resumen-general">
                            <div class="resumen-item">
                                <label>Total de Votantes:</label>
                                <span>${stats.totalVotantes.toLocaleString()}</span>
                            </div>
                            <div class="resumen-item">
                                <label>Relevamientos Completados:</label>
                                <span>${stats.totalRelevamientos.toLocaleString()}</span>
                            </div>
                            <div class="resumen-item">
                                <label>Porcentaje de Avance:</label>
                                <span>${stats.porcentajeCompletado}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.getElementById('modal-estadisticas').style.display = 'flex';
        } catch (error) {
            this.mostrarError(`Error al cargar estadísticas: ${error.message}`);
        }
    }

    cerrarModalEstadisticas() {
        document.getElementById('modal-estadisticas').style.display = 'none';
    }

    async exportarDatos() {
        try {
            this.mostrarNotificacion('Generando exportación...', 'info');
            const blob = await window.apiService.exportarDatos();
            const nombreArchivo = `padron_electoral_${new Date().toISOString().slice(0, 10)}.json`;
            
            window.apiService.descargarArchivo(blob, nombreArchivo);
            this.mostrarNotificacion('Datos exportados correctamente', 'success');
            
        } catch (error) {
            this.mostrarError(`Error al exportar datos: ${error.message}`);
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

    mostrarNotificacion(mensaje, tipo = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${tipo}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas ${this.getIconoTipo(tipo)}"></i>
                ${mensaje}
            </div>
        `;

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

    /**
     * Renderizar iconos de condiciones especiales
     * @private
     */
    renderizarCondicionesEspeciales(detalle) {
        if (!detalle) return '<span class="sin-condiciones">-</span>';

        const iconos = [];
        
        if (detalle.esNuevoVotante) {
            iconos.push('<i class="fas fa-user-plus icon-nuevo" title="Nuevo Votante"></i>');
        }
        
        if (detalle.estaFallecido) {
            iconos.push('<i class="fas fa-cross icon-fallecido" title="Fallecido"></i>');
        }
        
        if (detalle.esEmpleadoMunicipal) {
            iconos.push('<i class="fas fa-building icon-empleado" title="Empleado Municipal"></i>');
        }
        
        if (detalle.recibeAyudaSocial) {
            iconos.push('<i class="fas fa-hands-helping icon-ayuda" title="Recibe Ayuda Social"></i>');
        }

        return iconos.length > 0 ? `<span class="condiciones-iconos">${iconos.join(' ')}</span>` : '<span class="sin-condiciones">-</span>';
    }

    /**
     * Renderizar controles inline para condiciones especiales
     * @private
     */
    renderizarCondicionesInline(dni, detalle) {
        const condiciones = detalle || {
            esNuevoVotante: false,
            estaFallecido: false,
            esEmpleadoMunicipal: false,
            recibeAyudaSocial: false,
            observaciones: ''
        };

        return `
            <div class="condiciones-inline" data-dni="${dni}">
                <div class="condiciones-checkboxes">
                    <label class="checkbox-inline" title="Nuevo Votante">
                        <input type="checkbox" 
                               name="esNuevoVotante" 
                               ${condiciones.esNuevoVotante ? 'checked' : ''}
                               onchange="padronComponent.marcarCambioCondicion('${dni}')">
                        <i class="fas fa-user-plus icon-nuevo"></i>
                    </label>
                    
                    <label class="checkbox-inline" title="Fallecido">
                        <input type="checkbox" 
                               name="estaFallecido" 
                               ${condiciones.estaFallecido ? 'checked' : ''}
                               onchange="padronComponent.marcarCambioCondicion('${dni}')">
                        <i class="fas fa-cross icon-fallecido"></i>
                    </label>
                    
                    <label class="checkbox-inline" title="Empleado Municipal">
                        <input type="checkbox" 
                               name="esEmpleadoMunicipal" 
                               ${condiciones.esEmpleadoMunicipal ? 'checked' : ''}
                               onchange="padronComponent.marcarCambioCondicion('${dni}')">
                        <i class="fas fa-building icon-empleado"></i>
                    </label>
                    
                    <label class="checkbox-inline" title="Recibe Ayuda Social">
                        <input type="checkbox" 
                               name="recibeAyudaSocial" 
                               ${condiciones.recibeAyudaSocial ? 'checked' : ''}
                               onchange="padronComponent.marcarCambioCondicion('${dni}')">
                        <i class="fas fa-hands-helping icon-ayuda"></i>
                    </label>
                </div>
                ${condiciones.observaciones ? `<small class="observaciones-preview" title="${condiciones.observaciones}">
                    <i class="fas fa-comment"></i> ${condiciones.observaciones.substring(0, 20)}...
                </small>` : ''}
            </div>
        `;
    }

    /**
     * Marcar que hubo cambios en las condiciones para mostrar el botón guardar
     */
    marcarCambioCondicion(dni) {
        const fila = document.querySelector(`tr[data-dni="${dni}"]`);
        if (fila) {
            fila.classList.add('condiciones-modificadas');
            const botonGuardar = fila.querySelector('.btn-guardar-inline');
            if (botonGuardar) {
                botonGuardar.style.opacity = '1';
                botonGuardar.disabled = false;
            }
        }
    }

    /**
     * Guardar condiciones especiales inline
     */
    async guardarCondicionesInline(dni) {
        try {
            const fila = document.querySelector(`tr[data-dni="${dni}"]`);
            if (!fila) return;

            const condicionesContainer = fila.querySelector('.condiciones-inline');
            const checkboxes = condicionesContainer.querySelectorAll('input[type="checkbox"]');

            const condiciones = {};
            checkboxes.forEach(checkbox => {
                condiciones[checkbox.name] = checkbox.checked;
            });

            const botonGuardar = fila.querySelector('.btn-guardar-inline');
            botonGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            botonGuardar.disabled = true;

            const response = await window.apiService.request('/padron/detalle-votante', {
                method: 'POST',
                body: JSON.stringify({ dni, condiciones })
            });

            this.mostrarNotificacion('Condiciones guardadas correctamente', 'success');
            fila.classList.remove('condiciones-modificadas');
            botonGuardar.style.opacity = '0.5';
            botonGuardar.innerHTML = '<i class="fas fa-save"></i> <span class="desktop-only">Guardar</span>';

        } catch (error) {
            this.mostrarError(`Error al guardar condiciones: ${error.message}`);
        }
    }

    /**
     * Enriquecer votantes con sus detalles (condiciones especiales)
     * @private
     */
    async enriquecerConDetalles(votantes) {
        try {
            const votantesConDetalles = [];
            
            // Procesar de a lotes para evitar sobrecarga
            const loteSize = 10;
            for (let i = 0; i < votantes.length; i += loteSize) {
                const lote = votantes.slice(i, i + loteSize);
                
                const promesasDetalle = lote.map(async (item) => {
                    try {
                        const response = await window.apiService.request(`/padron/detalle-votante/${item.votante.dni}`);
                        
                        if (response.success && response.data) {
                            return { ...item, detalle: response.data };
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
console.log('🖥️ PadronComponent cargado');