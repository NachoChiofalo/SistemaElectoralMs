/**
 * Tema claro / oscuro.
 *
 * Se carga en el <head>, sin `defer`, y eso es a propósito: tiene que correr antes del
 * primer pintado. Si se aplicara después, quien eligió el tema oscuro vería un
 * destello blanco en cada navegación — el error clásico de los selectores de tema.
 *
 * Por defecto el tema lo decide el sistema operativo, vía `prefers-color-scheme` en
 * design-system.css. Este archivo sólo entra en juego cuando el usuario eligió algo
 * distinto: ahí escribe `data-theme` en el <html> y esa elección gana.
 *
 * Los tres estados son "sistema" (nada guardado), "light" y "dark". Es el ciclo que
 * recorre el botón de la barra de navegación.
 */
(function (global) {
    'use strict';

    const CLAVE = 'sistema-electoral:tema';
    const CICLO = ['sistema', 'light', 'dark'];

    /**
     * localStorage puede tirar excepción —modo privado, cookies bloqueadas por
     * política— y un tema que no se puede guardar no es motivo para romper la página.
     */
    function leerGuardado() {
        try {
            const valor = localStorage.getItem(CLAVE);
            return CICLO.includes(valor) ? valor : 'sistema';
        } catch {
            return 'sistema';
        }
    }

    function guardar(tema) {
        try {
            if (tema === 'sistema') localStorage.removeItem(CLAVE);
            else localStorage.setItem(CLAVE, tema);
        } catch {
            // Sin persistencia el tema vale para esta página y nada más. Aceptable.
        }
    }

    function aplicar(tema) {
        if (tema === 'sistema') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = tema;
    }

    /** El tema que se está viendo ahora mismo, ya resuelto contra el del sistema. */
    function efectivo() {
        const elegido = leerGuardado();
        if (elegido !== 'sistema') return elegido;
        return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    function cambiar() {
        const siguiente = CICLO[(CICLO.indexOf(leerGuardado()) + 1) % CICLO.length];
        guardar(siguiente);
        aplicar(siguiente);
        global.dispatchEvent(new CustomEvent('tema:cambiado', { detail: { tema: siguiente } }));
        return siguiente;
    }

    aplicar(leerGuardado());

    global.tema = { elegido: leerGuardado, efectivo, cambiar, aplicar };
})(window);
