# 026 — La pantalla no contradice al servidor

> Estado: borrador
> Tamaño estimado: M

## Problema

*(En presente: es el estado contra el que se leen los criterios.)*

La noche del 2026-10-14 una relevadora cargó unas 90 páginas del padrón y reportó que "a
cada rato" el sistema le decía que la fila no se había guardado y que reintentara, "dos o
tres veces en la misma página". Lo atribuyó a su internet. Los logs de Render muestran
otra cosa: el servidor respondió todo en ~160 ms, sin un solo 5xx, 429 ni 401. Lo que
hay son **nueve 409 contra sí misma**, todos con la misma forma:

```
11:55:50  PUT /api/padron/relevamientos/17349963  200
11:55:51  Conflicto de edicion  versionEnviada: 0, versionActual: 1, ultimaEdicionDe: <ella>
11:55:51  PUT /api/padron/relevamientos/17349963  409
11:55:54  PUT /api/padron/relevamientos/17349963  200   ← el reintento anda
```

El 409 existe para decir "otra persona editó esta ficha". Acá lo disparaba el propio
cliente, que mandaba una versión que ya no era la del servidor. Dos caminos llegaban a
eso, y los dos se corrigieron como arreglo inmediato (ver "Lo que ya se hizo"):

1. `cambiarOpcionPolitica` mandaba la versión de `votantesEnPantalla` y, al guardar bien,
   no la actualizaba. Corregir la misma fila antes de recargar la tabla mandaba la vieja.
2. El listado (`formatearFila` en `padron/routes.js`) armaba `relevamiento` —y su
   `version`— sólo si la fila tenía opción política. Una ficha guardada desde el panel
   con teléfono u observación ya tiene versión 1, pero la tabla la veía como 0.

El arreglo tapa esos dos agujeros, **no la forma del problema**: lo que el servidor sabe
de una fila vive copiado en el cliente en más de un lugar (`votantesEnPantalla`,
`panel.dataset.version`), y cada camino de escritura se acuerda o no de actualizarlo. El
próximo camino que se agregue —o el próximo campo— vuelve a abrirlo. Además quedan
huecos que no se vieron esa noche pero tienen la misma raíz:

- **Dos escrituras en vuelo sobre la misma fila.** Dos clics rápidos en las opciones de
  una fila salen en paralelo con la misma versión; uno de los dos es un 409 seguro.
  `CLAUDE.md` ya lo prohíbe ("tampoco se mandan dos escrituras simultáneas a una misma
  fila"), pero nada lo impide en los radios.
- **Un timeout de escritura es ambiguo.** `ApiService` corta a los 10 s. Si el servidor
  escribió igual, la pantalla dice "no se pudo guardar", revierte la fila y el reintento
  choca con un 409 propio.
- **El 409 propio se explica como ajeno.** "Fulano ya había marcado X en esta fila",
  con Fulano = una misma, no dice nada útil. Con dos pestañas abiertas es real y es
  propio; el mensaje debería decirlo.

## Por qué ahora

Faltan semanas de carga intensa (el padrón nuevo llega la semana que viene) y quien más
carga es quien más choca. Un aviso que salta sin motivo se aprende a ignorar, y el día
que dos personas sí se pisen, el 409 —lo único que [012](../012-multiusuario/spec.md)
puso para que no se pierdan cargas— va a estar entrenado como ruido.

## Lo que ya se hizo (arreglo inmediato, fuera de esta spec)

- `PadronComponent.cambiarOpcionPolitica` copia la versión devuelta al item en pantalla.
- `formatearFila` arma `relevamiento` cuando existe la fila, con `opcionPolitica: null`
  si no tiene opción. De paso, las marcas de teléfono y observación ahora aparecen en
  esas filas (antes no se veían).
- Tests: `padron.test.js` (forma del listado) y `frontend-regresiones.test.js` (guarda
  estática sobre `cambiarOpcionPolitica`).

## Alcance

- El estado de cada fila del padrón en el cliente: de dónde sale la versión que se manda
  y quién la actualiza.
- Las escrituras de relevamiento y detalle desde la tabla y desde el panel.
- Qué ve la persona ante un 409 propio y ante un timeout de escritura.
- Una prueba de comportamiento (no estática) del circuito marcar → cambiar → cambiar.

## Fuera de alcance

- Cambiar el contrato del 409 o la regla "decide una persona": no se mergea nada solo.
- Reintentar escrituras automáticamente a ciegas.
- Paginación keyset (009) y señal de presencia (014).
- Diagnóstico de reportes (id de request, log de 409 propio, guía): es 027.

## Criterios de aceptación

- [ ] Hay **un solo lugar** en el cliente que guarda la versión conocida de cada DNI. La
      tabla y el panel la leen de ahí; toda respuesta de escritura exitosa (opción, panel,
      detalle) y toda relectura la actualizan. Un test falla si un camino de escritura
      manda una versión que no salió de ese lugar.
- [ ] Dos escrituras sobre el mismo DNI nunca están en vuelo a la vez: la segunda espera a
      la primera y sale con la versión que ésta devolvió. Escrituras sobre DNIs distintos
      no se esperan entre sí.
- [ ] Marcar, cambiar y volver a cambiar la opción de una misma fila —rápido, sin recargar,
      y también después de guardar teléfono u observación desde el panel— produce **cero
      409**. Verificado con Playwright y la API interceptada, como `verificar-mapa.js`.
- [ ] Una edición real de otra persona en el medio **sigue** dando 409 y sigue mostrando
      el valor del servidor (la regresión que más importa).
- [ ] Si una escritura se corta por timeout, antes de decir "no se guardó" se relee la
      fila. Si el servidor ya tiene el valor pedido, se informa como guardado.
- [ ] Un 409 cuya última edición es de la misma persona se explica como tal ("ya lo
      guardaste, quizás en otra pestaña") y no con su propio nombre como si fuera ajeno.
- [ ] En los logs de producción, una semana de carga normal no muestra 409 con
      `ultimaEdicionDe` igual a `usuario` salvo con dos pestañas abiertas.

## Restricciones

- **Una escritura manda sólo los campos editados y dice qué versión leyó** (`CLAUDE.md`).
  Nada de esto puede releer una fila para "preservar" campos ni escribir sin versión.
- **Nunca dos escrituras simultáneas a una misma fila**: este trabajo es el que lo
  garantiza en el cliente.
- **No tocar el frontend para cambiar el backend** no aplica al revés: esto es frontend;
  el backend sólo cambia si la respuesta de alguna escritura no trae la versión.
- Sin `onclick=`, sin colores sueltos, todo dato de usuario con `escaparHtml`.
- `npm run build:assets` después de tocar `public/`.

## Riesgos

- **Ocultar un conflicto real.** El modo de falla silencioso es el peor: si el cliente
  "arregla" la versión con lo que sea que tenga a mano, un 409 legítimo deja de saltar y
  vuelve el bug que cerró 012. Por eso el criterio de la edición ajena es obligatorio.
- **La cola por DNI se traba.** Una escritura que nunca resuelve (red caída) no puede
  bloquear para siempre las siguientes de esa fila: el timeout la libera.
- **Relectura tras timeout con la red caída.** Si la relectura también falla, se informa
  como "no se pudo confirmar", nunca como guardado.
