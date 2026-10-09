/**
 * Componente de armado de listas electorales (borradores): alta, edicion y baja de
 * listas con sus candidatos, en tarjetas que se editan directo en la pagina. No hay
 * modal ni pantalla de detalle: ver una lista completa (candidatos, orden, suplentes,
 * notas) no requiere abrir nada aparte.
 *
 * El orden de un candidato o de un suplente es su posicion en el array de edicion, no
 * un campo que la persona tipea: mover una fila con las flechas recalcula el orden de
 * todos. Es lo que el service del backend exige (1..N sin huecos) sin pedirle a nadie
 * que numere a mano.
 *
 * Cada tarjeta tiene su propio estado "sin guardar": el guardado sigue siendo un
 * reemplazo completo (POST/PUT), no hay autosave por campo.
 */
class ListasComponent {
    constructor() {
        this.container = null;
        this.listas = []; // estado de edicion por lista: { id|null, nombre, tipoEleccion, cantidadLugares, candidatos, sucia, guardando, error, expandido:Map }
        this.filtroTipo = '';
        this.cargando = false;
        this.tiposEleccion = ['provincial', 'municipal', 'nacional'];
        this.contadorNuevas = 0; // ids temporales negativos para tarjetas todavia no guardadas
    }

    async init(containerId = 'listas-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Contenedor ${containerId} no encontrado`);
        }

