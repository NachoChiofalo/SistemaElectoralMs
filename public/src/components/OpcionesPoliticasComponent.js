/**
 * Configuración de las opciones políticas de la instancia (021).
 *
 * Es la pantalla donde el administrador define qué opciones se pueden marcar al relevar un
 * votante ("PJ", "UCR", "Frente Cívico"...). Lo que se cambia acá se refleja en el padrón,
 * los resultados y el dashboard sin tocar código.
 *
 * Tres reglas del dominio que la pantalla hace visibles:
 *   - El código de una opción no se cambia: es lo que guarda cada relevamiento. Se puede
 *     renombrar la etiqueta, que es lo que se muestra.
 *   - Una opción con relevamientos no se puede borrar (el servidor responde 409 y se muestra
 *     el motivo): borrarla dejaría votantes sin su respuesta.
 *   - La opción neutra es la que recibe un votante al que solo se le cargó un teléfono.
 *     No se borra y no lleva color.
 */
class OpcionesPoliticasComponent {
    constructor() {
        this.container = null;
        this.opciones = [];
        this.editando = null; // código de la opción abierta en el modal, o null si es una nueva
        this.colorElegido = 1;
        this.ocupado = false;
    }

    async init(containerId = 'opciones-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) throw new Error(`Contenedor ${containerId} no encontrado`);

        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargar();
        return true;
    }

    crearInterfaz() {
        const colores = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `
                            <label class="color-opcion" title="Color ${n}">
                                <input type="radio" name="form-color" value="${n}">
                                <span class="color-muestra op-${n}"></span>
                            </label>`).join('');

