/**
 * Componente de fiscales: padrón de fiscales (registro de datos, sin cuenta de
 * usuario), calendario de asignaciones por mesa (franjas de 08:00 a 18:00) y agenda de
 * un comicio a una hora dada.
 */
class FiscalesComponent {
    constructor() {
        this.container = null;
        this.fiscales = [];
        this.comicios = [];
        this.comicioSeleccionado = null; // { id, nombre, mesas: [...] }
        this.mesaSeleccionadaId = null;
        this.asignacionesMesa = [];
    }

    async init(containerId = 'fiscales-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error(`Contenedor ${containerId} no encontrado`);

        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargarComicios();
        await this.cargarFiscales();
        return true;
    }

    crearInterfaz() {
        this.container.innerHTML = `
            <!-- ---- Padrón de fiscales ---- -->
            <div class="fiscales-header">
                <div class="fiscales-title">
                    <h2><i class="fas fa-user-shield"></i> Fiscales</h2>
                    <p class="fiscales-subtitle">Registro de fiscales y su calendario por mesa</p>
                </div>
                <div class="fiscales-actions">
                    <button id="btn-crear-fiscal" class="btn btn-primary">
                        <i class="fas fa-plus"></i> <span class="btn-text">Nuevo Fiscal</span>
                    </button>
                </div>
            </div>

            <div class="fiscales-tabla-container">
                <div id="fiscales-loading" class="fiscales-loading" style="display: none;">
                    <i class="fas fa-spinner fa-spin"></i> Cargando fiscales...
                </div>
                <table class="fiscales-tabla" id="fiscales-tabla">
                    <thead>
                        <tr><th>Nombre</th><th>DNI</th><th>Teléfono</th><th>Acciones</th></tr>
                    </thead>
                    <tbody id="fiscales-tbody"></tbody>
                </table>
                <div id="fiscales-empty" class="fiscales-empty" style="display: none;">
                    <i class="fas fa-user-shield"></i>
                    <p>Todavía no hay fiscales cargados</p>
                </div>
            </div>

            <!-- ---- Calendario por mesa ---- -->
            <div class="fiscales-header" style="margin-top: 32px;">
                <div class="fiscales-title">
                    <h3><i class="fas fa-calendar-alt"></i> Calendario por mesa</h3>
                </div>
            </div>

            <div class="selectores-row">
                <div class="form-group">
                    <label for="select-comicio">Comicio</label>
                    <select id="select-comicio" class="form-input">
                        <option value="">Seleccionar comicio...</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="select-mesa">Mesa</label>
                    <select id="select-mesa" class="form-input" disabled>
                        <option value="">Elegí un comicio primero</option>
                    </select>
                </div>
            </div>

            <div id="calendario-mesa-container" style="display: none;">
                <div class="fiscales-actions" style="margin-bottom: 12px;">
                    <button id="btn-asignar-fiscal" class="btn btn-primary btn-sm">
                        <i class="fas fa-plus"></i> Asignar fiscal
                    </button>
                </div>
                <table class="fiscales-tabla" id="asignaciones-tabla">
                    <thead>
                        <tr><th>Desde</th><th>Hasta</th><th>Fiscal</th><th>Acciones</th></tr>
                    </thead>
                    <tbody id="asignaciones-tbody"></tbody>
                </table>
                <div id="asignaciones-empty" class="fiscales-empty" style="display: none;">
                    <i class="fas fa-calendar-day"></i>
                    <p>Esta mesa todavía no tiene fiscales asignados</p>
                </div>
            </div>

            <!-- ---- Agenda por hora ---- -->
            <div class="fiscales-header" style="margin-top: 32px;">
                <div class="fiscales-title">
                    <h3><i class="fas fa-clock"></i> Agenda del comicio</h3>
                    <p class="fiscales-subtitle">Quién cubre cada mesa a una hora dada</p>
                </div>
            </div>

            <div class="selectores-row">
                <div class="form-group">
                    <label for="input-hora-agenda">Hora</label>
                    <input type="time" id="input-hora-agenda" class="form-input" min="08:00" max="18:00" value="09:00">
                </div>
                <div class="form-group" style="align-self: flex-end;">
                    <button id="btn-ver-agenda" class="btn btn-secondary btn-sm">
                        <i class="fas fa-search"></i> Ver agenda
                    </button>
                </div>
            </div>

            <table class="fiscales-tabla" id="agenda-tabla" style="display: none;">
                <thead><tr><th>Mesa</th><th>Fiscal presente</th></tr></thead>
                <tbody id="agenda-tbody"></tbody>
            </table>

            <!-- ---- Modal fiscal ---- -->
            <div id="modal-fiscal" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3 id="modal-fiscal-titulo"><i class="fas fa-plus"></i> Nuevo Fiscal</h3>
                        <button type="button" class="modal-close" id="modal-fiscal-close">&times;</button>
                    </div>
                    <form id="form-fiscal" class="modal-body">
                        <input type="hidden" id="form-fiscal-id" value="">
                        <div class="form-group">
                            <label for="form-fiscal-nombre">Nombre <span class="required">*</span></label>
                            <input type="text" id="form-fiscal-nombre" class="form-input" required maxlength="200">
                        </div>
                        <div class="form-group">
                            <label for="form-fiscal-dni">DNI</label>
                            <input type="text" id="form-fiscal-dni" class="form-input" maxlength="20">
                        </div>
                        <div class="form-group">
                            <label for="form-fiscal-telefono">Teléfono</label>
                            <input type="text" id="form-fiscal-telefono" class="form-input" maxlength="50">
                        </div>
                        <div id="form-fiscal-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-fiscal">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-fiscal">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- ---- Modal asignación ---- -->
            <div id="modal-asignacion" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3 id="modal-asignacion-titulo"><i class="fas fa-plus"></i> Asignar Fiscal</h3>
                        <button type="button" class="modal-close" id="modal-asignacion-close">&times;</button>
                    </div>
                    <form id="form-asignacion" class="modal-body">
                        <input type="hidden" id="form-asignacion-id" value="">
                        <div class="form-group">
                            <label for="form-asignacion-fiscal">Fiscal <span class="required">*</span></label>
                            <select id="form-asignacion-fiscal" class="form-input" required>
                                <option value="">Seleccionar...</option>
                            </select>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="form-asignacion-desde">Desde <span class="required">*</span></label>
                                <input type="time" id="form-asignacion-desde" class="form-input" min="08:00" max="18:00" required>
                            </div>
                            <div class="form-group">
                                <label for="form-asignacion-hasta">Hasta <span class="required">*</span></label>
                                <input type="time" id="form-asignacion-hasta" class="form-input" min="08:00" max="18:00" required>
                            </div>
                        </div>
                        <div id="form-asignacion-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-asignacion">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-asignacion">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <div id="toast-container" class="toast-container"></div>
        `;
    }

