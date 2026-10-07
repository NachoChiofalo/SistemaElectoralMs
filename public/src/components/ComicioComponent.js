/**
 * Componente de Comicio: el comicio es el módulo. Un listado de comicios en el primer
 * nivel, y al entrar a uno, todo lo que le pertenece vive adentro de él en
 * sub-pestañas -- mesas (rango de padrón opcional, votos), fuerzas participantes,
 * fiscales de sus mesas (padrón + calendario de franjas) y resultados (métricas y
 * gráficos). Nunca todo a la vista al mismo tiempo: gestionar mesas no muestra el CRUD
 * de fuerzas ni el de fiscales de fondo.
 *
 * Las fuerzas y el padrón de fiscales son entidades globales (una fuerza puede
 * participar de varios comicios; un fiscal puede cubrir mesas de varios), pero se
 * gestionan desde adentro del comicio con el que se está trabajando -- es ahí donde
 * tiene sentido tocarlas. La única salida a esa regla es el botón "Nueva fuerza" dentro
 * del modal de alta de comicio: hace falta poder crear la primera fuerza sin haber
 * entrado nunca a un comicio, porque el primer comicio todavía no existe.
 *
 * El voto de mesa es por "fuerza" (PJ, UCR, etc.), no por lista de candidatos de 017:
 * son dos conceptos distintos -- una fuerza es lo que se vota, una lista es candidatos
 * y orden. Una fuerza puede enlazarse a una lista si hace falta el detalle, pero no es
 * un requisito para votar.
 *
 * Sin permiso comicio.view (sólo fiscales.view), no hay comicio al que entrar: se
 * muestra nada más el padrón de fiscales, standalone.
 *
 * Varias vistas dentro del mismo contenedor (listado / detalle de comicio), sin router,
 * como el resto del frontend hace con paneles.
 */
class ComicioComponent {
    constructor() {
        this.container = null;
        this.permisos = { comicioView: false, comicioEdit: false, fiscalesView: false, fiscalesEdit: false };

        this.fuerzas = [];
        this.fiscales = [];
        this.comicios = [];
        this.comicioActual = null; // { id, nombre, tipo_eleccion, fuerzas, mesas }
        this.mesaEnEdicionVotos = null;
        this.mesaSeleccionadaFiscales = null;
        this.asignacionesMesaActual = [];
        this.asignacionesPorMesa = new Map(); // mesaId -> asignaciones, para el calendario del comicio
        this.asignacionEnEdicionId = null; // fila del formulario inline de asignacion: null = alta

        this.graficoTorta = null;
        this.graficoBarras = null;

        this.subTabActual = 'mesas'; // 'mesas' | 'fuerzas' | 'fiscales' | 'resultados', dentro de un comicio
        this.modalComicioPausado = false; // true mientras el modal de fuerza tapa al de comicio (bootstrap)
    }

    async init(containerId = 'comicio-container', permisos = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error(`Contenedor ${containerId} no encontrado`);
        this.permisos = { ...this.permisos, ...permisos };

        this.crearInterfaz();
        this.inicializarEventos();

        if (this.permisos.comicioView) {
            await this.cargarFuerzas();
            await this.cargarComicios();
        }
        if (this.permisos.fiscalesView) {
            await this.cargarFiscales();
        }
        return true;
    }

    /**
     * El comicio es el módulo: fuerzas, fiscales y resultados se gestionan adentro de
     * un comicio elegido, no como secciones sueltas al costado. Alguien con sólo
     * fiscales.view (sin comicio.view) no tiene comicio al que entrar, así que ve el
     * padrón de fiscales solo, sin nada de comicio alrededor.
     */
    crearInterfaz() {
        if (this.permisos.comicioView) {
            this.container.innerHTML = `
                ${this.htmlSeccionComicios()}
                ${this.htmlModalComicio()}
                ${this.htmlModalFuerza()}
                ${this.htmlModalMesa()}
                ${this.htmlModalVotos()}
                ${this.permisos.fiscalesView ? this.htmlModalFiscal() : ''}
                ${this.permisos.fiscalesView ? this.htmlModalFiscalesMesa() : ''}
                <div id="toast-container" class="toast-container"></div>
            `;
            return;
        }

        // Sin comicio.view: sólo el padrón de fiscales, sin comicio ni calendario (ambos
        // necesitan una mesa, y una mesa vive dentro de un comicio).
        this.container.innerHTML = `
            ${this.htmlSeccionFiscales()}
            ${this.htmlModalFiscal()}
            <div id="toast-container" class="toast-container"></div>
        `;
    }

