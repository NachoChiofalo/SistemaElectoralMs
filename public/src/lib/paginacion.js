/**
 * Paginación: un <nav> con nombre, botones con nombre y la página actual marcada con
 * `aria-current="page"`. La versión anterior eran botones con "<" y ">" sueltos: sin
 * `<nav>`, sin nombre accesible en anterior/siguiente y sin forma de saber en qué página
 * estaba el foco.
 *
 * Es código puro (sin DOM) y se prueba en Node. El componente atiende los clics con su
 * delegación de siempre:
 *
 *   el.innerHTML = paginacion.render({ pagina: 3, totalPaginas: 12 });
 *   // <button data-action="ir-pagina" data-pagina="4">…
 */
(function (raiz) {
    function esc(valor) {
        return raiz.escaparHtml(valor);
    }

    /**
     * Qué números mostrar: la primera, la última y una ventana alrededor de la actual;
     * `null` marca un hueco ("…"). Con 12 páginas y la 6 actual: 1 … 5 6 7 … 12.
     */
    function ventana(pagina, totalPaginas, alrededor = 1) {
        const nums = new Set([1, totalPaginas]);
        for (let p = pagina - alrededor; p <= pagina + alrededor; p++) {
            if (p >= 1 && p <= totalPaginas) nums.add(p);
        }
        const orden = [...nums].sort((a, b) => a - b);
        const salida = [];
        orden.forEach((n, i) => {
            if (i > 0 && n - orden[i - 1] > 1) {
                // Un hueco de una sola página se escribe: "…" ocuparía lo mismo que el número.
                if (n - orden[i - 1] === 2) salida.push(n - 1);
                else salida.push(null);
            }
            salida.push(n);
        });
        return salida;
    }

    function boton({ texto, etiqueta, pagina, deshabilitado, actual, accion }) {
        return `<button type="button" class="paginacion-pagina"` +
            ` data-action="${esc(accion)}" data-pagina="${esc(pagina)}"` +
            ` aria-label="${esc(etiqueta)}"` +
            (actual ? ' aria-current="page"' : '') +
            (deshabilitado ? ' disabled' : '') +
            `>${texto}</button>`;
    }

    /**
     * @param {object} p
     * @param {number} p.pagina          Página actual (desde 1).
     * @param {number} p.totalPaginas
     * @param {string} [p.etiqueta]      Nombre del <nav>; si hay dos paginadores en la página, que difieran.
     * @param {string} [p.accion]        Valor de data-action de cada botón.
     * @returns {string} '' si hay una sola página: no hay nada que paginar.
     */
    function render({ pagina, totalPaginas, etiqueta = 'Paginación', accion = 'ir-pagina' } = {}) {
        if (!Number.isInteger(totalPaginas) || totalPaginas <= 1) return '';
        const actual = Math.min(Math.max(1, pagina | 0), totalPaginas);

        const partes = [
            boton({ texto: '<i class="fas fa-chevron-left" aria-hidden="true"></i>', etiqueta: 'Página anterior',
                pagina: actual - 1, deshabilitado: actual === 1, accion }),
            ...ventana(actual, totalPaginas).map((n) => n === null
                ? '<span class="paginacion-puntos" aria-hidden="true">…</span>'
                : boton({ texto: String(n), etiqueta: `Página ${n}`, pagina: n, actual: n === actual, accion })),
            boton({ texto: '<i class="fas fa-chevron-right" aria-hidden="true"></i>', etiqueta: 'Página siguiente',
                pagina: actual + 1, deshabilitado: actual === totalPaginas, accion }),
        ];

        return `<nav class="paginacion" aria-label="${esc(etiqueta)}">${partes.join('')}</nav>`;
    }

    const api = { render, ventana };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.paginacion = api;
})(typeof window !== 'undefined' ? window : globalThis);
