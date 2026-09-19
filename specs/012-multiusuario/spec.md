# 012 — Multiusuario sin pisarse

> Estado: en curso — fases 0, 1 y 2 hechas en código; falta aplicar las migraciones
> contra la base y la fase 3 (alta de usuarios).
> Tamaño estimado: L (se ejecuta en cuatro fases; la primera es S)

> Cómo quedó implementado, en un solo lugar y para quien llegue después:
> [docs/MULTIUSUARIO.md](../../docs/MULTIUSUARIO.md). Esta spec es el **qué** y el
> **porqué**; ese documento es el mecanismo terminado.

## Problema

*(Escrito antes de arreglarlo, y se deja en presente a propósito: es el estado contra el
que hay que leer los criterios de aceptación.)*

Dos personas trabajando al mismo tiempo sobre el padrón se borran datos entre sí, y
ninguna de las dos se entera. No es un riesgo teórico: hay cuatro mecanismos distintos,
y el primero falla **incluso con un solo usuario**.

**1. `guardarPanel` manda dos escrituras en paralelo a la misma fila.**
`public/src/components/PadronComponent.js:754` hace:

```js
await Promise.all([
  this.actualizarTelefono(dni, ...),     // GET relevamiento -> PUT con observación vieja
  this.actualizarObservacion(dni, ...),  // GET relevamiento -> PUT con teléfono viejo
  ... POST detalle-votante
]);
```

`actualizarTelefono` (`:961`) y `actualizarObservacion` (`:944`) son cada una un
read-modify-write: leen el relevamiento entero para "preservar los otros campos" y lo
reescriben completo. Corriendo en paralelo, las dos leen el mismo estado previo. La que
llega última pisa el campo de la otra. Cargar teléfono y observación en la misma pasada
pierde uno de los dos, con un solo usuario y sin ningún mensaje de error.

**2. Toda escritura de relevamiento es un reemplazo total, sin versión.**
`PUT /api/padron/relevamientos/:dni` escribe siempre `opcion_politica`, `observacion` y
`telefono` (`src/modules/padron/repository.js:165`). `cambiarOpcionPolitica`
(`PadronComponent.js:909`) hace GET y después PUT: entre esos dos requests, lo que haya
escrito otra persona se pierde. Nadie lo ve: la respuesta es 200.

**3. El panel se llena desde un snapshot en memoria, no desde el servidor.**
`abrirPanel` (`:651`) lee de `this.estado.votantesEnPantalla`, la página que se cargó la
última vez que se tocó un filtro. Una pestaña abierta hace veinte minutos guarda encima
de veinte minutos de trabajo ajeno. Lo mismo `POST /detalle-votante`, que manda las cuatro
condiciones enteras: revierte las que cambió otro.

**4. Una sola sesión por usuario.** `active_sessions` tiene `user_id` como clave
primaria (`src/modules/auth/migrations/001_esquema_auth.sql:60`) y el login hace
`ON CONFLICT (user_id) DO UPDATE SET session_jti = ...`: la segunda sesión de una cuenta
expulsa a la primera. **Resuelto por decisión, no por código**: cada persona va a tener su
usuario, así que esto deja de ser un mecanismo de pérdida. Queda una consecuencia menor
—una misma persona no puede tener la tablet y la computadora abiertas a la vez— que es el
comportamiento buscado y no se cambia.

## Por qué ahora

Es la prioridad uno declarada: el sistema tiene que poder usarse con varias personas
relevando a la vez. Hoy no puede, y el modo de fallar es el peor posible — silencioso y
sin rastro visible para quien lo sufre. El dato existe en `padron.auditoria`
(`datos_anteriores` guarda la fila completa), así que una pérdida es **reconstruible**,
pero sólo si alguien sospecha que ocurrió.

Cuanto más se demore, más cargas se hacen sobre un modelo que las pierde, y más grande es
el trabajo de auditar qué se perdió.

## Alcance

Cuatro fases, en este orden. Cada una es entregable por su cuenta.

**Fase 0 — Escritura parcial.** Un endpoint de relevamiento sólo escribe los campos que
vienen en el cuerpo. Quien carga un teléfono no vuelve a escribir la observación, así que
no puede pisarla. El frontend deja de hacer read-modify-write y deja de mandar dos
escrituras en paralelo a la misma fila.

