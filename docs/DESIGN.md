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
VARIANCE 3 / MOTION 3 / DENSITY 6.

## Color
Marca: `#1C1C1C` (tinta), `#343434`, `#FAFAF9` (fondo claro), `#202020` (fondo oscuro).
Texto: primary / secondary / muted, los tres >= 4,5:1 sobre las superficies de los dos temas
(muted claro `#666666`, oscuro `#a0a0a0`; primario oscuro `#f2f2f2`, no blanco puro).
Texto sobre tinte de estado: `--ds-*-on-tint`, >= 4,5:1 sobre su `-100`.
Texto sobre un relleno de opción política: `--opcion-on` (par de `--opcion-color`); no es
blanco fijo, porque sobre verde, ámbar y cian no llega y en oscuro los rellenos son pasteles.
Bordes: light / default / strong.
Semánticos: success, warning, danger, info. Datos: partidos, fuerzas 1-8, mapa 0-5.
Modo oscuro: se redefinen los tokens; nunca se escribe un color en una pantalla.

## Tipografía
Inter autoalojada. 11/12/13/14/16/18/22/28/36. Base 14 (`--ds-font-base`). La navegación usa
`--ds-font-chrome` (13): si crece con la base, los nueve ítems no entran en 1280. Cifras
tabulares en tablas; títulos con `text-wrap: balance`.

## Espaciado y forma
Escala 4/8/12/16/20/24/32/40/48/64. Radios 4/6/8/12 (controles 6, paneles 8, modales 12).

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
espacio de respeto = alto del tilde, solo sobre superficies neutras. Modo oscuro: hoy
`filter: invert(1)`; se evalúa una máscara tokenizada.

## Copy
Voseo consistente, tildes siempre, errores con próximo paso, sin guiones largos como recurso.

## Reglas de verificación
- Contraste: lo mide `test/design-tokens.test.js` sobre los valores reales del CSS.
- Sin colores sueltos: `test/assets.test.js` (css, html y js).
- Sin `transition: all`: `test/design-tokens.test.js`.
- Sin scroll horizontal ni violaciones axe serious/critical: `node scripts/verificar-frontend.js`.
- La barra de navegación entra en una fila de 769 px a cualquier ancho (íconos solos hasta 1260 px).
