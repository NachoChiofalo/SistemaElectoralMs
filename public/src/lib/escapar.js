/**
 * Escapado de datos de usuario antes de interpolarlos en HTML.
 *
 * Los componentes arman su markup con plantillas y `innerHTML`. Sin esto, una
 * observación que contenga `</textarea><script>` se ejecuta en el navegador de
 * cualquiera que abra la página — y los datos entran por carga manual *y* por
 * importación de CSV, así que quien escribe el dato no tiene por qué ser quien lo mira.
 * Con varias personas cargando, es una ejecutando código en la sesión de otra.
 *
 * **Escapa también las comillas**, y eso no es un detalle de prolijidad. El truco
 * habitual —`div.textContent = valor; return div.innerHTML`— escapa `&`, `<` y `>` pero
 * NO `"` ni `'`, así que sirve para texto y **no** para atributos. Y este frontend
 * interpola datos dentro de atributos en todos lados: `value="${telefono}"`,
 * `title="${nombre}"`, `onclick="abrirPanel('${dni}')"`. Un teléfono que empiece con
 * comilla se sale del atributo y agrega el suyo.
 *
 * Las entidades funcionan igual dentro de un atributo: el parser de HTML las decodifica
 * antes de que el valor llegue a JavaScript, así que `&#39;` protege también el caso del
 * `onclick`. Lo que resuelve ese caso de raíz es sacar los `onclick` del markup, que es
 * el ítem 002 del backlog.
 */
(function (global) {
    const ENTIDADES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    /**
     * @param {*} valor  Cualquier cosa; null y undefined dan cadena vacía.
     * @returns {string} El valor listo para interpolar, en texto o en atributo.
     */
    function escaparHtml(valor) {
        if (valor === null || valor === undefined) return '';
        return String(valor).replace(/[&<>"']/g, (caracter) => ENTIDADES[caracter]);
    }

    global.escaparHtml = escaparHtml;
})(window);
