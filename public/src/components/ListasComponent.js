/**
 * Componente de armado de listas electorales (borradores): alta, edicion y baja de
 * listas con sus candidatos ordenados.
 *
 * El orden de un candidato es su posicion en el array del modal, no un campo que la
 * persona tipea: mover una fila con las flechas recalcula el orden de todas. Es lo que
 * el service del backend exige (1..N sin huecos) sin pedirle a nadie que numere a mano.
 */
class ListasComponent {
    constructor() {
        this.container = null;
        this.listas = [];
        this.candidatosEnEdicion = []; // [{ nombre }], el orden es el indice + 1
        this.filtroTipo = '';
        this.cargando = false;
        this.tiposEleccion = ['provincial', 'municipal', 'nacional'];
    }

    async init(containerId = 'listas-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Contenedor ${containerId} no encontrado`);
        }

        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargarListas();
        return true;
    }

    crearInterfaz() {
        this.container.innerHTML = `
            <div class="listas-header">
                <div class="listas-title">
                    <h2><i class="fas fa-list-ol"></i> Armado de Listas</h2>
                    <p class="listas-subtitle">Borradores de listas electorales: candidatos y orden</p>
                </div>
                <div class="listas-actions">
                    <button id="btn-crear-lista" class="btn btn-primary">
                        <i class="fas fa-plus"></i> <span class="btn-text">Nueva Lista</span>
                    </button>
                </div>
            </div>

            <div class="listas-filtros">
                <div class="filtro-group">
                    <label for="filtro-tipo-eleccion">Tipo de elección</label>
                    <select id="filtro-tipo-eleccion" class="filtro-select">
                        <option value="">Todos los tipos</option>
                        <option value="provincial">Provincial</option>
                        <option value="municipal">Municipal</option>
                        <option value="nacional">Nacional</option>
                    </select>
                </div>
                <div class="filtro-group filtro-stats">
                    <span id="listas-count" class="listas-count">0 listas</span>
                </div>
            </div>

            <div class="listas-tabla-container">
                <div id="listas-loading" class="listas-loading" style="display: none;">
                    <i class="fas fa-spinner fa-spin"></i> Cargando listas...
                </div>
                <table class="listas-tabla" id="listas-tabla">
                    <thead>
                        <tr>
                            <th>Nombre</th>
                            <th>Tipo de elección</th>
                            <th>Lugares</th>
                            <th>Candidatos</th>
                            <th>Creada</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="listas-tbody"></tbody>
                </table>
                <div id="listas-empty" class="listas-empty" style="display: none;">
                    <i class="fas fa-folder-open"></i>
                    <p>No hay listas cargadas todavía</p>
                </div>
            </div>

            <!-- Modal Crear/Editar Lista -->
            <div id="modal-lista" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-lg">
                    <div class="modal-header">
                        <h3 id="modal-lista-titulo"><i class="fas fa-plus"></i> Nueva Lista</h3>
                        <button type="button" class="modal-close" id="modal-lista-close">&times;</button>
                    </div>
                    <form id="form-lista" class="modal-body">
                        <input type="hidden" id="form-lista-id" value="">
                        <div class="form-group">
                            <label for="form-lista-nombre">Nombre <span class="required">*</span></label>
                            <input type="text" id="form-lista-nombre" class="form-input" placeholder="Nombre de la lista" required maxlength="200">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="form-lista-tipo">Tipo de elección <span class="required">*</span></label>
                                <select id="form-lista-tipo" class="form-input" required>
                                    <option value="">Seleccionar...</option>
                                    <option value="provincial">Provincial</option>
                                    <option value="municipal">Municipal</option>
                                    <option value="nacional">Nacional</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="form-lista-lugares">Cantidad de lugares <span class="required">*</span></label>
                                <input type="number" id="form-lista-lugares" class="form-input" min="1" step="1" required>
                            </div>
                        </div>

                        <div class="candidatos-editor">
                            <div class="candidatos-editor-header">
                                <label>Candidatos <span class="required">*</span></label>
                                <button type="button" class="btn btn-secondary btn-sm" id="btn-agregar-candidato">
                                    <i class="fas fa-user-plus"></i> Agregar candidato
                                </button>
                            </div>
                            <ul id="candidatos-lista" class="candidatos-lista"></ul>
                            <p id="candidatos-vacio" class="candidatos-vacio">Todavía no hay candidatos cargados.</p>
                        </div>

                        <div id="form-lista-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-lista">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-lista">
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
        document.getElementById('btn-crear-lista').addEventListener('click', () => this.abrirModalCrear());
        document.getElementById('modal-lista-close').addEventListener('click', () => this.cerrarModal());
        document.getElementById('btn-cancelar-lista').addEventListener('click', () => this.cerrarModal());
        document.getElementById('btn-agregar-candidato').addEventListener('click', () => this.agregarCandidato());

        document.getElementById('form-lista').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarLista();
        });

        // Cerrar con click en el overlay, sólo si el click fue sobre el overlay mismo.
        document.getElementById('modal-lista').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.cerrarModal();
        });

        // Delegado: las filas de candidatos se recrean en cada render.
        document.getElementById('candidatos-lista').addEventListener('click', (e) => {
            const boton = e.target.closest('[data-candidato-action]');
            if (!boton) return;
            const fila = boton.closest('[data-indice]');
            const indice = Number(fila.dataset.indice);
            const accion = boton.dataset.candidatoAction;

            if (accion === 'subir' && indice > 0) this.moverCandidato(indice, indice - 1);
            else if (accion === 'bajar' && indice < this.candidatosEnEdicion.length - 1) this.moverCandidato(indice, indice + 1);
            else if (accion === 'quitar') this.quitarCandidato(indice);
        });

        document.getElementById('candidatos-lista').addEventListener('input', (e) => {
            const fila = e.target.closest('[data-indice]');
            if (!fila || !e.target.matches('input[type="text"]')) return;
            this.candidatosEnEdicion[Number(fila.dataset.indice)].nombre = e.target.value;
        });

        document.getElementById('filtro-tipo-eleccion').addEventListener('change', (e) => {
            this.filtroTipo = e.target.value;
            this.renderizarTabla();
        });
    }

    async cargarListas() {
        this.cargando = true;
        document.getElementById('listas-loading').style.display = 'flex';
        document.getElementById('listas-tabla').style.display = 'none';
        document.getElementById('listas-empty').style.display = 'none';

        try {
            // El techo de 100 lo aplica el servidor igual; se pide explicito para que
            // quede claro que esta pantalla no pagina (el volumen esperado es bajo).
            const response = await window.apiService.obtenerListas({ limite: 100 });
            if (response.success) {
                this.listas = response.data;
                this.renderizarTabla();
            }
        } catch (error) {
            console.error('Error cargando listas:', error);
            this.mostrarToast('Error al cargar listas: ' + error.message, 'error');
        } finally {
            this.cargando = false;
            document.getElementById('listas-loading').style.display = 'none';
        }
    }

    getListasFiltradas() {
        if (!this.filtroTipo) return this.listas;
        return this.listas.filter((l) => l.tipo_eleccion === this.filtroTipo);
    }

    renderizarTabla() {
        const filtradas = this.getListasFiltradas();
        const tbody = document.getElementById('listas-tbody');
        const tabla = document.getElementById('listas-tabla');
        const empty = document.getElementById('listas-empty');
        const count = document.getElementById('listas-count');

        count.textContent = `${filtradas.length} lista${filtradas.length !== 1 ? 's' : ''}`;

        if (filtradas.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = filtradas.map((lista) => `
            <tr>
                <td class="lista-nombre">${escaparHtml(lista.nombre)}</td>
                <td><span class="tipo-badge tipo-${escaparHtml(lista.tipo_eleccion)}">${escaparHtml(this.formatearTipo(lista.tipo_eleccion))}</span></td>
                <td>${escaparHtml(String(lista.cantidad_lugares))}</td>
                <td>${escaparHtml(String(lista.candidatos_count ?? 0))}</td>
                <td>${this.formatearFecha(lista.created_at)}</td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-editar" title="Editar lista" data-id="${lista.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar lista" data-id="${lista.id}" data-nombre="${escaparHtml(lista.nombre)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-editar').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalEditar(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
            btn.addEventListener('click', () => this.eliminarLista(Number(btn.dataset.id), btn.dataset.nombre));
        });
    }

    // ---- Modal ----

    abrirModalCrear() {
        document.getElementById('modal-lista-titulo').innerHTML = '<i class="fas fa-plus"></i> Nueva Lista';
        document.getElementById('form-lista-id').value = '';
        document.getElementById('form-lista-nombre').value = '';
        document.getElementById('form-lista-tipo').value = '';
        document.getElementById('form-lista-lugares').value = '';
        document.getElementById('form-lista-error').style.display = 'none';
        this.candidatosEnEdicion = [{ nombre: '' }, { nombre: '' }];
        this.renderizarCandidatosEditor();
        document.getElementById('modal-lista').style.display = 'flex';
        document.getElementById('form-lista-nombre').focus();
    }

    async abrirModalEditar(id) {
        try {
            const response = await window.apiService.obtenerLista(id);
            if (!response.success) return;
            const lista = response.data;

            document.getElementById('modal-lista-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Lista';
            document.getElementById('form-lista-id').value = lista.id;
            document.getElementById('form-lista-nombre').value = lista.nombre;
            document.getElementById('form-lista-tipo').value = lista.tipo_eleccion;
            document.getElementById('form-lista-lugares').value = lista.cantidad_lugares;
            document.getElementById('form-lista-error').style.display = 'none';
            this.candidatosEnEdicion = lista.candidatos
                .slice()
                .sort((a, b) => a.orden - b.orden)
                .map((c) => ({ nombre: c.nombre }));
            this.renderizarCandidatosEditor();
            document.getElementById('modal-lista').style.display = 'flex';
        } catch (error) {
            this.mostrarToast('Error al abrir la lista: ' + error.message, 'error');
        }
    }

    cerrarModal() {
        document.getElementById('modal-lista').style.display = 'none';
    }

    // ---- Editor de candidatos (orden = posicion en el array) ----

    agregarCandidato() {
        this.candidatosEnEdicion.push({ nombre: '' });
        this.renderizarCandidatosEditor();
        const filas = document.querySelectorAll('#candidatos-lista input[type="text"]');
        if (filas.length) filas[filas.length - 1].focus();
    }

    moverCandidato(desde, hacia) {
        const [item] = this.candidatosEnEdicion.splice(desde, 1);
        this.candidatosEnEdicion.splice(hacia, 0, item);
        this.renderizarCandidatosEditor();
    }

    quitarCandidato(indice) {
        this.candidatosEnEdicion.splice(indice, 1);
        this.renderizarCandidatosEditor();
    }

    renderizarCandidatosEditor() {
        const lista = document.getElementById('candidatos-lista');
        const vacio = document.getElementById('candidatos-vacio');

        vacio.style.display = this.candidatosEnEdicion.length === 0 ? 'block' : 'none';

        lista.innerHTML = this.candidatosEnEdicion.map((candidato, indice) => `
            <li class="candidato-fila" data-indice="${indice}">
                <span class="candidato-orden">${indice + 1}</span>
                <input type="text" class="form-input" placeholder="Nombre del candidato" value="${escaparHtml(candidato.nombre)}" required maxlength="200">
                <div class="candidato-acciones">
                    <button type="button" class="btn-accion" data-candidato-action="subir" title="Subir" ${indice === 0 ? 'disabled' : ''}>
                        <i class="fas fa-arrow-up"></i>
                    </button>
                    <button type="button" class="btn-accion" data-candidato-action="bajar" title="Bajar" ${indice === this.candidatosEnEdicion.length - 1 ? 'disabled' : ''}>
                        <i class="fas fa-arrow-down"></i>
                    </button>
                    <button type="button" class="btn-accion btn-eliminar" data-candidato-action="quitar" title="Quitar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </li>
        `).join('');
    }

    // ---- CRUD ----

    async guardarLista() {
        const id = document.getElementById('form-lista-id').value;
        const isEdit = !!id;

        const nombre = document.getElementById('form-lista-nombre').value.trim();
        const tipoEleccion = document.getElementById('form-lista-tipo').value;
        const cantidadLugares = Number(document.getElementById('form-lista-lugares').value);
        const candidatos = this.candidatosEnEdicion
            .map((c, indice) => ({ nombre: c.nombre.trim(), orden: indice + 1 }))
            .filter((c) => c.nombre);

        if (!nombre) return this.mostrarFormError('El nombre de la lista es obligatorio');
        if (!tipoEleccion) return this.mostrarFormError('Elegí un tipo de elección');
        if (!Number.isInteger(cantidadLugares) || cantidadLugares <= 0) {
            return this.mostrarFormError('La cantidad de lugares tiene que ser un entero positivo');
        }
        if (candidatos.length === 0) return this.mostrarFormError('Cargá al menos un candidato');
        if (candidatos.length !== this.candidatosEnEdicion.length) {
            return this.mostrarFormError('Hay un candidato sin nombre');
        }

        const btn = document.getElementById('btn-guardar-lista');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { nombre, tipoEleccion, cantidadLugares, candidatos };
            const response = isEdit
                ? await window.apiService.actualizarLista(Number(id), data)
                : await window.apiService.crearLista(data);

            if (response.success) {
                this.cerrarModal();
                this.mostrarToast(isEdit ? 'Lista actualizada' : 'Lista creada', 'success');
                await this.cargarListas();
            }
        } catch (error) {
            this.mostrarFormError(error.message || 'Error al guardar la lista');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarLista(id, nombre) {
        const confirmado = confirm(`¿Eliminar la lista "${nombre}"? Esta acción no se puede deshacer.`);
        if (!confirmado) return;

        try {
            const response = await window.apiService.eliminarLista(id);
            if (response.success) {
                this.mostrarToast('Lista eliminada', 'success');
                await this.cargarListas();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ---- Helpers ----

    formatearTipo(tipo) {
        const nombres = { provincial: 'Provincial', municipal: 'Municipal', nacional: 'Nacional' };
        return nombres[tipo] || tipo;
    }

    formatearFecha(fecha) {
        if (!fecha) return '-';
        return new Date(fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    mostrarFormError(mensaje) {
        const el = document.getElementById('form-lista-error');
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

window.listasComponent = new ListasComponent();
