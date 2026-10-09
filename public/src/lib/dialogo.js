/**
 * Diálogos modales sobre el elemento nativo <dialog>.
 *
 * Había unos quince modales armados a mano (un `div.modal-overlay` con `display:none`) y
 * ninguno atrapaba el foco, ninguno lo devolvía al cerrar, solo tres tenían `role="dialog"`
 * y el cierre era una `×` sin nombre. `showModal()` resuelve de fábrica lo que a mano
 * nunca se terminó de resolver: capa superior, foco atrapado, fondo inerte y Escape.
 *
 * Lo que sigue agrega lo que el elemento no hace solo: devolver el foco al disparador,
 * nombrar el diálogo, y la forma de pedir una respuesta (`confirmar`) que reemplaza a
 * `confirm()` y `alert()` del navegador, que bloquean el hilo, no se pueden estilar y no
 * siguen el tema.
 *
 *   if (await dialogo.confirmar({ titulo: 'Cerrar sesión', mensaje: '¿Salir?' })) { ... }
 *   await dialogo.avisar({ titulo: 'Sesión expirada', mensaje: '...', tono: 'peligro' });
 *   const { cerrar } = dialogo.abrir({ titulo, cuerpo: nodoOTexto, acciones: [...] });
 *
 * Título, mensaje y textos de botón entran por `textContent`: no hace falta escapar y no
 * se puede colar markup. `cuerpo` acepta un Node o un array de Nodes cuando el contenido
 * no es texto plano; quien lo arma es responsable de escapar lo que interpole.
 */
