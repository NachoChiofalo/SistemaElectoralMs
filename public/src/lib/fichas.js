/**
 * Lo que el cliente sabe de cada ficha del padrón, en un solo lugar (spec 026).
 *
 * Antes la versión de un relevamiento vivía copiada en `votantesEnPantalla` y en
 * `panel.dataset.version`, y cada camino de escritura tenía que acordarse de actualizar
 * las dos. El que se olvidaba mandaba una versión vieja y la persona chocaba con un 409
 * contra su propio cambio. Ahora hay un registro por DNI: se lee de acá antes de escribir
 * y se actualiza con cada respuesta del servidor.
 *
 * Además serializa las escrituras sobre un mismo DNI: la segunda espera a la primera y,
 * como la versión se lee recién cuando le toca, sale con la que devolvió aquélla. DNIs
 * distintos no se esperan. Es código puro (sin DOM) y se prueba en Node.
 */
(function (raiz) {
    function crear() {
        const versiones = new Map();
        const colas = new Map();

        const clave = dni => String(dni);

        return {
            /** La versión conocida del DNI. 0 = "no la leí": no coincide con ninguna fila, fuerza el 409. */
            version(dni) {
                return versiones.get(clave(dni)) ?? 0;
            },

            /** Registra lo que el servidor dijo. Un valor que no es entero >= 0 se ignora. */
            recordar(dni, version) {
                const n = Number(version);
                if (Number.isInteger(n) && n >= 0) versiones.set(clave(dni), n);
            },

            /**
             * Corre `tarea` cuando terminen las escrituras previas de ese DNI. Que una falle
             * (incluso por timeout) no traba las siguientes. Devuelve lo que devuelva la tarea.
             */
            enCola(dni, tarea) {
                const k = clave(dni);
                const previa = colas.get(k) || Promise.resolve();
                const actual = previa.then(() => {}, () => {}).then(tarea);
                colas.set(k, actual);
                const limpiar = () => { if (colas.get(k) === actual) colas.delete(k); };
                actual.then(limpiar, limpiar);
                return actual;
            },

            /** ¿Hay una escritura en vuelo o esperando para ese DNI? */
            ocupado(dni) {
                return colas.has(clave(dni));
            },
        };
    }

    const api = { crear };
    raiz.fichas = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