    htmlModalFuerza() {
        return `
            <div id="modal-fuerza" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3 id="modal-fuerza-titulo"><i class="fas fa-plus"></i> Nueva Fuerza</h3>
                        <button type="button" class="modal-close" id="modal-fuerza-close">&times;</button>
                    </div>
                    <form id="form-fuerza" class="modal-body">
                        <input type="hidden" id="form-fuerza-id" value="">
                        <div class="form-group">
                            <label for="form-fuerza-nombre">Nombre <span class="required">*</span></label>
                            <input type="text" id="form-fuerza-nombre" class="form-input" required maxlength="200">
                        </div>
                        <div class="form-group">
                            <label for="form-fuerza-sigla">Sigla</label>
                            <input type="text" id="form-fuerza-sigla" class="form-input" maxlength="20" placeholder="Ej: PJ, UCR">
                        </div>
                        <div class="form-group">
                            <label>Color <span class="required">*</span></label>
                            <input type="hidden" id="form-fuerza-color" value="1">
                            <div class="color-swatches" id="form-fuerza-color-swatches">
                                ${Array.from({ length: 8 }, (_, i) => i + 1).map((n) => `
                                    <button type="button" class="color-swatch color-swatch-${n}" data-color="${n}" title="Color ${n}"></button>
                                `).join('')}
                            </div>
                        </div>
                        <div id="form-fuerza-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-fuerza">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-fuerza">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    /** Carga la lista global de fuerzas. El render vive en el comicio abierto (o en el
     *  modal de alta de comicio, para el caso de bootstrap sin ningún comicio todavía). */
    async cargarFuerzas() {
        try {
            const response = await window.apiService.obtenerFuerzas();
            if (response.success) {
                this.fuerzas = response.data;
                if (this.comicioActual) this.renderizarFuerzasComicio();
            }
        } catch (error) {
            this.mostrarToast('Error al cargar fuerzas: ' + error.message, 'error');
        }
    }

    /** Índice 1..8 a `var(--ds-fuerza-N)`. Nunca un hex libre: es la paleta fija del design system. */
    colorFuerzaVar(color) {
        // Cast defensivo (FE-039): el dominio 1-8 lo valida el servidor y la base, pero este
        // valor se interpola en markup y no deberia depender de que otra capa lo haya hecho.
        const n = Number(color);
        return `var(--ds-fuerza-${Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1})`;
    }

    seleccionarColorFuerza(color) {
        document.getElementById('form-fuerza-color').value = color;
        document.querySelectorAll('#form-fuerza-color-swatches .color-swatch').forEach((btn) => {
            btn.classList.toggle('color-swatch-selected', Number(btn.dataset.color) === color);
        });
    }

    /** Color por defecto de una fuerza nueva: el siguiente de la paleta que menos se repite entre las cargadas. */
    proximoColorFuerza() {
        return (this.fuerzas.length % 8) + 1;
    }

    /**
     * Si el modal de comicio está abierto (bootstrap: crear la primera fuerza sin salir
     * de "Nuevo Comicio"), se oculta mientras dure el de fuerza y se restaura al
     * cerrarlo -- nunca dos `.modal-overlay` superpuestos, mismo criterio que ya se
     * aplicó para no anidar el modal de asignación de fiscal dentro del de la mesa.
     */
    pausarModalComicioSiAbierto() {
        const modalComicio = document.getElementById('modal-comicio');
        if (modalComicio && modalComicio.style.display === 'flex') {
            modalComicio.style.display = 'none';
            this.modalComicioPausado = true;
        }
    }

    abrirModalCrearFuerza() {
        this.pausarModalComicioSiAbierto();
        document.getElementById('modal-fuerza-titulo').innerHTML = '<i class="fas fa-plus"></i> Nueva Fuerza';
        document.getElementById('form-fuerza-id').value = '';
        document.getElementById('form-fuerza-nombre').value = '';
        document.getElementById('form-fuerza-sigla').value = '';
        document.getElementById('form-fuerza-error').style.display = 'none';
        this.seleccionarColorFuerza(this.proximoColorFuerza());
        document.getElementById('modal-fuerza').style.display = 'flex';
        document.getElementById('form-fuerza-nombre').focus();
    }

    abrirModalEditarFuerza(id) {
        const fuerza = this.fuerzas.find((f) => f.id === id);
        if (!fuerza) return;
        document.getElementById('modal-fuerza-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Fuerza';
        document.getElementById('form-fuerza-id').value = fuerza.id;
        document.getElementById('form-fuerza-nombre').value = fuerza.nombre;
        document.getElementById('form-fuerza-sigla').value = fuerza.sigla || '';
        document.getElementById('form-fuerza-error').style.display = 'none';
        this.seleccionarColorFuerza(fuerza.color || 1);
        document.getElementById('modal-fuerza').style.display = 'flex';
    }

    cerrarModalFuerza() {
        document.getElementById('modal-fuerza').style.display = 'none';
        if (this.modalComicioPausado) {
            this.modalComicioPausado = false;
            document.getElementById('modal-comicio').style.display = 'flex';
        }
    }

    async guardarFuerza() {
        const id = document.getElementById('form-fuerza-id').value;
        const isEdit = !!id;
        const nombre = document.getElementById('form-fuerza-nombre').value.trim();
        const sigla = document.getElementById('form-fuerza-sigla').value.trim();
        const color = Number(document.getElementById('form-fuerza-color').value);

        if (!nombre) return this.mostrarError('form-fuerza-error', 'El nombre de la fuerza es obligatorio');

        const btn = document.getElementById('btn-guardar-fuerza');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { nombre, sigla: sigla || null, color };
            const response = isEdit
                ? await window.apiService.actualizarFuerza(Number(id), data)
                : await window.apiService.crearFuerza(data);

            if (response.success) {
                // Si se llegó a "Nueva fuerza" desde el modal de comicio (bootstrap: no
                // hay fuerzas todavía para elegir), reabrirlo con la fuerza nueva ya
                // tildada -- guarda el paso de volver a marcarla a mano.
                const checklistPrevio = [...document.querySelectorAll('#form-comicio-fuerzas input:checked')].map((el) => Number(el.value));
                this.cerrarModalFuerza();
                this.mostrarToast(isEdit ? 'Fuerza actualizada' : 'Fuerza creada', 'success');
                await this.cargarFuerzas();
                if (document.getElementById('modal-comicio').style.display === 'flex') {
                    const seleccion = isEdit ? checklistPrevio : [...checklistPrevio, response.data.id];
                    this.renderizarChecklistFuerzas(seleccion);
                }
            }
        } catch (error) {
            this.mostrarError('form-fuerza-error', error.message || 'Error al guardar la fuerza');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarFuerza(id, nombre) {
        if (!confirm(`¿Eliminar la fuerza "${nombre}"?`)) return;
        try {
            const response = await window.apiService.eliminarFuerza(id);
            if (response.success) {
                this.mostrarToast('Fuerza eliminada', 'success');
                await this.cargarFuerzas();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ==================== Fiscales (padrón) ====================

    htmlSeccionFiscales() {
        return `
            <div class="fiscales-header">
                <div class="fiscales-title">
                    <h2><i class="fas fa-user-shield"></i> Fiscales</h2>
                    <p class="fiscales-subtitle">Registro de fiscales. La asignación a una mesa se hace dentro de cada comicio.</p>
                </div>
                ${this.permisos.fiscalesEdit ? `
                <div class="fiscales-actions">
                    <button id="btn-crear-fiscal" class="btn btn-primary">
                        <i class="fas fa-plus"></i> <span class="btn-text">Nuevo Fiscal</span>
                    </button>
                </div>` : ''}
            </div>
            <div class="fiscales-tabla-container" style="margin-bottom: 32px;">
                <div id="fiscales-loading" class="fiscales-loading" style="display: none;">
                    <i class="fas fa-spinner fa-spin"></i> Cargando fiscales...
                </div>
                <table class="fiscales-tabla" id="fiscales-tabla">
                    <thead><tr><th>Nombre</th><th>DNI</th><th>Teléfono</th><th>Acciones</th></tr></thead>
                    <tbody id="fiscales-tbody"></tbody>
                </table>
                <div id="fiscales-empty" class="fiscales-empty" style="display: none;">
                    <i class="fas fa-user-shield"></i>
                    <p>Todavía no hay fiscales cargados</p>
                </div>
            </div>
        `;
    }

    htmlModalFiscal() {
        return `
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
        `;
    }

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
                        ${this.permisos.fiscalesEdit ? `
                        <button class="btn-accion btn-editar" title="Editar fiscal" data-id="${f.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar fiscal" data-id="${f.id}" data-nombre="${escaparHtml(f.nombre)}">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
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

    // ==================== Comicios ====================

    /**
     * Un comicio es el contenedor: sus fuerzas, sus fiscales y sus resultados se
     * gestionan adentro de él, no como secciones sueltas al costado. Entrar a un
     * comicio muestra mesas por defecto, con sub-pestañas para el resto -- nunca todo
     * junto en pantalla.
     */
    subTabsDisponibles() {
        const tabs = [{ key: 'mesas', icon: 'fa-chair', label: 'Mesas' }];
        tabs.push({ key: 'fuerzas', icon: 'fa-flag', label: 'Fuerzas' });
        if (this.permisos.fiscalesView) tabs.push({ key: 'fiscales', icon: 'fa-user-shield', label: 'Fiscales' });
        tabs.push({ key: 'resultados', icon: 'fa-chart-pie', label: 'Resultados' });
        return tabs;
    }

    htmlSeccionComicios() {
        const subTabs = this.subTabsDisponibles();
        return `
            <div id="comicio-listado-view">
                <div class="comicio-header">
                    <div class="comicio-title">
                        <h2><i class="fas fa-building"></i> Comicios</h2>
                        <p class="comicio-subtitle">Entrá a un comicio para gestionar sus mesas, fuerzas, fiscales y resultados</p>
                    </div>
                    ${this.permisos.comicioEdit ? `
                    <div class="comicio-actions">
                        <button id="btn-crear-comicio" class="btn btn-primary">
                            <i class="fas fa-plus"></i> <span class="btn-text">Nuevo Comicio</span>
                        </button>
                    </div>` : ''}
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
                                <th>Fuerzas</th>
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

            <!-- ---- Detalle de un comicio: todo lo que le pertenece vive acá ---- -->
            <div id="comicio-detalle-view" style="display: none;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-volver-listado">
                    <i class="fas fa-arrow-left"></i> Volver a comicios
                </button>

                <div class="comicio-header">
                    <div class="comicio-title">
                        <h2 id="detalle-comicio-nombre"><i class="fas fa-building"></i></h2>
                        <p class="comicio-subtitle" id="detalle-comicio-fuerzas"></p>
                    </div>
                </div>

                <div class="comicio-subtabs" role="tablist">
                    ${subTabs.map((t) => `
                        <button type="button" class="comicio-subtab" data-subtab="${t.key}">
                            <i class="fas ${t.icon}"></i> ${t.label}
                        </button>
                    `).join('')}
                </div>

                <div id="subtab-mesas" class="comicio-subtab-panel">
                    <div class="comicio-header">
                        <div class="comicio-title"><h3><i class="fas fa-chair"></i> Mesas</h3></div>
                        ${this.permisos.comicioEdit ? `
                        <div class="comicio-actions">
                            <button id="btn-crear-mesa" class="btn btn-primary btn-sm">
                                <i class="fas fa-plus"></i> <span class="btn-text">Nueva Mesa</span>
                            </button>
                        </div>` : ''}
                    </div>
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

                <div id="subtab-fuerzas" class="comicio-subtab-panel" style="display: none;">
                    ${this.htmlPanelFuerzasComicio()}
                </div>

                ${this.permisos.fiscalesView ? `
                <div id="subtab-fiscales" class="comicio-subtab-panel" style="display: none;">
                    ${this.htmlSeccionFiscales()}
                    <div class="fiscales-header" style="margin-top: 24px;">
                        <div class="fiscales-title">
                            <h3><i class="fas fa-calendar-alt"></i> Horarios</h3>
                            <p class="fiscales-subtitle">Franjas de 08:00 a 18:00 por mesa. Tocá "Fiscales" en una mesa (pestaña Mesas) para asignar.</p>
                        </div>
                    </div>
                    <div id="calendario-comicio" class="calendario-container"></div>
                </div>` : ''}

                <div id="subtab-resultados" class="comicio-subtab-panel" style="display: none;">
                    ${this.htmlSeccionResultados()}
                </div>
            </div>
        `;
    }

    mostrarSubTab(key) {
        this.subTabActual = key;
        document.querySelectorAll('.comicio-subtab-panel').forEach((el) => {
            el.style.display = el.id === `subtab-${key}` ? 'block' : 'none';
        });
        document.querySelectorAll('.comicio-subtab').forEach((btn) => {
            btn.classList.toggle('comicio-subtab-activa', btn.dataset.subtab === key);
        });
        if (key === 'resultados') this.cargarResultadosComicioActual();
    }

    // ---- Fuerzas de este comicio (participación) ----

    htmlPanelFuerzasComicio() {
        return `
            <div class="comicio-header">
                <div class="comicio-title">
                    <h3><i class="fas fa-flag"></i> Fuerzas</h3>
                    <p class="comicio-subtitle">Tildá las que participan de este comicio. El voto de mesa se carga por fuerza.</p>
                </div>
                ${this.permisos.comicioEdit ? `
                <div class="comicio-actions">
                    <button id="btn-crear-fuerza" class="btn btn-primary btn-sm">
                        <i class="fas fa-plus"></i> <span class="btn-text">Nueva Fuerza</span>
                    </button>
                </div>` : ''}
            </div>
            <div class="comicio-tabla-container">
                <table class="comicio-tabla" id="fuerzas-comicio-tabla">
                    <thead><tr><th>Participa</th><th>Nombre</th><th>Sigla</th><th>Acciones</th></tr></thead>
                    <tbody id="fuerzas-comicio-tbody"></tbody>
                </table>
                <div id="fuerzas-comicio-empty" class="comicio-empty" style="display: none;">
                    <i class="fas fa-flag"></i>
                    <p>Todavía no hay fuerzas cargadas</p>
                </div>
            </div>
        `;
    }

    renderizarFuerzasComicio() {
        const tbody = document.getElementById('fuerzas-comicio-tbody');
        const tabla = document.getElementById('fuerzas-comicio-tabla');
        const empty = document.getElementById('fuerzas-comicio-empty');
        if (!tbody) return;

        if (this.fuerzas.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }
        tabla.style.display = 'table';
        empty.style.display = 'none';

        const participanIds = new Set((this.comicioActual.fuerzas || []).map((f) => f.id));

        tbody.innerHTML = this.fuerzas.map((f) => `
            <tr>
                <td>
                    <label class="checkbox-row">
                        <input type="checkbox" class="checkbox-participa-fuerza" value="${f.id}" ${participanIds.has(f.id) ? 'checked' : ''} ${this.permisos.comicioEdit ? '' : 'disabled'}>
                    </label>
                </td>
                <td class="comicio-nombre"><span class="color-dot" style="background:${this.colorFuerzaVar(f.color)};"></span>${escaparHtml(f.nombre)}</td>
                <td>${escaparHtml(f.sigla || '-')}</td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.comicioEdit ? `
                        <button class="btn-accion btn-editar" title="Editar fuerza" data-id="${f.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar fuerza" data-id="${f.id}" data-nombre="${escaparHtml(f.nombre)}">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');

        if (this.permisos.comicioEdit) {
            tbody.querySelectorAll('.checkbox-participa-fuerza').forEach((chk) => {
                chk.addEventListener('change', () => this.toggleFuerzaEnComicio(Number(chk.value), chk.checked));
            });
            tbody.querySelectorAll('.btn-editar').forEach((btn) => {
                btn.addEventListener('click', () => this.abrirModalEditarFuerza(Number(btn.dataset.id)));
            });
            tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
                btn.addEventListener('click', () => this.eliminarFuerza(Number(btn.dataset.id), btn.dataset.nombre));
            });
        }
    }

