/**
 * Mapa por manzana y barrio (018).
 *
 * Dibuja las manzanas y los radios censales de la localidad en un SVG propio (sin librerias ni teselas de
 * terceros), pintados por avance de relevamiento o por opcion lider. Al tocar una zona muestra toda su
 * informacion: la de la manzana Y la de su barrio, a la vez. Para una manzana, ademas, la lista de votantes
 * para el casa por casa.
 *
 * Lo que este componente NO decide: que se puede mostrar. El umbral de privacidad lo aplica el servidor; si
 * una zona viene con `desglose_oculto`, aca solo se explica por que falta el desglose.
 *
 * Todo texto que viene del servidor (nombres de calle y de barrio, domicilios, etiquetas de opcion) se escapa
 * con escaparHtml, o se escribe con textContent.
 */
class MapaComponent {
    constructor() {
        this.contenedor = null;
        this.geo = null;
        this.stats = null;
        this.nivel = 'manzana';
        this.color = 'avance';
        this.seleccion = null;
        this.pestana = 'estadisticas';
        this.pedido = 0;
        this.vista = 'mapa';
    }

    async init(idContenedor = 'mapa-container') {
        this.contenedor = document.getElementById(idContenedor);
        if (!this.contenedor) throw new Error(`Contenedor ${idContenedor} no encontrado`);
        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargar();
        return true;
    }

    api(ruta, opciones) {
        return window.apiService.request(`/api/territorio${ruta}`, opciones).then((r) => r.data);
    }

    // ------------------------------------------------------------ estructura

    crearInterfaz() {
        this.contenedor.innerHTML = `
            <div class="mapa-header">
                <div>
                    <h1><i class="fas fa-map" aria-hidden="true"></i> Mapa</h1>
                    <p class="mapa-subtitulo" id="mapa-subtitulo">Cargando…</p>
                </div>
                <button id="btn-recalcular" class="btn btn-secondary" type="button">
                    <i class="fas fa-sync"></i> Recalcular ubicaciones
                </button>
            </div>

            <div class="mapa-barra">
                <div class="segmentado" role="group" aria-label="Nivel del mapa">
                    <button type="button" data-nivel="manzana" aria-pressed="true">Manzanas</button>
                    <button type="button" data-nivel="barrio" aria-pressed="false" id="btn-nivel-barrio">Radios censales</button>
                </div>
                <div class="segmentado" role="group" aria-label="Qué pintar">
                    <button type="button" data-color="avance" aria-pressed="true">Avance</button>
                    <button type="button" data-color="lider" aria-pressed="false">Opción líder</button>
                </div>
                <button type="button" class="btn btn-secondary" id="btn-vista" aria-pressed="false">
                    <i class="fas fa-list" aria-hidden="true"></i> <span>Ver como lista</span>
                </button>
                <button type="button" class="mapa-sin-ubicar" id="btn-sin-ubicar">
                    <i class="fas fa-exclamation-triangle"></i> <span id="texto-sin-ubicar">…</span>
                </button>
            </div>

            <div class="mapa-cuerpo">
                <div class="mapa-columna">
                    <div class="mapa-lienzo" id="mapa-lienzo"><p class="mapa-vacio">Cargando el mapa…</p></div>
                    <div class="mapa-leyenda" id="mapa-leyenda" role="group" aria-label="Referencias"></div>
                </div>
                <aside class="mapa-panel" id="mapa-panel" aria-live="polite">
                    <p class="mapa-vacio">Tocá una manzana para ver sus datos y los de su radio censal.</p>
                </aside>
            </div>
        `;
    }

