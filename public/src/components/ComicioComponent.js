/**
 * Componente de comicios: listado de comicios y, al entrar a uno, sus mesas (rango de
 * padrón, cantidad de votantes), carga de votos por mesa y métricas agregadas.
 *
 * Dos vistas dentro del mismo contenedor (listado / detalle), sin router: es una sola
 * pantalla con un botón "volver", como el resto del frontend hace con paneles.
 */
class ComicioComponent {
    constructor() {
        this.container = null;
        this.comicios = [];
        this.listasDisponibles = [];
        this.comicioActual = null; // { id, nombre, tipo_eleccion, listas, mesas }
        this.mesaEnEdicionVotos = null;
    }

    async init(containerId = 'comicio-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error(`Contenedor ${containerId} no encontrado`);

        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargarListasDisponibles();
        await this.cargarComicios();
        return true;
    }

    crearInterfaz() {
        this.container.innerHTML = `
            <!-- ---- Listado de comicios ---- -->
            <div id="comicio-listado-view">
                <div class="comicio-header">
                    <div class="comicio-title">
                        <h2><i class="fas fa-building"></i> Comicios</h2>
                        <p class="comicio-subtitle">Comicios, mesas y votos por lista</p>
                    </div>
                    <div class="comicio-actions">
                        <button id="btn-crear-comicio" class="btn btn-primary">
                            <i class="fas fa-plus"></i> <span class="btn-text">Nuevo Comicio</span>
                        </button>
                    </div>
                </div>

                <div class="comicio-tabla-container">
                    <div id="comicios-loading" class="comicio-loading" style="display: none;">
                        <i class="fas fa-spinner fa-spin"></i> Cargando comicios...
                    </div>
                    <table class="comicio-tabla" id="comicios-tabla">
                        <thead>
                            <tr>
                                <th>Nombre</th>
                                <th>Tipo de elección</th>
                                <th>Listas</th>
                                <th>Mesas</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="comicios-tbody"></tbody>
                    </table>
                    <div id="comicios-empty" class="comicio-empty" style="display: none;">
                        <i class="fas fa-building"></i>
                        <p>Todavía no hay comicios cargados</p>
                    </div>
                </div>
            </div>

            <!-- ---- Detalle de un comicio ---- -->
            <div id="comicio-detalle-view" style="display: none;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-volver-listado">
                    <i class="fas fa-arrow-left"></i> Volver a comicios
                </button>

                <div class="comicio-header">
                    <div class="comicio-title">
                        <h2 id="detalle-comicio-nombre"><i class="fas fa-building"></i></h2>
                        <p class="comicio-subtitle" id="detalle-comicio-listas"></p>
                    </div>
                    <div class="comicio-actions">
                        <button id="btn-crear-mesa" class="btn btn-primary">
                            <i class="fas fa-plus"></i> <span class="btn-text">Nueva Mesa</span>
                        </button>
                    </div>
                </div>

                <div id="metricas-container" class="metricas-container"></div>

                <table class="comicio-tabla" id="mesas-tabla">
                    <thead>
                        <tr>
                            <th>Mesa</th>
                            <th>Rango de padrón</th>
                            <th>Votantes</th>
                            <th>Votos cargados</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="mesas-tbody"></tbody>
                </table>
                <div id="mesas-empty" class="comicio-empty" style="display: none;">
                    <i class="fas fa-chair"></i>
                    <p>Este comicio todavía no tiene mesas</p>
                </div>
            </div>

            <!-- ---- Modal alta/edición de comicio ---- -->
            <div id="modal-comicio" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="modal-comicio-titulo"><i class="fas fa-plus"></i> Nuevo Comicio</h3>
                        <button type="button" class="modal-close" id="modal-comicio-close">&times;</button>
                    </div>
                    <form id="form-comicio" class="modal-body">
                        <input type="hidden" id="form-comicio-id" value="">
                        <div class="form-group">
                            <label for="form-comicio-nombre">Nombre <span class="required">*</span></label>
                            <input type="text" id="form-comicio-nombre" class="form-input" required maxlength="200">
                        </div>
                        <div class="form-group">
                            <label for="form-comicio-tipo">Tipo de elección <span class="required">*</span></label>
                            <select id="form-comicio-tipo" class="form-input" required>
                                <option value="">Seleccionar...</option>
                                <option value="provincial">Provincial</option>
                                <option value="municipal">Municipal</option>
                                <option value="nacional">Nacional</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Listas participantes <span class="required">*</span></label>
                            <div id="form-comicio-listas" class="listas-checkboxes"></div>
                        </div>
                        <div id="form-comicio-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-comicio">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-comicio">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- ---- Modal alta/edición de mesa ---- -->
            <div id="modal-mesa" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3 id="modal-mesa-titulo"><i class="fas fa-plus"></i> Nueva Mesa</h3>
                        <button type="button" class="modal-close" id="modal-mesa-close">&times;</button>
                    </div>
                    <form id="form-mesa" class="modal-body">
                        <input type="hidden" id="form-mesa-id" value="">
                        <div class="form-group">
                            <label for="form-mesa-numero">Número de mesa <span class="required">*</span></label>
                            <input type="number" id="form-mesa-numero" class="form-input" min="1" step="1" required>
                        </div>
                        <div class="form-group">
                            <label for="form-mesa-desde">DNI desde <span class="required">*</span></label>
                            <input type="text" id="form-mesa-desde" class="form-input" placeholder="DNI del primer votante del rango" required>
                        </div>
                        <div class="form-group">
                            <label for="form-mesa-hasta">DNI hasta <span class="required">*</span></label>
                            <input type="text" id="form-mesa-hasta" class="form-input" placeholder="DNI del último votante del rango" required>
                        </div>
                        <p class="modal-info">El rango se calcula por orden de apellido y nombre del padrón, no por el número de DNI.</p>
                        <div id="form-mesa-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-mesa">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-mesa">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- ---- Modal de votos ---- -->
            <div id="modal-votos" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="modal-votos-titulo"><i class="fas fa-check-to-slot"></i> Votos</h3>
                        <button type="button" class="modal-close" id="modal-votos-close">&times;</button>
                    </div>
                    <form id="form-votos" class="modal-body">
                        <input type="hidden" id="form-votos-mesa-id" value="">
                        <div id="form-votos-listas"></div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="form-votos-blancos">Votos en blanco</label>
                                <input type="number" id="form-votos-blancos" class="form-input" min="0" step="1" required>
                            </div>
                            <div class="form-group">
                                <label for="form-votos-nulos">Votos nulos</label>
                                <input type="number" id="form-votos-nulos" class="form-input" min="0" step="1" required>
                            </div>
                        </div>
                        <div id="form-votos-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-votos">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-votos">
                                <i class="fas fa-save"></i> Guardar votos
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <div id="toast-container" class="toast-container"></div>
        `;
    }

