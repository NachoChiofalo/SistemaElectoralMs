// AuditoriaComponent.js
// Componente para visualizar y filtrar registros de auditoria

(function(global) {

    const OPERACIONES = {
        'CREAR_VOTANTE': { label: 'Crear Votante', icon: 'fa-user-plus', clase: 'crear-votante' },
        'ACTUALIZAR_RELEVAMIENTO': { label: 'Actualizar Relev.', icon: 'fa-edit', clase: 'actualizar-relevamiento' },
        'CREAR_DETALLE': { label: 'Crear Detalle', icon: 'fa-plus-circle', clase: 'crear-detalle' },
        'ACTUALIZAR_DETALLE': { label: 'Actualizar Detalle', icon: 'fa-pen', clase: 'actualizar-detalle' },
        'ELIMINAR_DETALLE': { label: 'Eliminar Detalle', icon: 'fa-trash', clase: 'eliminar-detalle' },
        'IMPORTAR_CSV': { label: 'Importar CSV', icon: 'fa-file-csv', clase: 'importar-csv' },
        'EXPORTAR_DATOS': { label: 'Exportar Datos', icon: 'fa-download', clase: 'exportar-datos' }
    };

    class AuditoriaComponent {
        constructor() {
            this.containerId = null;
            this.registros = [];
            this.estadisticas = null;
            this.paginacion = { paginaActual: 1, totalPaginas: 1, totalRegistros: 0 };
            this.filtros = {
                operacion: '',
                fecha_desde: '',
                fecha_hasta: '',
                page: 1,
                limit: 25
            };
        }

        async init(containerId) {
            this.containerId = containerId;
            this.render();
            await this.cargarDatos();
        }

        render() {
            const container = document.getElementById(this.containerId);
            if (!container) return;

            container.innerHTML = `
                <div class="auditoria-container">
                    <div class="auditoria-header">
                        <h1><i class="fas fa-clipboard-list"></i> Auditoria del Padron</h1>
                    </div>

                    <div id="auditoria-stats" class="auditoria-stats">
                        ${this.renderStatsLoading()}
                    </div>

                    <div class="auditoria-filtros">
                        <div class="filtros-grid">
                            <div class="filtro-group">
                                <label>Operacion</label>
                                <select id="filtro-operacion">
                                    <option value="">Todas</option>
                                    ${Object.entries(OPERACIONES).map(([key, val]) =>
                                        `<option value="${key}">${val.label}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="filtro-group">
                                <label>Desde</label>
                                <input type="date" id="filtro-fecha-desde">
                            </div>
                            <div class="filtro-group">
                                <label>Hasta</label>
                                <input type="date" id="filtro-fecha-hasta">
                            </div>
                            <div class="filtros-acciones">
                                <button class="btn btn-primary" id="btn-filtrar">
                                    <i class="fas fa-search"></i> Filtrar
                                </button>
                                <button class="btn btn-secondary" id="btn-limpiar">
                                    <i class="fas fa-times"></i> Limpiar
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="auditoria-tabla-wrapper">
                        <div class="auditoria-loading">
                            <i class="fas fa-spinner"></i>
                            <p>Cargando registros de auditoria...</p>
                        </div>
                    </div>
                </div>
            `;

            this.setupEventListeners();
        }

        setupEventListeners() {
            const btnFiltrar = document.getElementById('btn-filtrar');
            const btnLimpiar = document.getElementById('btn-limpiar');

            if (btnFiltrar) {
                btnFiltrar.addEventListener('click', () => this.aplicarFiltros());
            }
            if (btnLimpiar) {
                btnLimpiar.addEventListener('click', () => this.limpiarFiltros());
            }
        }

        async cargarDatos() {
            try {
                const [auditoriaRes, statsRes] = await Promise.all([
                    window.apiService.obtenerAuditoria(this.filtros),
                    window.apiService.obtenerEstadisticasAuditoria({
                        fecha_desde: this.filtros.fecha_desde,
                        fecha_hasta: this.filtros.fecha_hasta
                    })
                ]);

                if (auditoriaRes && auditoriaRes.success) {
                    this.registros = auditoriaRes.data || [];
                    this.paginacion = auditoriaRes.paginacion || { paginaActual: 1, totalPaginas: 1, totalRegistros: 0 };
                }

                if (statsRes && statsRes.success) {
                    this.estadisticas = statsRes.data;
                }

                this.renderStats();
                this.renderTabla();
            } catch (error) {
                console.error('Error cargando auditoria:', error);
                this.renderError();
            }
        }

        renderStatsLoading() {
            return `
                <div class="stat-card"><div class="auditoria-loading"><i class="fas fa-spinner"></i></div></div>
                <div class="stat-card"><div class="auditoria-loading"><i class="fas fa-spinner"></i></div></div>
                <div class="stat-card"><div class="auditoria-loading"><i class="fas fa-spinner"></i></div></div>
            `;
        }

        renderStats() {
            const statsContainer = document.getElementById('auditoria-stats');
            if (!statsContainer || !this.estadisticas) return;

            const stats = this.estadisticas;
            const totalUsuarios = stats.porUsuario ? stats.porUsuario.length : 0;
            const opMasFrecuente = stats.porTipo && stats.porTipo.length > 0
                ? OPERACIONES[stats.porTipo[0].operacion]?.label || stats.porTipo[0].operacion
                : 'N/A';

            statsContainer.innerHTML = `
                <div class="stat-card">
                    <div class="stat-icon total"><i class="fas fa-list"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.totalOperaciones || 0}</div>
                        <div class="stat-label">Total operaciones</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon usuarios"><i class="fas fa-users"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${totalUsuarios}</div>
                        <div class="stat-label">Usuarios activos</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon operacion"><i class="fas fa-star"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${opMasFrecuente}</div>
                        <div class="stat-label">Operacion mas frecuente</div>
                    </div>
                </div>
            `;
        }

        renderTabla() {
            const wrapper = document.getElementById('auditoria-tabla-wrapper');
            if (!wrapper) return;

            if (this.registros.length === 0) {
                wrapper.innerHTML = `
                    <div class="auditoria-tabla-container">
                        <div class="auditoria-vacia">
                            <i class="fas fa-clipboard-check"></i>
                            <p>No se encontraron registros de auditoria</p>
                        </div>
                    </div>
                `;
                return;
            }

            wrapper.innerHTML = `
                <div class="auditoria-tabla-container">
                    <div class="auditoria-tabla-header">
                        <h3>Registros de Auditoria</h3>
                        <span class="registro-count">${this.paginacion.totalRegistros} registros encontrados</span>
                    </div>
                    <table class="auditoria-tabla">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Usuario</th>
                                <th>Operacion</th>
                                <th>Entidad</th>
                                <th>DNI/ID</th>
                                <th>Detalles</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.registros.map(r => this.renderFila(r)).join('')}
                        </tbody>
                    </table>
                    ${this.renderPaginacion()}
                </div>
            `;

            // Event listeners for row clicks
            wrapper.querySelectorAll('.fila-auditoria').forEach(fila => {
                fila.addEventListener('click', () => {
                    const id = fila.dataset.id;
                    const registro = this.registros.find(r => String(r.id) === id);
                    if (registro) this.mostrarDetalle(registro);
                });
            });

            // Pagination events
            const btnAnterior = document.getElementById('btn-pag-anterior');
            const btnSiguiente = document.getElementById('btn-pag-siguiente');
            if (btnAnterior) btnAnterior.addEventListener('click', () => this.cambiarPagina(-1));
            if (btnSiguiente) btnSiguiente.addEventListener('click', () => this.cambiarPagina(1));
        }

        renderFila(registro) {
            const op = OPERACIONES[registro.operacion] || { label: registro.operacion, icon: 'fa-circle', clase: '' };
            const fecha = new Date(registro.created_at);
            const fechaStr = fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const horaStr = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

            return `
                <tr class="fila-auditoria" data-id="${registro.id}">
                    <td>
                        <div class="fecha-texto">${fechaStr}</div>
                        <div class="fecha-texto">${horaStr}</div>
                    </td>
                    <td>
                        <div class="usuario-info">
                            <span class="usuario-nombre">${this.escapeHtml(registro.usuario_nombre)}</span>
                            <span class="usuario-username">@${this.escapeHtml(registro.usuario_username)}</span>
                        </div>
                    </td>
                    <td>
                        <span class="badge-operacion ${op.clase}">
                            <i class="fas ${op.icon}"></i> ${op.label}
                        </span>
                    </td>
                    <td>${this.escapeHtml(registro.entidad)}</td>
                    <td>${registro.entidad_id ? this.escapeHtml(registro.entidad_id) : '-'}</td>
                    <td>${registro.detalles ? this.escapeHtml(this.truncar(registro.detalles, 50)) : '-'}</td>
                </tr>
            `;
        }

        renderPaginacion() {
            const { paginaActual, totalPaginas } = this.paginacion;
            return `
                <div class="auditoria-paginacion">
                    <button class="btn-pag" id="btn-pag-anterior" ${paginaActual <= 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> Anterior
                    </button>
                    <span class="pag-info">Pagina ${paginaActual} de ${totalPaginas}</span>
                    <button class="btn-pag" id="btn-pag-siguiente" ${paginaActual >= totalPaginas ? 'disabled' : ''}>
                        Siguiente <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            `;
        }

        mostrarDetalle(registro) {
            const op = OPERACIONES[registro.operacion] || { label: registro.operacion, icon: 'fa-circle', clase: '' };
            const fecha = new Date(registro.created_at);
            const fechaCompleta = fecha.toLocaleString('es-AR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            const datosAnteriores = registro.datos_anteriores
                ? JSON.stringify(registro.datos_anteriores, null, 2)
                : null;
            const datosNuevos = registro.datos_nuevos
                ? JSON.stringify(registro.datos_nuevos, null, 2)
                : null;

            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i class="fas ${op.icon}"></i> Detalle de Operacion</h3>
                        <button class="modal-close" id="modal-close-btn"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body">
                        <div class="detalle-campo">
                            <div class="campo-label">Operacion</div>
                            <div class="campo-valor">
                                <span class="badge-operacion ${op.clase}">
                                    <i class="fas ${op.icon}"></i> ${op.label}
                                </span>
                            </div>
                        </div>
                        <div class="detalle-campo">
                            <div class="campo-label">Fecha y Hora</div>
                            <div class="campo-valor">${fechaCompleta}</div>
                        </div>
                        <div class="detalle-campo">
                            <div class="campo-label">Usuario</div>
                            <div class="campo-valor">${this.escapeHtml(registro.usuario_nombre)} (@${this.escapeHtml(registro.usuario_username)})</div>
                        </div>
                        <div class="detalle-campo">
                            <div class="campo-label">Entidad</div>
                            <div class="campo-valor">${this.escapeHtml(registro.entidad)} ${registro.entidad_id ? '(ID: ' + this.escapeHtml(registro.entidad_id) + ')' : ''}</div>
                        </div>
                        ${registro.detalles ? `
                        <div class="detalle-campo">
                            <div class="campo-label">Descripcion</div>
                            <div class="campo-valor">${this.escapeHtml(registro.detalles)}</div>
                        </div>
                        ` : ''}
                        ${registro.ip_address ? `
                        <div class="detalle-campo">
                            <div class="campo-label">Direccion IP</div>
                            <div class="campo-valor">${this.escapeHtml(registro.ip_address)}</div>
                        </div>
                        ` : ''}
                        ${(datosAnteriores || datosNuevos) ? `
                        <div class="detalle-campo">
                            <div class="campo-label">Datos</div>
                            <div class="datos-comparacion">
                                ${datosAnteriores ? `
                                <div class="datos-col">
                                    <h4>Antes</h4>
                                    <div class="datos-json">${this.escapeHtml(datosAnteriores)}</div>
                                </div>
                                ` : ''}
                                ${datosNuevos ? `
                                <div class="datos-col">
                                    <h4>Despues</h4>
                                    <div class="datos-json">${this.escapeHtml(datosNuevos)}</div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Close handlers
            const closeBtn = modal.querySelector('#modal-close-btn');
            closeBtn.addEventListener('click', () => modal.remove());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        }

        aplicarFiltros() {
            this.filtros.operacion = document.getElementById('filtro-operacion')?.value || '';
            this.filtros.fecha_desde = document.getElementById('filtro-fecha-desde')?.value || '';
            this.filtros.fecha_hasta = document.getElementById('filtro-fecha-hasta')?.value || '';
            this.filtros.page = 1;
            this.cargarDatos();
        }

        limpiarFiltros() {
            const opSelect = document.getElementById('filtro-operacion');
            const desdeInput = document.getElementById('filtro-fecha-desde');
            const hastaInput = document.getElementById('filtro-fecha-hasta');

            if (opSelect) opSelect.value = '';
            if (desdeInput) desdeInput.value = '';
            if (hastaInput) hastaInput.value = '';

            this.filtros = { operacion: '', fecha_desde: '', fecha_hasta: '', page: 1, limit: 25 };
            this.cargarDatos();
        }

        cambiarPagina(delta) {
            const nuevaPagina = this.paginacion.paginaActual + delta;
            if (nuevaPagina < 1 || nuevaPagina > this.paginacion.totalPaginas) return;
            this.filtros.page = nuevaPagina;
            this.cargarDatos();
        }

        renderError() {
            const wrapper = document.getElementById('auditoria-tabla-wrapper');
            if (!wrapper) return;
            wrapper.innerHTML = `
                <div class="auditoria-tabla-container">
                    <div class="auditoria-vacia">
                        <i class="fas fa-exclamation-triangle"></i>
                        <p>Error al cargar los registros de auditoria</p>
                    </div>
                </div>
            `;
        }

        truncar(texto, max) {
            if (!texto) return '';
            return texto.length > max ? texto.substring(0, max) + '...' : texto;
        }

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }
    }

    // Global instance
    global.auditoriaComponent = new AuditoriaComponent();

})(window);
