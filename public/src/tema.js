/**
 * Tema claro / oscuro.
 *
 * Se carga en el <head>, sin `defer`, y eso es a propósito: tiene que correr antes del
 * primer pintado. Si se aplicara después, quien eligió el tema oscuro vería un
 * destello blanco en cada navegación — el error clásico de los selectores de tema.
 *
 * El tema de diseño es el OSCURO (centro de control): si la persona nunca eligió nada, se
 * muestra oscuro, sin importar cómo tenga el sistema operativo. Antes el defecto seguía
 * al sistema. "Sistema" sigue existiendo, pero como una ELECCIÓN explícita (se guarda), no
 * como el estado de "no elegí": en ese caso se borra `data-theme` y manda
 * `prefers-color-scheme` en design-system.css.
 *
 * Los tres estados son "dark" (defecto), "light" y "sistema". Es el ciclo que recorre el
 * botón de la barra de navegación.
 */
(function (global) {
    'use strict';

    const CLAVE = 'sistema-electoral:tema';
    const CICLO = ['dark', 'light', 'sistema'];
    const DEFECTO = 'dark';

    /**
     * localStorage puede tirar excepción —modo privado, cookies bloqueadas por
     * política— y un tema que no se puede guardar no es motivo para romper la página.
     */
    function leerGuardado() {
        try {
            const valor = localStorage.getItem(CLAVE);
            return CICLO.includes(valor) ? valor : DEFECTO;
        } catch {
            return DEFECTO;
        }
    }

    function guardar(tema) {
        try {
            // "sistema" se guarda: es una elección, y borrarla la confundiría con "no elegí"
            // (que ahora es oscuro).
            localStorage.setItem(CLAVE, tema);
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

    /**
     * Color de la barra del navegador en móvil (`<meta name="theme-color">`). Se lee del
     * token en vez de escribirlo en cada HTML: así sigue al tema sin un hex suelto fuera
     * de design-system.css, y un cambio de paleta lo arrastra solo. Necesita las hojas
     * ya cargadas, por eso corre en `load` y no en la carga inicial del script.
     */
    function sincronizarBarra() {
        const fondo = getComputedStyle(document.documentElement).getPropertyValue('--ds-bg-page').trim();
        if (!fondo) return;
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.content = fondo;
    }

    aplicar(leerGuardado());

    global.addEventListener('load', sincronizarBarra);
    global.addEventListener('tema:cambiado', sincronizarBarra);
    if (global.matchMedia) {
        const sistema = global.matchMedia('(prefers-color-scheme: dark)');
        // Safari viejo sólo conoce addListener.
        (sistema.addEventListener ? sistema.addEventListener.bind(sistema, 'change') : sistema.addListener.bind(sistema))(sincronizarBarra);
    }

    global.tema = { elegido: leerGuardado, efectivo, cambiar, aplicar };
})(window);