    async toggleFuerzaEnComicio(fuerzaId, participa) {
        // Cada cambio manda el PUT completo calculado desde el estado local, que recien se
        // actualiza al volver la respuesta: dos tildes rapidas partian del mismo estado y
        // la ultima en resolver pisaba a la otra (FE-017). Mientras hay un guardado en
        // curso, los checkboxes quedan deshabilitados.
        if (this.guardandoFuerzas) {
            this.renderizarFuerzasComicio();
            return;
        }
        this.guardandoFuerzas = true;
        document.querySelectorAll('.checkbox-participa-fuerza').forEach((chk) => { chk.disabled = true; });
        try {
            await this.guardarFuerzasDeComicio(fuerzaId, participa);
        } finally {
            this.guardandoFuerzas = false;
            this.renderizarFuerzasComicio();
        }
    }

    async guardarFuerzasDeComicio(fuerzaId, participa) {
        const actuales = new Set((this.comicioActual.fuerzas || []).map((f) => f.id));
        if (participa) actuales.add(fuerzaId); else actuales.delete(fuerzaId);
        const fuerzaIds = [...actuales];

        if (fuerzaIds.length === 0) {
            this.mostrarToast('El comicio necesita al menos una fuerza participante', 'error');
            this.renderizarFuerzasComicio();
            return;
        }

        try {
            const data = { nombre: this.comicioActual.nombre, tipoEleccion: this.comicioActual.tipo_eleccion, fuerzaIds };
            const response = await window.apiService.actualizarComicio(this.comicioActual.id, data);
            if (response.success) {
                this.comicioActual = response.data;
                document.getElementById('detalle-comicio-fuerzas').textContent =
                    `${this.formatearTipo(this.comicioActual.tipo_eleccion)} · ${this.comicioActual.fuerzas.map((f) => f.nombre).join(', ')}`;
                this.renderizarFuerzasComicio();
                this.mostrarToast('Fuerzas del comicio actualizadas', 'success');
            }
        } catch (error) {
            this.mostrarToast('Error al actualizar: ' + error.message, 'error');
            this.renderizarFuerzasComicio();
        }
    }