    inicializarEventos() {
        const $ = (id) => document.getElementById(id);

        this.contenedor.querySelectorAll('[data-nivel]').forEach((b) => b.addEventListener('click', () => {
            this.nivel = b.dataset.nivel;
            this.marcarBotones('[data-nivel]', this.nivel, 'nivel');
            this.dibujar();
        }));
        this.contenedor.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
            this.color = b.dataset.color;
            this.marcarBotones('[data-color]', this.color, 'color');
            this.dibujar();
            this.dibujarLeyenda();
        }));

        // Una sola delegacion para todas las zonas del mapa: el SVG se redibuja entero.
        const lienzo = $('mapa-lienzo');
        const elegir = (evento) => {
            const zona = evento.target.closest('[data-interactiva]');
            if (zona) this.seleccionar(zona.dataset.tipo, Number(zona.dataset.id));
        };
        lienzo.addEventListener('click', elegir);
        lienzo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(e); }
        });

        $('mapa-panel').addEventListener('click', (e) => {
            const boton = e.target.closest('button[data-accion]');
            if (!boton) return;
            const { accion } = boton.dataset;
            if (accion === 'pestana') { this.pestana = boton.dataset.pestana; this.enfocarTab = true; this.mostrarPestana(); }
            if (accion === 'pagina') this.mostrarLista(Number(boton.dataset.pagina));
        });

        $('btn-sin-ubicar').addEventListener('click', () => this.mostrarSinUbicar());

        $('btn-recalcular').addEventListener('click', () => this.abrirRecalcular());

        // Vista alternativa a la del dibujo: la misma información como lista operable.
        $('btn-vista').addEventListener('click', () => {
            this.vista = this.vista === 'lista' ? 'mapa' : 'lista';
            this.actualizarBotonVista();
            this.dibujar();
        });

        // Tabs del panel (manzana): flechas, Inicio y Fin; el foco se queda en la pestaña.
        $('mapa-panel').addEventListener('keydown', (e) => {
            const tab = e.target.closest('[role="tab"]');
            if (!tab) return;
            const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
            const i = tabs.indexOf(tab);
            let j = null;
            if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') j = 0;
            else if (e.key === 'End') j = tabs.length - 1;
            if (j === null) return;
            e.preventDefault();
            this.enfocarTab = true;
            this.pestana = tabs[j].dataset.pestana;
            this.mostrarPestana();
        });
    }

    actualizarBotonVista() {
        const boton = document.getElementById('btn-vista');
        const lista = this.vista === 'lista';
        boton.setAttribute('aria-pressed', String(lista));
        boton.querySelector('span').textContent = lista ? 'Ver el mapa' : 'Ver como lista';
    }

    marcarBotones(selector, valor, clave) {
        this.contenedor.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[clave] === valor)));
    }

    // ------------------------------------------------------------ datos

    async cargar() {
        try {
            const [geo, stats] = await Promise.all([
                this.api('/geometria'),
                this.api('/estadisticas'),
                window.opcionesPoliticas.cargar(),
            ]);
            this.geo = geo;
            this.stats = stats;
        } catch (error) {
            document.getElementById('mapa-lienzo').innerHTML = `<p class="mapa-vacio">No se pudo cargar el mapa: ${escaparHtml(error.message)}</p>`;
            return;
        }

        const conf = this.stats.configuracion;
        document.getElementById('btn-nivel-barrio').textContent = this.plural(conf.etiquetaBarrio);

        if (!this.geo.manzanas.length) {
            document.getElementById('mapa-subtitulo').textContent = 'Todavía no se cargaron las calles y manzanas de la localidad.';
            document.getElementById('mapa-lienzo').innerHTML =
                '<p class="mapa-vacio">El mapa se habilita cuando se cargan las capas de la localidad (lo hace quien administra el sistema).</p>';
            return;
        }
        this.mostrarResumen();
        this.dibujar();
        this.dibujarLeyenda();
    }

    /** "Radio censal" -> "Radios censales"; cualquier otra etiqueta, con una "s". */
    plural(etiqueta) {
        if (/^radio censal$/i.test(etiqueta)) return 'Radios censales';
        return /s$/i.test(etiqueta) ? etiqueta : `${etiqueta}s`;
    }

    mostrarResumen() {
        const { resumen, configuracion } = this.stats;
        const n = (x) => Number(x || 0).toLocaleString('es-AR');
        const pct = resumen.total ? Math.round((resumen.ubicados * 100) / resumen.total) : 0;
        document.getElementById('mapa-subtitulo').textContent =
            `${configuracion.localidad || ''} · ${n(resumen.ubicados)} de ${n(resumen.total)} votantes ubicados en una manzana (${pct} %)`;
        const sinUbicar = resumen.sinUbicar + resumen.sinCalcular;
        document.getElementById('texto-sin-ubicar').textContent = `${n(sinUbicar)} sin ubicar`;
    }

    // ------------------------------------------------------------ dibujo

    claseColor(zona) {
        if (!zona || !zona.votantes) return 'mapa-n0';
        if (this.color === 'avance') return `mapa-n${Math.min(5, 1 + Math.floor(zona.avance / 20))}`;
        if (zona.desglose_oculto || !zona.lider) return 'mapa-n0';
        return `op-relleno ${window.opcionesPoliticas.clase(zona.lider)}`;
    }

    etiqueta(tipo, entidad, zona) {
        const nombre = tipo === 'manzana' ? `Manzana ${entidad.id}` : entidad.nombre;
        if (!zona || !zona.votantes) return `${nombre}: sin votantes ubicados`;
        return `${nombre}: ${zona.votantes} votantes, ${zona.avance} % relevado`;
    }

    dibujar() {
        if (!this.geo || !this.geo.manzanas.length) return;
        const NS = 'http://www.w3.org/2000/svg';
        const { crearProyeccion, pathDe } = window.geometriaSvg;
        // Se encuadra con las manzanas: un radio censal del borde puede tener kilometros de campo, y
        // encuadrarlo dejaria al pueblo como un punto. Lo que sobresale del cuadro se recorta.
        const anillos = this.geo.manzanas.flatMap((z) => z.anillos);
        const { ancho, alto, proyectar } = crearProyeccion(anillos, 1000);

        const porManzana = new Map(this.stats.manzanas.map((m) => [m.id, m]));
        const porBarrio = new Map(this.stats.barrios.map((b) => [b.id, b]));

        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
        svg.setAttribute('class', 'mapa-svg');
        svg.setAttribute('role', 'group');
        svg.setAttribute('aria-label', `Mapa por ${this.nivel === 'manzana' ? 'manzana' : this.stats.configuracion.etiquetaBarrio.toLowerCase()}`);

        const zona = (tipo, entidad, datos, interactiva) => {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', pathDe(entidad.anillos, proyectar));
            p.setAttribute('fill-rule', 'evenodd');
            p.dataset.tipo = tipo;
            p.dataset.id = entidad.id;
            if (interactiva) {
                p.setAttribute('class', `zona ${this.claseColor(datos)}`);
                p.dataset.interactiva = '1';
                p.setAttribute('tabindex', '0');
                p.setAttribute('role', 'button');
                p.setAttribute('aria-label', this.etiqueta(tipo, entidad, datos));
                const titulo = document.createElementNS(NS, 'title');
                titulo.textContent = this.etiqueta(tipo, entidad, datos);
                p.appendChild(titulo);
                if (this.seleccion && this.seleccion.tipo === tipo && this.seleccion.id === Number(entidad.id)) p.classList.add('seleccionada');
            } else {
                p.setAttribute('class', `contorno contorno-${tipo}`);
            }
            return p;
        };

        // El nivel elegido se pinta y se puede tocar; el otro queda de referencia, solo con su borde.
        if (this.nivel === 'manzana') {
            this.geo.manzanas.forEach((m) => svg.appendChild(zona('manzana', m, porManzana.get(m.id), true)));
            this.geo.barrios.forEach((b) => svg.appendChild(zona('barrio', b, null, false)));
        } else {
            // Un radio censal del borde llega kilometros al campo: se dibuja recortado a la forma de las
            // manzanas, asi se ve el pueblo pintado por radio. Sigue siendo UN elemento por radio para tocar
            // y para el teclado (el recorte tambien limita donde se puede tocar).
            const defs = document.createElementNS(NS, 'defs');
            const recorte = document.createElementNS(NS, 'clipPath');
            recorte.setAttribute('id', 'mapa-recorte-manzanas');
            const forma = document.createElementNS(NS, 'path');
            forma.setAttribute('d', this.geo.manzanas.map((m) => pathDe(m.anillos, proyectar)).join(' '));
            recorte.appendChild(forma);
            defs.appendChild(recorte);
            svg.appendChild(defs);

            this.geo.barrios.forEach((b) => {
                const p = zona('barrio', b, porBarrio.get(b.id), true);
                p.setAttribute('clip-path', 'url(#mapa-recorte-manzanas)');
                svg.appendChild(p);
            });
            this.geo.manzanas.forEach((m) => svg.appendChild(zona('manzana', m, null, false)));
            // Con un radio elegido, los demas se atenuan: su borde va por las calles y el recorte lo esconde.
            if (this.seleccion && this.seleccion.tipo === 'barrio') svg.classList.add('con-seleccion');
        }

        const lienzo = document.getElementById('mapa-lienzo');
        if (this.vista === 'lista') {
            lienzo.replaceChildren(this.construirLista(porManzana, porBarrio));
            return;
        }
        lienzo.replaceChildren(svg);

        // Un solo tope de tabulación (roving): con cientos de manzanas, un Tab por cada una
        // dejaría el mapa impracticable con teclado. Entre zonas se mueve con las flechas.
        const zonas = [...svg.querySelectorAll('[data-interactiva]')];
        zonas.forEach((p, i) => p.setAttribute('tabindex', i === 0 ? '0' : '-1'));
        svg.addEventListener('keydown', (e) => {
            const i = zonas.indexOf(document.activeElement);
            if (i < 0) return;
            let j = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(i + 1, zonas.length - 1);
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(i - 1, 0);
            else if (e.key === 'Home') j = 0;
            else if (e.key === 'End') j = zonas.length - 1;
            if (j === null) return;
            e.preventDefault();
            zonas[i].setAttribute('tabindex', '-1');
            zonas[j].setAttribute('tabindex', '0');
            zonas[j].focus();
        });
    }

    /**
     * La misma información del dibujo como tabla: nombre, votantes y avance de cada zona del
     * nivel elegido, con un botón por fila que abre su panel. Es la alternativa para quien no
     * puede o no quiere recorrer un dibujo (teclado, lector de pantalla, pantallas chicas).
     */
    construirLista(porManzana, porBarrio) {
        const filas = this.nivel === 'manzana'
            ? this.geo.manzanas.map((m) => ({ tipo: 'manzana', id: m.id, nombre: `Manzana ${m.id}`, datos: porManzana.get(m.id) }))
            : this.geo.barrios.map((b) => ({ tipo: 'barrio', id: b.id, nombre: b.nombre, datos: porBarrio.get(b.id) }));
        filas.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));

        const contenedor = document.createElement('div');
        contenedor.className = 'tabla-contenedor mapa-lista';
        contenedor.setAttribute('role', 'region');
        contenedor.setAttribute('tabindex', '0');
        contenedor.setAttribute('aria-label', 'Zonas del mapa en lista');
        const n = (x) => Number(x || 0).toLocaleString('es-AR');
        contenedor.innerHTML = `
            <table class="tabla">
                <thead><tr><th scope="col">Zona</th><th scope="col" class="num">Votantes</th><th scope="col" class="num">Relevado</th><th scope="col"><span class="sr-only">Acción</span></th></tr></thead>
                <tbody>${filas.map((f) => `
                    <tr${this.seleccion && this.seleccion.tipo === f.tipo && this.seleccion.id === Number(f.id) ? ' aria-selected="true"' : ''}>
                        <th scope="row">${escaparHtml(f.nombre)}</th>
                        <td class="num">${f.datos && f.datos.votantes ? n(f.datos.votantes) : '—'}</td>
                        <td class="num">${f.datos && f.datos.votantes ? `${n(f.datos.avance)} %` : '—'}</td>
                        <td><button type="button" class="btn btn-secondary btn-sm" data-interactiva="1" data-tipo="${f.tipo}" data-id="${escaparHtml(f.id)}" aria-label="Ver datos de ${escaparHtml(f.nombre)}">Ver</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        return contenedor;
    }

    dibujarLeyenda() {
        const leyenda = document.getElementById('mapa-leyenda');
        const umbral = this.stats.configuracion.umbral;
        const item = (clase, texto) => `<span class="leyenda-item"><span class="leyenda-muestra ${clase}"></span>${escaparHtml(texto)}</span>`;
        if (this.color === 'avance') {
            leyenda.innerHTML = [
                item('mapa-n1', 'menos de 20 %'), item('mapa-n2', '20 a 40 %'), item('mapa-n3', '40 a 60 %'),
                item('mapa-n4', '60 a 80 %'), item('mapa-n5', '80 % o más'), item('mapa-n0', 'sin votantes ubicados'),
            ].join('');
        } else {
            leyenda.innerHTML = [
                ...window.opcionesPoliticas.lista().map((o) => item(`op-relleno ${window.opcionesPoliticas.clase(o)}`, o.etiqueta)),
                item('mapa-n0', `empate, o menos de ${umbral} relevados`),
            ].join('');
        }
    }

    // ------------------------------------------------------------ panel

    async seleccionar(tipo, id) {
        this.seleccion = { tipo, id };
        this.pestana = 'estadisticas';
        this.contenedor.querySelectorAll('path.seleccionada').forEach((p) => p.classList.remove('seleccionada'));
        this.contenedor.querySelector(`path[data-interactiva][data-tipo="${tipo}"][data-id="${id}"]`)?.classList.add('seleccionada');
        this.contenedor.querySelector('.mapa-svg')?.classList.toggle('con-seleccion', tipo === 'barrio');

        const panel = document.getElementById('mapa-panel');
        panel.innerHTML = '<p class="mapa-vacio">Cargando…</p>';
        const pedido = ++this.pedido;
        try {
            const z = await this.api(`/zonas/${tipo}/${id}`);
            // Dos clics seguidos: si vuelve primero la respuesta vieja, no se dibuja.
            if (pedido !== this.pedido) return;
            this.zonaActual = z;
            this.mostrarPestana();
        } catch (error) {
            if (pedido === this.pedido) panel.innerHTML = `<p class="mapa-vacio">No se pudo cargar la zona: ${escaparHtml(error.message)}</p>`;
        }
    }

    mostrarPestana() {
        const z = this.zonaActual;
        if (!z) return;
        const panel = document.getElementById('mapa-panel');
        const etiquetaBarrio = z.etiquetaBarrio || 'Radio censal';

        if (z.tipo === 'barrio') {
            panel.innerHTML = `<h2 class="panel-titulo">${escaparHtml(z.nombre)}</h2>${this.bloqueZona(z)}${this.bloqueCenso(z)}`;
            return;
        }

        const tab = (clave, texto) => `<button type="button" role="tab" id="mapa-tab-${clave}" aria-controls="mapa-tabpanel" data-accion="pestana" data-pestana="${clave}" aria-selected="${this.pestana === clave}" tabindex="${this.pestana === clave ? 0 : -1}">${texto}</button>`;
        const pestanas = `
            <div class="panel-pestanas" role="tablist" aria-label="Datos de la manzana">
                ${tab('estadisticas', 'Estadísticas')}
                ${z.barrio ? tab('barrio', escaparHtml(etiquetaBarrio)) : ''}
                ${tab('votantes', 'Votantes')}
            </div>`;
        const abrirPanel = `<div id="mapa-tabpanel" role="tabpanel" aria-labelledby="mapa-tab-${this.pestana}" tabindex="0">`;
        // Al cambiar de pestaña con el teclado el panel se redibuja entero: el foco vuelve a la pestaña activa.
        const devolverFoco = () => {
            if (!this.enfocarTab) return;
            this.enfocarTab = false;
            document.getElementById(`mapa-tab-${this.pestana}`)?.focus();
        };

        // Un radio censal que ya no corresponde (otra manzana sin radio) vuelve a las estadísticas.
        if (this.pestana === 'barrio' && !z.barrio) this.pestana = 'estadisticas';

        if (this.pestana === 'barrio') {
            panel.innerHTML = `<h2 class="panel-titulo">Manzana ${escaparHtml(z.id)}</h2>${pestanas}${abrirPanel}<h3 class="panel-subtitulo">${escaparHtml(etiquetaBarrio)}: ${escaparHtml(z.barrio.nombre)}</h3>${this.bloqueZona(z.barrio)}${this.bloqueCenso(z.barrio)}</div>`;
            devolverFoco();
            return;
        }

        if (this.pestana === 'votantes') {
            panel.innerHTML = `<h2 class="panel-titulo">Manzana ${escaparHtml(z.id)}</h2>${pestanas}${abrirPanel}<div id="panel-lista"><p class="mapa-vacio">Cargando…</p></div></div>`;
            devolverFoco();
            this.mostrarLista(1);
            return;
        }

        const sinBarrio = z.barrio
            ? ''
            : `<p class="mapa-vacio panel-barrio">Esta manzana no está dentro de ningún ${escaparHtml(etiquetaBarrio.toLowerCase())}.</p>`;
        panel.innerHTML = `
            <h2 class="panel-titulo">Manzana ${escaparHtml(z.id)}</h2>${pestanas}
            ${abrirPanel}${this.bloqueZona(z)}${sinBarrio}</div>`;
        devolverFoco();
    }

    bloqueCenso(b) {
        if (!b.censo2022 || b.censo2022.poblacion == null) return '';
        return `<p class="panel-nota">Censo 2022: ${Number(b.censo2022.poblacion).toLocaleString('es-AR')} habitantes,
            ${Number(b.censo2022.viviendas || 0).toLocaleString('es-AR')} viviendas.</p>`;
    }

    /** Las cifras y, si el servidor lo permite, el desglose completo de una zona. */
    bloqueZona(z) {
        const n = (x) => Number(x || 0).toLocaleString('es-AR');
        const cifras = `
            <dl class="panel-cifras">
                <div><dt>Votantes</dt><dd>${n(z.votantes)}</dd></div>
                <div><dt>Relevados</dt><dd>${n(z.relevados)}</dd></div>
                <div><dt>Avance</dt><dd>${escaparHtml(z.avance)} %</dd></div>
            </dl>`;
        if (z.desglose_oculto) {
            const umbral = (this.zonaActual && this.zonaActual.umbral) || this.stats.configuracion.umbral;
            return `${cifras}<p class="panel-aviso"><i class="fas fa-info-circle"></i> Con menos de ${n(umbral)} relevados no se muestra el
                desglose: con tan pocas personas, se podría saber qué respondió cada una.</p>`;
        }
        return cifras + this.barrasOpciones(z) + this.tablaCorte('Por sexo', z.porSexo, 'sexo')
            + this.tablaCorte('Por edad', z.porEdad, 'rango_etario') + this.tablaCondiciones(z.condiciones);
    }

    barrasOpciones(z) {
        const filas = window.opcionesPoliticas.lista().map((o) => {
            const votos = z.votos ? z.votos[o.codigo] || 0 : 0;
            const pct = z.porcentajes ? z.porcentajes[o.codigo] || 0 : 0;
            return `
                <div class="barra-opcion ${window.opcionesPoliticas.clase(o)}">
                    <span class="barra-nombre">${escaparHtml(o.etiqueta)}</span>
                    <span class="barra-pista"><span class="barra-relleno" style="width: ${Math.min(100, Number(pct))}%"></span></span>
                    <span class="barra-valor">${votos} (${pct} %)</span>
                </div>`;
        }).join('');
        return `<div class="panel-opciones">${filas}</div>`;
    }

    tablaCorte(titulo, filas, clave) {
        if (!Array.isArray(filas) || !filas.length) return '';
        const opciones = window.opcionesPoliticas.lista();
        const nombre = (v) => ({ M: 'Masculino', F: 'Femenino' }[v] || (v == null ? 'Sin dato' : v));
        const cuerpo = filas.map((f) => `
            <tr>
                <th scope="row">${escaparHtml(nombre(f[clave]))}</th>
                <td>${f.votantes}</td><td>${f.relevados}</td>
                ${f.desglose_oculto
                    ? `<td colspan="${opciones.length}" class="celda-oculta">menos de ${this.zonaActual.umbral} relevados</td>`
                    : opciones.map((o) => `<td>${f.votos ? f.votos[o.codigo] || 0 : 0}</td>`).join('')}
            </tr>`).join('');
        return `
            <details class="panel-corte" open>
                <summary>${escaparHtml(titulo)}</summary>
                <table class="panel-tabla">
                    <thead><tr><th></th><th>Votantes</th><th>Relevados</th>${opciones.map((o) => `<th>${escaparHtml(o.etiqueta)}</th>`).join('')}</tr></thead>
                    <tbody>${cuerpo}</tbody>
                </table>
            </details>`;
    }

    tablaCondiciones(condiciones) {
        if (!condiciones) return '';
        const opciones = window.opcionesPoliticas.lista();
        const NOMBRES = {
            empleados_municipales: 'Empleados municipales', ayuda_social: 'Ayuda social',
            nuevos_votantes: 'Nuevos votantes', fallecidos: 'Fallecidos',
        };
        const cuerpo = Object.entries(NOMBRES).map(([clave, nombre]) => {
            const c = condiciones[clave] || { total: 0, desglose_oculto: true };
            const resto = c.desglose_oculto
                ? `<td colspan="${opciones.length}" class="celda-oculta">${c.total ? 'pocos casos' : '—'}</td>`
                : opciones.map((o) => `<td>${c.por_opcion[o.codigo] || 0}</td>`).join('');
            return `<tr><th scope="row">${nombre}</th><td>${c.total}</td>${resto}</tr>`;
        }).join('');
        return `
            <details class="panel-corte">
                <summary>Condiciones especiales</summary>
                <table class="panel-tabla">
                    <thead><tr><th></th><th>Total</th>${opciones.map((o) => `<th>${escaparHtml(o.etiqueta)}</th>`).join('')}</tr></thead>
                    <tbody>${cuerpo}</tbody>
                </table>
            </details>`;
    }

    /** La lista de la manzana, para el casa por casa. Sin opcion politica: se ve en la ficha. */
    async mostrarLista(pagina) {
        const destino = document.getElementById('panel-lista');
        if (!destino || !this.zonaActual) return;
        const id = this.zonaActual.id;
        const pedido = ++this.pedido;
        try {
            const { votantes, paginacion } = await this.api(`/manzanas/${id}/votantes?pagina=${pagina}`);
            if (pedido !== this.pedido) return;
            if (!votantes.length) {
                destino.innerHTML = '<p class="mapa-vacio">No hay votantes ubicados en esta manzana.</p>';
                return;
            }
            const filas = votantes.map((v) => `
                <tr>
                    <td>${escaparHtml(v.apellido)}, ${escaparHtml(v.nombre)}</td>
                    <td>${escaparHtml(v.domicilio)}</td>
                    <td>${v.edad ?? ''}</td>
                    <td><span class="estado-relevado ${v.relevado ? 'si' : 'no'}">${v.relevado ? 'Relevado' : 'Pendiente'}</span></td>
                    <td><a href="index.html?dni=${encodeURIComponent(v.dni)}" class="enlace-ficha">Ficha</a></td>
                </tr>`).join('');
            const { pagina: p, paginas, total } = paginacion;
            destino.innerHTML = `
                <p class="panel-nota">${total} votantes, ordenados por calle y número.</p>
                <table class="panel-tabla panel-lista">
                    <thead><tr><th>Apellido y nombre</th><th>Domicilio</th><th>Edad</th><th>Estado</th><th></th></tr></thead>
                    <tbody>${filas}</tbody>
                </table>
                <div class="panel-paginas">
                    <button type="button" class="btn btn-secondary" data-accion="pagina" data-pagina="${p - 1}" ${p <= 1 ? 'disabled' : ''} aria-label="Página anterior"><i class="fas fa-chevron-left"></i></button>
                    <span>Página ${p} de ${paginas}</span>
                    <button type="button" class="btn btn-secondary" data-accion="pagina" data-pagina="${p + 1}" ${p >= paginas ? 'disabled' : ''} aria-label="Página siguiente"><i class="fas fa-chevron-right"></i></button>
                </div>`;
        } catch (error) {
            if (pedido === this.pedido) destino.innerHTML = `<p class="mapa-vacio">No se pudo cargar la lista: ${escaparHtml(error.message)}</p>`;
        }
    }

    async mostrarSinUbicar() {
        const panel = document.getElementById('mapa-panel');
        this.zonaActual = null;
        panel.innerHTML = '<p class="mapa-vacio">Cargando…</p>';
        const pedido = ++this.pedido;
        try {
            const s = await this.api('/sin-ubicar');
            if (pedido !== this.pedido) return;
            const motivos = s.motivos.map((m) => `
                <details class="panel-corte">
                    <summary>${escaparHtml(m.descripcion)} <strong>${m.votantes}</strong></summary>
                    ${m.detalles.length
                        ? `<ul class="panel-detalles">${m.detalles.map((d) => `<li>${escaparHtml(d.detalle)} <span>${d.votantes}</span></li>`).join('')}</ul>`
                        : ''}
                </details>`).join('');
            const sinCalcular = s.sinCalcular
                ? `<p class="panel-aviso">${s.sinCalcular} votantes cargados después del último cálculo: se ubican al recalcular.</p>` : '';
            panel.innerHTML = `
                <h3 class="panel-titulo">Votantes sin ubicar</h3>
                <p class="panel-nota">No se pudieron ubicar en una manzana a partir de su domicilio. Nunca se les inventa una ubicación.</p>
                ${sinCalcular}${motivos || '<p class="mapa-vacio">Todos los votantes están ubicados.</p>'}`;
        } catch (error) {
            if (pedido === this.pedido) panel.innerHTML = `<p class="mapa-vacio">${escaparHtml(error.message)}</p>`;
        }
    }

    // ------------------------------------------------------------ recalcular

    /** Confirmar con el diálogo del sistema (nativo: foco atrapado, Escape, fondo inerte). */
    async abrirRecalcular() {
        const acepto = await window.dialogo.confirmar({
            titulo: 'Recalcular ubicaciones',
            mensaje: 'Vuelve a ubicar a todo el padrón en las manzanas. Se hace solo al importar el padrón; hace falta a mano si se cargaron votantes uno por uno.',
            confirmar: 'Recalcular',
        });
        if (acepto) await this.recalcular();
    }

    async recalcular() {
        const boton = document.getElementById('btn-recalcular');
        boton.setAttribute('aria-busy', 'true');
        try {
            const r = await this.api('/reubicar', { method: 'POST' });
            window.avisos.exito(`Listo: ${r.ubicados} de ${r.total} votantes ubicados en una manzana.`);
            this.seleccion = null;
            document.getElementById('mapa-panel').innerHTML = '<p class="mapa-vacio">Tocá una manzana para ver sus datos y los de su radio censal.</p>';
            await this.cargar();
        } catch (error) {
            window.avisos.error(error.message);
        } finally {
            boton.removeAttribute('aria-busy');
        }
    }
}

window.mapaComponent = new MapaComponent();