        this.crearInterfaz();
        this.inicializarEventosGlobales();
        await this.cargarListas();
        return true;
    }

    crearInterfaz() {
        this.container.innerHTML = `
            <div class="listas-header">
                <div class="listas-title">
                    <h1><i class="fas fa-list-ol" aria-hidden="true"></i> Armado de listas</h1>
                    <p class="listas-subtitle">Borradores de listas electorales: candidatos, orden, suplentes y notas</p>
                </div>
                <div class="listas-actions">
                    <button id="btn-crear-lista" class="btn btn-primary" aria-label="Nueva lista">
                        <i class="fas fa-plus" aria-hidden="true"></i> <span class="btn-text">Nueva lista</span>
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

            <datalist id="sugerencias-nombres"></datalist>

            <div id="listas-loading" class="listas-loading" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i> Cargando listas...
            </div>
            <div id="listas-empty" class="listas-empty" style="display: none;">
                <i class="fas fa-folder-open"></i>
                <p>No hay listas cargadas todavía</p>
            </div>
            <div id="listas-cards" class="listas-cards"></div>

            <div id="toast-container" class="toast-container"></div>
        `;
    }

    inicializarEventosGlobales() {
        document.getElementById('btn-crear-lista').addEventListener('click', () => this.agregarTarjetaNueva());

        document.getElementById('filtro-tipo-eleccion').addEventListener('change', (e) => {
            this.filtroTipo = e.target.value;
            this.renderizarTarjetas();
        });

        // Delegado sobre el contenedor de tarjetas: las tarjetas se recrean en cada render.
        const cards = document.getElementById('listas-cards');

        cards.addEventListener('click', (e) => this.manejarClick(e));

        cards.addEventListener('input', (e) => this.manejarInput(e));

        cards.addEventListener('submit', (e) => {
            if (e.target.matches('form[data-form-lista]')) {
                e.preventDefault();
                const idx = Number(e.target.dataset.formLista);
                this.guardarLista(idx);
            }
        });
    }

    // ---- Carga ----

    async cargarListas() {
        this.cargando = true;
        document.getElementById('listas-loading').style.display = 'flex';
        document.getElementById('listas-cards').style.display = 'none';
        document.getElementById('listas-empty').style.display = 'none';

        try {
            // El techo de 100 lo aplica el servidor igual; se pide explicito para que
            // quede claro que esta pantalla no pagina (el volumen esperado es bajo).
            const response = await window.apiService.obtenerListas({ limite: 100 });
            if (response.success) {
                this.listas = response.data.map((lista) => this.aEstadoEdicion(lista));
                this.actualizarSugerencias();
                this.renderizarTarjetas();
            }
        } catch (error) {
            console.error('Error cargando listas:', error);
            this.mostrarToast('Error al cargar listas: ' + error.message, 'error');
        } finally {
            this.cargando = false;
            document.getElementById('listas-loading').style.display = 'none';
        }
    }

    aEstadoEdicion(lista) {
        return {
            id: lista.id,
            nombre: lista.nombre,
            tipoEleccion: lista.tipo_eleccion,
            cantidadLugares: lista.cantidad_lugares,
            createdAt: lista.created_at,
            candidatos: (lista.candidatos || [])
                .slice()
                .sort((a, b) => a.orden - b.orden)
                .map((c) => ({
                    nombre: c.nombre,
                    notas: c.notas || '',
                    detalleAbierto: false,
                    suplentes: (c.suplentes || []).slice().sort((a, b) => a.orden - b.orden).map((s) => ({ nombre: s.nombre })),
                })),
            sucia: false,
            guardando: false,
            error: null,
        };
    }

    tarjetaVacia() {
        this.contadorNuevas += 1;
        return {
            id: null,
            clientId: `nueva-${this.contadorNuevas}`,
            nombre: '',
            tipoEleccion: '',
            cantidadLugares: '',
            createdAt: null,
            candidatos: [{ nombre: '', notas: '', detalleAbierto: false, suplentes: [] }, { nombre: '', notas: '', detalleAbierto: false, suplentes: [] }],
            sucia: true,
            guardando: false,
            error: null,
        };
    }

    actualizarSugerencias() {
        const nombres = new Set();
        for (const lista of this.listas) {
            for (const candidato of lista.candidatos) {
                if (candidato.nombre) nombres.add(candidato.nombre);
                for (const suplente of candidato.suplentes) {
                    if (suplente.nombre) nombres.add(suplente.nombre);
                }
            }
        }
        document.getElementById('sugerencias-nombres').innerHTML = [...nombres]
            .sort()
            .map((n) => `<option value="${escaparHtml(n)}"></option>`)
            .join('');
    }

    // ---- Alta de tarjeta ----

    agregarTarjetaNueva() {
        this.listas.unshift(this.tarjetaVacia());
        this.renderizarTarjetas();
        const primerInput = document.querySelector('.lista-card .lista-input-nombre');
        if (primerInput) primerInput.focus();
    }

    // ---- Render ----

    getListasFiltradas() {
        const indices = this.listas.map((_, i) => i);
        if (!this.filtroTipo) return indices;
        return indices.filter((i) => this.listas[i].tipoEleccion === this.filtroTipo);
    }

    renderizarTarjetas() {
        const indices = this.getListasFiltradas();
        const cont = document.getElementById('listas-cards');
        const empty = document.getElementById('listas-empty');
        const count = document.getElementById('listas-count');

        count.textContent = `${indices.length} lista${indices.length !== 1 ? 's' : ''}`;

        if (indices.length === 0) {
            cont.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        cont.style.display = 'flex';
        empty.style.display = 'none';
        cont.innerHTML = indices.map((i) => this.renderizarTarjeta(i)).join('');
    }

    renderizarTarjeta(indice) {
        const lista = this.listas[indice];
        const esNueva = lista.id === null;

        return `
            <article class="lista-card ${lista.sucia ? 'lista-card-sucia' : ''}" data-indice="${indice}">
                <form data-form-lista="${indice}">
                    <header class="lista-card-header">
                        <div class="lista-card-datos">
                            <input type="text" class="form-input lista-input-nombre" data-campo="nombre"
                                placeholder="Nombre de la lista" maxlength="200" required value="${escaparHtml(lista.nombre)}">
                            <select class="form-input lista-input-tipo" data-campo="tipoEleccion" required>
                                <option value="" ${lista.tipoEleccion ? '' : 'selected'}>Tipo...</option>
                                ${this.tiposEleccion.map((t) => `<option value="${t}" ${lista.tipoEleccion === t ? 'selected' : ''}>${this.formatearTipo(t)}</option>`).join('')}
                            </select>
                            <input type="number" class="form-input lista-input-lugares" data-campo="cantidadLugares"
                                placeholder="Lugares" min="1" step="1" required value="${escaparHtml(String(lista.cantidadLugares))}">
                        </div>
                        <div class="lista-card-acciones">
                            ${lista.sucia ? '<span class="lista-estado">Sin guardar</span>' : ''}
                            <button type="submit" class="btn-guardar-lista" ${lista.guardando ? 'disabled' : ''}>
                                <i class="fas ${lista.guardando ? 'fa-spinner fa-spin' : 'fa-save'}"></i> Guardar
                            </button>
                            ${esNueva
                                ? `<button type="button" class="btn-accion" data-accion="cancelar-nueva" title="Descartar"><i class="fas fa-times"></i></button>`
                                : `<button type="button" class="btn-accion btn-eliminar" data-accion="eliminar-lista" title="Eliminar lista"><i class="fas fa-trash"></i></button>`}
                        </div>
                    </header>

                    ${lista.error ? `<div class="form-error">${escaparHtml(lista.error)}</div>` : ''}

                    <ul class="candidatos-lista">
                        ${lista.candidatos.map((c, i) => this.renderizarCandidato(c, i, lista.candidatos.length)).join('')}
                    </ul>
                    <button type="button" class="btn btn-secondary btn-sm" data-accion="agregar-candidato">
                        <i class="fas fa-user-plus"></i> Agregar candidato
                    </button>
                </form>
            </article>
        `;
    }

    renderizarCandidato(candidato, indice, total) {
        const tieneDetalle = !!candidato.notas || candidato.suplentes.length > 0;
        return `
            <li class="candidato-fila" data-candidato-indice="${indice}">
                <div class="candidato-fila-principal">
                    <span class="candidato-orden">${indice + 1}</span>
                    <input type="text" class="form-input candidato-nombre" data-campo="nombre-candidato"
                        list="sugerencias-nombres" placeholder="Nombre del candidato" maxlength="200" required
                        value="${escaparHtml(candidato.nombre)}">
                    <div class="candidato-acciones">
                        <button type="button" class="btn-accion" data-accion="subir-candidato" title="Subir" ${indice === 0 ? 'disabled' : ''}>
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button type="button" class="btn-accion" data-accion="bajar-candidato" title="Bajar" ${indice === total - 1 ? 'disabled' : ''}>
                            <i class="fas fa-arrow-down"></i>
                        </button>
                        <button type="button" class="btn-accion ${tieneDetalle ? 'btn-accion-activa' : ''}" data-accion="toggle-detalle" title="Notas y suplentes">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button type="button" class="btn-accion btn-eliminar" data-accion="quitar-candidato" title="Quitar">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                ${candidato.detalleAbierto ? this.renderizarDetalleCandidato(candidato, indice) : ''}
            </li>
        `;
    }

    renderizarDetalleCandidato(candidato, indice) {
        return `
            <div class="candidato-detalle">
                <div class="form-group">
                    <label>Notas</label>
                    <textarea class="form-input candidato-notas" data-campo="notas-candidato" maxlength="2000"
                        placeholder="Observaciones internas, ej: confirmar DNI">${escaparHtml(candidato.notas)}</textarea>
                </div>
                <div class="suplentes-editor">
                    <label>Suplentes</label>
                    <ul class="suplentes-lista">
                        ${candidato.suplentes.map((s, i) => this.renderizarSuplente(s, i, candidato.suplentes.length)).join('')}
                    </ul>
                    <button type="button" class="btn btn-secondary btn-sm" data-accion="agregar-suplente">
                        <i class="fas fa-user-plus"></i> Agregar suplente
                    </button>
                </div>
            </div>
        `;
    }

    renderizarSuplente(suplente, indice, total) {
        return `
            <li class="suplente-fila" data-suplente-indice="${indice}">
                <span class="candidato-orden candidato-orden-sm">${indice + 1}</span>
                <input type="text" class="form-input suplente-nombre" data-campo="nombre-suplente"
                    list="sugerencias-nombres" placeholder="Nombre del suplente" maxlength="200" required
                    value="${escaparHtml(suplente.nombre)}">
                <div class="candidato-acciones">
                    <button type="button" class="btn-accion" data-accion="subir-suplente" title="Subir" ${indice === 0 ? 'disabled' : ''}>
                        <i class="fas fa-arrow-up"></i>
                    </button>
                    <button type="button" class="btn-accion" data-accion="bajar-suplente" title="Bajar" ${indice === total - 1 ? 'disabled' : ''}>
                        <i class="fas fa-arrow-down"></i>
                    </button>
                    <button type="button" class="btn-accion btn-eliminar" data-accion="quitar-suplente" title="Quitar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </li>
        `;
    }

    // ---- Eventos delegados ----

    manejarInput(e) {
        const tarjeta = e.target.closest('.lista-card');
        if (!tarjeta) return;
        const indice = Number(tarjeta.dataset.indice);
        const lista = this.listas[indice];
        if (!lista) return;

        const campo = e.target.dataset.campo;
        let manejado = true;

        if (campo === 'nombre') lista.nombre = e.target.value;
        else if (campo === 'tipoEleccion') lista.tipoEleccion = e.target.value;
        else if (campo === 'cantidadLugares') lista.cantidadLugares = e.target.value;
        else {
            const filaCandidato = e.target.closest('[data-candidato-indice]');
            const candidato = filaCandidato ? lista.candidatos[Number(filaCandidato.dataset.candidatoIndice)] : null;

            if (candidato && campo === 'nombre-candidato') candidato.nombre = e.target.value;
            else if (candidato && campo === 'notas-candidato') candidato.notas = e.target.value;
            else if (candidato && campo === 'nombre-suplente') {
                const filaSuplente = e.target.closest('[data-suplente-indice]');
                const suplente = filaSuplente ? candidato.suplentes[Number(filaSuplente.dataset.suplenteIndice)] : null;
                if (suplente) suplente.nombre = e.target.value;
                else manejado = false;
            } else manejado = false;
        }

        if (!manejado) return;
        lista.sucia = true;
        // Marca visual de "sin guardar" sin volver a renderizar todo (se perderia el foco).
        this.marcarSucia(tarjeta, lista);
    }

    marcarSucia(tarjeta, lista) {
        if (!tarjeta.classList.contains('lista-card-sucia')) {
            tarjeta.classList.add('lista-card-sucia');
            const acciones = tarjeta.querySelector('.lista-card-acciones');
            if (acciones && !acciones.querySelector('.lista-estado')) {
                acciones.insertAdjacentHTML('afterbegin', '<span class="lista-estado">Sin guardar</span>');
            }
        }
    }

    manejarClick(e) {
        const tarjeta = e.target.closest('.lista-card');
        if (!tarjeta) return;
        const indice = Number(tarjeta.dataset.indice);
        const lista = this.listas[indice];
        if (!lista) return;

        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        const accion = boton.dataset.accion;

        if (accion === 'eliminar-lista') return this.eliminarLista(indice);
        if (accion === 'cancelar-nueva') return this.descartarTarjeta(indice);
        if (accion === 'agregar-candidato') return this.agregarCandidato(indice);

        const filaCandidato = e.target.closest('[data-candidato-indice]');
        if (!filaCandidato) return;
        const ci = Number(filaCandidato.dataset.candidatoIndice);

        if (accion === 'subir-candidato') return this.moverCandidato(indice, ci, ci - 1);
        if (accion === 'bajar-candidato') return this.moverCandidato(indice, ci, ci + 1);
        if (accion === 'quitar-candidato') return this.quitarCandidato(indice, ci);
        if (accion === 'toggle-detalle') return this.toggleDetalle(indice, ci);
        if (accion === 'agregar-suplente') return this.agregarSuplente(indice, ci);

        const filaSuplente = e.target.closest('[data-suplente-indice]');
        if (!filaSuplente) return;
        const si = Number(filaSuplente.dataset.suplenteIndice);

        if (accion === 'subir-suplente') return this.moverSuplente(indice, ci, si, si - 1);
        if (accion === 'bajar-suplente') return this.moverSuplente(indice, ci, si, si + 1);
        if (accion === 'quitar-suplente') return this.quitarSuplente(indice, ci, si);
    }

    // ---- Edicion: candidatos ----

    agregarCandidato(indice) {
        // Mismo tope que el servidor (TOPE_CANDIDATOS = 60): sin esto el 400 aparece recien al guardar (FE-036).
        if (this.listas[indice].candidatos.length >= 60) {
            this.mostrarToast('Una lista admite hasta 60 candidatos', 'error');
            return;
        }
        this.listas[indice].candidatos.push({ nombre: '', notas: '', detalleAbierto: false, suplentes: [] });
        this.listas[indice].sucia = true;
        this.renderizarTarjetas();
        const filas = document.querySelectorAll(`.lista-card[data-indice="${indice}"] .candidato-nombre`);
        if (filas.length) filas[filas.length - 1].focus();
    }

    moverCandidato(indice, desde, hacia) {
        const candidatos = this.listas[indice].candidatos;
        if (hacia < 0 || hacia >= candidatos.length) return;
        const [item] = candidatos.splice(desde, 1);
        candidatos.splice(hacia, 0, item);
        this.listas[indice].sucia = true;
        this.renderizarTarjetas();
    }

    quitarCandidato(indice, ci) {
        this.listas[indice].candidatos.splice(ci, 1);
        this.listas[indice].sucia = true;
        this.renderizarTarjetas();
    }

    toggleDetalle(indice, ci) {
        const candidato = this.listas[indice].candidatos[ci];
        candidato.detalleAbierto = !candidato.detalleAbierto;
        this.renderizarTarjetas();
    }

    // ---- Edicion: suplentes ----

    agregarSuplente(indice, ci) {
        // TOPE_SUPLENTES = 10 en el servidor (FE-036).
        if (this.listas[indice].candidatos[ci].suplentes.length >= 10) {
            this.mostrarToast('Un candidato admite hasta 10 suplentes', 'error');
            return;
        }
        this.listas[indice].candidatos[ci].suplentes.push({ nombre: '' });
        this.listas[indice].sucia = true;
        this.renderizarTarjetas();
        const filas = document.querySelectorAll(`.lista-card[data-indice="${indice}"] [data-candidato-indice="${ci}"] .suplente-nombre`);
        if (filas.length) filas[filas.length - 1].focus();
    }

    moverSuplente(indice, ci, desde, hacia) {
        const suplentes = this.listas[indice].candidatos[ci].suplentes;
        if (hacia < 0 || hacia >= suplentes.length) return;
        const [item] = suplentes.splice(desde, 1);
        suplentes.splice(hacia, 0, item);
        this.listas[indice].sucia = true;
        this.renderizarTarjetas();
    }

    quitarSuplente(indice, ci, si) {
        this.listas[indice].candidatos[ci].suplentes.splice(si, 1);
        this.listas[indice].sucia = true;
        this.renderizarTarjetas();
    }

    // ---- Descarte / eliminacion ----

    descartarTarjeta(indice) {
        this.listas.splice(indice, 1);
        this.renderizarTarjetas();
    }

    async eliminarLista(indice) {
        const lista = this.listas[indice];
        const confirmado = confirm(`¿Eliminar la lista "${lista.nombre}"? Esta acción no se puede deshacer.`);
        if (!confirmado) return;

        try {
            const response = await window.apiService.eliminarLista(lista.id);
            if (response.success) {
                this.mostrarToast('Lista eliminada', 'success');
                this.listas.splice(indice, 1);
                this.actualizarSugerencias();
                this.renderizarTarjetas();
            }
        } catch (error) {
            this.mostrarToast('Error al eliminar: ' + error.message, 'error');
        }
    }

    // ---- Guardado ----

    async guardarLista(indice) {
        const lista = this.listas[indice];
        lista.error = null;

        const nombre = lista.nombre.trim();
        const tipoEleccion = lista.tipoEleccion;
        const cantidadLugares = Number(lista.cantidadLugares);

        if (!nombre) return this.marcarError(indice, 'El nombre de la lista es obligatorio');
        if (!tipoEleccion) return this.marcarError(indice, 'Elegí un tipo de elección');
        if (!Number.isInteger(cantidadLugares) || cantidadLugares <= 0) {
            return this.marcarError(indice, 'La cantidad de lugares tiene que ser un entero positivo');
        }
        if (lista.candidatos.length === 0) return this.marcarError(indice, 'Cargá al menos un candidato');
        if (lista.candidatos.some((c) => !c.nombre.trim())) {
            return this.marcarError(indice, 'Hay un candidato sin nombre');
        }
        if (lista.candidatos.some((c) => c.suplentes.some((s) => !s.nombre.trim()))) {
            return this.marcarError(indice, 'Hay un suplente sin nombre');
        }

        const candidatos = lista.candidatos.map((c, i) => ({
            nombre: c.nombre.trim(),
            orden: i + 1,
            notas: c.notas.trim() || null,
            suplentes: c.suplentes.map((s, si) => ({ nombre: s.nombre.trim(), orden: si + 1 })),
        }));

        lista.guardando = true;
        this.renderizarTarjetas();

        try {
            const data = { nombre, tipoEleccion, cantidadLugares, candidatos };
            const response = lista.id
                ? await window.apiService.actualizarLista(lista.id, data)
                : await window.apiService.crearLista(data);

            if (response.success) {
                this.mostrarToast(lista.id ? 'Lista actualizada' : 'Lista creada', 'success');
                this.listas[indice] = this.aEstadoEdicion(response.data);
                this.actualizarSugerencias();
                this.renderizarTarjetas();
            }
        } catch (error) {
            lista.guardando = false;
            this.marcarError(indice, error.message || 'Error al guardar la lista');
        }
    }

    marcarError(indice, mensaje) {
        this.listas[indice].error = mensaje;
        this.listas[indice].guardando = false;
        this.renderizarTarjetas();
    }

    // ---- Helpers ----

    formatearTipo(tipo) {
        const nombres = { provincial: 'Provincial', municipal: 'Municipal', nacional: 'Nacional' };
        return nombres[tipo] || tipo;
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