    inicializarEventos() {
        document.getElementById('btn-crear-comicio').addEventListener('click', () => this.abrirModalCrearComicio());
        document.getElementById('modal-comicio-close').addEventListener('click', () => this.cerrarModalComicio());
        document.getElementById('btn-cancelar-comicio').addEventListener('click', () => this.cerrarModalComicio());
        document.getElementById('modal-comicio').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalComicio();
        });
        document.getElementById('form-comicio').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarComicio();
        });

        document.getElementById('btn-volver-listado').addEventListener('click', () => this.volverAlListado());

        document.getElementById('btn-crear-mesa').addEventListener('click', () => this.abrirModalCrearMesa());
        document.getElementById('modal-mesa-close').addEventListener('click', () => this.cerrarModalMesa());
        document.getElementById('btn-cancelar-mesa').addEventListener('click', () => this.cerrarModalMesa());
        document.getElementById('modal-mesa').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalMesa();
        });
        document.getElementById('form-mesa').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarMesa();
        });

        document.getElementById('modal-votos-close').addEventListener('click', () => this.cerrarModalVotos());
        document.getElementById('btn-cancelar-votos').addEventListener('click', () => this.cerrarModalVotos());
        document.getElementById('modal-votos').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalVotos();
        });
        document.getElementById('form-votos').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarVotos();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cerrarModalComicio();
                this.cerrarModalMesa();
                this.cerrarModalVotos();
            }
        });
    }

    // ---- Carga inicial ----

    async cargarListasDisponibles() {
        try {
            const response = await window.apiService.obtenerListas({ limite: 100 });
            if (response.success) this.listasDisponibles = response.data;
        } catch (error) {
            console.error('Error cargando listas:', error);
        }
    }

    async cargarComicios() {
        document.getElementById('comicios-loading').style.display = 'flex';
        document.getElementById('comicios-tabla').style.display = 'none';
        document.getElementById('comicios-empty').style.display = 'none';

        try {
            const response = await window.apiService.obtenerComicios({ limite: 100 });
            if (response.success) {
                this.comicios = response.data;
                this.renderizarComicios();
            }
        } catch (error) {
            console.error('Error cargando comicios:', error);
            this.mostrarToast('Error al cargar comicios: ' + error.message, 'error');
        } finally {
            document.getElementById('comicios-loading').style.display = 'none';
        }
    }

    renderizarComicios() {
        const tbody = document.getElementById('comicios-tbody');
        const tabla = document.getElementById('comicios-tabla');
        const empty = document.getElementById('comicios-empty');

        if (this.comicios.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = this.comicios.map((c) => `
            <tr>
                <td class="comicio-nombre">${escaparHtml(c.nombre)}</td>
                <td><span class="tipo-badge tipo-${escaparHtml(c.tipo_eleccion)}">${escaparHtml(this.formatearTipo(c.tipo_eleccion))}</span></td>
                <td>${escaparHtml(String(c.listas_count ?? '-'))}</td>
                <td>${escaparHtml(String(c.mesas_count ?? '-'))}</td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-entrar" title="Ver mesas" data-id="${c.id}">
                            <i class="fas fa-arrow-right"></i>
                        </button>
                        <button class="btn-accion btn-editar" title="Editar comicio" data-id="${c.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar comicio" data-id="${c.id}" data-nombre="${escaparHtml(c.nombre)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-entrar').forEach((btn) => {
            btn.addEventListener('click', () => this.entrarAComicio(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-editar').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalEditarComicio(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
            btn.addEventListener('click', () => this.eliminarComicio(Number(btn.dataset.id), btn.dataset.nombre));
        });
    }

    // ---- Modal comicio ----

    renderizarChecklistListas(seleccionadas = []) {
        const cont = document.getElementById('form-comicio-listas');
        if (this.listasDisponibles.length === 0) {
            cont.innerHTML = '<p class="candidatos-vacio" style="display:block;">No hay listas cargadas todavía — creá una en "Listas" primero.</p>';
            return;
        }
        cont.innerHTML = this.listasDisponibles.map((l) => `
            <label class="checkbox-row">
                <input type="checkbox" value="${l.id}" ${seleccionadas.includes(l.id) ? 'checked' : ''}>
                <span>${escaparHtml(l.nombre)}</span>
            </label>
        `).join('');
    }

    abrirModalCrearComicio() {
        document.getElementById('modal-comicio-titulo').innerHTML = '<i class="fas fa-plus"></i> Nuevo Comicio';
        document.getElementById('form-comicio-id').value = '';
        document.getElementById('form-comicio-nombre').value = '';
        document.getElementById('form-comicio-tipo').value = '';
        document.getElementById('form-comicio-error').style.display = 'none';
        this.renderizarChecklistListas();
        document.getElementById('modal-comicio').style.display = 'flex';
        document.getElementById('form-comicio-nombre').focus();
    }

    async abrirModalEditarComicio(id) {
        try {
            const response = await window.apiService.obtenerComicio(id);
            if (!response.success) return;
            const comicio = response.data;

            document.getElementById('modal-comicio-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Comicio';
            document.getElementById('form-comicio-id').value = comicio.id;
            document.getElementById('form-comicio-nombre').value = comicio.nombre;
            document.getElementById('form-comicio-tipo').value = comicio.tipo_eleccion;
            document.getElementById('form-comicio-error').style.display = 'none';
            this.renderizarChecklistListas(comicio.listas.map((l) => l.id));
            document.getElementById('modal-comicio').style.display = 'flex';
        } catch (error) {
            this.mostrarToast('Error al abrir el comicio: ' + error.message, 'error');
        }
    }

    cerrarModalComicio() {
        document.getElementById('modal-comicio').style.display = 'none';
    }

    async guardarComicio() {
        const id = document.getElementById('form-comicio-id').value;
        const isEdit = !!id;
        const nombre = document.getElementById('form-comicio-nombre').value.trim();
        const tipoEleccion = document.getElementById('form-comicio-tipo').value;
        const listaIds = [...document.querySelectorAll('#form-comicio-listas input:checked')].map((el) => Number(el.value));

        if (!nombre) return this.mostrarError('form-comicio-error', 'El nombre del comicio es obligatorio');
        if (!tipoEleccion) return this.mostrarError('form-comicio-error', 'Elegí un tipo de elección');
        if (listaIds.length === 0) return this.mostrarError('form-comicio-error', 'Elegí al menos una lista participante');

        const btn = document.getElementById('btn-guardar-comicio');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { nombre, tipoEleccion, listaIds };
            const response = isEdit
                ? await window.apiService.actualizarComicio(Number(id), data)
                : await window.apiService.crearComicio(data);

            if (response.success) {
                this.cerrarModalComicio();
                this.mostrarToast(isEdit ? 'Comicio actualizado' : 'Comicio creado', 'success');
                await this.cargarComicios();
                if (this.comicioActual && isEdit && this.comicioActual.id === Number(id)) {
                    await this.entrarAComicio(Number(id));
                }
            }
        } catch (error) {
            this.mostrarError('form-comicio-error', error.message || 'Error al guardar el comicio');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarComicio(id, nombre) {
        if (!confirm(`¿Eliminar el comicio "${nombre}"? Se borran también sus mesas y votos cargados.`)) return;
        try {
            const response = await window.apiService.eliminarComicio(id);
            if (response.success) {
                this.mostrarToast('Comicio eliminado', 'success');
                await this.cargarComicios();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ---- Detalle de comicio (mesas + métricas) ----

    async entrarAComicio(id) {
        try {
            const response = await window.apiService.obtenerComicio(id);
            if (!response.success) return;
            this.comicioActual = response.data;

            document.getElementById('comicio-listado-view').style.display = 'none';
            document.getElementById('comicio-detalle-view').style.display = 'block';
            document.getElementById('detalle-comicio-nombre').innerHTML =
                `<i class="fas fa-building"></i> ${escaparHtml(this.comicioActual.nombre)}`;
            document.getElementById('detalle-comicio-listas').textContent =
                `${this.formatearTipo(this.comicioActual.tipo_eleccion)} · ${this.comicioActual.listas.map((l) => l.nombre).join(', ')}`;

            this.renderizarMesas();
            await this.cargarMetricas();
        } catch (error) {
            this.mostrarToast('Error al abrir el comicio: ' + error.message, 'error');
        }
    }

    volverAlListado() {
        this.comicioActual = null;
        document.getElementById('comicio-detalle-view').style.display = 'none';
        document.getElementById('comicio-listado-view').style.display = 'block';
        this.cargarComicios();
    }

    renderizarMesas() {
        const mesas = this.comicioActual.mesas || [];
        const tbody = document.getElementById('mesas-tbody');
        const tabla = document.getElementById('mesas-tabla');
        const empty = document.getElementById('mesas-empty');

        if (mesas.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = mesas.map((m) => {
            const cargados = m.votos_blancos !== null && m.votos_blancos !== undefined;
            return `
            <tr>
                <td>${escaparHtml(String(m.numero))}</td>
                <td>${escaparHtml(m.padron_desde_dni)} — ${escaparHtml(m.padron_hasta_dni)}</td>
                <td>${escaparHtml(String(m.cantidad_votantes ?? '-'))}</td>
                <td>
                    <span class="estado-badge ${cargados ? 'estado-activo' : 'estado-inactivo'}">
                        <i class="fas ${cargados ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                        ${cargados ? 'Cargados' : 'Sin cargar'}
                    </span>
                </td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-votos" title="Cargar votos" data-id="${m.id}">
                            <i class="fas fa-check-to-slot"></i>
                        </button>
                        <button class="btn-accion btn-editar" title="Editar mesa" data-id="${m.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar mesa" data-id="${m.id}" data-numero="${escaparHtml(String(m.numero))}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');

        tbody.querySelectorAll('.btn-votos').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalVotos(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-editar').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalEditarMesa(Number(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
            btn.addEventListener('click', () => this.eliminarMesa(Number(btn.dataset.id), btn.dataset.numero));
        });
    }

    // ---- Modal mesa ----

    abrirModalCrearMesa() {
        document.getElementById('modal-mesa-titulo').innerHTML = '<i class="fas fa-plus"></i> Nueva Mesa';
        document.getElementById('form-mesa-id').value = '';
        document.getElementById('form-mesa-numero').value = '';
        document.getElementById('form-mesa-desde').value = '';
        document.getElementById('form-mesa-hasta').value = '';
        document.getElementById('form-mesa-error').style.display = 'none';
        document.getElementById('modal-mesa').style.display = 'flex';
        document.getElementById('form-mesa-numero').focus();
    }

    abrirModalEditarMesa(mesaId) {
        const mesa = this.comicioActual.mesas.find((m) => m.id === mesaId);
        if (!mesa) return;

        document.getElementById('modal-mesa-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Mesa';
        document.getElementById('form-mesa-id').value = mesa.id;
        document.getElementById('form-mesa-numero').value = mesa.numero;
        document.getElementById('form-mesa-desde').value = mesa.padron_desde_dni;
        document.getElementById('form-mesa-hasta').value = mesa.padron_hasta_dni;
        document.getElementById('form-mesa-error').style.display = 'none';
        document.getElementById('modal-mesa').style.display = 'flex';
    }

    cerrarModalMesa() {
        document.getElementById('modal-mesa').style.display = 'none';
    }

    async guardarMesa() {
        const id = document.getElementById('form-mesa-id').value;
        const isEdit = !!id;
        const numero = Number(document.getElementById('form-mesa-numero').value);
        const desdeDni = document.getElementById('form-mesa-desde').value.trim();
        const hastaDni = document.getElementById('form-mesa-hasta').value.trim();

        if (!Number.isInteger(numero) || numero <= 0) return this.mostrarError('form-mesa-error', 'El número de mesa tiene que ser un entero positivo');
        if (!desdeDni || !hastaDni) return this.mostrarError('form-mesa-error', 'Completá los dos DNI del rango');

        const btn = document.getElementById('btn-guardar-mesa');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { numero, desdeDni, hastaDni };
            const response = isEdit
                ? await window.apiService.actualizarMesa(this.comicioActual.id, Number(id), data)
                : await window.apiService.crearMesa(this.comicioActual.id, data);

            if (response.success) {
                this.cerrarModalMesa();
                this.mostrarToast(isEdit ? 'Mesa actualizada' : `Mesa creada — ${response.data.cantidad_votantes} votantes en el rango`, 'success');
                await this.entrarAComicio(this.comicioActual.id);
            }
        } catch (error) {
            this.mostrarError('form-mesa-error', error.message || 'Error al guardar la mesa');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarMesa(mesaId, numero) {
        if (!confirm(`¿Eliminar la mesa ${numero}? Se borran también sus votos cargados.`)) return;
        try {
            const response = await window.apiService.eliminarMesa(this.comicioActual.id, mesaId);
            if (response.success) {
                this.mostrarToast('Mesa eliminada', 'success');
                await this.entrarAComicio(this.comicioActual.id);
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ---- Modal votos ----

    async abrirModalVotos(mesaId) {
        this.mesaEnEdicionVotos = mesaId;
        const mesa = this.comicioActual.mesas.find((m) => m.id === mesaId);

        document.getElementById('modal-votos-titulo').innerHTML = `<i class="fas fa-check-to-slot"></i> Votos — Mesa ${escaparHtml(String(mesa.numero))}`;
        document.getElementById('form-votos-mesa-id').value = mesaId;
        document.getElementById('form-votos-error').style.display = 'none';

        let votosPrevios = { porLista: [] };
        try {
            const response = await window.apiService.obtenerVotosMesa(this.comicioActual.id, mesaId);
            if (response.success) votosPrevios = response.data;
        } catch (error) {
            console.error('Error cargando votos previos:', error);
        }

        document.getElementById('form-votos-blancos').value = votosPrevios.blancos ?? 0;
        document.getElementById('form-votos-nulos').value = votosPrevios.nulos ?? 0;

        const cont = document.getElementById('form-votos-listas');
        cont.innerHTML = this.comicioActual.listas.map((l) => {
            const previo = votosPrevios.porLista.find((v) => v.lista_id === l.id);
            return `
                <div class="form-group">
                    <label for="voto-lista-${l.id}">${escaparHtml(l.nombre)}</label>
                    <input type="number" id="voto-lista-${l.id}" class="form-input" data-lista-id="${l.id}" min="0" step="1" value="${previo ? previo.cantidad : 0}" required>
                </div>
            `;
        }).join('');

        document.getElementById('modal-votos').style.display = 'flex';
    }

    cerrarModalVotos() {
        document.getElementById('modal-votos').style.display = 'none';
    }

    async guardarVotos() {
        const mesaId = Number(document.getElementById('form-votos-mesa-id').value);
        const blancos = Number(document.getElementById('form-votos-blancos').value);
        const nulos = Number(document.getElementById('form-votos-nulos').value);
        const porLista = [...document.querySelectorAll('#form-votos-listas input')].map((input) => ({
            listaId: Number(input.dataset.listaId),
            cantidad: Number(input.value),
        }));

        if (!Number.isInteger(blancos) || blancos < 0) return this.mostrarError('form-votos-error', 'Los votos en blanco tienen que ser un entero no negativo');
        if (!Number.isInteger(nulos) || nulos < 0) return this.mostrarError('form-votos-error', 'Los votos nulos tienen que ser un entero no negativo');

        const btn = document.getElementById('btn-guardar-votos');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const response = await window.apiService.cargarVotosMesa(this.comicioActual.id, mesaId, { blancos, nulos, porLista });
            if (response.success) {
                this.cerrarModalVotos();
                this.mostrarToast('Votos guardados', 'success');
                await this.entrarAComicio(this.comicioActual.id);
            }
        } catch (error) {
            this.mostrarError('form-votos-error', error.message || 'Error al guardar los votos');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar votos';
        }
    }

    // ---- Métricas ----

    async cargarMetricas() {
        const cont = document.getElementById('metricas-container');
        cont.innerHTML = '<div class="comicio-loading"><i class="fas fa-spinner fa-spin"></i> Calculando métricas...</div>';

        try {
            const response = await window.apiService.metricasComicio(this.comicioActual.id);
            if (!response.success) return;
            const m = response.data;

            const filasLista = m.porLista.map((l) => `
                <tr>
                    <td>${escaparHtml(l.lista_nombre)}</td>
                    <td>${escaparHtml(String(l.votos))}</td>
                    <td>${m.emitidos > 0 ? `${((l.votos / m.emitidos) * 100).toFixed(1)}%` : '-'}</td>
                </tr>
            `).join('');

            const participacionTexto = m.participacion === null ? '-' : `${(m.participacion * 100).toFixed(1)}%`;

            cont.innerHTML = `
                <div class="metricas-cards">
                    <div class="metrica-card">
                        <span class="metrica-valor">${escaparHtml(String(m.emitidos))}</span>
                        <span class="metrica-label">Votos emitidos</span>
                    </div>
                    <div class="metrica-card">
                        <span class="metrica-valor">${escaparHtml(String(m.blancos))}</span>
                        <span class="metrica-label">En blanco</span>
                    </div>
                    <div class="metrica-card">
                        <span class="metrica-valor">${escaparHtml(String(m.nulos))}</span>
                        <span class="metrica-label">Nulos</span>
                    </div>
                    <div class="metrica-card">
                        <span class="metrica-valor">${escaparHtml(String(m.mesasConVotos))}/${escaparHtml(String(m.mesasTotal))}</span>
                        <span class="metrica-label">Mesas cargadas</span>
                    </div>
                    <div class="metrica-card">
                        <span class="metrica-valor">${escaparHtml(participacionTexto)}</span>
                        <span class="metrica-label">Participación</span>
                    </div>
                </div>
                <table class="comicio-tabla metricas-tabla">
                    <thead><tr><th>Lista</th><th>Votos</th><th>% sobre emitidos</th></tr></thead>
                    <tbody>${filasLista || '<tr><td colspan="3">Sin votos cargados todavía</td></tr>'}</tbody>
                </table>
            `;
        } catch (error) {
            cont.innerHTML = `<p class="candidatos-vacio" style="display:block;">Error al calcular métricas: ${escaparHtml(error.message)}</p>`;
        }
    }

    // ---- Helpers ----

    formatearTipo(tipo) {
        const nombres = { provincial: 'Provincial', municipal: 'Municipal', nacional: 'Nacional' };
        return nombres[tipo] || tipo;
    }

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

window.comicioComponent = new ComicioComponent();