**Fase 1 — Concurrencia optimista.** `padron.relevamientos` lleva `version`. Quien guarda
manda la versión que leyó; si no coincide, la escritura no se aplica y la respuesta es
409 con el estado actual del servidor. Se termina el "pisé algo y no me enteré".

**Fase 2 — Ver lo ajeno.** El relevamiento guarda quién lo tocó último y cuándo. El panel
relee la ficha del servidor al abrirse, muestra esa firma, y la tabla marca las filas que
cambiaron desde que se cargó la página.

**Fase 3 — Identidad por persona.** Un usuario por persona, con su rol. Cero código: es
alta de usuarios y dejar escrita la política de que la cuenta no se comparte. Es también
el disparador del resto: no se da de alta al segundo usuario con las fases 0 a 2 sin
desplegar.

## Fuera de alcance

- **Redis y más de una instancia.** Es el ítem 010 y es un problema distinto:
  multiusuario no es multi-instancia. Un proceso Node atiende de sobra a las decenas de
  personas que releva esta elección. Mientras haya una sola instancia, la caché de sesión
  y `CacheResultados` siguen siendo correctas.
- **WebSockets / tiempo real.** La fase 2 se resuelve con un GET condicional. Una
  conexión persistente por usuario en un servidor chico, para avisar de un cambio cada
  varios minutos, no se paga sola.
- **Edición colaborativa dentro de un mismo campo** (tipo documento compartido). El grano
  del conflicto es la ficha, no el carácter.
- **Bloqueo pesimista** ("Juan está editando esta ficha, esperá"). Ver alternativas
  descartadas en el plan.
- **Señal de presencia** ("Juan tiene esta ficha abierta"). Es el ítem 014, y se decide
  con el conteo de 409 que deja la fase 1, no antes.
- **Merge automático de textos en conflicto.** Ante un 409 decide la persona, no el
  sistema.

## Criterios de aceptación

Fase 0
- [x] `PUT /api/padron/relevamientos/:dni` con `{ "telefono": "351..." }` no modifica
      `observacion` ni `opcion_politica`: se verifica leyendo la fila antes y después.
- [x] Mandar `{ "observacion": "" }` **sí** vacía la observación. Omitir la clave la deja
      intacta. La diferencia entre las dos cosas está cubierta por un test.
- [ ] Guardar la ficha del panel con teléfono y observación nuevos a la vez deja los dos
      valores guardados. Hoy se pierde uno. *(Prueba manual: necesita base.)*
- [x] `guardarPanel` hace una sola escritura de relevamiento, y no manda dos escrituras
      simultáneas contra la misma fila.
- [ ] `node scripts/api-snapshot.js` antes y después: **sin diferencias**.
      Ojo con lo que este criterio *no* cubre: la lista de endpoints del snapshot es de
      sólo lectura a propósito («Nada de esta lista modifica datos del padron»), así que
      el PUT de relevamientos no está ahí y el cambio de contrato no se ve. El snapshot
      sirve para confirmar que no se movió nada *más*; el PUT lo cubren los tests y la
      prueba manual.

Fase 1
- [x] `GET /relevamientos/:dni` devuelve `version`.
- [x] Un PUT con `version` desactualizada responde 409, **no modifica la fila**, y el
      cuerpo trae el estado actual del servidor.
- [x] Un PUT con la versión correcta responde 200 y la versión devuelta es la anterior + 1.
- [~] Dos PUT simultáneos con la misma versión: uno responde 200, el otro 409. Cubierto
      **a nivel service**, con un repo falso que imita el `WHERE`. Que Postgres serialice
      de verdad dos `ON CONFLICT DO UPDATE` sobre la misma fila necesita base real: espera
      al ítem 003.
- [x] El panel, ante un 409, muestra el valor del servidor junto al propio y no cierra
      perdiendo lo escrito.

Fase 2
- [x] `GET /relevamientos/:dni` devuelve quién lo modificó último y cuándo.
- [x] `abrirPanel` pide la ficha al servidor; lo que se muestra no sale del snapshot.
- [ ] Con la ficha de un DNI abierta en dos pestañas, guardar en una hace que la otra
      muestre la firma ajena al intentar guardar. *(Prueba manual: necesita base.)*
- [x] La tabla marca visualmente las filas modificadas por otro desde que se cargó, sin
      re-renderizar la fila que se está editando ni robar el foco.

