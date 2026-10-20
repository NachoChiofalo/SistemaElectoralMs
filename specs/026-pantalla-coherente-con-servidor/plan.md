# 026 — Plan

## Decisión de fondo

La versión de cada ficha deja de copiarse. Hay **un registro por DNI** (`public/src/lib/fichas.js`,
`window.fichas.crear()`), código puro sin DOM que se prueba en Node, con dos operaciones:

- `version(dni)` / `recordar(dni, version)`: lo que el cliente sabe de la ficha. 0 si no se
  leyó (no coincide con ninguna fila, así que ante la duda el servidor responde 409).
- `enCola(dni, tarea)`: serializa las tareas del mismo DNI. La versión se lee **adentro** de
  la tarea, cuando le toca, no al encolarla: así la segunda escritura sale con la versión que
  devolvió la primera. Una tarea que falla no traba las siguientes.

Descartado: reintentar solo ante un 409 propio. Es la forma del bug silencioso que 012 cerró:
si el cliente "arregla" la versión por su cuenta, un conflicto real deja de saltar.

## Quién escribe y quién registra

| Evento | Efecto |
|---|---|
| Se dibuja el listado | `recordar(dni, relevamiento?.version ?? 0)` por fila, salvo filas con escritura en vuelo |
| `abrirPanel` relee la ficha | `recordar(dni, version)` |
| PUT 200 (tabla o panel) | `recordar(dni, relevamiento.version)` |
| PUT 409 | `recordar(dni, actual.version)` y se muestra el estado del servidor |
| Timeout + relectura | `recordar` con lo releído |

## Cambios

1. `lib/fichas.js` (nuevo) y su carga en `index.html`.
2. `PadronComponent`: `this.fichas`; método `escribirRelevamiento(dni, campos)` como **única**
   puerta de escritura (cola + versión del registro + relectura tras timeout); `cambiarOpcionPolitica`
   y `guardarPanel` pasan por ahí; se elimina `panel.dataset.version` y `versionDelPanel`.
3. `ApiService`: el error por abort lleva `timeout = true`, para distinguir "no hubo respuesta"
   de un rechazo.
4. Mensaje del 409: si `actual.actualizadoPor` es el usuario actual, "Ya habías guardado X en esta
   fila, quizás en otra pestaña"; si no, el de siempre.
5. Backend: sin cambios (las respuestas de escritura ya traen `version`).

## Riesgos y cómo se cubren

- *Ocultar un conflicto real*: el registro sólo se alimenta de respuestas del servidor, nunca se
  inventa. Prueba de comportamiento con edición ajena en el medio (tarea 6).
- *Cola trabada*: el timeout de 10 s de `ApiService` hace fallar la tarea y libera la cola (test).
- *Relectura fallida*: dice "no se pudo confirmar", nunca "guardado".
- *Listado que pisa una versión más nueva*: se saltan las filas con escritura en vuelo.

## Verificación

- Unitarios (`test/fichas.test.js`): cola por DNI, DNIs distintos en paralelo, falla que no traba.
- Guarda estática (`test/frontend-regresiones.test.js`): una sola llamada a `actualizarRelevamiento`,
  con versión de `this.fichas`; sin `dataset.version`.
- Comportamiento: Playwright contra base descartable (nunca producción), ver tareas.
- Producción: una semana sin 409 con `ultimaEdicionDe == usuario` salvo dos pestañas.
