# DESIGN.md - ÁGORA

Fuente de verdad visual. Los valores salen de `public/src/styles/design-system.css`.

> Estado: **vigente desde la Fase 1** del plan de mejora del frontend. Los valores salen de
> `design-system.css`; si este documento y el CSS discrepan, manda el CSS y esto es un bug del
> documento. Lo que se puede medir lo cuidan `test/design-tokens.test.js` y
> `scripts/verificar-frontend.js`.

## Principios
1. La interfaz es una herramienta de trabajo: calma, densa y legible. El dato es el protagonista.
2. Monocromo grafito como marca (derivado del logo). El color significa algo (partido, estado) o no se usa.
3. Superficies planas y bordes de 1 px. Sin degradados ni sombras decorativas.
4. Accesible por defecto: teclado, foco, contraste AA, lector de pantalla.
5. Un patrón, un componente.

## Dials
VARIANCE 4 / MOTION 4 / DENSITY 7. Dirección v2 (rediseño R0-R6): centro de control oscuro,
monocromo, denso; la personalidad sale de la tipografía, la escala, el borde y la luminancia,
no de un color de marca.

## Color
El tema de diseño es el **oscuro** y es el de entrada (sin elección guardada); el claro es su
espejo. Neutros fríos, apenas teñidos hacia el azul, sin color de marca:
- Oscuro: página `#0C0D0F`, panel `#131417`, elevado `#1A1C20`, sutil `#17181C`, atenuado `#22252A`.
- Claro: página `#F4F4F5`, panel `#FFFFFF`, sutil `#F8F8F9`, atenuado `#EBECEE`.
- La acción primaria se invierte entre temas (relleno claro sobre oscuro y al revés).
Texto: primary / secondary / muted >= 4,5:1 sobre todas las superficies de los dos temas
(muted también sobre bg-muted). `--ds-border-strong` (borde de controles) >= 3:1 sobre panel y
elevado en los dos temas (WCAG 1.4.11).
Texto sobre tinte de estado: `--ds-*-on-tint`, >= 4,5:1 sobre su `-100`.
Texto sobre un relleno de opción política: `--opcion-on` (par de `--opcion-color`); no es
blanco fijo, porque sobre verde, ámbar y cian no llega y en oscuro los rellenos son pasteles.
Bordes: light / default / strong.
Semánticos: success, warning, danger, info. Datos: partidos, fuerzas 1-8, mapa 0-5.
Modo oscuro: se redefinen los tokens; nunca se escribe un color en una pantalla.

## Tipografía
Geist Sans (interfaz) y Geist Mono (toda cifra de datos: DNI, mesa, hora, porcentaje, KPI,
con `tabular-nums`), autoalojadas por `scripts/build-assets.js`. Escala 12/13/14/16/20/24/28/44
(el 44 solo para el KPI principal). Base 14 (`--ds-font-base`). La navegación usa
`--ds-font-chrome` (13): si crece con la base, los nueve ítems no entran en 1280. Cifras
tabulares en tablas; títulos con `text-wrap: balance`.

## Espaciado y forma
Escala 4/8/12/16/20/24/32/40/48/64. Radios 3/5/8/12 (controles 5, paneles 8, modales 12).

## Elevación
Sin sombra salvo menús y modales. Jerarquía por borde y fondo. Foco: anillo sólido de dos capas
(`--ds-shadow-focus`), nunca un halo translúcido ni `outline: none` sin reemplazo.
Capas: `--ds-z-raised/sticky/nav/modal/toast`; fondo de modales `--ds-scrim`.

## Movimiento
120/200 ms, ease-out. Solo feedback y cambios de estado. Respeta `prefers-reduced-motion`.
Nunca `transition: all`.

## Componentes
Botón, campo, diálogo, aviso, estado (cargando/vacío/error), navegación, tabla, pestañas, paginación, panel.
Cada uno: variantes, estados (hover, foco, activo, deshabilitado, carga), reglas de teclado y ARIA.

## Logo
`agora-logo.png` (lockup) y `agora-icon.png` (ícono). No se modifican. Alto mínimo 24 px,
espacio de respeto = alto del tilde, solo sobre superficies neutras. En la barra lateral es una
**máscara** (`mask-image` sobre el PNG con canal alfa) con `background: var(--ds-text-primary)`:
la tinta sigue al tema sin filtros. Lockup expandida, ícono colapsada.

## Paleta de comandos y densidad
Ctrl/Cmd + K abre una paleta (`<dialog>` con patrón combobox: foco en el campo, `aria-activedescendant`, flechas, Enter y Escape) con los destinos de la barra —con sus permisos— y las acciones del pie: tema, menú lateral, densidad y cerrar sesión. La densidad es **cómoda** (por defecto) o **compacta** (`data-densidad` en el `<html>`, guardada en `localStorage` y aplicada por `tema.js` antes del primer pintado): baja la altura de filas, botones y campos, nada más. En móvil la compacta no baja de 40 px de blanco táctil.

## Pantalla (igual en todas)
Contenedor `main#contenido`: 1440 px máx., relleno 24 px (16 en móvil). Cabecera: `h1` de 24 px / 600 con el ícono de su destino de la barra, subtítulo de 13 px en tono atenuado debajo, acciones a la derecha, 20 px de aire hasta el contenido. Encabezado de tabla: 12 px, 600, mayúsculas, `--ds-bg-subtle`. Todo esto vive **una sola vez** en `design-system.css` (sección "Pantalla"), con `main#contenido` para ganarle a las hojas de pantalla sin `!important`. Una pantalla nueva usa esas clases de cabecera y no define su ancho, su título ni su botón.

## Barra lateral
Columna fija a la izquierda en escritorio (240 px; 68 px colapsada a íconos; preferencia en
`localStorage`, clave `sistema-electoral:nav`, reflejada en `data-nav` del `<html>`). De ese
atributo salen el ancho de la columna y el margen del contenido (`--nav-ancho`). Tres grupos:
Operación, Elección, Administración; un grupo sin destinos visibles por permisos no se dibuja.
Activo = superficie más clara + barra de 2 px, sin color. En móvil (<= 768 px) es una barra
superior mínima y la columna pasa a ser un cajón con foco, Escape y `aria-expanded`.

## Copy
Voseo consistente, tildes siempre, errores con próximo paso, sin guiones largos como recurso.

## Reglas de verificación
- Contraste: lo mide `test/design-tokens.test.js` sobre los valores reales del CSS.
- Sin colores sueltos: `test/assets.test.js` (css, html y js).
- Sin `transition: all`: `test/design-tokens.test.js`.
- Sin scroll horizontal ni violaciones axe serious/critical: `node scripts/verificar-frontend.js`.
- La barra lateral se colapsa, persiste y se opera con teclado: lo mide `scripts/verificar-componentes.js`.
