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
 *
 * Interfaz: los modales son <dialog> nativos (lib/dialogo.js: foco atrapado, Escape, fondo
 * inerte) en lugar de `div.modal-overlay` con display:none; los avisos son lib/avisos.js; las
 * confirmaciones, dialogo.confirmar() en lugar de confirm(); las pestañas, lib/pestanas.js.
 */

(function () {
'use strict';

const $ = (id) => document.getElementById(id);

/** Porcentaje con la coma decimal de es-AR ("33,3"): toFixed daba "33.3". */
function formatPct(valor, decimales = 1) {
    const n = Number(valor);
    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
    }).format(Number.isFinite(n) ? n : 0);
}

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
        this.tabs = null;            // API de lib/pestanas.js sobre el tablist del comicio abierto
    }

    async init(containerId = 'comicio-container', permisos = {}) {
        this.container = $(containerId);
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
            `;
            return;
        }

        // Sin comicio.view: sólo el padrón de fiscales, sin comicio ni calendario (ambos
        // necesitan una mesa, y una mesa vive dentro de un comicio).
        this.container.innerHTML = `
            ${this.htmlSeccionFiscales(1)}
            ${this.htmlModalFiscal()}
        `;
    }

    // ==================== Diálogos (lib/dialogo.js) ====================

    /**
     * Estructura común de un modal: <dialog> con cabecera (título + cerrar), cuerpo y pie.
     * El título lleva un ícono decorativo y se cambia con `fijarTitulo`. El error del
     * formulario es una región `role="alert"` oculta hasta que hay algo que decir.
     */
    htmlDialogo({ id, icono, titulo, ancho = false, cuerpo, pie = '', form = null }) {
        const interior = `
            <div class="dialogo-cabecera">
                <h2 class="dialogo-titulo" id="${id}-titulo"><i class="fas ${icono}" aria-hidden="true"></i> ${titulo}</h2>
                <button type="button" class="btn btn-ghost btn-icono btn-sm dialogo-cerrar" id="${id}-close" aria-label="Cerrar">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </div>
            <div class="dialogo-cuerpo">${cuerpo}</div>
            ${pie ? `<div class="dialogo-pie">${pie}</div>` : ''}
        `;
        return `
            <dialog id="${id}" class="dialogo${ancho ? ' dialogo--ancho' : ''}" aria-labelledby="${id}-titulo">
                ${form ? `<form id="${form}" novalidate>${interior}</form>` : interior}
            </dialog>
        `;
    }

    fijarTitulo(id, icono, texto) {
        const h = $(id);
        const i = document.createElement('i');
        i.className = `fas ${icono}`;
        i.setAttribute('aria-hidden', 'true');
        h.replaceChildren(i, ` ${texto}`);
    }

    abrirDialogo(id) {
        const dlg = $(id);
        if (dlg && !dlg.open) window.dialogo.mostrar(dlg);
    }

    cerrarDialogo(id) {
        $(id)?.close();
    }

    /** ¿Está abierto el diálogo? (reemplaza el `style.display === 'flex'` de los overlays) */
    estaAbierto(id) {
        return !!$(id)?.open;
    }

    async confirmarEliminar(mensaje) {
        return window.dialogo.confirmar({
            titulo: 'Eliminar',
            mensaje,
            confirmar: 'Eliminar',
            cancelar: 'Cancelar',
            tono: 'peligro'
        });
    }

    // ==================== Fuerzas ====================

    htmlModalFuerza() {
        return this.htmlDialogo({
            id: 'modal-fuerza', form: 'form-fuerza', icono: 'fa-plus', titulo: 'Nueva fuerza',
            cuerpo: `
                <input type="hidden" id="form-fuerza-id" value="">
                <div class="form-group">
                    <label for="form-fuerza-nombre">Nombre <span class="required" aria-hidden="true">*</span></label>
                    <input type="text" id="form-fuerza-nombre" class="form-input" required aria-required="true" maxlength="200" autocomplete="off">
                </div>
                <div class="form-group">
                    <label for="form-fuerza-sigla">Sigla</label>
                    <input type="text" id="form-fuerza-sigla" class="form-input" maxlength="20" placeholder="Sigla de la fuerza" autocomplete="off">
                </div>
                <div class="form-group">
                    <span class="etiqueta-grupo" id="form-fuerza-color-etiqueta">Color <span class="required" aria-hidden="true">*</span></span>
                    <input type="hidden" id="form-fuerza-color" value="1">
                    <div class="color-swatches" id="form-fuerza-color-swatches" role="group" aria-labelledby="form-fuerza-color-etiqueta">
                        ${Array.from({ length: 8 }, (_, i) => i + 1).map((n) => `
                            <button type="button" class="color-swatch color-swatch-${n}" data-color="${n}" aria-label="Color ${n}" aria-pressed="false"></button>
                        `).join('')}
                    </div>
                </div>
                <div id="form-fuerza-error" class="form-error" role="alert" hidden></div>`,
            pie: `
                <button type="button" class="btn btn-secondary" id="btn-cancelar-fuerza">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btn-guardar-fuerza">
                    <i class="fas fa-save" aria-hidden="true"></i> Guardar
                </button>`,
        });
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
            this.mostrarToast('No se pudieron cargar las fuerzas: ' + error.message, 'error');
        }
    }

    /** Índice 1..8 a `var(--ds-fuerza-N)`. Nunca un hex libre: es la paleta fija del design system. */
    colorFuerzaVar(color) {
        // Cast defensivo (FE-039): el dominio 1-8 lo valida el servidor y la base, pero este
        // valor se interpola en markup y no deberia depender de que otra capa lo haya hecho.
        const n = Number(color);
        return `var(--ds-fuerza-${Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1})`;
    }

    /**
     * Clase `op-N` (design-system.css) que fija `--opcion-color`. Los puntos de color
     * se pintan con esa variable en CSS; antes cada uno llevaba `style="background:..."` en el
     * markup, que es lo que impide quitar 'unsafe-inline' de la CSP de estilos.
     */
    claseFuerza(color) {
        const n = Number(color);
        return `op-${Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1}`;
    }

    seleccionarColorFuerza(color) {
        $('form-fuerza-color').value = color;
        document.querySelectorAll('#form-fuerza-color-swatches .color-swatch').forEach((btn) => {
            const activo = Number(btn.dataset.color) === color;
            btn.classList.toggle('color-swatch-selected', activo);
            btn.setAttribute('aria-pressed', String(activo));
        });
    }

    /** Color por defecto de una fuerza nueva: el siguiente de la paleta que menos se repite entre las cargadas. */
    proximoColorFuerza() {
        return (this.fuerzas.length % 8) + 1;
    }

    abrirModalCrearFuerza() {
        // Si se llegó desde "Nuevo comicio" (bootstrap: no hay fuerzas para elegir), este
        // diálogo se abre ENCIMA del de comicio: la pila de <dialog> nativos lo resuelve, y
        // al cerrarlo el de abajo vuelve solo. Antes había que ocultar uno para mostrar el otro.
        this.fijarTitulo('modal-fuerza-titulo', 'fa-plus', 'Nueva fuerza');
        $('form-fuerza-id').value = '';
        $('form-fuerza-nombre').value = '';
        $('form-fuerza-sigla').value = '';
        this.ocultarError('form-fuerza-error');
        this.seleccionarColorFuerza(this.proximoColorFuerza());
        this.abrirDialogo('modal-fuerza');
        $('form-fuerza-nombre').focus();
    }

    abrirModalEditarFuerza(id) {
        const fuerza = this.fuerzas.find((f) => f.id === id);
        if (!fuerza) return;
        this.fijarTitulo('modal-fuerza-titulo', 'fa-edit', 'Editar fuerza');
        $('form-fuerza-id').value = fuerza.id;
        $('form-fuerza-nombre').value = fuerza.nombre;
        $('form-fuerza-sigla').value = fuerza.sigla || '';
        this.ocultarError('form-fuerza-error');
        this.seleccionarColorFuerza(fuerza.color || 1);
        this.abrirDialogo('modal-fuerza');
    }

    cerrarModalFuerza() {
        this.cerrarDialogo('modal-fuerza');
    }

    async guardarFuerza() {
        const id = $('form-fuerza-id').value;
        const isEdit = !!id;
        const nombre = $('form-fuerza-nombre').value.trim();
        const sigla = $('form-fuerza-sigla').value.trim();
        const color = Number($('form-fuerza-color').value);

        if (!nombre) return this.mostrarError('form-fuerza-error', 'El nombre de la fuerza es obligatorio', 'form-fuerza-nombre');

        const btn = $('btn-guardar-fuerza');
        btn.setAttribute('aria-busy', 'true');

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
                if (this.estaAbierto('modal-comicio')) {
                    const seleccion = isEdit ? checklistPrevio : [...checklistPrevio, response.data.id];
                    this.renderizarChecklistFuerzas(seleccion);
                }
            }
        } catch (error) {
            this.mostrarError('form-fuerza-error', error.message || 'No se pudo guardar la fuerza');
        } finally {
            btn.removeAttribute('aria-busy');
        }
    }

    async eliminarFuerza(id, nombre) {
        if (!(await this.confirmarEliminar(`¿Eliminar la fuerza "${nombre}"?`))) return;
        try {
            const response = await window.apiService.eliminarFuerza(id);
            if (response.success) {
                this.mostrarToast('Fuerza eliminada', 'success');
                await this.cargarFuerzas();
            }
        } catch (error) {
            this.mostrarToast('No se pudo eliminar: ' + error.message, 'error');
        }
    }

    // ==================== Fiscales (padrón) ====================

    /**
     * `nivel` es el nivel de encabezado: 1 cuando el padrón de fiscales es la pantalla entera
     * (sin comicio.view), 2 cuando es una sección dentro de un comicio.
     */
    htmlSeccionFiscales(nivel = 2) {
        const h = `h${nivel}`;
        return `
            <div class="fiscales-header">
                <div class="fiscales-title">
                    <${h}><i class="fas fa-user-shield" aria-hidden="true"></i> Fiscales</${h}>
                    <p class="fiscales-subtitle">Registro de fiscales. La asignación a una mesa se hace dentro de cada comicio.</p>
                </div>
                ${this.permisos.fiscalesEdit ? `
                <div class="fiscales-actions">
                    <button type="button" id="btn-crear-fiscal" class="btn btn-primary" aria-label="Nuevo fiscal">
                        <i class="fas fa-plus" aria-hidden="true"></i> <span class="btn-text">Nuevo fiscal</span>
                    </button>
                </div>` : ''}
            </div>
            <div class="fiscales-tabla-container" role="region" aria-label="Fiscales registrados" tabindex="0">
                <div id="fiscales-loading" class="fiscales-loading" role="status" hidden>
                    <i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Cargando fiscales…
                </div>
                <div id="fiscales-error" hidden></div>
                <table class="fiscales-tabla" id="fiscales-tabla">
                    <caption class="sr-only">Fiscales registrados</caption>
                    <thead><tr><th scope="col">Nombre</th><th scope="col">DNI</th><th scope="col">Teléfono</th><th scope="col">Acciones</th></tr></thead>
                    <tbody id="fiscales-tbody"></tbody>
                </table>
                <div id="fiscales-empty" class="fiscales-empty" hidden>
                    <i class="fas fa-user-shield" aria-hidden="true"></i>
                    <p>Todavía no hay fiscales cargados</p>
                </div>
            </div>
        `;
    }

    htmlModalFiscal() {
        return this.htmlDialogo({
            id: 'modal-fiscal', form: 'form-fiscal', icono: 'fa-plus', titulo: 'Nuevo fiscal',
            cuerpo: `
                <input type="hidden" id="form-fiscal-id" value="">
                <div class="form-group">
                    <label for="form-fiscal-nombre">Nombre <span class="required" aria-hidden="true">*</span></label>
                    <input type="text" id="form-fiscal-nombre" class="form-input" required aria-required="true" maxlength="200" autocomplete="off">
                </div>
                <div class="form-group">
                    <label for="form-fiscal-dni">DNI</label>
                    <input type="text" id="form-fiscal-dni" class="form-input" maxlength="20" inputmode="numeric" autocomplete="off" spellcheck="false">
                </div>
                <div class="form-group">
                    <label for="form-fiscal-telefono">Teléfono</label>
                    <input type="tel" id="form-fiscal-telefono" class="form-input" maxlength="50" inputmode="tel" autocomplete="off">
                </div>
                <div id="form-fiscal-error" class="form-error" role="alert" hidden></div>`,
            pie: `
                <button type="button" class="btn btn-secondary" id="btn-cancelar-fiscal">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btn-guardar-fiscal">
                    <i class="fas fa-save" aria-hidden="true"></i> Guardar
                </button>`,
        });
    }

    async cargarFiscales() {
        $('fiscales-loading').hidden = false;
        $('fiscales-tabla').hidden = true;
        $('fiscales-empty').hidden = true;
        $('fiscales-error').hidden = true;

        try {
            const response = await window.apiService.obtenerFiscales({ limite: 100 });
            if (response.success) {
                this.fiscales = response.data;
                this.renderizarFiscales();
            }
        } catch (error) {
            // El error ocupa el lugar de la tabla, con salida: antes era un toast y la tabla
            // quedaba oculta, o sea una pantalla en blanco sin forma de reintentar.
            console.error('Error cargando fiscales:', error);
            $('fiscales-error').innerHTML = estados.error({
                titulo: 'No se pudieron cargar los fiscales',
                texto: 'Revisá tu conexión y volvé a intentar.',
                reintentar: 'cargarFiscales',
                compacto: true
            });
            $('fiscales-error').hidden = false;
        } finally {
            $('fiscales-loading').hidden = true;
        }
    }

    renderizarFiscales() {
        const tbody = $('fiscales-tbody');
        const tabla = $('fiscales-tabla');
        const empty = $('fiscales-empty');

        if (this.fiscales.length === 0) {
            tabla.hidden = true;
            empty.hidden = false;
            return;
        }
        tabla.hidden = false;
        empty.hidden = true;

        // Los botones de ícono llevan el nombre de la persona en `aria-label`: con solo
        // "Editar fiscal" un lector de pantalla oye lo mismo por cada fila de la tabla.
        tbody.innerHTML = this.fiscales.map((f) => `
            <tr>
                <td class="fiscal-nombre">${escaparHtml(f.nombre)}</td>
                <td class="dato">${escaparHtml(f.dni || '-')}</td>
                <td>${escaparHtml(f.telefono || '-')}</td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.fiscalesEdit ? `
                        <button type="button" class="btn-accion btn-editar" title="Editar fiscal" aria-label="Editar fiscal ${escaparHtml(f.nombre)}" data-id="${f.id}">
                            <i class="fas fa-edit" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-eliminar" title="Eliminar fiscal" aria-label="Eliminar fiscal ${escaparHtml(f.nombre)}" data-id="${f.id}" data-nombre="${escaparHtml(f.nombre)}">
                            <i class="fas fa-trash" aria-hidden="true"></i>
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
        this.fijarTitulo('modal-fiscal-titulo', 'fa-plus', 'Nuevo fiscal');
        $('form-fiscal-id').value = '';
        $('form-fiscal-nombre').value = '';
        $('form-fiscal-dni').value = '';
        $('form-fiscal-telefono').value = '';
        this.ocultarError('form-fiscal-error');
        this.abrirDialogo('modal-fiscal');
        $('form-fiscal-nombre').focus();
    }

    abrirModalEditarFiscal(id) {
        const fiscal = this.fiscales.find((f) => f.id === id);
        if (!fiscal) return;
        this.fijarTitulo('modal-fiscal-titulo', 'fa-edit', 'Editar fiscal');
        $('form-fiscal-id').value = fiscal.id;
        $('form-fiscal-nombre').value = fiscal.nombre;
        $('form-fiscal-dni').value = fiscal.dni || '';
        $('form-fiscal-telefono').value = fiscal.telefono || '';
        this.ocultarError('form-fiscal-error');
        this.abrirDialogo('modal-fiscal');
    }

    cerrarModalFiscal() {
        this.cerrarDialogo('modal-fiscal');
    }

    async guardarFiscal() {
        const id = $('form-fiscal-id').value;
        const isEdit = !!id;
        const nombre = $('form-fiscal-nombre').value.trim();
        const dni = $('form-fiscal-dni').value.trim();
        const telefono = $('form-fiscal-telefono').value.trim();

        if (!nombre) return this.mostrarError('form-fiscal-error', 'El nombre del fiscal es obligatorio', 'form-fiscal-nombre');

        const btn = $('btn-guardar-fiscal');
        btn.setAttribute('aria-busy', 'true');

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
            this.mostrarError('form-fiscal-error', error.message || 'No se pudo guardar el fiscal');
        } finally {
            btn.removeAttribute('aria-busy');
        }
    }

    async eliminarFiscal(id, nombre) {
        if (!(await this.confirmarEliminar(`¿Eliminar a "${nombre}"? Se borran también sus asignaciones.`))) return;
        try {
            const response = await window.apiService.eliminarFiscal(id);
            if (response.success) {
                this.mostrarToast('Fiscal eliminado', 'success');
                await this.cargarFiscales();
            }
        } catch (error) {
            this.mostrarToast('No se pudo eliminar: ' + error.message, 'error');
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
                        <h1 id="comicios-titulo" tabindex="-1"><i class="fas fa-building" aria-hidden="true"></i> Comicios</h1>
                        <p class="comicio-subtitle">Entrá a un comicio para gestionar sus mesas, fuerzas, fiscales y resultados</p>
                    </div>
                    ${this.permisos.comicioEdit ? `
                    <div class="comicio-actions">
                        <button type="button" id="btn-crear-comicio" class="btn btn-primary" aria-label="Nuevo comicio">
                            <i class="fas fa-plus" aria-hidden="true"></i> <span class="btn-text">Nuevo comicio</span>
                        </button>
                    </div>` : ''}
                </div>

                <div class="comicio-tabla-container" role="region" aria-label="Listado de comicios" tabindex="0">
                    <div id="comicios-loading" class="comicio-loading" role="status" hidden>
                        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Cargando comicios…
                    </div>
                    <div id="comicios-error" hidden></div>
                    <table class="comicio-tabla" id="comicios-tabla">
                        <caption class="sr-only">Comicios cargados</caption>
                        <thead>
                            <tr>
                                <th scope="col">Nombre</th>
                                <th scope="col">Tipo de elección</th>
                                <th scope="col">Fuerzas</th>
                                <th scope="col">Mesas</th>
                                <th scope="col">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="comicios-tbody"></tbody>
                    </table>
                    <div id="comicios-empty" class="comicio-empty" hidden>
                        <i class="fas fa-building" aria-hidden="true"></i>
                        <p>Todavía no hay comicios cargados</p>
                    </div>
                </div>
            </div>

            <!-- ---- Detalle de un comicio: todo lo que le pertenece vive acá ---- -->
            <div id="comicio-detalle-view" hidden>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-volver-listado">
                    <i class="fas fa-arrow-left" aria-hidden="true"></i> Volver a comicios
                </button>

                <div class="comicio-header">
                    <div class="comicio-title">
                        <h1 id="detalle-comicio-nombre" tabindex="-1"></h1>
                        <p class="comicio-subtitle" id="detalle-comicio-fuerzas"></p>
                    </div>
                </div>

                <!-- Pestañas WAI-ARIA (lib/pestanas.js): flechas, Inicio y Fin; solo la activa está
                     en el orden de tabulación. Antes eran botones con una clase "activa". -->
                <div class="comicio-subtabs" id="comicio-tabs" role="tablist" aria-label="Secciones del comicio">
                    ${subTabs.map((t) => `
                        <button type="button" class="comicio-subtab" role="tab" id="tab-${t.key}" aria-controls="subtab-${t.key}">
                            <i class="fas ${t.icon}" aria-hidden="true"></i> ${t.label}
                        </button>
                    `).join('')}
                </div>

                <div id="subtab-mesas" class="comicio-subtab-panel" role="tabpanel" aria-labelledby="tab-mesas">
                    <div class="comicio-header">
                        <div class="comicio-title"><h2><i class="fas fa-chair" aria-hidden="true"></i> Mesas</h2></div>
                        ${this.permisos.comicioEdit ? `
                        <div class="comicio-actions">
                            <button type="button" id="btn-crear-mesa" class="btn btn-primary btn-sm" aria-label="Nueva mesa">
                                <i class="fas fa-plus" aria-hidden="true"></i> <span class="btn-text">Nueva mesa</span>
                            </button>
                        </div>` : ''}
                    </div>
                    <div class="comicio-tabla-container" role="region" aria-label="Mesas del comicio" tabindex="0">
                    <table class="comicio-tabla" id="mesas-tabla">
                        <caption class="sr-only">Mesas del comicio</caption>
                        <thead>
                            <tr>
                                <th scope="col">Mesa</th>
                                <th scope="col">Rango de padrón</th>
                                <th scope="col">Votantes</th>
                                <th scope="col">Votos cargados</th>
                                <th scope="col">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="mesas-tbody"></tbody>
                    </table>
                    </div>
                    <div id="mesas-empty" class="comicio-empty" hidden>
                        <i class="fas fa-chair" aria-hidden="true"></i>
                        <p>Este comicio todavía no tiene mesas</p>
                    </div>
                </div>

                <div id="subtab-fuerzas" class="comicio-subtab-panel" role="tabpanel" aria-labelledby="tab-fuerzas">
                    ${this.htmlPanelFuerzasComicio()}
                </div>

                ${this.permisos.fiscalesView ? `
                <div id="subtab-fiscales" class="comicio-subtab-panel" role="tabpanel" aria-labelledby="tab-fiscales">
                    ${this.htmlSeccionFiscales(2)}
                    <div class="fiscales-header fiscales-header-sep">
                        <div class="fiscales-title">
                            <h3><i class="fas fa-calendar-alt" aria-hidden="true"></i> Horarios</h3>
                            <p class="fiscales-subtitle">Franjas de 08:00 a 18:00 por mesa. Tocá "Fiscales" en una mesa (pestaña Mesas) para asignar.</p>
                        </div>
                    </div>
                    <div id="calendario-comicio" class="calendario-container"></div>
                </div>` : ''}

                <div id="subtab-resultados" class="comicio-subtab-panel" role="tabpanel" aria-labelledby="tab-resultados">
                    ${this.htmlSeccionResultados()}
                </div>
            </div>
        `;
    }

    mostrarSubTab(key) {
        if (this.tabs) this.tabs.seleccionar(`tab-${key}`);
    }

    /** Lo que pasa al cambiar de pestaña (lib/pestanas.js ya mostró/ocultó los paneles). */
    alCambiarSubTab(key) {
        this.subTabActual = key;
        if (key === 'resultados') this.cargarResultadosComicioActual();
    }

    // ---- Fuerzas de este comicio (participación) ----

    htmlPanelFuerzasComicio() {
        return `
            <div class="comicio-header">
                <div class="comicio-title">
                    <h2><i class="fas fa-flag" aria-hidden="true"></i> Fuerzas</h2>
                    <p class="comicio-subtitle">Tildá las que participan de este comicio. El voto de mesa se carga por fuerza.</p>
                </div>
                ${this.permisos.comicioEdit ? `
                <div class="comicio-actions">
                    <button type="button" id="btn-crear-fuerza" class="btn btn-primary btn-sm" aria-label="Nueva fuerza">
                        <i class="fas fa-plus" aria-hidden="true"></i> <span class="btn-text">Nueva fuerza</span>
                    </button>
                </div>` : ''}
            </div>
            <div class="comicio-tabla-container" role="region" aria-label="Fuerzas del comicio" tabindex="0">
                <table class="comicio-tabla" id="fuerzas-comicio-tabla">
                    <caption class="sr-only">Fuerzas y su participación en este comicio</caption>
                    <thead><tr><th scope="col">Participa</th><th scope="col">Nombre</th><th scope="col">Sigla</th><th scope="col">Acciones</th></tr></thead>
                    <tbody id="fuerzas-comicio-tbody"></tbody>
                </table>
                <div id="fuerzas-comicio-empty" class="comicio-empty" hidden>
                    <i class="fas fa-flag" aria-hidden="true"></i>
                    <p>Todavía no hay fuerzas cargadas</p>
                </div>
            </div>
        `;
    }

    renderizarFuerzasComicio() {
        const tbody = $('fuerzas-comicio-tbody');
        const tabla = $('fuerzas-comicio-tabla');
        const empty = $('fuerzas-comicio-empty');
        if (!tbody) return;

        if (this.fuerzas.length === 0) {
            tabla.hidden = true;
            empty.hidden = false;
            return;
        }
        tabla.hidden = false;
        empty.hidden = true;

        const participanIds = new Set((this.comicioActual.fuerzas || []).map((f) => f.id));

        tbody.innerHTML = this.fuerzas.map((f) => `
            <tr>
                <td>
                    <label class="checkbox-row">
                        <input type="checkbox" class="checkbox-participa-fuerza" value="${f.id}" ${participanIds.has(f.id) ? 'checked' : ''} ${this.permisos.comicioEdit ? '' : 'disabled'}
                               aria-label="Participa en este comicio: ${escaparHtml(f.nombre)}">
                    </label>
                </td>
                <td class="comicio-nombre"><span class="color-dot ${this.claseFuerza(f.color)}" aria-hidden="true"></span>${escaparHtml(f.nombre)}</td>
                <td>${escaparHtml(f.sigla || '-')}</td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.comicioEdit ? `
                        <button type="button" class="btn-accion btn-editar" title="Editar fuerza" aria-label="Editar fuerza ${escaparHtml(f.nombre)}" data-id="${f.id}">
                            <i class="fas fa-edit" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-eliminar" title="Eliminar fuerza" aria-label="Eliminar fuerza ${escaparHtml(f.nombre)}" data-id="${f.id}" data-nombre="${escaparHtml(f.nombre)}">
                            <i class="fas fa-trash" aria-hidden="true"></i>
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
                $('detalle-comicio-fuerzas').textContent =
                    `${this.formatearTipo(this.comicioActual.tipo_eleccion)} · ${this.comicioActual.fuerzas.map((f) => f.nombre).join(', ')}`;
                this.renderizarFuerzasComicio();
                this.mostrarToast('Fuerzas del comicio actualizadas', 'success');
            }
        } catch (error) {
            this.mostrarToast('No se pudo actualizar: ' + error.message, 'error');
            this.renderizarFuerzasComicio();
        }
    }

    // ==================== Resultados ====================

    htmlSeccionResultados() {
        return `
            <div class="comicio-header">
                <div class="comicio-title">
                    <h2><i class="fas fa-chart-pie" aria-hidden="true"></i> Resultados</h2>
                    <p class="comicio-subtitle">Métricas y gráficos en base a los votos cargados por mesa</p>
                </div>
            </div>

            <div id="resultados-error" hidden></div>
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

            <div class="comicio-tabla-container" role="region" aria-label="Votos por fuerza" tabindex="0">
                <table class="comicio-tabla metricas-tabla" id="resultados-tabla-fuerzas">
                    <caption class="sr-only">Votos por fuerza</caption>
                    <thead><tr><th scope="col"><span class="sr-only">Color</span></th><th scope="col">Fuerza</th><th scope="col">Votos</th><th scope="col">% sobre emitidos</th></tr></thead>
                    <tbody id="resultados-tbody-fuerzas"></tbody>
                </table>
            </div>
        `;
    }

    /** Resultados del comicio abierto (`this.comicioActual`) -- no hay selector propio, ya estamos adentro de uno. */
    async cargarResultadosComicioActual() {
        if (!this.comicioActual) return;
        $('resultados-error').hidden = true;
        try {
            const response = await window.apiService.metricasComicio(this.comicioActual.id);
            if (!response.success) return;
            const m = response.data;

            this.renderizarMetricasResultados(m);
            this.renderizarTablaResultados(m);
            this.renderizarGraficosResultados(m);
        } catch (error) {
            console.error('Error calculando resultados:', error);
            $('resultados-error').innerHTML = estados.error({
                titulo: 'No se pudieron calcular los resultados',
                texto: 'Revisá tu conexión y volvé a intentar.',
                reintentar: 'cargarResultadosComicioActual',
                compacto: true
            });
            $('resultados-error').hidden = false;
        }
    }

    renderizarMetricasResultados(m) {
        const participacionTexto = m.participacion === null ? '-' : `${formatPct(m.participacion * 100)}%`;
        const n = (v) => escaparHtml(Number(v).toLocaleString('es-AR'));
        $('resultados-metricas-container').innerHTML = `
            <div class="metricas-cards">
                <div class="metrica-card">
                    <span class="metrica-valor">${n(m.emitidos)}</span>
                    <span class="metrica-label">Votos emitidos</span>
                </div>
                <div class="metrica-card">
                    <span class="metrica-valor">${n(m.blancos)}</span>
                    <span class="metrica-label">En blanco</span>
                </div>
                <div class="metrica-card">
                    <span class="metrica-valor">${n(m.nulos)}</span>
                    <span class="metrica-label">Nulos</span>
                </div>
                <div class="metrica-card">
                    <span class="metrica-valor">${n(m.mesasConVotos)}/${n(m.mesasTotal)}</span>
                    <span class="metrica-label">Mesas cargadas</span>
                </div>
                <div class="metrica-card">
                    <span class="metrica-valor">${n(m.votantesAsignados)}</span>
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
                <td><span class="color-dot ${this.claseFuerza(f.fuerza_color)}" aria-hidden="true"></span></td>
                <td>${escaparHtml(f.fuerza_nombre)}</td>
                <td class="dato">${escaparHtml(Number(f.votos).toLocaleString('es-AR'))}</td>
                <td class="dato">${m.emitidos > 0 ? `${formatPct((f.votos / m.emitidos) * 100)}%` : '-'}</td>
            </tr>
        `).join('');
        $('resultados-tbody-fuerzas').innerHTML =
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
        const ctxTorta = $('resultados-chart-torta').getContext('2d');
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
                                const pct = total > 0 ? formatPct((ctx.parsed / total) * 100) : '0';
                                return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                            },
                        },
                    },
                },
            },
        });

        if (this.graficoBarras) this.graficoBarras.destroy();
        const ctxBarras = $('resultados-chart-barras').getContext('2d');
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

    // ==================== Modales de comicio, mesa y votos ====================

    htmlModalComicio() {
        return this.htmlDialogo({
            id: 'modal-comicio', form: 'form-comicio', icono: 'fa-plus', titulo: 'Nuevo comicio',
            cuerpo: `
                <input type="hidden" id="form-comicio-id" value="">
                <div class="form-group">
                    <label for="form-comicio-nombre">Nombre <span class="required" aria-hidden="true">*</span></label>
                    <input type="text" id="form-comicio-nombre" class="form-input" required aria-required="true" maxlength="200" autocomplete="off">
                </div>
                <div class="form-group">
                    <label for="form-comicio-tipo">Tipo de elección <span class="required" aria-hidden="true">*</span></label>
                    <select id="form-comicio-tipo" class="form-input" required aria-required="true">
                        <option value="">Seleccionar…</option>
                        <option value="provincial">Provincial</option>
                        <option value="municipal">Municipal</option>
                        <option value="nacional">Nacional</option>
                    </select>
                </div>
                <fieldset class="form-group grupo-fuerzas">
                    <legend class="sr-only">Fuerzas participantes</legend>
                    <div class="form-comicio-fuerzas-header">
                        <span class="etiqueta-grupo" aria-hidden="true">Fuerzas participantes <span class="required">*</span></span>
                        ${this.permisos.comicioEdit ? `
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-nueva-fuerza-desde-comicio">
                            <i class="fas fa-plus" aria-hidden="true"></i> Nueva fuerza
                        </button>` : ''}
                    </div>
                    <div id="form-comicio-fuerzas" class="listas-checkboxes"></div>
                </fieldset>
                <div id="form-comicio-error" class="form-error" role="alert" hidden></div>`,
            pie: `
                <button type="button" class="btn btn-secondary" id="btn-cancelar-comicio">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btn-guardar-comicio">
                    <i class="fas fa-save" aria-hidden="true"></i> Guardar
                </button>`,
        });
    }

    htmlModalMesa() {
        return this.htmlDialogo({
            id: 'modal-mesa', form: 'form-mesa', icono: 'fa-plus', titulo: 'Nueva mesa',
            cuerpo: `
                <input type="hidden" id="form-mesa-id" value="">
                <div class="form-group">
                    <label for="form-mesa-numero">Número de mesa <span class="required" aria-hidden="true">*</span></label>
                    <input type="number" id="form-mesa-numero" class="form-input" min="1" step="1" required aria-required="true" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label for="form-mesa-desde">DNI desde</label>
                    <input type="text" id="form-mesa-desde" class="form-input" placeholder="Opcional" inputmode="numeric" autocomplete="off" spellcheck="false" aria-describedby="form-mesa-ayuda">
                </div>
                <div class="form-group">
                    <label for="form-mesa-hasta">DNI hasta</label>
                    <input type="text" id="form-mesa-hasta" class="form-input" placeholder="Opcional" inputmode="numeric" autocomplete="off" spellcheck="false" aria-describedby="form-mesa-ayuda">
                </div>
                <p class="modal-info" id="form-mesa-ayuda">El rango de padrón es opcional: se puede cargar después. Si se completa, va por
                orden de apellido y nombre del padrón (no por número de DNI) y hay que completar los dos campos.</p>
                <div id="form-mesa-error" class="form-error" role="alert" hidden></div>`,
            pie: `
                <button type="button" class="btn btn-secondary" id="btn-cancelar-mesa">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btn-guardar-mesa">
                    <i class="fas fa-save" aria-hidden="true"></i> Guardar
                </button>`,
        });
    }

    htmlModalVotos() {
        return this.htmlDialogo({
            id: 'modal-votos', form: 'form-votos', icono: 'fa-check-to-slot', titulo: 'Votos',
            cuerpo: `
                <input type="hidden" id="form-votos-mesa-id" value="">
                <div id="form-votos-fuerzas"></div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="form-votos-blancos">Votos en blanco</label>
                        <input type="number" id="form-votos-blancos" class="form-input" min="0" step="1" required aria-required="true" inputmode="numeric">
                    </div>
                    <div class="form-group">
                        <label for="form-votos-nulos">Votos nulos</label>
                        <input type="number" id="form-votos-nulos" class="form-input" min="0" step="1" required aria-required="true" inputmode="numeric">
                    </div>
                </div>
                <div id="form-votos-error" class="form-error" role="alert" hidden></div>`,
            pie: `
                <button type="button" class="btn btn-secondary" id="btn-cancelar-votos">Cancelar</button>
                <button type="submit" class="btn btn-primary" id="btn-guardar-votos">
                    <i class="fas fa-save" aria-hidden="true"></i> Guardar votos
                </button>`,
        });
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
        return this.htmlDialogo({
            id: 'modal-fiscales-mesa', icono: 'fa-user-shield', titulo: 'Fiscales', ancho: true,
            cuerpo: `
                <div id="asignaciones-error" hidden></div>
                <table class="fiscales-tabla" id="asignaciones-tabla">
                    <caption class="sr-only">Franjas horarias de los fiscales de la mesa</caption>
                    <thead><tr><th scope="col">Desde</th><th scope="col">Hasta</th><th scope="col">Fiscal</th><th scope="col">Acciones</th></tr></thead>
                    <tbody id="asignaciones-tbody"></tbody>
                </table>
                <div id="asignaciones-empty" class="fiscales-empty" hidden>
                    <i class="fas fa-calendar-day" aria-hidden="true"></i>
                    <p>Esta mesa todavía no tiene fiscales asignados</p>
                </div>

                ${this.permisos.fiscalesEdit ? `
                <form id="form-asignacion" class="asignacion-form-inline" novalidate>
                    <input type="hidden" id="form-asignacion-id" value="">
                    <h3 id="asignacion-form-titulo"><i class="fas fa-plus" aria-hidden="true"></i> Agregar fiscal</h3>
                    <div class="form-group">
                        <label for="form-asignacion-fiscal">Fiscal <span class="required" aria-hidden="true">*</span></label>
                        <select id="form-asignacion-fiscal" class="form-input" required aria-required="true">
                            <option value="">Seleccionar…</option>
                        </select>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="form-asignacion-desde">Desde <span class="required" aria-hidden="true">*</span></label>
                            <input type="time" id="form-asignacion-desde" class="form-input" min="08:00" max="18:00" required aria-required="true">
                        </div>
                        <div class="form-group">
                            <label for="form-asignacion-hasta">Hasta <span class="required" aria-hidden="true">*</span></label>
                            <input type="time" id="form-asignacion-hasta" class="form-input" min="08:00" max="18:00" required aria-required="true">
                        </div>
                    </div>
                    <div id="form-asignacion-error" class="form-error" role="alert" hidden></div>
                    <div class="asignacion-form-acciones">
                        <button type="button" class="btn btn-secondary btn-sm" id="btn-cancelar-edicion-asignacion" hidden>Cancelar edición</button>
                        <button type="submit" class="btn btn-primary btn-sm" id="btn-guardar-asignacion">
                            <i class="fas fa-save" aria-hidden="true"></i> Guardar
                        </button>
                    </div>
                </form>` : ''}`,
        });
    }

    // ==================== Eventos ====================

    inicializarEventos() {
        // El modal de fiscal solo existe en el DOM con fiscalesView (ver el render): sin
        // esa mitad, enganchar listeners tiraba TypeError y dejaba toda la pagina muerta
        // (FE-010).
        if (this.permisos.fiscalesEdit && this.permisos.fiscalesView) {
            $('btn-crear-fiscal').addEventListener('click', () => this.abrirModalCrearFiscal());
            $('modal-fiscal-close').addEventListener('click', () => this.cerrarModalFiscal());
            $('btn-cancelar-fiscal').addEventListener('click', () => this.cerrarModalFiscal());
            $('form-fiscal').addEventListener('submit', (e) => {
                e.preventDefault();
                this.guardarFiscal();
            });
        }

        // "Reintentar" de los estados de error: solo estas acciones, no cualquier método.
        const REINTENTOS = ['cargarComicios', 'cargarFiscales', 'cargarResultadosComicioActual', 'cargarAsignacionesMesa'];
        this.container.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action]');
            if (el && REINTENTOS.includes(el.dataset.action)) this[el.dataset.action]();
        });

        if (!this.permisos.comicioView) return;

        if (this.permisos.comicioEdit) {
            $('btn-crear-comicio').addEventListener('click', () => this.abrirModalCrearComicio());
            $('btn-nueva-fuerza-desde-comicio').addEventListener('click', () => this.abrirModalCrearFuerza());
            $('btn-crear-fuerza').addEventListener('click', () => this.abrirModalCrearFuerza());
            $('modal-fuerza-close').addEventListener('click', () => this.cerrarModalFuerza());
            $('btn-cancelar-fuerza').addEventListener('click', () => this.cerrarModalFuerza());
            $('form-fuerza').addEventListener('submit', (e) => {
                e.preventDefault();
                this.guardarFuerza();
            });
            $('form-fuerza-color-swatches').addEventListener('click', (e) => {
                const btn = e.target.closest('.color-swatch');
                if (btn) this.seleccionarColorFuerza(Number(btn.dataset.color));
            });
        }
        $('modal-comicio-close').addEventListener('click', () => this.cerrarModalComicio());
        $('btn-cancelar-comicio').addEventListener('click', () => this.cerrarModalComicio());
        $('form-comicio').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarComicio();
        });

        $('btn-volver-listado').addEventListener('click', () => this.volverAlListado());

        this.tabs = window.pestanas.iniciar($('comicio-tabs'), {
            alCambiar: (id) => this.alCambiarSubTab(id.replace(/^tab-/, ''))
        });

        if (this.permisos.comicioEdit) {
            $('btn-crear-mesa').addEventListener('click', () => this.abrirModalCrearMesa());
        }
        $('modal-mesa-close').addEventListener('click', () => this.cerrarModalMesa());
        $('btn-cancelar-mesa').addEventListener('click', () => this.cerrarModalMesa());
        $('form-mesa').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarMesa();
        });

        $('modal-votos-close').addEventListener('click', () => this.cerrarModalVotos());
        $('btn-cancelar-votos').addEventListener('click', () => this.cerrarModalVotos());
        $('form-votos').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarVotos();
        });

        if (this.permisos.fiscalesView) {
            $('modal-fiscales-mesa-close').addEventListener('click', () => this.cerrarModalFiscalesMesa());
            if (this.permisos.fiscalesEdit) {
                $('btn-cancelar-edicion-asignacion').addEventListener('click', () => this.resetearFormularioAsignacion());
                $('form-asignacion').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.guardarAsignacion();
                });
            }
        }
        // Sin listener global de Escape: cada <dialog> lo maneja solo. El de antes cerraba los
        // seis modales a la vez (existieran o no) en cada pulsación.
    }

    // ---- Listado de comicios ----

    async cargarComicios() {
        $('comicios-loading').hidden = false;
        $('comicios-tabla').hidden = true;
        $('comicios-empty').hidden = true;
        $('comicios-error').hidden = true;

        try {
            const response = await window.apiService.obtenerComicios({ limite: 100 });
            if (response.success) {
                this.comicios = response.data;
                this.renderizarComicios();
            }
        } catch (error) {
            // El error ocupa el lugar de la tabla, con salida: antes era un toast y la tabla
            // quedaba oculta (pantalla en blanco) sin forma de reintentar.
            console.error('Error cargando comicios:', error);
            $('comicios-error').innerHTML = estados.error({
                titulo: 'No se pudieron cargar los comicios',
                texto: 'Revisá tu conexión y volvé a intentar.',
                reintentar: 'cargarComicios'
            });
            $('comicios-error').hidden = false;
        } finally {
            $('comicios-loading').hidden = true;
        }
    }

    renderizarComicios() {
        const tbody = $('comicios-tbody');
        const tabla = $('comicios-tabla');
        const empty = $('comicios-empty');

        if (this.comicios.length === 0) {
            tabla.hidden = true;
            empty.hidden = false;
            return;
        }

        tabla.hidden = false;
        empty.hidden = true;

        tbody.innerHTML = this.comicios.map((c) => `
            <tr>
                <td class="comicio-nombre">${escaparHtml(c.nombre)}</td>
                <td><span class="tipo-badge tipo-${escaparHtml(c.tipo_eleccion)}">${escaparHtml(this.formatearTipo(c.tipo_eleccion))}</span></td>
                <td class="dato">${escaparHtml(String(c.fuerzas_count ?? '-'))}</td>
                <td class="dato">${escaparHtml(String(c.mesas_count ?? '-'))}</td>
                <td>
                    <div class="acciones-cell">
                        <button type="button" class="btn-accion btn-entrar" title="Ver mesas" aria-label="Entrar al comicio ${escaparHtml(c.nombre)}" data-id="${c.id}">
                            <i class="fas fa-arrow-right" aria-hidden="true"></i>
                        </button>
                        ${this.permisos.comicioEdit ? `
                        <button type="button" class="btn-accion btn-editar" title="Editar comicio" aria-label="Editar comicio ${escaparHtml(c.nombre)}" data-id="${c.id}">
                            <i class="fas fa-edit" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-eliminar" title="Eliminar comicio" aria-label="Eliminar comicio ${escaparHtml(c.nombre)}" data-id="${c.id}" data-nombre="${escaparHtml(c.nombre)}">
                            <i class="fas fa-trash" aria-hidden="true"></i>
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
        const cont = $('form-comicio-fuerzas');
        if (this.fuerzas.length === 0) {
            cont.innerHTML = '<p class="candidatos-vacio">No hay fuerzas cargadas todavía: creá una con el botón "Nueva fuerza" de arriba.</p>';
            return;
        }
        cont.innerHTML = this.fuerzas.map((f) => `
            <label class="checkbox-row">
                <input type="checkbox" value="${f.id}" ${seleccionadas.includes(f.id) ? 'checked' : ''}>
                <span class="color-dot ${this.claseFuerza(f.color)}" aria-hidden="true"></span>
                <span>${escaparHtml(f.nombre)}${f.sigla ? ` (${escaparHtml(f.sigla)})` : ''}</span>
            </label>
        `).join('');
    }

    abrirModalCrearComicio() {
        this.fijarTitulo('modal-comicio-titulo', 'fa-plus', 'Nuevo comicio');
        $('form-comicio-id').value = '';
        $('form-comicio-nombre').value = '';
        $('form-comicio-tipo').value = '';
        this.ocultarError('form-comicio-error');
        this.renderizarChecklistFuerzas();
        this.abrirDialogo('modal-comicio');
        $('form-comicio-nombre').focus();
    }

    async abrirModalEditarComicio(id) {
        try {
            const response = await window.apiService.obtenerComicio(id);
            if (!response.success) return;
            const comicio = response.data;

            this.fijarTitulo('modal-comicio-titulo', 'fa-edit', 'Editar comicio');
            $('form-comicio-id').value = comicio.id;
            $('form-comicio-nombre').value = comicio.nombre;
            $('form-comicio-tipo').value = comicio.tipo_eleccion;
            this.ocultarError('form-comicio-error');
            this.renderizarChecklistFuerzas(comicio.fuerzas.map((f) => f.id));
            this.abrirDialogo('modal-comicio');
        } catch (error) {
            this.mostrarToast('No se pudo abrir el comicio: ' + error.message, 'error');
        }
    }

    cerrarModalComicio() {
        this.cerrarDialogo('modal-comicio');
    }

    async guardarComicio() {
        const id = $('form-comicio-id').value;
        const isEdit = !!id;
        const nombre = $('form-comicio-nombre').value.trim();
        const tipoEleccion = $('form-comicio-tipo').value;
        const fuerzaIds = [...document.querySelectorAll('#form-comicio-fuerzas input:checked')].map((el) => Number(el.value));

        if (!nombre) return this.mostrarError('form-comicio-error', 'El nombre del comicio es obligatorio', 'form-comicio-nombre');
        if (!tipoEleccion) return this.mostrarError('form-comicio-error', 'Elegí un tipo de elección', 'form-comicio-tipo');
        if (fuerzaIds.length === 0) return this.mostrarError('form-comicio-error', 'Elegí al menos una fuerza participante');

        const btn = $('btn-guardar-comicio');
        btn.setAttribute('aria-busy', 'true');

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
            this.mostrarError('form-comicio-error', error.message || 'No se pudo guardar el comicio');
        } finally {
            btn.removeAttribute('aria-busy');
        }
    }

    async eliminarComicio(id, nombre) {
        if (!(await this.confirmarEliminar(`¿Eliminar el comicio "${nombre}"? Se borran también sus mesas y votos cargados.`))) return;
        try {
            const response = await window.apiService.eliminarComicio(id);
            if (response.success) {
                this.mostrarToast('Comicio eliminado', 'success');
                await this.cargarComicios();
            }
        } catch (error) {
            this.mostrarToast('No se pudo eliminar: ' + error.message, 'error');
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

            const vienedelListado = !$('comicio-listado-view').hidden;
            $('comicio-listado-view').hidden = true;
            $('comicio-detalle-view').hidden = false;

            const titulo = $('detalle-comicio-nombre');
            const icono = document.createElement('i');
            icono.className = 'fas fa-building';
            icono.setAttribute('aria-hidden', 'true');
            titulo.replaceChildren(icono, ` ${this.comicioActual.nombre}`);
            $('detalle-comicio-fuerzas').textContent =
                `${this.formatearTipo(this.comicioActual.tipo_eleccion)} · ${this.comicioActual.fuerzas.map((f) => f.nombre).join(', ')}`;

            this.renderizarMesas();
            this.renderizarFuerzasComicio();
            if (this.permisos.fiscalesView) await this.cargarAsignacionesDelComicio();

            if (resetSubTab) this.mostrarSubTab('mesas');
            else if (this.subTabActual === 'resultados') this.cargarResultadosComicioActual();

            // Al cambiar de vista el foco pasa al título de la nueva, para que quien navega con
            // teclado o lector de pantalla no quede en un botón que ya no está en pantalla.
            if (vienedelListado) titulo.focus();
        } catch (error) {
            this.mostrarToast('No se pudo abrir el comicio: ' + error.message, 'error');
        }
    }

    volverAlListado() {
        this.comicioActual = null;
        this.asignacionesPorMesa = new Map();
        if (this.graficoTorta) { this.graficoTorta.destroy(); this.graficoTorta = null; }
        if (this.graficoBarras) { this.graficoBarras.destroy(); this.graficoBarras = null; }
        $('comicio-detalle-view').hidden = true;
        $('comicio-listado-view').hidden = false;
        $('comicios-titulo').focus();
        this.cargarComicios();
    }

    renderizarMesas() {
        const mesas = this.comicioActual.mesas || [];
        const tbody = $('mesas-tbody');
        const tabla = $('mesas-tabla');
        const empty = $('mesas-empty');

        if (mesas.length === 0) {
            tabla.hidden = true;
            empty.hidden = false;
            return;
        }

        tabla.hidden = false;
        empty.hidden = true;

        tbody.innerHTML = mesas.map((m) => {
            const cargados = m.votos_blancos !== null && m.votos_blancos !== undefined;
            const tieneRango = !!m.padron_desde_dni && !!m.padron_hasta_dni;
            const num = escaparHtml(String(m.numero));
            return `
            <tr>
                <td class="dato">${num}</td>
                <td class="dato">${tieneRango ? `${escaparHtml(m.padron_desde_dni)} a ${escaparHtml(m.padron_hasta_dni)}` : '<span class="sin-cubrir">Sin rango</span>'}</td>
                <td class="dato">${escaparHtml(m.cantidad_votantes === null || m.cantidad_votantes === undefined ? '-' : String(m.cantidad_votantes))}</td>
                <td>
                    <span class="estado-badge ${cargados ? 'estado-activo' : 'estado-inactivo'}">
                        <i class="fas ${cargados ? 'fa-check-circle' : 'fa-times-circle'}" aria-hidden="true"></i>
                        ${cargados ? 'Cargados' : 'Sin cargar'}
                    </span>
                </td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.fiscalesView ? `
                        <button type="button" class="btn-accion" title="Fiscales de esta mesa" aria-label="Fiscales de la mesa ${num}" data-id="${m.id}" data-numero="${num}" data-accion="fiscales">
                            <i class="fas fa-user-shield" aria-hidden="true"></i>
                        </button>` : ''}
                        ${this.permisos.comicioEdit ? `
                        <button type="button" class="btn-accion btn-votos" title="Cargar votos" aria-label="Cargar votos de la mesa ${num}" data-id="${m.id}">
                            <i class="fas fa-check-to-slot" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-editar" title="Editar mesa" aria-label="Editar la mesa ${num}" data-id="${m.id}">
                            <i class="fas fa-edit" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-eliminar" title="Eliminar mesa" aria-label="Eliminar la mesa ${num}" data-id="${m.id}" data-numero="${num}">
                            <i class="fas fa-trash" aria-hidden="true"></i>
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
        this.fijarTitulo('modal-mesa-titulo', 'fa-plus', 'Nueva mesa');
        $('form-mesa-id').value = '';
        $('form-mesa-numero').value = '';
        $('form-mesa-desde').value = '';
        $('form-mesa-hasta').value = '';
        this.ocultarError('form-mesa-error');
        this.abrirDialogo('modal-mesa');
        $('form-mesa-numero').focus();
    }

    abrirModalEditarMesa(mesaId) {
        const mesa = this.comicioActual.mesas.find((m) => m.id === mesaId);
        if (!mesa) return;

        this.fijarTitulo('modal-mesa-titulo', 'fa-edit', 'Editar mesa');
        $('form-mesa-id').value = mesa.id;
        $('form-mesa-numero').value = mesa.numero;
        $('form-mesa-desde').value = mesa.padron_desde_dni || '';
        $('form-mesa-hasta').value = mesa.padron_hasta_dni || '';
        this.ocultarError('form-mesa-error');
        this.abrirDialogo('modal-mesa');
    }

    cerrarModalMesa() {
        this.cerrarDialogo('modal-mesa');
    }

    async guardarMesa() {
        const id = $('form-mesa-id').value;
        const isEdit = !!id;
        const numero = Number($('form-mesa-numero').value);
        const desdeDni = $('form-mesa-desde').value.trim();
        const hastaDni = $('form-mesa-hasta').value.trim();

        if (!Number.isInteger(numero) || numero <= 0) return this.mostrarError('form-mesa-error', 'El número de mesa tiene que ser un entero positivo', 'form-mesa-numero');
        if ((desdeDni && !hastaDni) || (!desdeDni && hastaDni)) {
            return this.mostrarError('form-mesa-error', 'Completá los dos DNI del rango, o dejalos los dos vacíos', desdeDni ? 'form-mesa-hasta' : 'form-mesa-desde');
        }

        const btn = $('btn-guardar-mesa');
        btn.setAttribute('aria-busy', 'true');

        try {
            const data = { numero, desdeDni: desdeDni || null, hastaDni: hastaDni || null };
            const response = isEdit
                ? await window.apiService.actualizarMesa(this.comicioActual.id, Number(id), data)
                : await window.apiService.crearMesa(this.comicioActual.id, data);

            if (response.success) {
                this.cerrarModalMesa();
                const votantesTexto = response.data.cantidad_votantes === null ? '' : `: ${response.data.cantidad_votantes} votantes en el rango`;
                this.mostrarToast(isEdit ? 'Mesa actualizada' : `Mesa creada${votantesTexto}`, 'success');
                await this.entrarAComicio(this.comicioActual.id, false);
            }
        } catch (error) {
            this.mostrarError('form-mesa-error', error.message || 'No se pudo guardar la mesa');
        } finally {
            btn.removeAttribute('aria-busy');
        }
    }

    async eliminarMesa(mesaId, numero) {
        if (!(await this.confirmarEliminar(`¿Eliminar la mesa ${numero}? Se borran también sus votos cargados y fiscales asignados.`))) return;
        try {
            const response = await window.apiService.eliminarMesa(this.comicioActual.id, mesaId);
            if (response.success) {
                this.mostrarToast('Mesa eliminada', 'success');
                await this.entrarAComicio(this.comicioActual.id, false);
            }
        } catch (error) {
            this.mostrarToast('No se pudo eliminar: ' + error.message, 'error');
        }
    }

    // ---- Modal votos ----

    async abrirModalVotos(mesaId) {
        this.mesaEnEdicionVotos = mesaId;
        const mesa = this.comicioActual.mesas.find((m) => m.id === mesaId);

        this.fijarTitulo('modal-votos-titulo', 'fa-check-to-slot', `Votos: mesa ${mesa.numero}`);
        $('form-votos-mesa-id').value = mesaId;
        this.ocultarError('form-votos-error');

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

        $('form-votos-blancos').value = votosPrevios.blancos ?? 0;
        $('form-votos-nulos').value = votosPrevios.nulos ?? 0;

        const cont = $('form-votos-fuerzas');
        cont.innerHTML = this.comicioActual.fuerzas.map((f) => {
            const previo = votosPrevios.porFuerza.find((v) => v.fuerza_id === f.id);
            return `
                <div class="form-group">
                    <label for="voto-fuerza-${f.id}"><span class="color-dot ${this.claseFuerza(f.color)}" aria-hidden="true"></span>${escaparHtml(f.nombre)}</label>
                    <input type="number" id="voto-fuerza-${f.id}" class="form-input" data-fuerza-id="${f.id}" min="0" step="1" value="${previo ? previo.cantidad : 0}" required aria-required="true" inputmode="numeric">
                </div>
            `;
        }).join('');

        this.abrirDialogo('modal-votos');
    }

    cerrarModalVotos() {
        this.cerrarDialogo('modal-votos');
    }

    async guardarVotos() {
        const mesaId = Number($('form-votos-mesa-id').value);
        const blancos = Number($('form-votos-blancos').value);
        const nulos = Number($('form-votos-nulos').value);
        const porFuerza = [...document.querySelectorAll('#form-votos-fuerzas input')].map((input) => ({
            fuerzaId: Number(input.dataset.fuerzaId),
            cantidad: Number(input.value),
        }));

        if (!Number.isInteger(blancos) || blancos < 0) return this.mostrarError('form-votos-error', 'Los votos en blanco tienen que ser un entero no negativo', 'form-votos-blancos');
        if (!Number.isInteger(nulos) || nulos < 0) return this.mostrarError('form-votos-error', 'Los votos nulos tienen que ser un entero no negativo', 'form-votos-nulos');

        const btn = $('btn-guardar-votos');
        btn.setAttribute('aria-busy', 'true');

        try {
            const response = await window.apiService.cargarVotosMesa(this.comicioActual.id, mesaId, { blancos, nulos, porFuerza });
            if (response.success) {
                this.cerrarModalVotos();
                this.mostrarToast('Votos guardados', 'success');
                await this.entrarAComicio(this.comicioActual.id, false);
            }
        } catch (error) {
            this.mostrarError('form-votos-error', error.message || 'No se pudieron guardar los votos');
        } finally {
            btn.removeAttribute('aria-busy');
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

    /** % de la franja 08:00 a 18:00 (600 min) que representa una hora HH:MM. */
    pctEnJornada(horaHHMM) {
        const [h, m] = this.formatearHora(horaHHMM).split(':').map(Number);
        const minutos = (h * 60 + m) - (8 * 60);
        return Math.max(0, Math.min(100, (minutos / 600) * 100));
    }

    renderizarCalendarioComicio() {
        const cont = $('calendario-comicio');
        if (!cont) return;
        const mesas = this.comicioActual.mesas || [];

        if (mesas.length === 0) {
            cont.innerHTML = '<p class="fiscales-empty fiscales-empty-linea">Este comicio todavía no tiene mesas.</p>';
            return;
        }

        const horas = Array.from({ length: 10 }, (_, i) => 8 + i);
        const encabezado = horas.map((h) => `<div class="calendario-hora">${String(h).padStart(2, '0')}:00</div>`).join('');

        // Posición y ancho de cada franja: `data-izq` / `data-ancho`, aplicados por CSSOM al
        // final (un `style=` en el markup impide quitar 'unsafe-inline' de la CSP).
        const filas = mesas.map((m) => {
            const asignaciones = this.asignacionesPorMesa.get(m.id) || [];
            const bloques = asignaciones.map((a) => {
                const left = this.pctEnJornada(a.desde);
                const width = Math.max(this.pctEnJornada(a.hasta) - left, 2);
                const etiqueta = `${escaparHtml(a.fiscal_nombre)}, ${this.formatearHora(a.desde)} a ${this.formatearHora(a.hasta)}`;
                return `<div class="calendario-bloque" data-izq="${left}" data-ancho="${width}" title="${etiqueta}">${escaparHtml(a.fiscal_nombre)}</div>`;
            }).join('');
            return `
                <div class="calendario-fila">
                    <div class="calendario-mesa-label">Mesa ${escaparHtml(String(m.numero))}</div>
                    <div class="calendario-timeline">${bloques}</div>
                </div>
            `;
        }).join('');

        // El dibujo es una ayuda visual: un lector de pantalla no puede recorrer franjas
        // posicionadas en porcentajes, así que se lo oculta y se ofrece lo mismo como tabla.
        const filasTabla = mesas.map((m) => {
            const asignaciones = this.asignacionesPorMesa.get(m.id) || [];
            if (!asignaciones.length) {
                return `<tr><th scope="row">Mesa ${escaparHtml(String(m.numero))}</th><td colspan="3" class="fiscales-empty-linea">Sin fiscal asignado</td></tr>`;
            }
            return asignaciones.map((a, i) => `
                <tr>
                    ${i === 0 ? `<th scope="row" rowspan="${asignaciones.length}">Mesa ${escaparHtml(String(m.numero))}</th>` : ''}
                    <td>${escaparHtml(a.fiscal_nombre)}</td>
                    <td class="num">${this.formatearHora(a.desde)}</td>
                    <td class="num">${this.formatearHora(a.hasta)}</td>
                </tr>`).join('');
        }).join('');

        cont.innerHTML = `
            <div class="calendario-grid" aria-hidden="true">
                <div class="calendario-fila calendario-fila-encabezado">
                    <div class="calendario-mesa-label"></div>
                    <div class="calendario-timeline calendario-timeline-encabezado">${encabezado}</div>
                </div>
                ${filas}
            </div>
            <details class="calendario-tabla">
                <summary>Ver el calendario como tabla</summary>
                <div class="tabla-contenedor" role="region" tabindex="0" aria-label="Fiscales por mesa y horario">
                    <table class="tabla">
                        <caption class="sr-only">Fiscales asignados a cada mesa, con su horario</caption>
                        <thead><tr><th scope="col">Mesa</th><th scope="col">Fiscal</th><th scope="col" class="num">Desde</th><th scope="col" class="num">Hasta</th></tr></thead>
                        <tbody>${filasTabla}</tbody>
                    </table>
                </div>
            </details>
        `;
        cont.querySelectorAll('.calendario-bloque').forEach((b) => {
            b.style.left = `${Number(b.dataset.izq) || 0}%`;
            b.style.width = `${Number(b.dataset.ancho) || 0}%`;
        });
    }

    // ---- Modal fiscales de una mesa (lista de asignaciones) ----

    async abrirModalFiscalesMesa(mesaId, numero) {
        this.mesaSeleccionadaFiscales = mesaId;
        this.fijarTitulo('modal-fiscales-mesa-titulo', 'fa-user-shield', `Fiscales: mesa ${numero}`);
        if (this.permisos.fiscalesEdit) {
            this.poblarSelectFiscales();
            this.resetearFormularioAsignacion();
        }
        await this.cargarAsignacionesMesa();
        this.abrirDialogo('modal-fiscales-mesa');
    }

    cerrarModalFiscalesMesa() {
        this.cerrarDialogo('modal-fiscales-mesa');
    }

    async cargarAsignacionesMesa() {
        // Capturada antes del await: si mientras esperaba la respuesta se abrió otra
        // mesa, mesaSeleccionadaFiscales ya cambió, y sin esta constante el resultado
        // tardío se guardaría bajo la clave equivocada. Depende de que
        // mesaSeleccionadaFiscales se reasigne de forma síncrona al abrir el modal.
        const mesaId = this.mesaSeleccionadaFiscales;
        $('asignaciones-error').hidden = true;
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
            console.error('Error cargando asignaciones:', error);
            $('asignaciones-error').innerHTML = estados.error({
                titulo: 'No se pudieron cargar las asignaciones',
                reintentar: 'cargarAsignacionesMesa',
                compacto: true
            });
            $('asignaciones-error').hidden = false;
        }
    }

    renderizarAsignaciones() {
        const tbody = $('asignaciones-tbody');
        const tabla = $('asignaciones-tabla');
        const empty = $('asignaciones-empty');

        if (this.asignacionesMesaActual.length === 0) {
            tabla.hidden = true;
            empty.hidden = false;
            return;
        }
        tabla.hidden = false;
        empty.hidden = true;

        tbody.innerHTML = this.asignacionesMesaActual.map((a) => {
            const franja = `${escaparHtml(a.fiscal_nombre)}, ${escaparHtml(this.formatearHora(a.desde))} a ${escaparHtml(this.formatearHora(a.hasta))}`;
            return `
            <tr>
                <td class="dato">${escaparHtml(this.formatearHora(a.desde))}</td>
                <td class="dato">${escaparHtml(this.formatearHora(a.hasta))}</td>
                <td>${escaparHtml(a.fiscal_nombre)}</td>
                <td>
                    <div class="acciones-cell">
                        ${this.permisos.fiscalesEdit ? `
                        <button type="button" class="btn-accion btn-editar" title="Editar" aria-label="Editar la franja de ${franja}" data-id="${a.id}">
                            <i class="fas fa-edit" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-eliminar" title="Quitar" aria-label="Quitar la franja de ${franja}" data-id="${a.id}">
                            <i class="fas fa-trash" aria-hidden="true"></i>
                        </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
        }).join('');

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
        const select = $('form-asignacion-fiscal');
        select.innerHTML = '<option value="">Seleccionar…</option>' +
            this.fiscales.map((f) => `<option value="${f.id}" ${String(f.id) === String(seleccionado) ? 'selected' : ''}>${escaparHtml(f.nombre)}</option>`).join('');
    }

    /** Vuelve el formulario inline a modo "agregar" (sin franja en edición). */
    resetearFormularioAsignacion() {
        this.asignacionEnEdicionId = null;
        $('form-asignacion-id').value = '';
        $('form-asignacion-desde').value = '';
        $('form-asignacion-hasta').value = '';
        this.ocultarError('form-asignacion-error');
        this.fijarTitulo('asignacion-form-titulo', 'fa-plus', 'Agregar fiscal');
        this.etiquetaGuardarAsignacion();
        $('btn-cancelar-edicion-asignacion').hidden = true;
        this.poblarSelectFiscales();
    }

    /** Texto del botón de guardar según el modo (alta o edición). */
    etiquetaGuardarAsignacion() {
        const texto = this.asignacionEnEdicionId ? 'Guardar cambios' : 'Guardar';
        const btn = $('btn-guardar-asignacion');
        const i = document.createElement('i');
        i.className = 'fas fa-save';
        i.setAttribute('aria-hidden', 'true');
        btn.replaceChildren(i, ` ${texto}`);
    }

    cargarAsignacionEnFormulario(id) {
        const a = this.asignacionesMesaActual.find((x) => x.id === id);
        if (!a) return;
        this.asignacionEnEdicionId = id;
        $('form-asignacion-id').value = a.id;
        $('form-asignacion-desde').value = this.formatearHora(a.desde);
        $('form-asignacion-hasta').value = this.formatearHora(a.hasta);
        this.ocultarError('form-asignacion-error');
        this.fijarTitulo('asignacion-form-titulo', 'fa-edit', 'Editar franja');
        this.etiquetaGuardarAsignacion();
        $('btn-cancelar-edicion-asignacion').hidden = false;
        this.poblarSelectFiscales(a.fiscal_id);
        $('form-asignacion-fiscal').focus();
    }

    async guardarAsignacion() {
        const isEdit = !!this.asignacionEnEdicionId;
        const fiscalId = Number($('form-asignacion-fiscal').value);
        const desde = $('form-asignacion-desde').value;
        const hasta = $('form-asignacion-hasta').value;

        if (!fiscalId) return this.mostrarError('form-asignacion-error', 'Elegí un fiscal', 'form-asignacion-fiscal');
        if (!desde || !hasta) return this.mostrarError('form-asignacion-error', 'Completá desde y hasta', desde ? 'form-asignacion-hasta' : 'form-asignacion-desde');

        const btn = $('btn-guardar-asignacion');
        btn.setAttribute('aria-busy', 'true');

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
            this.mostrarError('form-asignacion-error', error.message || 'No se pudo guardar la asignación');
        } finally {
            // aria-busy y no un texto que se pisa: antes, si fallaba una EDICIÓN, el botón
            // quedaba para siempre en "Guardando…" con el spinner (el texto solo se
            // restauraba fuera del modo edición).
            btn.removeAttribute('aria-busy');
        }
    }

    async eliminarAsignacion(id) {
        if (!(await this.confirmarEliminar('¿Quitar esta asignación?'))) return;
        try {
            const response = await window.apiService.eliminarAsignacionFiscal(id);
            if (response.success) {
                this.mostrarToast('Asignación eliminada', 'success');
                if (this.asignacionEnEdicionId === id) this.resetearFormularioAsignacion();
                await this.cargarAsignacionesMesa();
                this.renderizarCalendarioComicio();
            }
        } catch (error) {
            this.mostrarToast('No se pudo eliminar: ' + error.message, 'error');
        }
    }

    // ==================== Helpers ====================

    formatearTipo(tipo) {
        const nombres = { provincial: 'Provincial', municipal: 'Municipal', nacional: 'Nacional' };
        return nombres[tipo] || tipo;
    }

    /**
     * Error de un formulario: región `role="alert"` (que se anuncia) y, si se indica el
     * campo, `aria-invalid` y foco en él. Antes solo se pintaba un texto rojo: un lector de
     * pantalla no sabía que había un error ni en qué campo.
     */
    mostrarError(elementId, mensaje, campoId = null) {
        const el = $(elementId);
        el.textContent = mensaje;
        el.hidden = false;
        if (campoId) {
            const campo = $(campoId);
            if (campo) {
                campo.setAttribute('aria-invalid', 'true');
                campo.focus();
            }
        }
    }

    ocultarError(elementId) {
        const el = $(elementId);
        if (!el) return;
        el.textContent = '';
        el.hidden = true;
        el.closest('dialog, form')?.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
    }

    /** Aviso transitorio (lib/avisos.js): reemplaza al toast propio de esta pantalla. */
    mostrarToast(message, type = 'info') {
        window.avisos.mostrar(message, type);
    }
}

window.comicioComponent = new ComicioComponent();
})();
