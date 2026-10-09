/**
 * Avisos transitorios (toasts), uno solo para todo el sistema.
 *
 * Había cinco implementaciones —`mostrarToast` en Usuarios, Mapa, Opciones, Listas y
 * Comicio; `mostrarNotificacion` en Padrón y Resultados; `showError` en app.js— y ninguna
 * se anunciaba a un lector de pantalla: aparecía un `div` y nadie se enteraba.
 *
 * Dos regiones vivas permanentes, creadas al cargar y ANTES de que haya un mensaje (varios
 * lectores de pantalla ignoran una región que nace ya con contenido): `status` para lo
 * informativo, que se anuncia con cortesía, y `alert` para errores y advertencias, que
 * interrumpen. Un aviso es para lo transitorio: un fallo de carga que deja una pantalla
 * sin contenido es un estado de error en la pantalla (lib/estados.js), no un toast.
 *
 *   avisos.exito('Usuario creado');
 *   avisos.error('No se pudo guardar. Probá de nuevo.');
 *   avisos.mostrar('Mensaje', 'success')   // acepta los nombres en inglés de los toasts viejos
 *
 * El mensaje entra por `textContent`: no hay que escaparlo y no puede traer markup.
 */
(function (global) {
    'use strict';

    const MAXIMO_VISIBLES = 4;
    // El error dura más: hay que poder leerlo y decidir. Con el puntero encima se pausa.
    const DURACION = { exito: 4500, info: 4500, aviso: 8000, error: 10000 };
    const ICONO = { exito: 'fa-check-circle', info: 'fa-info-circle', aviso: 'fa-exclamation-triangle', error: 'fa-times-circle' };
    // Los toasts viejos hablaban inglés; se aceptan para migrar sin tocar cada llamada.
    const ALIAS = { success: 'exito', warning: 'aviso', danger: 'error', info: 'info', exito: 'exito', aviso: 'aviso', error: 'error' };

    let contenedor = null;
    let regiones = null;

    function asegurar() {
        if (contenedor && contenedor.isConnected) return;
        contenedor = document.createElement('div');
        contenedor.className = 'avisos';

        const cortesia = document.createElement('div');
        cortesia.className = 'avisos-region';
        cortesia.setAttribute('role', 'status');
        cortesia.setAttribute('aria-live', 'polite');

        const urgente = document.createElement('div');
        urgente.className = 'avisos-region';
        urgente.setAttribute('role', 'alert');

        contenedor.append(cortesia, urgente);
        document.body.appendChild(contenedor);
        regiones = { status: cortesia, alert: urgente };
    }

    function cerrar(aviso) {
        if (!aviso.isConnected) return;
        clearTimeout(aviso._timer);
        aviso.remove();
    }

    function mostrar(mensaje, tipo = 'info', { duracion } = {}) {
        asegurar();
        const clave = ALIAS[tipo] || 'info';
        const region = clave === 'error' || clave === 'aviso' ? regiones.alert : regiones.status;

        const aviso = document.createElement('div');
        aviso.className = `aviso aviso--${clave}`;

        const icono = document.createElement('i');
        icono.className = `fas ${ICONO[clave]}`;
        icono.setAttribute('aria-hidden', 'true');

        const texto = document.createElement('span');
        texto.className = 'aviso-texto';
        texto.textContent = mensaje;

        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'btn btn-ghost btn-icono btn-sm';
        x.setAttribute('aria-label', 'Cerrar aviso');
        const ix = document.createElement('i');
        ix.className = 'fas fa-times';
        ix.setAttribute('aria-hidden', 'true');
        x.appendChild(ix);
        x.addEventListener('click', () => cerrar(aviso));

        aviso.append(icono, texto, x);
        region.appendChild(aviso);

        // Tope: si se acumulan, sale el más viejo en vez de tapar la pantalla.
        const todos = contenedor.querySelectorAll('.aviso');
        if (todos.length > MAXIMO_VISIBLES) cerrar(todos[0]);

        const espera = duracion === undefined ? DURACION[clave] : duracion;
        if (espera > 0) {
            const armar = () => { aviso._timer = setTimeout(() => cerrar(aviso), espera); };
            armar();
            // Leerlo lleva tiempo y a veces se lo quiere copiar: con el puntero o el foco
            // encima no se cierra.
            const pausar = () => clearTimeout(aviso._timer);
            aviso.addEventListener('mouseenter', pausar);
            aviso.addEventListener('focusin', pausar);
            aviso.addEventListener('mouseleave', armar);
            aviso.addEventListener('focusout', armar);
        }
        return aviso;
    }

    global.avisos = {
        mostrar,
        exito: (m, o) => mostrar(m, 'exito', o),
        info: (m, o) => mostrar(m, 'info', o),
        aviso: (m, o) => mostrar(m, 'aviso', o),
        error: (m, o) => mostrar(m, 'error', o),
    };

    // Las regiones tienen que estar en el DOM antes del primer mensaje.
    if (document.body) asegurar();
    else document.addEventListener('DOMContentLoaded', asegurar);
})(window);
