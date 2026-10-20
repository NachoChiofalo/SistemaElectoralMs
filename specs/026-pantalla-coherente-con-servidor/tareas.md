# 026 — Tareas

- [x] 1. `lib/fichas.js`: registro de versiones y cola por DNI, con tests (`test/fichas.test.js`).
- [x] 2. `PadronComponent`: `escribirRelevamiento` como única puerta; `cambiarOpcionPolitica` y
      `guardarPanel` pasan por ahí; fuera `dataset.version`.
- [x] 3. `ApiService`: `timeout = true` en el error por abort; relectura antes de decir "no se guardó".
- [x] 4. Mensaje distinto para el 409 propio.
- [x] 5. Guarda estática en `test/frontend-regresiones.test.js`; `npm run build:assets`; suite verde.
- [ ] 6. Prueba de comportamiento (Playwright, base descartable, API interceptada o real local):
      a) marcar → cambiar → cambiar rápido, sin recargar: cero 409;
      b) guardar teléfono desde el panel y marcar desde la tabla: cero 409;
      c) dos clics casi simultáneos sobre la misma fila: un solo PUT en vuelo a la vez, cero 409;
      d) edición ajena en el medio: 409 y la fila muestra el valor del servidor;
      e) PUT que tarda más del timeout pero el servidor guardó: se informa como guardado.
- [ ] 7. Desplegar (push; sin migraciones) y vigilar la semana de logs: criterio de cierre de la spec.