    // ==================== Resultados ====================

    htmlSeccionResultados() {
        return `
            <div class="comicio-header">
                <div class="comicio-title">
                    <h3><i class="fas fa-chart-pie"></i> Resultados</h3>
                    <p class="comicio-subtitle">Métricas y gráficos en base a los votos cargados por mesa</p>
                </div>
            </div>

            <div id="resultados-metricas-container" class="metricas-container"></div>

            <div class="resultados-graficos">
                <div class="resultado-grafico-card">
                    <h3>Distribución de votos</h3>
                    <div class="chart-container chart-container-sm">
                        <canvas id="resultados-chart-torta"></canvas>
                    </div>
                </div>
                <div class="resultado-grafico-card">
                    <h3>Votos por fuerza</h3>
                    <div class="chart-container chart-container-sm">
                        <canvas id="resultados-chart-barras"></canvas>
                    </div>
                </div>
            </div>

            <table class="comicio-tabla metricas-tabla" id="resultados-tabla-fuerzas">
                <thead><tr><th></th><th>Fuerza</th><th>Votos</th><th>% sobre emitidos</th></tr></thead>
                <tbody id="resultados-tbody-fuerzas"></tbody>
            </table>
        `;
    }

    /** Resultados del comicio abierto (`this.comicioActual`) -- no hay selector propio, ya estamos adentro de uno. */
    async cargarResultadosComicioActual() {
        if (!this.comicioActual) return;
        try {
            const response = await window.apiService.metricasComicio(this.comicioActual.id);
            if (!response.success) return;
            const m = response.data;

            this.renderizarMetricasResultados(m);
            this.renderizarTablaResultados(m);
            this.renderizarGraficosResultados(m);
        } catch (error) {
            this.mostrarToast('Error al calcular resultados: ' + error.message, 'error');
        }
    }

    renderizarMetricasResultados(m) {
        const participacionTexto = m.participacion === null ? '-' : `${(m.participacion * 100).toFixed(1)}%`;
        document.getElementById('resultados-metricas-container').innerHTML = `
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
                    <span class="metrica-valor">${escaparHtml(String(m.votantesAsignados))}</span>
                    <span class="metrica-label">Votantes asignados</span>
                </div>
                <div class="metrica-card">
                    <span class="metrica-valor">${escaparHtml(participacionTexto)}</span>
                    <span class="metrica-label">Participación</span>
                </div>
            </div>
        `;
    }

    renderizarTablaResultados(m) {
        const filas = m.porFuerza.map((f) => `
            <tr>
                <td><span class="color-dot" style="background:${this.colorFuerzaVar(f.fuerza_color)};"></span></td>
                <td>${escaparHtml(f.fuerza_nombre)}</td>
                <td>${escaparHtml(String(f.votos))}</td>
                <td>${m.emitidos > 0 ? `${((f.votos / m.emitidos) * 100).toFixed(1)}%` : '-'}</td>
            </tr>
        `).join('');
        document.getElementById('resultados-tbody-fuerzas').innerHTML =
            filas || '<tr><td colspan="4">Sin votos cargados todavía</td></tr>';
    }