    inicializarEventos() {
        document.getElementById('btn-crear-fiscal').addEventListener('click', () => this.abrirModalCrearFiscal());
        document.getElementById('modal-fiscal-close').addEventListener('click', () => this.cerrarModalFiscal());
        document.getElementById('btn-cancelar-fiscal').addEventListener('click', () => this.cerrarModalFiscal());
        document.getElementById('modal-fiscal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalFiscal();
        });
        document.getElementById('form-fiscal').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarFiscal();
        });

        document.getElementById('select-comicio').addEventListener('change', (e) => this.seleccionarComicio(e.target.value));
        document.getElementById('select-mesa').addEventListener('change', (e) => this.seleccionarMesa(e.target.value));

        document.getElementById('btn-asignar-fiscal').addEventListener('click', () => this.abrirModalCrearAsignacion());
        document.getElementById('modal-asignacion-close').addEventListener('click', () => this.cerrarModalAsignacion());
        document.getElementById('btn-cancelar-asignacion').addEventListener('click', () => this.cerrarModalAsignacion());
        document.getElementById('modal-asignacion').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalAsignacion();
        });
        document.getElementById('form-asignacion').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarAsignacion();
        });

        document.getElementById('btn-ver-agenda').addEventListener('click', () => this.verAgenda());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cerrarModalFiscal();
                this.cerrarModalAsignacion();
            }
        });
    }

    // ---- Fiscales ----

    async cargarFiscales() {
        document.getElementById('fiscales-loading').style.display = 'flex';
        document.getElementById('fiscales-tabla').style.display = 'none';
        document.getElementById('fiscales-empty').style.display = 'none';

        try {
            const response = await window.apiService.obtenerFiscales({ limite: 100 });
            if (response.success) {
                this.fiscales = response.data;
                this.renderizarFiscales();
            }
        } catch (error) {
            this.mostrarToast('Error al cargar fiscales: ' + error.message, 'error');
        } finally {
            document.getElementById('fiscales-loading').style.display = 'none';
        }
    }

    renderizarFiscales() {
        const tbody = document.getElementById('fiscales-tbody');
        const tabla = document.getElementById('fiscales-tabla');
        const empty = document.getElementById('fiscales-empty');

        if (this.fiscales.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }
        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = this.fiscales.map((f) => `
            <tr>
                <td class="fiscal-nombre">${escaparHtml(f.nombre)}</td>
                <td>${escaparHtml(f.dni || '-')}</td>
                <td>${escaparHtml(f.telefono || '-')}</td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-editar" title="Editar fiscal" data-id="${f.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar fiscal" data-id="${f.id}" data-nombre="${escaparHtml(f.nombre)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-editar').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalEditarFiscal(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
            btn.addEventListener('click', () => this.eliminarFiscal(Number(btn.dataset.id), btn.dataset.nombre));
        });
    }

    abrirModalCrearFiscal() {
        document.getElementById('modal-fiscal-titulo').innerHTML = '<i class="fas fa-plus"></i> Nuevo Fiscal';
        document.getElementById('form-fiscal-id').value = '';
        document.getElementById('form-fiscal-nombre').value = '';
        document.getElementById('form-fiscal-dni').value = '';
        document.getElementById('form-fiscal-telefono').value = '';
        document.getElementById('form-fiscal-error').style.display = 'none';
        document.getElementById('modal-fiscal').style.display = 'flex';
        document.getElementById('form-fiscal-nombre').focus();
    }

    abrirModalEditarFiscal(id) {
        const fiscal = this.fiscales.find((f) => f.id === id);
        if (!fiscal) return;
        document.getElementById('modal-fiscal-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Fiscal';
        document.getElementById('form-fiscal-id').value = fiscal.id;
        document.getElementById('form-fiscal-nombre').value = fiscal.nombre;
        document.getElementById('form-fiscal-dni').value = fiscal.dni || '';
        document.getElementById('form-fiscal-telefono').value = fiscal.telefono || '';
        document.getElementById('form-fiscal-error').style.display = 'none';
        document.getElementById('modal-fiscal').style.display = 'flex';
    }

    cerrarModalFiscal() {
        document.getElementById('modal-fiscal').style.display = 'none';
    }

    async guardarFiscal() {
        const id = document.getElementById('form-fiscal-id').value;
        const isEdit = !!id;
        const nombre = document.getElementById('form-fiscal-nombre').value.trim();
        const dni = document.getElementById('form-fiscal-dni').value.trim();
        const telefono = document.getElementById('form-fiscal-telefono').value.trim();

        if (!nombre) return this.mostrarError('form-fiscal-error', 'El nombre del fiscal es obligatorio');

        const btn = document.getElementById('btn-guardar-fiscal');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { nombre, dni: dni || null, telefono: telefono || null };
            const response = isEdit
                ? await window.apiService.actualizarFiscal(Number(id), data)
                : await window.apiService.crearFiscal(data);

            if (response.success) {
                this.cerrarModalFiscal();
                this.mostrarToast(isEdit ? 'Fiscal actualizado' : 'Fiscal creado', 'success');
                await this.cargarFiscales();
            }
        } catch (error) {
            this.mostrarError('form-fiscal-error', error.message || 'Error al guardar el fiscal');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarFiscal(id, nombre) {
        if (!confirm(`¿Eliminar a "${nombre}"? Se borran también sus asignaciones.`)) return;
        try {
            const response = await window.apiService.eliminarFiscal(id);
            if (response.success) {
                this.mostrarToast('Fiscal eliminado', 'success');
                await this.cargarFiscales();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ---- Comicio / mesa ----

    async cargarComicios() {
        try {
            const response = await window.apiService.obtenerComicios({ limite: 100 });
            if (response.success) {
                this.comicios = response.data;
                const select = document.getElementById('select-comicio');
                select.innerHTML = '<option value="">Seleccionar comicio...</option>' +
                    this.comicios.map((c) => `<option value="${c.id}">${escaparHtml(c.nombre)}</option>`).join('');
            }
        } catch (error) {
            console.error('Error cargando comicios:', error);
        }
    }

    async seleccionarComicio(comicioId) {
        this.mesaSeleccionadaId = null;
        document.getElementById('calendario-mesa-container').style.display = 'none';
        document.getElementById('agenda-tabla').style.display = 'none';

        const selectMesa = document.getElementById('select-mesa');
        if (!comicioId) {
            this.comicioSeleccionado = null;
            selectMesa.innerHTML = '<option value="">Elegí un comicio primero</option>';
            selectMesa.disabled = true;
            return;
        }

        try {
            const response = await window.apiService.obtenerComicio(Number(comicioId));
            if (!response.success) return;
            this.comicioSeleccionado = response.data;

            if (this.comicioSeleccionado.mesas.length === 0) {
                selectMesa.innerHTML = '<option value="">Este comicio no tiene mesas todavía</option>';
                selectMesa.disabled = true;
                return;
            }

            selectMesa.innerHTML = '<option value="">Seleccionar mesa...</option>' +
                this.comicioSeleccionado.mesas.map((m) => `<option value="${m.id}">Mesa ${escaparHtml(String(m.numero))}</option>`).join('');
            selectMesa.disabled = false;
        } catch (error) {
            this.mostrarToast('Error al cargar el comicio: ' + error.message, 'error');
        }
    }

    async seleccionarMesa(mesaId) {
        if (!mesaId) {
            this.mesaSeleccionadaId = null;
            document.getElementById('calendario-mesa-container').style.display = 'none';
            return;
        }
        this.mesaSeleccionadaId = Number(mesaId);
        document.getElementById('calendario-mesa-container').style.display = 'block';
        await this.cargarAsignacionesMesa();
    }

    async cargarAsignacionesMesa() {
        try {
            const response = await window.apiService.asignacionesDeMesa(this.mesaSeleccionadaId);
            if (response.success) {
                this.asignacionesMesa = response.data;
                this.renderizarAsignaciones();
            }
        } catch (error) {
            this.mostrarToast('Error al cargar el calendario: ' + error.message, 'error');
        }
    }

    /** El servidor devuelve TIME como HH:MM:SS; acá sólo se muestran HH:MM. */
    formatearHora(hora) {
        return (hora || '').slice(0, 5);
    }

    renderizarAsignaciones() {
        const tbody = document.getElementById('asignaciones-tbody');
        const tabla = document.getElementById('asignaciones-tabla');
        const empty = document.getElementById('asignaciones-empty');

        if (this.asignacionesMesa.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }
        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = this.asignacionesMesa.map((a) => `
            <tr>
                <td>${escaparHtml(this.formatearHora(a.desde))}</td>
                <td>${escaparHtml(this.formatearHora(a.hasta))}</td>
                <td>${escaparHtml(a.fiscal_nombre)}</td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-editar" title="Editar" data-id="${a.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Quitar" data-id="${a.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-editar').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalEditarAsignacion(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
            btn.addEventListener('click', () => this.eliminarAsignacion(Number(btn.dataset.id)));
        });
    }

    // ---- Modal asignación ----

    poblarSelectFiscales(seleccionado = '') {
        const select = document.getElementById('form-asignacion-fiscal');
        select.innerHTML = '<option value="">Seleccionar...</option>' +
            this.fiscales.map((f) => `<option value="${f.id}" ${String(f.id) === String(seleccionado) ? 'selected' : ''}>${escaparHtml(f.nombre)}</option>`).join('');
    }

    abrirModalCrearAsignacion() {
        document.getElementById('modal-asignacion-titulo').innerHTML = '<i class="fas fa-plus"></i> Asignar Fiscal';
        document.getElementById('form-asignacion-id').value = '';
        document.getElementById('form-asignacion-desde').value = '';
        document.getElementById('form-asignacion-hasta').value = '';
        document.getElementById('form-asignacion-error').style.display = 'none';
        this.poblarSelectFiscales();
        document.getElementById('modal-asignacion').style.display = 'flex';
    }

    abrirModalEditarAsignacion(id) {
        const a = this.asignacionesMesa.find((x) => x.id === id);
        if (!a) return;
        document.getElementById('modal-asignacion-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Asignación';
        document.getElementById('form-asignacion-id').value = a.id;
        document.getElementById('form-asignacion-desde').value = this.formatearHora(a.desde);
        document.getElementById('form-asignacion-hasta').value = this.formatearHora(a.hasta);
        document.getElementById('form-asignacion-error').style.display = 'none';
        this.poblarSelectFiscales(a.fiscal_id);
        document.getElementById('modal-asignacion').style.display = 'flex';
    }

    cerrarModalAsignacion() {
        document.getElementById('modal-asignacion').style.display = 'none';
    }

    async guardarAsignacion() {
        const id = document.getElementById('form-asignacion-id').value;
        const isEdit = !!id;
        const fiscalId = Number(document.getElementById('form-asignacion-fiscal').value);
        const desde = document.getElementById('form-asignacion-desde').value;
        const hasta = document.getElementById('form-asignacion-hasta').value;

        if (!fiscalId) return this.mostrarError('form-asignacion-error', 'Elegí un fiscal');
        if (!desde || !hasta) return this.mostrarError('form-asignacion-error', 'Completá desde y hasta');

        const btn = document.getElementById('btn-guardar-asignacion');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { fiscalId, desde, hasta };
            const response = isEdit
                ? await window.apiService.actualizarAsignacionFiscal(Number(id), data)
                : await window.apiService.crearAsignacionFiscal(this.mesaSeleccionadaId, data);

            if (response.success) {
                this.cerrarModalAsignacion();
                this.mostrarToast(isEdit ? 'Asignación actualizada' : 'Fiscal asignado', 'success');
                await this.cargarAsignacionesMesa();
            }
        } catch (error) {
            this.mostrarError('form-asignacion-error', error.message || 'Error al guardar la asignación');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarAsignacion(id) {
        if (!confirm('¿Quitar esta asignación?')) return;
        try {
            const response = await window.apiService.eliminarAsignacionFiscal(id);
            if (response.success) {
                this.mostrarToast('Asignación eliminada', 'success');
                await this.cargarAsignacionesMesa();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ---- Agenda ----

    async verAgenda() {
        if (!this.comicioSeleccionado) {
            this.mostrarToast('Elegí un comicio primero', 'error');
            return;
        }
        const hora = document.getElementById('input-hora-agenda').value;
        if (!hora) return;

        try {
            const response = await window.apiService.agendaDeComicio(this.comicioSeleccionado.id, hora);
            if (!response.success) return;

            const tabla = document.getElementById('agenda-tabla');
            const tbody = document.getElementById('agenda-tbody');
            tbody.innerHTML = response.data.map((m) => `
                <tr>
                    <td>Mesa ${escaparHtml(String(m.mesa_numero))}</td>
                    <td>${m.fiscal_nombre ? escaparHtml(m.fiscal_nombre) : '<span class="sin-cubrir">Sin cubrir</span>'}</td>
                </tr>
            `).join('');
            tabla.style.display = 'table';
        } catch (error) {
            this.mostrarToast('Error al calcular la agenda: ' + error.message, 'error');
        }
    }

    // ---- Helpers ----

    mostrarError(elementId, mensaje) {
        const el = document.getElementById(elementId);
        el.textContent = mensaje;
        el.style.display = 'block';
    }

    mostrarToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${escaparHtml(message)}`;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('toast-visible'));
        setTimeout(() => {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
}

window.fiscalesComponent = new FiscalesComponent();
