/**
 * Coordenadas geograficas a SVG, para el mapa por manzana (018).
 *
 * Proyeccion equirrectangular con correccion por latitud: para una localidad (unos pocos kilometros) la
 * diferencia con una proyeccion "de verdad" es invisible, y no hace falta ninguna libreria. El norte queda
 * arriba: la latitud crece hacia arriba y la y del SVG crece hacia abajo.
 *
 * Funciones puras: se usan en el navegador (window.geometriaSvg) y se prueban en node.
 */
(function (raiz) {
    'use strict';

    /**
     * Arma la proyeccion que encaja todos los anillos en un ancho dado.
     * @param {Array} anillos  lista de anillos [[lon, lat], ...]
     * @returns {{ ancho: number, alto: number, proyectar: Function }}
     */
    function crearProyeccion(anillos, ancho = 1000, margen = 12) {
        let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
        for (const anillo of anillos) {
            for (const [x, y] of anillo) {
                if (x < minx) minx = x;
                if (x > maxx) maxx = x;
                if (y < miny) miny = y;
                if (y > maxy) maxy = y;
            }
        }
        if (!Number.isFinite(minx)) return { ancho, alto: ancho / 2, proyectar: () => [0, 0] };

        const k = Math.cos((((miny + maxy) / 2) * Math.PI) / 180);
        const anchoGeo = (maxx - minx) * k || 1e-9;
        const altoGeo = (maxy - miny) || 1e-9;
        const escala = (ancho - 2 * margen) / anchoGeo;
        const alto = altoGeo * escala + 2 * margen;

        const proyectar = ([lon, lat]) => [margen + (lon - minx) * k * escala, margen + (maxy - lat) * escala];
        return { ancho, alto: Math.round(alto), proyectar };
    }

    /** El atributo `d` de un <path> con uno o mas anillos (los huecos se dibujan con fill-rule evenodd). */
    function pathDe(anillos, proyectar) {
        return anillos
            .filter((a) => a.length > 2)
            .map((a) => a.map((p, i) => {
                const [x, y] = proyectar(p);
                return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
            }).join(' ') + ' Z')
            .join(' ');
    }

    const api = { crearProyeccion, pathDe };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.geometriaSvg = api;
})(typeof window !== 'undefined' ? window : globalThis);
