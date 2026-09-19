# 015 — Módulo de comicio: mesas, votos y sectorización del padrón

> Estado: aprobada
> Tamaño estimado: L

## Problema

No existe forma de registrar un comicio: qué listas participan, tipo de elección, cuántas
mesas tiene. Tampoco hay dónde cargar los votos que obtiene cada lista por mesa, ni los
votos en blanco y nulos, ni una sección de métricas del comicio. `public/comicio.html`
existe como cáscara ("Próximamente") sin backend; los permisos `comicio.view`/
`comicio.edit` ya están sembrados en `auth/migrations/002_roles_y_permisos.sql`.

## Por qué ahora

Es la prioridad P2 declarada, y ahora tiene insumo real: 017 (listas) ya existe, así que
un comicio puede asociar listas de verdad en vez de un sub-formulario inventado. Reemplaza
el alcance de 008, que había quedado abierto sin resolver la relación entre comicio, mesa
y circuito.

## Alcance

- **Comicio**: alta/edición/baja/listado. Nombre, tipo de elección (misma lista blanca que
  017: `provincial | municipal | nacional`), listas participantes (selección de listas ya
  cargadas en 017).
- **Mesa**: alta/edición/baja dentro de un comicio. Número de mesa y un rango del padrón
  ("desde tal persona hasta tal persona"), expresado como dos DNIs que delimitan un tramo
  sobre el orden habitual del padrón (apellido, nombre, dni — el mismo que ya usa el
  listado de `GET /api/padron/votantes`). La cantidad de votantes de la mesa se calcula
  contra ese rango, no se copia ni se materializa.
- **Votos por mesa**: carga de la cantidad de votos de cada lista participante del
  comicio, más votos en blanco y votos nulos. Reemplazo completo por mesa (mismo patrón
  que los candidatos de 017: cargar de nuevo pisa lo anterior, no hay PATCH por lista).
- **Métricas del comicio**: totales por lista sumando todas las mesas, blancos, nulos,
  votos emitidos, cantidad de mesas con votos cargados vs. total de mesas, participación
  (emitidos / padrón asignado a las mesas).

## Fuera de alcance

- Circuito como concepto propio: el padrón ya tiene una columna `circuito` de texto libre
  (importada del CSV); este ítem no la formaliza ni la cruza con mesas. El rango de mesa
  es sobre el orden del padrón completo, no por circuito.
- Impugnación de votos, actas, o cualquier flujo de fiscalización — eso es 016 (fiscales),
  que además depende de que exista mesa (este ítem).
- Edición de una lista de candidatos desde acá — eso ya lo resuelve 017; este módulo sólo
  las referencia.
- Historial de cambios de una carga de votos (quién cargó qué versión) — la auditoría
  general ya registra alta/edición/baja; un historial detallado de recargas de votos no
  está pedido.
- Exportación de resultados del comicio a un formato oficial.

## Criterios de aceptación

- [ ] `POST /api/comicio` crea un comicio con nombre, tipo de elección y listas
      participantes (array de ids de `elecciones.listas`); responde 201.
- [ ] `GET /api/comicio` lista comicios, paginado con techo.
- [ ] `GET /api/comicio/:id` trae un comicio con sus listas y sus mesas.
- [ ] `PUT /api/comicio/:id` edita nombre, tipo de elección y el set de listas.
- [ ] `DELETE /api/comicio/:id` borra el comicio, sus mesas y sus votos cargados.
- [ ] `POST /api/comicio/:id/mesas` crea una mesa con número y rango de padrón (dos DNIs
      existentes en `padron.votantes`); responde 201 con la cantidad de votantes que caen
      en ese rango.
- [ ] `PUT /api/comicio/:id/mesas/:mesaId` edita número y rango.
- [ ] `DELETE /api/comicio/:id/mesas/:mesaId` borra la mesa y sus votos.
- [ ] Dos mesas del mismo comicio no pueden compartir número (409 si se repite).
- [ ] El DNI "hasta" no puede ir antes que el DNI "desde" en el orden del padrón (400).
- [ ] El rango de una mesa nueva (o editada) no puede solaparse con el de otra mesa del
      mismo comicio — mismo votante en dos mesas a la vez (409 con la mesa que se pisa).
- [ ] `PUT /api/comicio/:id/mesas/:mesaId/votos` recibe blancos, nulos y un array
      `{ listaId, cantidad }` por cada lista participante; reemplaza todo en una
      transacción. Cargar una `listaId` que no participa del comicio da 400.
- [ ] Cantidades negativas de voto dan 400.
- [ ] `GET /api/comicio/:id/metricas` devuelve: total de votos por lista, blancos, nulos,
      emitidos, mesas con votos cargados / total de mesas, votantes en el padrón asignado
      a las mesas del comicio, participación (emitidos / votantes asignados).
- [ ] `GET`/escritura exigen `comicio.view` / `comicio.edit` respectivamente (los permisos
      que ya existen).
- [ ] Alta, edición y baja de comicio, mesa y votos quedan auditadas.
- [ ] Frontend: `public/comicio.html` reemplaza la cáscara "Próximamente" por una pantalla
      real — listado de comicios, alta/edición, y dentro de un comicio: mesas (alta,
      rango, cantidad de votantes), carga de votos por mesa, y una sección de métricas.
- [ ] Ítem visible en el navbar y en el dashboard, gateado por `comicio.view` (mismo
      patrón que 017 con `listas.view`).
- [ ] `npm test` en verde; probado de punta a punta en un navegador real contra Postgres
      real (mismo nivel de verificación que 017).

## Restricciones

- **Costo de servidor por delante del alcance**: el volumen esperado es bajo (pocos
  comicios, un puñado de mesas cada uno), así que no hay caché que mantener. La cantidad
  de votantes por rango de mesa se calcula con una comparación de tuplas
  `(apellido, nombre, dni)` contra el índice ya existente de `padron.votantes`, no con una
  tabla que duplique el padrón. Las métricas se calculan on-demand con agregaciones SQL,
  no con un job en segundo plano.
- **Un solo pool, migraciones idempotentes, errores lanzados, permisos por request,
  `process.env` sólo en `config.js`.**
- **Auditar lo que modifica datos**: alta/edición/baja de comicio, mesa y votos.
- **Toda escritura de votos reemplaza el conjunto completo de una mesa en una única
  transacción** — mismo criterio que el `PUT` de candidatos en 017: cargar los votos de
  una mesa es una unidad, no N escrituras sueltas por lista.
- **No se materializa qué votante cae en qué mesa**: el rango se guarda como dos DNIs:
  calcular quién cae adentro es una consulta contra `padron.votantes`, no una tabla nueva
  de asignación votante↔mesa. Evita mantener sincronizada una segunda copia del padrón
  cada vez que se importa un CSV nuevo (013).

## Riesgos

- **El orden `(apellido, nombre, dni)` puede no coincidir con el orden real usado para
  armar las mesas en papel** (que podría venir de otra fuente, como el número de orden
  del padrón oficial). Si aparece esa discrepancia en uso real, es una spec nueva, no un
  ajuste de ésta: cambiar el criterio de orden después de que haya mesas cargadas
  invalidaría los rangos ya guardados.
- **Borrar una lista de 017 que ya participa de un comicio**: la FK lo impide (409), pero
  el mensaje de error genérico de `PG_A_HTTP` no dice "está en uso por un comicio" — es
  aceptable para este ítem, mejorar el mensaje es cosmético.
