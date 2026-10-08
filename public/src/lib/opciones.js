/**
 * Opciones políticas de la instancia (021).
 *
 * Antes eran tres literales —PJ, UCR e Indeciso— repartidos por el padrón, los resultados
 * y el dashboard. Cada cliente tiene las suyas, así que viven en la base y este es el
 * único lugar del frontend que las pide. Todo lo demás pregunta acá.
 *
 * Una opción es `{ codigo, etiqueta, color, orden, esNeutra }`:
 *   - `codigo`   lo que se guarda en cada relevamiento. Es texto libre del cliente
 *                ("Frente Cívico"), así que SIEMPRE se escapa al interpolarlo.
 *   - `etiqueta` lo que se muestra.
 *   - `color`    1 a 8, un índice a la paleta fija `--ds-fuerza-N` del design system. Nunca
 *                un color libre: es lo que mantiene el modo oscuro y la regla de "ningún
 *                hex fuera de design-system.css".
 *   - `esNeutra` la que se asigna sola a un relevamiento nuevo ("Indeciso"). No lleva color:
 *                se pinta con el gris neutro.
 */
(function (global) {
    'use strict';

    let opciones = [];
    let enCurso = null;

    /**
     * Trae las opciones una vez por carga de página. Las llamadas siguientes reutilizan la
     * misma promesa, así que cada componente puede pedirlas sin coordinarse con los demás.
     */
    function cargar(forzar = false) {
        if (enCurso && !forzar) return enCurso;

        enCurso = global.apiService.request('/api/padron/opciones-politicas')
            .then((respuesta) => {
                opciones = Array.isArray(respuesta?.data) ? respuesta.data : [];
                return opciones;
            })
            .catch((error) => {
                // Si falla, la próxima llamada vuelve a intentar en lugar de quedarse con el error.
                enCurso = null;
                throw error;
            });

        return enCurso;
    }

    const lista = () => opciones;
    const porCodigo = (codigo) => opciones.find((o) => o.codigo === codigo) || null;
    const neutra = () => opciones.find((o) => o.esNeutra) || null;

    /** La etiqueta de un código; si ya no existe, el propio código. */
    function etiqueta(codigo) {
        return porCodigo(codigo)?.etiqueta || codigo || '';
    }

    /**
     * Clase CSS que fija `--opcion-color` (definida en design-system.css). Acepta la opción o
     * su código.
     */
    function clase(opcionOCodigo) {
        const opcion = typeof opcionOCodigo === 'string' ? porCodigo(opcionOCodigo) : opcionOCodigo;
        if (!opcion || opcion.esNeutra || !opcion.color) return 'op-neutra';
        return `op-${opcion.color}`;
    }

    /** El color como valor CSS, para los gráficos (que lo aplican por `style`). */
    function color(opcionOCodigo) {
        const opcion = typeof opcionOCodigo === 'string' ? porCodigo(opcionOCodigo) : opcionOCodigo;
        if (!opcion || opcion.esNeutra || !opcion.color) return 'var(--ds-party-indeciso)';
        return `var(--ds-fuerza-${opcion.color})`;
    }

    global.opcionesPoliticas = { cargar, lista, porCodigo, neutra, etiqueta, clase, color };
})(window);