    renderizarGraficosResultados(m) {
        if (!window.Chart) return; // microchart.js no cargado (permiso/pagina distinta)

        const labels = [...m.porFuerza.map((f) => f.fuerza_nombre), 'Blancos', 'Nulos'];
        const valores = [...m.porFuerza.map((f) => f.votos), m.blancos, m.nulos];
        const colores = [
            ...m.porFuerza.map((f) => this.colorFuerzaVar(f.fuerza_color)),
            'var(--ds-text-muted)',
            'var(--ds-danger-500)',
        ];

        if (this.graficoTorta) this.graficoTorta.destroy();
        const ctxTorta = document.getElementById('resultados-chart-torta').getContext('2d');
        this.graficoTorta = new Chart(ctxTorta, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: valores, backgroundColor: colores, borderWidth: 3 }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = valores.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
                                return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                            },
                        },
                    },
                },
            },
        });

        if (this.graficoBarras) this.graficoBarras.destroy();
        const ctxBarras = document.getElementById('resultados-chart-barras').getContext('2d');
        this.graficoBarras = new Chart(ctxBarras, {
            type: 'bar',
            data: {
                labels: m.porFuerza.map((f) => f.fuerza_nombre),
                datasets: [{
                    data: m.porFuerza.map((f) => f.votos),
                    backgroundColor: m.porFuerza.map((f) => this.colorFuerzaVar(f.fuerza_color)),
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: { x: { beginAtZero: true } },
                plugins: { legend: { display: false } },
            },
        });
    }

    htmlModalComicio() {
        return `
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
                            <div class="form-comicio-fuerzas-header">
                                <label>Fuerzas participantes <span class="required">*</span></label>
                                ${this.permisos.comicioEdit ? `
                                <button type="button" class="btn btn-secondary btn-sm" id="btn-nueva-fuerza-desde-comicio">
                                    <i class="fas fa-plus"></i> Nueva fuerza
                                </button>` : ''}
                            </div>
                            <div id="form-comicio-fuerzas" class="listas-checkboxes"></div>
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
        `;
    }

    htmlModalMesa() {
        return `
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
                            <label for="form-mesa-desde">DNI desde</label>
                            <input type="text" id="form-mesa-desde" class="form-input" placeholder="Opcional">
                        </div>
                        <div class="form-group">
                            <label for="form-mesa-hasta">DNI hasta</label>
                            <input type="text" id="form-mesa-hasta" class="form-input" placeholder="Opcional">
                        </div>
                        <p class="modal-info">El rango de padrón es opcional: se puede cargar después. Si se completa, va por
                        orden de apellido y nombre del padrón (no por número de DNI) y hay que completar los dos campos.</p>
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
        `;
    }

    htmlModalVotos() {
        return `
            <div id="modal-votos" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="modal-votos-titulo"><i class="fas fa-check-to-slot"></i> Votos</h3>
                        <button type="button" class="modal-close" id="modal-votos-close">&times;</button>
                    </div>
                    <form id="form-votos" class="modal-body">
                        <input type="hidden" id="form-votos-mesa-id" value="">
                        <div id="form-votos-fuerzas"></div>
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
        `;
    }

    // ==================== Fiscales por mesa (calendario + asignación) ====================

    /**
     * Un solo modal para ver y gestionar los fiscales de una mesa: la lista de franjas
     * y el formulario para agregar/editar una, en el mismo cuerpo. Antes "Asignar
     * fiscal" abría un segundo modal encima de éste -- dos overlays apilados, cada uno
     * oscureciendo el fondo, rompía la lectura y el Escape cerraba ambos de golpe. El
     * formulario inline no tiene ese problema: nunca hay más de un modal en pantalla.
     */
    htmlModalFiscalesMesa() {
        return `
            <div id="modal-fiscales-mesa" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="modal-fiscales-mesa-titulo"><i class="fas fa-user-shield"></i> Fiscales</h3>
                        <button type="button" class="modal-close" id="modal-fiscales-mesa-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <table class="fiscales-tabla" id="asignaciones-tabla">
                            <thead><tr><th>Desde</th><th>Hasta</th><th>Fiscal</th><th>Acciones</th></tr></thead>
                            <tbody id="asignaciones-tbody"></tbody>
                        </table>
                        <div id="asignaciones-empty" class="fiscales-empty" style="display: none;">
                            <i class="fas fa-calendar-day"></i>
                            <p>Esta mesa todavía no tiene fiscales asignados</p>
                        </div>

                        ${this.permisos.fiscalesEdit ? `
                        <form id="form-asignacion" class="asignacion-form-inline">
                            <input type="hidden" id="form-asignacion-id" value="">
                            <h4 id="asignacion-form-titulo"><i class="fas fa-plus"></i> Agregar fiscal</h4>
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
                            <div class="asignacion-form-acciones">
                                <button type="button" class="btn btn-secondary btn-sm" id="btn-cancelar-edicion-asignacion" style="display: none;">Cancelar edición</button>
                                <button type="submit" class="btn btn-primary btn-sm" id="btn-guardar-asignacion">
                                    <i class="fas fa-save"></i> Guardar
                                </button>
                            </div>
                        </form>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== Eventos ====================

    inicializarEventos() {
        // El modal de fiscal solo existe en el DOM con fiscalesView (ver el render): sin
        // esa mitad, enganchar listeners tiraba TypeError y dejaba toda la pagina muerta
        // (FE-010).
        if (this.permisos.fiscalesEdit && this.permisos.fiscalesView) {
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
        }

        if (!this.permisos.comicioView) return;

        if (this.permisos.comicioEdit) {
            document.getElementById('btn-crear-comicio').addEventListener('click', () => this.abrirModalCrearComicio());
            document.getElementById('btn-nueva-fuerza-desde-comicio').addEventListener('click', () => this.abrirModalCrearFuerza());
            document.getElementById('btn-crear-fuerza').addEventListener('click', () => this.abrirModalCrearFuerza());
            document.getElementById('modal-fuerza-close').addEventListener('click', () => this.cerrarModalFuerza());
            document.getElementById('btn-cancelar-fuerza').addEventListener('click', () => this.cerrarModalFuerza());
            document.getElementById('modal-fuerza').addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay')) this.cerrarModalFuerza();
            });
            document.getElementById('form-fuerza').addEventListener('submit', (e) => {
                e.preventDefault();
                this.guardarFuerza();
            });
            document.getElementById('form-fuerza-color-swatches').addEventListener('click', (e) => {
                const btn = e.target.closest('.color-swatch');
                if (btn) this.seleccionarColorFuerza(Number(btn.dataset.color));
            });
        }
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

        document.querySelectorAll('.comicio-subtab').forEach((btn) => {
            btn.addEventListener('click', () => this.mostrarSubTab(btn.dataset.subtab));
        });

        if (this.permisos.comicioEdit) {
            document.getElementById('btn-crear-mesa').addEventListener('click', () => this.abrirModalCrearMesa());
        }
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

        if (this.permisos.fiscalesView) {
            document.getElementById('modal-fiscales-mesa-close').addEventListener('click', () => this.cerrarModalFiscalesMesa());
            document.getElementById('modal-fiscales-mesa').addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-overlay')) this.cerrarModalFiscalesMesa();
            });
            if (this.permisos.fiscalesEdit) {
                document.getElementById('btn-cancelar-edicion-asignacion').addEventListener('click', () => this.resetearFormularioAsignacion());
                document.getElementById('form-asignacion').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.guardarAsignacion();
                });
            }
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            this.cerrarModalComicio();
            this.cerrarModalFuerza();
            this.cerrarModalMesa();
            this.cerrarModalVotos();
            // Estos dos modales solo existen con fiscalesView: sin el guard, Escape tiraba
            // TypeError en cualquier parte de la pagina (FE-018).
            if (document.getElementById('modal-fiscal')) this.cerrarModalFiscal();
            if (document.getElementById('modal-fiscales-mesa')) this.cerrarModalFiscalesMesa();
        });
    }

    // ---- Listado de comicios ----

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
                <td>${escaparHtml(String(c.fuerzas_count ?? '-'))}</td>
                <td>${escaparHtml(String(c.mesas_count ?? '-'))}</td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-entrar" title="Ver mesas" data-id="${c.id}">
                            <i class="fas fa-arrow-right"></i>
                        </button>
                        ${this.permisos.comicioEdit ? `
                        <button class="btn-accion btn-editar" title="Editar comicio" data-id="${c.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar comicio" data-id="${c.id}" data-nombre="${escaparHtml(c.nombre)}">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
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

    renderizarChecklistFuerzas(seleccionadas = []) {
        const cont = document.getElementById('form-comicio-fuerzas');
        if (this.fuerzas.length === 0) {
            cont.innerHTML = '<p class="candidatos-vacio" style="display:block;">No hay fuerzas cargadas todavía — creá una con el botón "Nueva fuerza" de arriba.</p>';
            return;
        }
        cont.innerHTML = this.fuerzas.map((f) => `
            <label class="checkbox-row">
                <input type="checkbox" value="${f.id}" ${seleccionadas.includes(f.id) ? 'checked' : ''}>
                <span class="color-dot" style="background:${this.colorFuerzaVar(f.color)};"></span>
                <span>${escaparHtml(f.nombre)}${f.sigla ? ` (${escaparHtml(f.sigla)})` : ''}</span>
            </label>
        `).join('');
    }

    abrirModalCrearComicio() {
        document.getElementById('modal-comicio-titulo').innerHTML = '<i class="fas fa-plus"></i> Nuevo Comicio';
        document.getElementById('form-comicio-id').value = '';
        document.getElementById('form-comicio-nombre').value = '';
        document.getElementById('form-comicio-tipo').value = '';
        document.getElementById('form-comicio-error').style.display = 'none';
        this.renderizarChecklistFuerzas();
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
            this.renderizarChecklistFuerzas(comicio.fuerzas.map((f) => f.id));
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
        const fuerzaIds = [...document.querySelectorAll('#form-comicio-fuerzas input:checked')].map((el) => Number(el.value));

        if (!nombre) return this.mostrarError('form-comicio-error', 'El nombre del comicio es obligatorio');
        if (!tipoEleccion) return this.mostrarError('form-comicio-error', 'Elegí un tipo de elección');
        if (fuerzaIds.length === 0) return this.mostrarError('form-comicio-error', 'Elegí al menos una fuerza participante');

        const btn = document.getElementById('btn-guardar-comicio');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { nombre, tipoEleccion, fuerzaIds };
            const response = isEdit
                ? await window.apiService.actualizarComicio(Number(id), data)
                : await window.apiService.crearComicio(data);

            if (response.success) {
                this.cerrarModalComicio();
                this.mostrarToast(isEdit ? 'Comicio actualizado' : 'Comicio creado', 'success');
                await this.cargarComicios();
                if (this.comicioActual && isEdit && this.comicioActual.id === Number(id)) {
                    await this.entrarAComicio(Number(id), false);
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

    // ---- Detalle de comicio (mesas + métricas + fiscales) ----

    /**
     * Entra a un comicio: todo lo que le pertenece (mesas, fuerzas, fiscales,
     * resultados) se pinta desde acá. `resetSubTab` es false cuando esto se llama para
     * refrescar datos después de una mutación (crear mesa, cargar votos) hecha estando
     * ya adentro -- no tiene sentido devolver a la persona a "Mesas" si estaba en otra
     * sub-pestaña.
     */
    async entrarAComicio(id, resetSubTab = true) {
        try {
            const response = await window.apiService.obtenerComicio(id);
            if (!response.success) return;
            this.comicioActual = response.data;

            document.getElementById('comicio-listado-view').style.display = 'none';
            document.getElementById('comicio-detalle-view').style.display = 'block';
            document.getElementById('detalle-comicio-nombre').innerHTML =
                `<i class="fas fa-building"></i> ${escaparHtml(this.comicioActual.nombre)}`;
            document.getElementById('detalle-comicio-fuerzas').textContent =
                `${this.formatearTipo(this.comicioActual.tipo_eleccion)} · ${this.comicioActual.fuerzas.map((f) => f.nombre).join(', ')}`;

            this.renderizarMesas();
            this.renderizarFuerzasComicio();
            if (this.permisos.fiscalesView) await this.cargarAsignacionesDelComicio();

            if (resetSubTab) this.mostrarSubTab('mesas');
            else if (this.subTabActual === 'resultados') this.cargarResultadosComicioActual();
        } catch (error) {
            this.mostrarToast('Error al abrir el comicio: ' + error.message, 'error');
        }
    }

    volverAlListado() {
        this.comicioActual = null;
        this.asignacionesPorMesa = new Map();
        if (this.graficoTorta) { this.graficoTorta.destroy(); this.graficoTorta = null; }
        if (this.graficoBarras) { this.graficoBarras.destroy(); this.graficoBarras = null; }
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
            const tieneRango = !!m.padron_desde_dni && !!m.padron_hasta_dni;
            return `
            <tr>
                <td>${escaparHtml(String(m.numero))}</td>
                <td>${tieneRango ? `${escaparHtml(m.padron_desde_dni)} — ${escaparHtml(m.padron_hasta_dni)}` : '<span class="sin-cubrir">Sin rango</span>'}</td>
                <td>${escaparHtml(m.cantidad_votantes === null || m.cantidad_votantes === undefined ? '-' : String(m.cantidad_votantes))}</td>
                <td>
                    <span class="estado-badge ${cargados ? 'estado-activo' : 'estado-inactivo'}">
                        <i class="fas ${cargados ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                        ${cargados ? 'Cargados' : 'Sin cargar'}
                    </span>
                </td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.fiscalesView ? `
                        <button class="btn-accion" title="Fiscales de esta mesa" data-id="${m.id}" data-numero="${escaparHtml(String(m.numero))}" data-accion="fiscales">
                            <i class="fas fa-user-shield"></i>
                        </button>` : ''}
                        ${this.permisos.comicioEdit ? `
                        <button class="btn-accion btn-votos" title="Cargar votos" data-id="${m.id}">
                            <i class="fas fa-check-to-slot"></i>
                        </button>
                        <button class="btn-accion btn-editar" title="Editar mesa" data-id="${m.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Eliminar mesa" data-id="${m.id}" data-numero="${escaparHtml(String(m.numero))}">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
        }).join('');

        tbody.querySelectorAll('[data-accion="fiscales"]').forEach((btn) => {
            btn.addEventListener('click', () => this.abrirModalFiscalesMesa(Number(btn.dataset.id), btn.dataset.numero));
        });
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
        document.getElementById('form-mesa-desde').value = mesa.padron_desde_dni || '';
        document.getElementById('form-mesa-hasta').value = mesa.padron_hasta_dni || '';
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
        if ((desdeDni && !hastaDni) || (!desdeDni && hastaDni)) {
            return this.mostrarError('form-mesa-error', 'Completá los dos DNI del rango, o dejalos los dos vacíos');
        }

        const btn = document.getElementById('btn-guardar-mesa');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const data = { numero, desdeDni: desdeDni || null, hastaDni: hastaDni || null };
            const response = isEdit
                ? await window.apiService.actualizarMesa(this.comicioActual.id, Number(id), data)
                : await window.apiService.crearMesa(this.comicioActual.id, data);

            if (response.success) {
                this.cerrarModalMesa();
                const votantesTexto = response.data.cantidad_votantes === null ? '' : ` — ${response.data.cantidad_votantes} votantes en el rango`;
                this.mostrarToast(isEdit ? 'Mesa actualizada' : `Mesa creada${votantesTexto}`, 'success');
                await this.entrarAComicio(this.comicioActual.id, false);
            }
        } catch (error) {
            this.mostrarError('form-mesa-error', error.message || 'Error al guardar la mesa');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarMesa(mesaId, numero) {
        if (!confirm(`¿Eliminar la mesa ${numero}? Se borran también sus votos cargados y fiscales asignados.`)) return;
        try {
            const response = await window.apiService.eliminarMesa(this.comicioActual.id, mesaId);
            if (response.success) {
                this.mostrarToast('Mesa eliminada', 'success');
                await this.entrarAComicio(this.comicioActual.id, false);
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

        let votosPrevios = { porFuerza: [] };
        try {
            const response = await window.apiService.obtenerVotosMesa(this.comicioActual.id, mesaId);
            if (response.success) votosPrevios = response.data;
        } catch (error) {
            console.error('Error cargando votos previos:', error);
        }

        // Si mientras esperaba la respuesta se abrió otra mesa, esta invocación quedó
        // vieja: la más reciente es la responsable de dejar el modal en su estado
        // correcto. Depende de que mesaEnEdicionVotos se reasigne de forma síncrona
        // arriba, al entrar a la función.
        if (this.mesaEnEdicionVotos !== mesaId) return;

        document.getElementById('form-votos-blancos').value = votosPrevios.blancos ?? 0;
        document.getElementById('form-votos-nulos').value = votosPrevios.nulos ?? 0;

        const cont = document.getElementById('form-votos-fuerzas');
        cont.innerHTML = this.comicioActual.fuerzas.map((f) => {
            const previo = votosPrevios.porFuerza.find((v) => v.fuerza_id === f.id);
            return `
                <div class="form-group">
                    <label for="voto-fuerza-${f.id}"><span class="color-dot" style="background:${this.colorFuerzaVar(f.color)};"></span>${escaparHtml(f.nombre)}</label>
                    <input type="number" id="voto-fuerza-${f.id}" class="form-input" data-fuerza-id="${f.id}" min="0" step="1" value="${previo ? previo.cantidad : 0}" required>
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
        const porFuerza = [...document.querySelectorAll('#form-votos-fuerzas input')].map((input) => ({
            fuerzaId: Number(input.dataset.fuerzaId),
            cantidad: Number(input.value),
        }));

        if (!Number.isInteger(blancos) || blancos < 0) return this.mostrarError('form-votos-error', 'Los votos en blanco tienen que ser un entero no negativo');
        if (!Number.isInteger(nulos) || nulos < 0) return this.mostrarError('form-votos-error', 'Los votos nulos tienen que ser un entero no negativo');

        const btn = document.getElementById('btn-guardar-votos');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

        try {
            const response = await window.apiService.cargarVotosMesa(this.comicioActual.id, mesaId, { blancos, nulos, porFuerza });
            if (response.success) {
                this.cerrarModalVotos();
                this.mostrarToast('Votos guardados', 'success');
                await this.entrarAComicio(this.comicioActual.id, false);
            }
        } catch (error) {
            this.mostrarError('form-votos-error', error.message || 'Error al guardar los votos');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar votos';
        }
    }

    // ---- Calendario de fiscales del comicio ----

    async cargarAsignacionesDelComicio() {
        this.asignacionesPorMesa = new Map();
        const mesas = this.comicioActual.mesas || [];
        await Promise.all(mesas.map(async (m) => {
            try {
                const response = await window.apiService.asignacionesDeMesa(m.id);
                if (response.success) this.asignacionesPorMesa.set(m.id, response.data);
            } catch (error) {
                console.error('Error cargando asignaciones de mesa', m.id, error);
            }
        }));
        this.renderizarCalendarioComicio();
    }

    /** El servidor devuelve TIME como HH:MM:SS; acá sólo se muestran/usan HH:MM. */
    formatearHora(hora) {
        return (hora || '').slice(0, 5);
    }

    /** % de la franja 08:00–18:00 (600 min) que representa una hora HH:MM. */
    pctEnJornada(horaHHMM) {
        const [h, m] = this.formatearHora(horaHHMM).split(':').map(Number);
        const minutos = (h * 60 + m) - (8 * 60);
        return Math.max(0, Math.min(100, (minutos / 600) * 100));
    }

    renderizarCalendarioComicio() {
        const cont = document.getElementById('calendario-comicio');
        if (!cont) return;
        const mesas = this.comicioActual.mesas || [];

        if (mesas.length === 0) {
            cont.innerHTML = '<p class="fiscales-empty" style="display:block;">Este comicio todavía no tiene mesas.</p>';
            return;
        }

        const horas = Array.from({ length: 10 }, (_, i) => 8 + i);
        const encabezado = horas.map((h) => `<div class="calendario-hora">${String(h).padStart(2, '0')}:00</div>`).join('');

        const filas = mesas.map((m) => {
            const asignaciones = this.asignacionesPorMesa.get(m.id) || [];
            const bloques = asignaciones.map((a) => {
                const left = this.pctEnJornada(a.desde);
                const width = Math.max(this.pctEnJornada(a.hasta) - left, 2);
                const etiqueta = `${escaparHtml(a.fiscal_nombre)} ${this.formatearHora(a.desde)}–${this.formatearHora(a.hasta)}`;
                return `<div class="calendario-bloque" style="left:${left}%;width:${width}%;" title="${etiqueta}">${escaparHtml(a.fiscal_nombre)}</div>`;
            }).join('');
            return `
                <div class="calendario-fila">
                    <div class="calendario-mesa-label">Mesa ${escaparHtml(String(m.numero))}</div>
                    <div class="calendario-timeline">${bloques}</div>
                </div>
            `;
        }).join('');

        cont.innerHTML = `
            <div class="calendario-grid">
                <div class="calendario-fila calendario-fila-encabezado">
                    <div class="calendario-mesa-label"></div>
                    <div class="calendario-timeline calendario-timeline-encabezado">${encabezado}</div>
                </div>
                ${filas}
            </div>
        `;
    }

    // ---- Modal fiscales de una mesa (lista de asignaciones) ----

    async abrirModalFiscalesMesa(mesaId, numero) {
        this.mesaSeleccionadaFiscales = mesaId;
        document.getElementById('modal-fiscales-mesa-titulo').innerHTML =
            `<i class="fas fa-user-shield"></i> Fiscales — Mesa ${escaparHtml(numero)}`;
        if (this.permisos.fiscalesEdit) {
            this.poblarSelectFiscales();
            this.resetearFormularioAsignacion();
        }
        await this.cargarAsignacionesMesa();
        document.getElementById('modal-fiscales-mesa').style.display = 'flex';
    }

    cerrarModalFiscalesMesa() {
        document.getElementById('modal-fiscales-mesa').style.display = 'none';
    }

    async cargarAsignacionesMesa() {
        // Capturada antes del await: si mientras esperaba la respuesta se abrió otra
        // mesa, mesaSeleccionadaFiscales ya cambió, y sin esta constante el resultado
        // tardío se guardaría bajo la clave equivocada. Depende de que
        // mesaSeleccionadaFiscales se reasigne de forma síncrona al abrir el modal.
        const mesaId = this.mesaSeleccionadaFiscales;
        try {
            const response = await window.apiService.asignacionesDeMesa(mesaId);
            if (this.mesaSeleccionadaFiscales !== mesaId) return;
            if (response.success) {
                this.asignacionesMesaActual = response.data;
                this.asignacionesPorMesa.set(mesaId, response.data);
                this.renderizarAsignaciones();
            }
        } catch (error) {
            if (this.mesaSeleccionadaFiscales !== mesaId) return;
            this.mostrarToast('Error al cargar las asignaciones: ' + error.message, 'error');
        }
    }

    renderizarAsignaciones() {
        const tbody = document.getElementById('asignaciones-tbody');
        const tabla = document.getElementById('asignaciones-tabla');
        const empty = document.getElementById('asignaciones-empty');

        if (this.asignacionesMesaActual.length === 0) {
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }
        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = this.asignacionesMesaActual.map((a) => `
            <tr>
                <td>${escaparHtml(this.formatearHora(a.desde))}</td>
                <td>${escaparHtml(this.formatearHora(a.hasta))}</td>
                <td>${escaparHtml(a.fiscal_nombre)}</td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.fiscalesEdit ? `
                        <button class="btn-accion btn-editar" title="Editar" data-id="${a.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-eliminar" title="Quitar" data-id="${a.id}">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');

        if (this.permisos.fiscalesEdit) {
            tbody.querySelectorAll('.btn-editar').forEach((btn) => {
                btn.addEventListener('click', () => this.cargarAsignacionEnFormulario(Number(btn.dataset.id)));
            });
            tbody.querySelectorAll('.btn-eliminar').forEach((btn) => {
                btn.addEventListener('click', () => this.eliminarAsignacion(Number(btn.dataset.id)));
            });
        }
    }

    // ---- Formulario inline de asignación (agregar/editar una franja, dentro del mismo modal) ----

    poblarSelectFiscales(seleccionado = '') {
        const select = document.getElementById('form-asignacion-fiscal');
        select.innerHTML = '<option value="">Seleccionar...</option>' +
            this.fiscales.map((f) => `<option value="${f.id}" ${String(f.id) === String(seleccionado) ? 'selected' : ''}>${escaparHtml(f.nombre)}</option>`).join('');
    }

    /** Vuelve el formulario inline a modo "agregar" (sin franja en edición). */
    resetearFormularioAsignacion() {
        this.asignacionEnEdicionId = null;
        document.getElementById('form-asignacion-id').value = '';
        document.getElementById('form-asignacion-desde').value = '';
        document.getElementById('form-asignacion-hasta').value = '';
        document.getElementById('form-asignacion-error').style.display = 'none';
        document.getElementById('asignacion-form-titulo').innerHTML = '<i class="fas fa-plus"></i> Agregar fiscal';
        document.getElementById('btn-guardar-asignacion').innerHTML = '<i class="fas fa-save"></i> Guardar';
        document.getElementById('btn-cancelar-edicion-asignacion').style.display = 'none';
        this.poblarSelectFiscales();
    }

    cargarAsignacionEnFormulario(id) {
        const a = this.asignacionesMesaActual.find((x) => x.id === id);
        if (!a) return;
        this.asignacionEnEdicionId = id;
        document.getElementById('form-asignacion-id').value = a.id;
        document.getElementById('form-asignacion-desde').value = this.formatearHora(a.desde);
        document.getElementById('form-asignacion-hasta').value = this.formatearHora(a.hasta);
        document.getElementById('form-asignacion-error').style.display = 'none';
        document.getElementById('asignacion-form-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar franja';
        document.getElementById('btn-guardar-asignacion').innerHTML = '<i class="fas fa-save"></i> Guardar cambios';
        document.getElementById('btn-cancelar-edicion-asignacion').style.display = 'inline-flex';
        this.poblarSelectFiscales(a.fiscal_id);
        document.getElementById('form-asignacion-fiscal').focus();
    }

    async guardarAsignacion() {
        const isEdit = !!this.asignacionEnEdicionId;
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
                ? await window.apiService.actualizarAsignacionFiscal(this.asignacionEnEdicionId, data)
                : await window.apiService.crearAsignacionFiscal(this.mesaSeleccionadaFiscales, data);

            if (response.success) {
                this.mostrarToast(isEdit ? 'Asignación actualizada' : 'Fiscal asignado', 'success');
                this.resetearFormularioAsignacion();
                await this.cargarAsignacionesMesa();
                this.renderizarCalendarioComicio();
            }
        } catch (error) {
            this.mostrarError('form-asignacion-error', error.message || 'Error al guardar la asignación');
        } finally {
            btn.disabled = false;
            if (!this.asignacionEnEdicionId) btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async eliminarAsignacion(id) {
        if (!confirm('¿Quitar esta asignación?')) return;
        try {
            const response = await window.apiService.eliminarAsignacionFiscal(id);
            if (response.success) {
                this.mostrarToast('Asignación eliminada', 'success');
                if (this.asignacionEnEdicionId === id) this.resetearFormularioAsignacion();
                await this.cargarAsignacionesMesa();
                this.renderizarCalendarioComicio();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ==================== Helpers ====================

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
