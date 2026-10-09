/**
 * Estados de una lista o tabla que se llena con una llamada a la API: cargando, vacío y
 * error. Devuelven markup (con el escapado de lib/escapar.js) para asignar a `innerHTML`.
 *
 * Existen porque la versión anterior solo cubría el caso feliz. Cuando la carga fallaba,
 * Listas, Comicio, Usuarios y Configuración mostraban un toast de tres segundos y dejaban
 * el contenedor en blanco: la persona no sabía si no había datos o si algo se había roto,
 * ni tenía cómo reintentar. Los spinners tampoco decían nada a un lector de pantalla.
 *
 * Es código puro (sin DOM) y por eso se prueba en Node, como geometria-svg.js.
 *
 *   contenedor.innerHTML = estados.cargando('Cargando usuarios…');
 *   contenedor.innerHTML = estados.vacio({ titulo: 'Sin usuarios', texto: 'Creá el primero.',
 *                                          accion: { texto: 'Nuevo usuario', accion: 'nuevo' } });
 *   contenedor.innerHTML = estados.error({ texto: error.message, reintentar: 'recargar' });
 *
 * `accion` y `reintentar` son nombres de `data-action`: el componente los atiende con la
 * misma delegación de eventos que ya usa para el resto (no hay `onclick` en el markup).
 */
(function (raiz) {
    function esc(valor) {
        return raiz.escaparHtml(valor);
    }

    function boton(texto, accion, clase) {
        return `<button type="button" class="btn ${clase}" data-action="${esc(accion)}">${esc(texto)}</button>`;
    }

    /** Spinner con texto, anunciado con cortesía (`role="status"`). */
    function cargando(texto = 'Cargando…') {
        return `<div class="estado" role="status">` +
            `<div class="spinner" aria-hidden="true"></div>` +
            `<p class="estado-texto">${esc(texto)}</p>` +
            `</div>`;
    }

    /**
     * Marcador de posición con la forma de una tabla. Una sola región `status` con el
     * texto para el lector de pantalla; las barras son decoración (`aria-hidden`).
     */
    function esqueletoTabla(filas = 5, columnas = 4, texto = 'Cargando…') {
        const celdas = Array.from({ length: columnas }, () => '<td><div class="skeleton"></div></td>').join('');
        const cuerpo = Array.from({ length: filas }, () => `<tr>${celdas}</tr>`).join('');
        return `<div role="status"><span class="sr-only">${esc(texto)}</span>` +
            `<table class="tabla" aria-hidden="true"><tbody>${cuerpo}</tbody></table></div>`;
    }

    /** Sin resultados. Dice qué falta y, si se puede, cómo llenarlo. */
    function vacio({ icono = 'fa-inbox', titulo, texto, accion } = {}) {
        return `<div class="estado">` +
            `<i class="fas ${esc(icono)} estado-icono" aria-hidden="true"></i>` +
            (titulo ? `<h3 class="estado-titulo">${esc(titulo)}</h3>` : '') +
            (texto ? `<p class="estado-texto">${esc(texto)}</p>` : '') +
            (accion ? boton(accion.texto, accion.accion, 'btn-primary') : '') +
            `</div>`;
    }

    /** Falló la carga. `role="alert"` para que se anuncie, y con salida: reintentar. */
    function error({ titulo = 'No se pudo cargar', texto, reintentar } = {}) {
        return `<div class="estado estado--error" role="alert">` +
            `<i class="fas fa-exclamation-triangle estado-icono" aria-hidden="true"></i>` +
            `<h3 class="estado-titulo">${esc(titulo)}</h3>` +
            (texto ? `<p class="estado-texto">${esc(texto)}</p>` : '') +
            (reintentar ? boton('Reintentar', reintentar, 'btn-secondary') : '') +
            `</div>`;
    }

    const api = { cargando, esqueletoTabla, vacio, error };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.estados = api;
})(typeof window !== 'undefined' ? window : globalThis);