(function (global) {
    'use strict';

    let contador = 0;

    const soportado = typeof HTMLDialogElement === 'function';

    function el(etiqueta, clase, texto) {
        const nodo = document.createElement(etiqueta);
        if (clase) nodo.className = clase;
        if (texto !== undefined) nodo.textContent = texto;
        return nodo;
    }

    function icono(clase) {
        const i = el('i', `fas ${clase}`);
        i.setAttribute('aria-hidden', 'true');
        return i;
    }

    /**
     * Abre un diálogo y devuelve `{ el, cerrar, resultado }`. `resultado` se resuelve con
     * el `id` de la acción pulsada, o `null` si se cerró por Escape, por la `×` o por
     * `cerrar()` sin valor.
     *
     * @param {object}   opciones
     * @param {string}   opciones.titulo
     * @param {string|Node|Node[]} [opciones.cuerpo]
     * @param {{id:string, texto:string, tipo?:'primario'|'secundario'|'peligro', foco?:boolean}[]} [opciones.acciones]
     * @param {'peligro'|'aviso'|'info'} [opciones.tono]  Tinte de la cabecera.
     * @param {string}   [opciones.icono]                 Clase del ícono (p. ej. 'fa-clock').
     * @param {boolean}  [opciones.cerrable=true]         false: sin Escape ni `×`; solo las acciones cierran.
     * @param {boolean}  [opciones.ancho=false]
     * @param {string}   [opciones.rol='dialog']          'alertdialog' si exige una respuesta.
     */
    function abrir({ titulo, cuerpo, acciones, tono, icono: claseIcono, cerrable = true, ancho = false, rol = 'dialog' }) {
        const id = `dialogo-${++contador}`;
        const disparador = document.activeElement;

        const dlg = el('dialog', 'dialogo' + (tono ? ` dialogo--${tono}` : '') + (ancho ? ' dialogo--ancho' : ''));
        dlg.setAttribute('role', rol);
        dlg.setAttribute('aria-labelledby', `${id}-titulo`);

        const cabecera = el('div', 'dialogo-cabecera');
        if (claseIcono) {
            const caja = el('span', 'dialogo-icono');
            caja.appendChild(icono(claseIcono));
            cabecera.appendChild(caja);
        }
        const h = el('h2', 'dialogo-titulo', titulo);
        h.id = `${id}-titulo`;
        cabecera.appendChild(h);
        if (cerrable) {
            const x = el('button', 'btn btn-ghost btn-icono btn-sm dialogo-cerrar');
            x.type = 'button';
            x.setAttribute('aria-label', 'Cerrar');
            x.appendChild(icono('fa-times'));
            x.addEventListener('click', () => dlg.close());
            cabecera.appendChild(x);
        }
        dlg.appendChild(cabecera);

        const cuerpoEl = el('div', 'dialogo-cuerpo');
        cuerpoEl.id = `${id}-cuerpo`;
        const nodos = typeof cuerpo === 'string' ? [el('p', '', cuerpo)] : [].concat(cuerpo || []);
        nodos.forEach((n) => cuerpoEl.appendChild(n));
        dlg.appendChild(cuerpoEl);
        dlg.setAttribute('aria-describedby', cuerpoEl.id);

        let resultadoId = null;
        const lista = acciones && acciones.length ? acciones : [{ id: 'aceptar', texto: 'Aceptar', tipo: 'primario' }];
        const pie = el('div', 'dialogo-pie');
        lista.forEach((a) => {
            const clase = a.tipo === 'peligro' ? 'btn-danger' : a.tipo === 'secundario' ? 'btn-secondary' : 'btn-primary';
            const b = el('button', `btn ${clase}`, a.texto);
            b.type = 'button';
            b.id = `${id}-${a.id}`;
            if (a.foco) b.setAttribute('autofocus', '');
            b.addEventListener('click', () => { resultadoId = a.id; dlg.close(); });
            pie.appendChild(b);
        });
        dlg.appendChild(pie);

        const resultado = new Promise((resolver) => {
            dlg.addEventListener('close', () => {
                dlg.remove();
                // Los navegadores modernos ya devuelven el foco; esto cubre los que no, y el
                // caso en que el disparador se haya vuelto a dibujar.
                if (disparador && disparador.isConnected && typeof disparador.focus === 'function') disparador.focus();
                resolver(resultadoId);
            });
        });

        // Escape dispara `cancel`. Si el diálogo exige una respuesta, no se cierra solo.
        dlg.addEventListener('cancel', (e) => { if (!cerrable) e.preventDefault(); });

        document.body.appendChild(dlg);
        dlg.showModal();

        return { el: dlg, cerrar: (valor) => { resultadoId = valor === undefined ? resultadoId : valor; dlg.close(); }, resultado };
    }

    /** Reemplazo de `confirm()`. Devuelve `true` si se aceptó. */
    async function confirmar({ titulo = 'Confirmar', mensaje, confirmar: textoOk = 'Aceptar', cancelar: textoNo = 'Cancelar', tono } = {}) {
        if (!soportado) return global.confirm(mensaje);
        const peligro = tono === 'peligro';
        const { resultado } = abrir({
            titulo, cuerpo: mensaje, tono, rol: 'alertdialog',
            icono: peligro ? 'fa-exclamation-triangle' : 'fa-question-circle',
            // En una acción destructiva el foco arranca en "Cancelar": Enter no debe borrar.
            acciones: [
                { id: 'cancelar', texto: textoNo, tipo: 'secundario', foco: peligro },
                { id: 'aceptar', texto: textoOk, tipo: peligro ? 'peligro' : 'primario', foco: !peligro },
            ],
        });
        return (await resultado) === 'aceptar';
    }

    /** Reemplazo de `alert()`. Se resuelve al cerrarlo. */
    async function avisar({ titulo = 'Aviso', mensaje, boton = 'Entendido', tono } = {}) {
        if (!soportado) { global.alert(mensaje); return; }
        const { resultado } = abrir({
            titulo, cuerpo: mensaje, tono, rol: 'alertdialog',
            acciones: [{ id: 'aceptar', texto: boton, tipo: 'primario', foco: true }],
        });
        await resultado;
    }

    /**
     * Abre un <dialog class="dialogo"> que la pantalla ya tiene en su markup (los modales
     * de formulario, que son demasiado distintos para armarlos desde cero). Devuelve una
     * promesa que se resuelve al cerrarse. Con `cerrarAlClicFuera` un clic en el fondo lo
     * cierra; por defecto NO, para no perder lo que la persona tipeó.
     */
    function mostrar(dlg, { cerrarAlClicFuera = false } = {}) {
        const disparador = document.activeElement;
        return new Promise((resolver) => {
            const alCerrar = () => {
                dlg.removeEventListener('close', alCerrar);
                if (disparador && disparador.isConnected && typeof disparador.focus === 'function') disparador.focus();
                resolver(dlg.returnValue || null);
            };
            dlg.addEventListener('close', alCerrar);
            if (cerrarAlClicFuera) {
                dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
            }
            dlg.showModal();
        });
    }

    global.dialogo = { abrir, confirmar, avisar, mostrar };
})(window);
