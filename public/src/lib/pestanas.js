/**
 * Pestañas accesibles (patrón WAI-ARIA "Tabs"). Cablea un tablist que ya existe en el DOM.
 *
 * Comicio tenía pestañas sin `role="tab"` ni `aria-selected` (el estado activo era solo una
 * clase CSS) y Mapa tenía `tab` y `aria-selected` pero sin `tabpanel`, sin `aria-controls`
 * y sin flechas. Para teclado y lector de pantalla ninguna de las dos era una pestaña.
 *
 * Markup esperado (los ids de panel salen de `aria-controls`):
 *
 *   <div class="pestanas" role="tablist" aria-label="Secciones">
 *     <button class="pestana" role="tab" id="t-datos" aria-controls="p-datos">Datos</button>
 *     <button class="pestana" role="tab" id="t-mesas" aria-controls="p-mesas">Mesas</button>
 *   </div>
 *   <div id="p-datos" role="tabpanel" aria-labelledby="t-datos">…</div>
 *   <div id="p-mesas" role="tabpanel" aria-labelledby="t-mesas" hidden>…</div>
 *
 * Teclado: ←/→ mueven y activan, Inicio/Fin saltan a los extremos. Solo la pestaña activa
 * está en el orden de tabulación (`tabindex` itinerante); el panel se alcanza con Tab.
 */
(function (global) {
    'use strict';

    /**
     * @param {HTMLElement} lista  El elemento con role="tablist".
     * @param {{ inicial?: string, alCambiar?: (id: string) => void }} [opciones]
     * @returns {{ seleccionar: (id: string, enfocar?: boolean) => void, actual: () => string|null }}
     */
    function iniciar(lista, { inicial, alCambiar } = {}) {
        const tabs = [...lista.querySelectorAll('[role="tab"]')];
        let activa = null;

        function seleccionar(id, enfocar = false) {
            const destino = tabs.find((t) => t.id === id) || tabs[0];
            if (!destino) return;
            tabs.forEach((t) => {
                const esta = t === destino;
                t.setAttribute('aria-selected', String(esta));
                t.tabIndex = esta ? 0 : -1;
                const panel = document.getElementById(t.getAttribute('aria-controls'));
                if (panel) panel.hidden = !esta;
            });
            if (enfocar) destino.focus();
            const cambio = activa !== destino.id;
            activa = destino.id;
            if (cambio && alCambiar) alCambiar(destino.id);
        }

        lista.addEventListener('click', (e) => {
            const t = e.target.closest('[role="tab"]');
            if (t && tabs.includes(t)) seleccionar(t.id);
        });

        lista.addEventListener('keydown', (e) => {
            const i = tabs.indexOf(document.activeElement);
            if (i < 0) return;
            let j = null;
            if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
            else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') j = 0;
            else if (e.key === 'End') j = tabs.length - 1;
            if (j === null) return;
            e.preventDefault();
            seleccionar(tabs[j].id, true);
        });

        const marcada = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
        seleccionar(inicial || (marcada && marcada.id) || (tabs[0] && tabs[0].id));

        return { seleccionar, actual: () => activa };
    }

    global.pestanas = { iniciar };
})(window);