Fase 3
- [ ] Cada persona entra con su propio usuario y su propio rol.
- [ ] `padron.auditoria` muestra nombres distintos para cargas de personas distintas.
- [ ] Escrito en `CLAUDE.md`: la cuenta es personal y por qué (una cuenta compartida
      vuelve inútil la auditoría entera y rompe la atribución de la fase 2).
- [ ] Las fases 0, 1 y 2 están en producción **antes** del alta del segundo usuario.

## Restricciones

- **No tocar el frontend para cambiar el backend.** Acá se toca `public/` con razón: los
  mecanismos 1 y 3 del problema *son* del frontend. Lo que no entra es rediseñar la
  página aprovechando el viaje.
- **Migraciones idempotentes.** `ADD COLUMN IF NOT EXISTS`, valores por defecto para las
  filas que ya existen. Una migración aplicada no se edita.
- **`routes` no escribe SQL; `repository` no conoce `req`/`res`.** El 409 se lanza con
  `errores.conflicto` desde el service, nunca se responde a mano.
- **Toda escritura de relevamiento invalida `CacheResultados`.** Vale también para las
  que se agreguen acá.
- **Ningún color fuera del design system.** La marca de "modificado por otro" sale de un
  token `--ds-*`.

## Riesgos

- **Cambiar el upsert a escritura parcial puede dejar de escribir un campo que antes sí
  se escribía.** Es el riesgo central de la fase 0: se manifiesta como "cargué algo y no
  quedó", que es exactamente lo que venimos a arreglar. Mitigación: tests por campo, y la
  regla de que ausente ≠ vacío queda cubierta por su propio test.
- **La versión puede volverse ruido.** Si el 409 aparece seguido sin que haya conflicto
  real, la gente aprende a ignorarlo. Mitigación: `version` no se incrementa si ningún
  valor cambió, así que un 409 siempre corresponde a un cambio real de otro.
- **El aviso de cambios ajenos puede pisar lo que alguien está tipeando.** Mitigación:
  marcar la fila, nunca reemplazar el contenido de un control con foco.
- **Auditoría por escritura.** La fase 0 baja de tres escrituras a una al guardar el
  panel; conviene confirmar que `registrarDeRequest` no se dispara cuando nada cambió.
- **`ON CONFLICT ... DO UPDATE ... WHERE` que no aplica devuelve cero filas**, igual que
  un DNI inexistente. Hay que distinguir los dos casos releyendo, o el 409 aparecería
  donde corresponde un 404.

## Decisiones tomadas

1. **Hoy hay una sola persona cargando. En el futuro van a ser varias, cada una con su
   usuario.** No se comparte cuenta. La fase 3 queda en crear los usuarios y escribir la
   política: no hay código de sesiones. `active_sessions` con `user_id` como clave
   primaria sigue siendo correcto — el mecanismo 4 del problema deja de ser un mecanismo.
2. **Todas relevan sobre el mismo padrón, los mismos DNIs.** El trabajo no está repartido
   por circuito. Dos personas editando el mismo campo de la misma ficha es un caso
   esperable, no un accidente raro.

Lo que eso cambia respecto de la primera versión de esta spec:

- **La fase 1 deja de ser "el caso raro pero irreparable" y pasa a ser el corazón.** Con
  el trabajo repartido por circuito, la escritura parcial casi alcanzaba. Sobre los
  mismos DNIs, dos personas escriben la misma observación el mismo día.
- **La fase 3 baja de L a S y se puede hacer en cualquier momento.** Pero es el disparador
  de todo lo demás (ver abajo).
- **La señal de presencia** ("Juan tiene esta ficha abierta") **vuelve a estar sobre la
  mesa**, porque el supuesto que la descartaba —que los conflictos casi no pasan— es
  falso. No entra en esta spec igual: ver el porqué en el plan. Queda como ítem 014.

## Cuándo hace falta cada fase

Que hoy haya una sola persona no vuelve esto menos urgente, lo ordena:

- **La fase 0 hace falta ya**, con un solo usuario: la pérdida de teléfono-vs-observación
  al guardar el panel ocurre hoy, en cada carga que use los dos campos.
- **Las fases 1 y 2 tienen que estar en producción *antes* de dar de alta al segundo
  usuario.** No después. Ese alta es el momento exacto en que el sistema empieza a perder
  datos que nadie va a poder atribuir, y es una fecha que se controla.
- **La fase 3 es ese alta.** Es el disparador, no el final.