        this.container.innerHTML = `
            <div class="usuarios-header">
                <div class="usuarios-title">
                    <h1><i class="fas fa-flag" aria-hidden="true"></i> Opciones políticas</h1>
                    <p class="usuarios-subtitle">Lo que se puede marcar al relevar a un votante. Se usa en el padrón, los resultados y el inicio.</p>
                </div>
                <div class="usuarios-actions">
                    <button id="btn-nueva-opcion" class="btn btn-primary" aria-label="Nueva opción">
                        <i class="fas fa-plus" aria-hidden="true"></i> <span class="btn-text">Nueva opción</span>
                    </button>
                </div>
            </div>

            <div class="usuarios-tabla-container">
                <div id="opciones-loading" class="usuarios-loading" style="display: none;">
                    <i class="fas fa-spinner fa-spin"></i> Cargando opciones...
                </div>
                <table class="usuarios-tabla" id="opciones-tabla">
                    <thead>
                        <tr>
                            <th>Orden</th>
                            <th>Opción</th>
                            <th>Código</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="opciones-tbody"></tbody>
                </table>
            </div>
            <p class="configuracion-nota">
                El <strong>código</strong> no se puede cambiar porque es lo que queda guardado en cada relevamiento;
                la <strong>etiqueta</strong> sí. Una opción que ya fue marcada en algún relevamiento no se puede borrar.
            </p>

            <div id="modal-opcion" class="modal-overlay" style="display: none;" role="dialog" aria-modal="true" aria-labelledby="modal-opcion-titulo">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3 id="modal-opcion-titulo"><i class="fas fa-flag"></i> Nueva opción</h3>
                        <button class="modal-close" id="modal-opcion-close" aria-label="Cerrar">&times;</button>
                    </div>
                    <form id="form-opcion" class="modal-body">
                        <div class="form-group">
                            <label for="form-codigo">Código <span class="required">*</span></label>
                            <input type="text" id="form-codigo" class="form-input" maxlength="20" autocomplete="off"
                                   placeholder="Ej: FP">
                            <small class="form-ayuda">Hasta 20 caracteres. No se puede cambiar después.</small>
                        </div>
                        <div class="form-group">
                            <label for="form-etiqueta">Etiqueta <span class="required">*</span></label>
                            <input type="text" id="form-etiqueta" class="form-input" maxlength="50" autocomplete="off"
                                   placeholder="Cómo se muestra">
                        </div>
                        <div class="form-group" id="grupo-color">
                            <span class="form-etiqueta-grupo" id="etiqueta-color">Color</span>
                            <div class="colores" role="radiogroup" aria-labelledby="etiqueta-color">${colores}
                            </div>
                        </div>
                        <div id="form-opcion-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-opcion">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-opcion">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <div id="modal-borrar-opcion" class="modal-overlay" style="display: none;" role="dialog" aria-modal="true" aria-labelledby="modal-borrar-titulo">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3 id="modal-borrar-titulo"><i class="fas fa-trash"></i> Borrar opción</h3>
                        <button class="modal-close" id="modal-borrar-close" aria-label="Cerrar">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p class="modal-info">¿Borrar la opción <strong id="borrar-nombre"></strong>? Esta acción no se puede deshacer.</p>
                        <div id="borrar-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-borrar">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="btn-confirmar-borrar">
                                <i class="fas fa-trash"></i> Borrar
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="toast-container" class="toast-container"></div>
        `;
    }

    inicializarEventos() {
        const $ = (id) => document.getElementById(id);

        $('btn-nueva-opcion').addEventListener('click', () => this.abrirModal(null));
        $('modal-opcion-close').addEventListener('click', () => this.cerrarModal());
        $('btn-cancelar-opcion').addEventListener('click', () => this.cerrarModal());
        $('modal-opcion').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModal();
        });
        $('form-opcion').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardar();
        });

        $('modal-borrar-close').addEventListener('click', () => this.cerrarBorrar());
        $('btn-cancelar-borrar').addEventListener('click', () => this.cerrarBorrar());
        $('modal-borrar-opcion').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarBorrar();
        });
        $('btn-confirmar-borrar').addEventListener('click', () => this.borrar());

        // Una sola delegación para las acciones de la tabla: las filas se redibujan.
        $('opciones-tbody').addEventListener('click', (e) => {
            const boton = e.target.closest('button[data-accion]');
            if (!boton || this.ocupado) return;
            const { accion, codigo } = boton.dataset;
            if (accion === 'editar') this.abrirModal(codigo);
            if (accion === 'borrar') this.abrirBorrar(codigo);
            if (accion === 'subir') this.mover(codigo, -1);
            if (accion === 'bajar') this.mover(codigo, +1);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cerrarModal();
                this.cerrarBorrar();
            }
        });
    }

    // ------------------------------------------------------------- datos

    async cargar() {
        const cargando = document.getElementById('opciones-loading');
        cargando.style.display = 'flex';
        try {
            this.opciones = await window.opcionesPoliticas.cargar(true);
            this.renderizar();
        } catch (error) {
            this.toast('No se pudieron cargar las opciones: ' + error.message, 'error');
        } finally {
            cargando.style.display = 'none';
        }
    }

    renderizar() {
        const tbody = document.getElementById('opciones-tbody');
        const ultima = this.opciones.length - 1;

        tbody.innerHTML = this.opciones.map((opcion, i) => `
            <tr>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion" data-accion="subir" data-codigo="${escaparHtml(opcion.codigo)}"
                                title="Subir" aria-label="Subir ${escaparHtml(opcion.etiqueta)}" ${i === 0 ? 'disabled' : ''}>
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button class="btn-accion" data-accion="bajar" data-codigo="${escaparHtml(opcion.codigo)}"
                                title="Bajar" aria-label="Bajar ${escaparHtml(opcion.etiqueta)}" ${i === ultima ? 'disabled' : ''}>
                            <i class="fas fa-arrow-down"></i>
                        </button>
                    </div>
                </td>
                <td>
                    <span class="opcion-nombre">
                        <span class="color-muestra ${window.opcionesPoliticas.clase(opcion)}"></span>
                        ${escaparHtml(opcion.etiqueta)}
                        ${opcion.esNeutra ? '<span class="estado-badge estado-activo" title="Se asigna sola a un votante al que solo se le cargó un teléfono u otro dato">Neutra</span>' : ''}
                    </span>
                </td>
                <td><code>${escaparHtml(opcion.codigo)}</code></td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-editar" data-accion="editar" data-codigo="${escaparHtml(opcion.codigo)}"
                                title="Editar" aria-label="Editar ${escaparHtml(opcion.etiqueta)}">
                            <i class="fas fa-pen"></i>
                        </button>
                        ${opcion.esNeutra ? '' : `
                        <button class="btn-accion btn-desactivar" data-accion="borrar" data-codigo="${escaparHtml(opcion.codigo)}"
                                title="Borrar" aria-label="Borrar ${escaparHtml(opcion.etiqueta)}">
                            <i class="fas fa-trash"></i>
                        </button>`}
                    </div>
                </td>
            </tr>`).join('');
    }

    /**
     * Intercambia el lugar de una opción con la vecina. Se renumera todo (1, 2, 3...) y se
     * escribe solo lo que cambió: así dos opciones nunca quedan con el mismo orden.
     */
    async mover(codigo, sentido) {
        const i = this.opciones.findIndex(o => o.codigo === codigo);
        const j = i + sentido;
        if (i < 0 || j < 0 || j >= this.opciones.length) return;

        const nuevoOrden = [...this.opciones];
        [nuevoOrden[i], nuevoOrden[j]] = [nuevoOrden[j], nuevoOrden[i]];

        this.ocupado = true;
        try {
            for (let n = 0; n < nuevoOrden.length; n += 1) {
                if (nuevoOrden[n].orden !== n + 1) {
                    await this.peticion('PATCH', `/${encodeURIComponent(nuevoOrden[n].codigo)}`, { orden: n + 1 });
                }
            }
            await this.cargar();
        } catch (error) {
            this.toast('No se pudo reordenar: ' + error.message, 'error');
            await this.cargar();
        } finally {
            this.ocupado = false;
        }
    }

    peticion(metodo, sufijo, cuerpo) {
        return window.apiService.request(`/api/padron/opciones-politicas${sufijo}`, {
            method: metodo,
            ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
        });
    }

    // ------------------------------------------------------------- modales

    abrirModal(codigo) {
        const opcion = codigo === null ? null : this.opciones.find(o => o.codigo === codigo);
        this.editando = opcion ? opcion.codigo : null;

        const titulo = document.getElementById('modal-opcion-titulo');
        titulo.innerHTML = opcion
            ? '<i class="fas fa-flag"></i> Editar opción'
            : '<i class="fas fa-flag"></i> Nueva opción';

        const campoCodigo = document.getElementById('form-codigo');
        campoCodigo.value = opcion ? opcion.codigo : '';
        campoCodigo.disabled = Boolean(opcion);
        document.getElementById('form-etiqueta').value = opcion ? opcion.etiqueta : '';

        // La neutra no lleva color; en una nueva se propone el primero que no esté usado.
        document.getElementById('grupo-color').style.display = opcion?.esNeutra ? 'none' : '';
        const usados = new Set(this.opciones.map(o => o.color));
        this.colorElegido = opcion?.color
            || [1, 2, 3, 4, 5, 6, 7, 8].find(n => !usados.has(n))
            || 1;
        document.querySelectorAll('input[name="form-color"]').forEach((radio) => {
            radio.checked = Number(radio.value) === this.colorElegido;
        });

        this.mostrarError('form-opcion-error', '');
        document.getElementById('modal-opcion').style.display = 'flex';
        (opcion ? document.getElementById('form-etiqueta') : campoCodigo).focus();
    }

    cerrarModal() {
        document.getElementById('modal-opcion').style.display = 'none';
    }

    abrirBorrar(codigo) {
        const opcion = this.opciones.find(o => o.codigo === codigo);
        if (!opcion) return;
        this.borrando = opcion.codigo;
        document.getElementById('borrar-nombre').textContent = opcion.etiqueta;
        this.mostrarError('borrar-error', '');
        document.getElementById('modal-borrar-opcion').style.display = 'flex';
    }

    cerrarBorrar() {
        document.getElementById('modal-borrar-opcion').style.display = 'none';
        this.borrando = null;
    }

    // ------------------------------------------------------------- acciones

    async guardar() {
        const etiqueta = document.getElementById('form-etiqueta').value.trim();
        const codigo = document.getElementById('form-codigo').value.trim();
        const marcado = document.querySelector('input[name="form-color"]:checked');
        const color = marcado ? Number(marcado.value) : this.colorElegido;
        const esNeutra = this.editando && this.opciones.find(o => o.codigo === this.editando)?.esNeutra;

        if (!etiqueta) return this.mostrarError('form-opcion-error', 'La etiqueta es obligatoria');
        if (!this.editando && !codigo) return this.mostrarError('form-opcion-error', 'El código es obligatorio');

        const boton = document.getElementById('btn-guardar-opcion');
        boton.disabled = true;
        try {
            if (this.editando) {
                const cuerpo = { etiqueta, ...(esNeutra ? {} : { color }) };
                await this.peticion('PATCH', `/${encodeURIComponent(this.editando)}`, cuerpo);
            } else {
                await this.peticion('POST', '', { codigo, etiqueta, color });
            }
            this.cerrarModal();
            this.toast(this.editando ? 'Opción actualizada' : 'Opción creada', 'success');
            await this.cargar();
        } catch (error) {
            this.mostrarError('form-opcion-error', error.message);
        } finally {
            boton.disabled = false;
        }
    }

    async borrar() {
        if (!this.borrando) return;
        const boton = document.getElementById('btn-confirmar-borrar');
        boton.disabled = true;
        try {
            await this.peticion('DELETE', `/${encodeURIComponent(this.borrando)}`);
            this.cerrarBorrar();
            this.toast('Opción borrada', 'success');
            await this.cargar();
        } catch (error) {
            // El 409 trae el motivo ("está marcada en N relevamientos"): se muestra tal cual.
            this.mostrarError('borrar-error', error.message);
        } finally {
            boton.disabled = false;
        }
    }

    // ------------------------------------------------------------- utilidades

    mostrarError(id, mensaje) {
        const caja = document.getElementById(id);
        caja.textContent = mensaje;
        caja.style.display = mensaje ? 'block' : 'none';
    }

    toast(mensaje, tipo = 'info') {
        const contenedor = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${tipo}`;
        const iconos = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };

        const icono = document.createElement('i');
        icono.className = `fas ${iconos[tipo] || iconos.info}`;
        toast.append(icono, ' ', document.createTextNode(mensaje));

        contenedor.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('toast-visible'));
        setTimeout(() => {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
}

window.opcionesPoliticasComponent = new OpcionesPoliticasComponent();
