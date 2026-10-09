# DESIGN.md - ÁGORA

Fuente de verdad visual. Los valores salen de `public/src/styles/design-system.css`.

> Estado: **propuesta**. Los valores marcados como nuevos entran en vigor con la Fase 1
> del plan de mejora del frontend; hasta entonces manda `design-system.css`.

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
Texto: primary / secondary / muted (muted >= 4.5:1). Bordes: light / default / strong.
Semánticos: success, warning, danger, info. Datos: partidos, fuerzas 1-8, mapa 0-5.
Modo oscuro: se redefinen los tokens; nunca se escribe un color en una pantalla.

## Tipografía
Inter autoalojada. 11/12/13/14/16/18/22/28/36. Base 14. Cifras tabulares. Títulos balanceados.

## Espaciado y forma
Escala 4/8/12/16/20/24/32/40/48/64. Radios 4/6/8/12 (controles 6, paneles 8, modales 12).

## Elevación
Sin sombra salvo menús y modales. Jerarquía por borde y fondo.

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
