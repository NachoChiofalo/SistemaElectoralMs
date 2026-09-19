# 017 — Armado de listas (borradores)

> Estado: aprobada
> Tamaño estimado: M

## Problema

No existe forma de armar un borrador de lista electoral dentro del sistema: cantidad de
lugares a cubrir, tipo de elección, candidatos y el orden en que van. Hoy esto se arma
fuera del sistema (planillas sueltas, mensajes) y no queda registrado en ningún lado.

## Por qué ahora

Es insumo directo de **015** (módulo de comicio): un comicio necesita listas ya armadas
para asociarlas. Sin este ítem, 015 no tiene de dónde tomarlas y terminaría inventando su
propio sub-formulario de listas, duplicando lo que corresponde acá.

## Alcance

- Alta, edición y baja de una lista en estado borrador: nombre, tipo de elección
  (provincial | municipal | nacional) y cantidad de lugares a cubrir.
- Candidatos de una lista: nombre y orden (1..N) dentro de la lista. Alta, edición,
  reordenamiento y baja de candidatos, siempre dentro de una lista existente.
- Listado de los borradores existentes, con paginación.
- Permisos nuevos `listas.view` / `listas.edit`, siguiendo el mismo patrón que
  `fiscales.*` y `comicio.*`.

## Fuera de alcance

- Asociar una lista a un comicio concreto — es el trabajo de 015, que todavía no existe.
- Cualquier estado más allá de "borrador" (presentada, oficializada, impugnada) y el
  flujo de aprobación que eso implicaría. Se agrega cuando haga falta, no antes.
- Vincular la lista con los partidos que ya aparecen en `padron.relevamientos.opcion_politica`
  (`PJ`, `UCR`, `Indeciso`). Son dos conceptos distintos: uno es intención de voto
  relevada persona a persona, el otro es una lista de candidatos. No se cruzan acá.
- Resultados de votación por lista — eso es 015.
- UI de impresión o exportación de la lista en formato oficial.

## Criterios de aceptación

- [ ] `POST /api/listas` crea una lista con nombre, tipo de elección, cantidad de lugares
      y un array de candidatos (nombre + orden); responde 201 con la lista creada,
      candidatos incluidos, en orden.
- [ ] `GET /api/listas` devuelve los borradores existentes, paginado con techo (igual
      convención que el resto del sistema: un `?limite=` sin tope no es aceptable).
- [ ] `GET /api/listas/:id` devuelve una lista con sus candidatos ordenados por `orden`.
- [ ] `PUT /api/listas/:id` edita nombre, tipo de elección, cantidad de lugares y la
      lista completa de candidatos (reemplazo, no parches sueltos: una lista de
      candidatos es una unidad, a diferencia de un relevamiento).
- [ ] `DELETE /api/listas/:id` borra el borrador y sus candidatos.
- [ ] Crear o editar una lista sin candidatos, o con órdenes duplicados dentro de la
      misma lista, responde 400.
- [ ] Cargar más candidatos que el tope definido (ver Restricciones) responde 400, no
      se acepta silenciosamente ni se trunca.
- [ ] `GET` exige `listas.view`; `POST`/`PUT`/`DELETE` exigen `listas.edit`. Un usuario
      sin el permiso recibe 403.
- [ ] Alta, edición y baja quedan auditadas (`services.auditoria`).
- [ ] `test/integracion.test.js` sigue pasando: el módulo nuevo declara sus permisos en
      su propia migración, no en la de `auth`.

## Restricciones

- **Un solo pool, migraciones idempotentes, errores lanzados, permisos por request,
  `process.env` sólo en `config.js`** — las reglas de siempre, sin excepción acá.
- **Auditar lo que modifica datos**: alta, edición y baja de listas y de candidatos
  pasan por `services.auditoria.registrarDeRequest`.
- **Costo de servidor por delante del alcance** (criterio nuevo, aplica a toda feature
  desde ahora): el volumen esperado es bajísimo — unas pocas listas por elección, con
  pocos candidatos cada una — así que no hay caché que agregar ni streaming que armar.
  El riesgo real es un payload sin techo: por eso el `?limite=` en el listado y un tope
  fijo de candidatos por lista (ver plan.md para el número exacto). Reemplazar la lista
  completa de candidatos en el `PUT` es una única transacción, no N deletes más N
  inserts sueltos.

## Riesgos

- **Reordenar candidatos sin transacción** deja huecos u órdenes duplicados si el
  proceso se corta a mitad de camino — por eso el `PUT` reemplaza todo dentro de una
  sola transacción, igual que el patrón de `db.transaccion` que ya usa el importador.
- **Un tope de candidatos demasiado bajo** bloquea un caso real (listas grandes de
  concejales, por ejemplo). El número se define en el plan con margen, no arbitrario.
