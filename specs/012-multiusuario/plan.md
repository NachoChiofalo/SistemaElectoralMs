# 012 — Plan

Cómo se implementa la spec. Cada fase se puede mergear y desplegar sola.

**El orden no es negociable, y no es el mismo que el de la urgencia.**

La fase 0 va primera porque arregla lo único que ya está fallando hoy, con la única
persona que usa el sistema, y porque sin ella la fase 1 detectaría como conflicto lo que
en realidad es un artefacto del frontend: dos escrituras propias, disparadas por un mismo
botón, chocando entre sí. Ese 409 sería ruido, y el ruido es lo que hace que un aviso de
conflicto se aprenda a ignorar.

Pero **la fase 1 es la que resuelve el problema que describió el usuario**. Como todas
las personas relevan los mismos DNIs, la escritura parcial ya no alcanza: dos personas
escribiendo la misma observación del mismo votante el mismo día es un caso esperable. La
fase 0 sin la 1 sería un sistema que pierde menos, no uno que no pierde.

Traducido a calendario: 0 se puede desplegar mañana; **1 y 2 tienen que estar antes del
alta del segundo usuario**; 3 *es* esa alta.

---

## Fase 0 — Escritura parcial · S

### Idea

Un campo que no viaja en el cuerpo no se escribe. No es una optimización: es la única
forma de que dos personas editando campos distintos de la misma ficha no se toquen, sin
ningún mecanismo de coordinación.

La regla del contrato, que hay que sostener en todas las capas:

| El cuerpo trae | Significa |
|---|---|
| `"telefono": "3511234"` | escribir ese valor |
| `"telefono": ""` | vaciar el campo |
| la clave ausente | **no tocar el campo** |

`null` no se usa para nada: sería un tercer caso sin significado propio.

### Archivos

**1. `src/modules/padron/repository.js` — `upsertRelevamiento`.**
La fila nueva usa los valores por defecto de siempre; la existente sólo cambia donde el
parámetro no es `NULL`. El `COALESCE` de la rama `DO UPDATE` va contra el **parámetro**,
no contra `EXCLUDED`: `EXCLUDED` ya trae el default aplicado en `VALUES` y arruinaría la
distinción.

```sql
INSERT INTO padron.relevamientos (dni, opcion_politica, observacion, telefono)
VALUES ($1, COALESCE($2, 'Indeciso'), COALESCE($3, ''), COALESCE($4, ''))
ON CONFLICT (dni) DO UPDATE SET
  opcion_politica    = COALESCE($2, padron.relevamientos.opcion_politica),
  observacion        = COALESCE($3, padron.relevamientos.observacion),
  telefono           = COALESCE($4, padron.relevamientos.telefono),
  fecha_modificacion = CURRENT_TIMESTAMP
RETURNING *
```

**2. `src/modules/padron/service.js` — `actualizarRelevamiento`.**
Pasa `undefined` → `null` por campo ausente. `opcionPolitica` deja de ser obligatorio;
cuando viene, se sigue validando contra `OPCIONES_POLITICAS`. Si el cuerpo no trae
**ningún** campo conocido, es 400: un PUT vacío es un error del cliente, no un no-op.

**3. `src/modules/padron/routes.js` — `PUT /relevamientos/:dni`.**
Se cae el `if (!opcionPolitica) throw ...`. La validación de "algo que escribir" vive en
el service.

**4. `public/src/services/ApiService.js` — `actualizarRelevamiento`.**
Pasa a recibir un objeto de campos y a serializar sólo las claves presentes:
`actualizarRelevamiento(dni, campos)`. Es el cambio que habilita a los tres llamadores.

**5. `public/src/components/PadronComponent.js`.**
- `guardarPanel`: un solo PUT con `{ telefono, observacion }` + el POST de condiciones.
  Se va el `Promise.all` de dos escrituras a la misma fila.
- `actualizarTelefono` / `actualizarObservacion`: **se borraron**. Este plan decía que
  quedaban "porque hay otros llamadores"; al hacerlo resultó que `guardarPanel` era el
  único, así que eran dos métodos muertos con un `catch` que se tragaba el error.
- `cambiarOpcionPolitica`: manda `{ opcionPolitica }` y nada más. Se le va el GET.

### Verificación

- `npm test` con casos nuevos en `test/padron.test.js`: uno por campo escrito solo, y el
  par ausente-vs-vacío.
- `node scripts/api-snapshot.js --base http://localhost:8080 --compare ...` antes y
  después.
- A mano: abrir una ficha, cargar teléfono y observación juntos, guardar, recargar.

### Lo que esta fase NO arregla

Dos personas editando **el mismo campo** de la misma ficha. Esa es la fase 1.

---

## Fase 1 — Concurrencia optimista · M

### Migración

`src/modules/padron/migrations/004_version_relevamientos.sql`: (la 003 se la
llevó la fase 2, que se hizo antes)

```sql
ALTER TABLE padron.relevamientos
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
```

Idempotente y sin backfill: las filas existentes arrancan en 1, que es exactamente lo que
hace falta.

**Por qué una columna y no `fecha_modificacion`.** El timestamp ya existe, pero su
resolución no garantiza distinguir dos escrituras seguidas, y compararlo obliga a viajar
fechas serializadas de ida y vuelta, con su formato y su zona. Un entero es exacto y no
tiene ninguna de esas preguntas.

### Escritura

El `DO UPDATE` lleva `WHERE`, y el incremento sólo ocurre si algo cambió de verdad:

```sql
ON CONFLICT (dni) DO UPDATE SET
  ... ,
  version = padron.relevamientos.version + 1
WHERE padron.relevamientos.version = $7
  AND (
    COALESCE($2, padron.relevamientos.opcion_politica) IS DISTINCT FROM padron.relevamientos.opcion_politica
    OR COALESCE($3, padron.relevamientos.observacion)  IS DISTINCT FROM padron.relevamientos.observacion
    OR COALESCE($4, padron.relevamientos.telefono)     IS DISTINCT FROM padron.relevamientos.telefono
  )
RETURNING *
```

Los `IS DISTINCT FROM` son el "no incrementar si nada cambió". Y meten un tercer caso de
cero filas, que hay que desambiguar releyendo: **misma versión → no había nada que
cambiar, 200**; versión distinta → 409. Un guardado sin cambios no mueve la firma ni le
marca la fila como novedad a los demás, que es justo lo que evita que la señal de la
fase 2 se llene de ruido.

Cero filas devueltas significa una de dos cosas, y hay que distinguirlas releyendo:
- la fila no existe → 404 (hoy ya se chequea antes con `votantePorDni`);
- la versión no coincidía → `errores.conflicto`, con el estado actual en `detalles`.

**La compatibilidad `IS NULL` no llegó a existir.** El plan la tenía para desplegar
backend y frontend por separado, pero acá los dos salen en el mismo proceso, y un `IS
NULL` así se vuelve permanente por olvido. La versión es obligatoria desde el primer
commit: sin ella es 400.

Cuidado con cómo falla eso, que es la trampa de este cambio: `WHERE version = NULL` **no
matchea nunca**, así que una llamada sin versión no daría error — devolvería 200 sin
haber escrito nada. Por eso la validación está en la ruta *y* en el service, y hay un
test que la cubre. Un no-op silencioso es peor que un error.

El costo conocido: una pestaña abierta durante el deploy sigue corriendo el JS viejo
—`?v=` es `immutable`— y sus guardados dan 400 hasta que recargue. Es visible y se
arregla solo; una escritura a ciegas no.

### Respuesta del 409

```json
{ "success": false, "code": "CONFLICT",
  "message": "Otra persona modificó esta ficha mientras la editabas",
  "errors": { "actual": { "opcionPolitica": "...", "observacion": "...", "telefono": "...", "version": 7 } } }
```

Usa la forma que `manejadorErrores` ya arma (`errors` sale de `detalles`): no hay que
tocar el manejador ni inventar un formato nuevo.

### Frontend

- `abrirPanel` guarda la `version` que leyó en `panel.dataset.version`.
- `guardarPanel` la manda. Ante 409 **no cierra el panel**: marca los campos en conflicto,
  muestra el valor del servidor al lado del propio, y ofrece "usar el mío" (reintenta con
  la versión nueva) o "quedarme con el del servidor".
- Lo que la persona escribió no se pierde en ningún camino del 409. Es la parte que hay
  que probar a mano.

### Contar los conflictos

Cada 409 se loguea con el DNI y los dos usuarios involucrados (`logger.info`, no `warn`:
es una condición esperada del dominio, no una falla). Es el único dato que después
permite decidir el ítem 014 sin adivinar: si aparecen dos por semana, no hay que construir
nada más; si son veinte por día, la señal de presencia se paga sola.

### Test de carrera

En `test/padron.test.js`, dos PUT con la misma versión disparados sin `await` entre uno y
otro, resueltos con `Promise.allSettled`: exactamente uno 200 y uno 409. Este test
necesita base real — si todavía no está el ítem 003 (tests de integración contra
Postgres), va marcado y se corre a mano contra una base de desarrollo, sin colarlo en la
suite que corre sin base.

---

## Fase 2 — Ver lo ajeno · M

> **Ejecutada antes que la fase 1.** El orden del plan decía 1 y después 2; se hizo al
> revés por pedido. Lo que eso deja abierto está dicho en `tareas.md`: la ficha se abre
> fresca y con firma, pero el 409 no existe todavía, así que dos personas siguen pudiendo
> escribir el mismo campo. La migración de `version` de la fase 1 pasa a ser la `004`.

### Migración

`003_autoria_relevamientos.sql`:

```sql
ALTER TABLE padron.relevamientos
  ADD COLUMN IF NOT EXISTS actualizado_por          INTEGER,
  ADD COLUMN IF NOT EXISTS actualizado_por_username VARCHAR(100);
```

Sin foreign key a `usuarios` y con el username desnormalizado, igual que
`padron.auditoria`, que ya guarda `usuario_nombre` y `usuario_username` al lado del id. El
panel necesita mostrar un nombre, no un número, y no vale un JOIN entre esquemas en el
camino del listado.

El service ya recibe `req` para auditar: de ahí salen los dos valores. `repository` sigue
sin conocer `req`.

### Panel desde el servidor

`abrirPanel` pasa a ser `async` y pide `GET /relevamientos/:dni` + `GET /detalle-votante/:dni`
antes de dibujar. El snapshot queda sólo para lo que no cambia (nombre, DNI, circuito).
Son dos requests contra una fila indexada por clave primaria, al abrir una ficha: no es
un costo que haya que administrar.

En el encabezado del panel: *"Última edición: Juan Pérez, hace 3 min"*.

### Cambios ajenos en la tabla

`GET /api/padron/cambios?desde=<ISO>` devuelve los DNIs con `fecha_modificacion` o
`fecha_detalle` posterior a `desde`. La página lo consulta cada 30 s con el timestamp de
su última carga y marca esas filas.

Requisitos duros de esa marca:
- **marca, nunca redibuja.** Redibujar una fila borraría lo que alguien está tipeando en
  ella: la misma pérdida de datos que veníamos a arreglar, por otra puerta;
- no toca el panel abierto;
- es una clase CSS con token `--ds-*`, no un color suelto. El borde izquierdo ya
  significa relevado / sin relevar, así que la señal va como tinte de fondo más un punto
  en el DNI, en ámbar — que en esta interfaz ya significa advertencia y no compite con el
  azul, el rojo y el gris de la opción política;
- **no marca lo propio.** Sin ese filtro, cambiar una opción política marcaría la propia
  fila y la señal se volvería ruido en una tarde.

Y una consecuencia de que abrir la ficha ahora espere al servidor: dos clics seguidos son
dos lecturas en vuelo, y la primera puede volver última. Sin un guard, se dibuja la ficha
equivocada sobre el DNI que la persona eligió — peor que no abrir nada.

Necesita índice — **dos**, no uno: las condiciones especiales se guardan por otro
endpoint y sólo mueven `fecha_detalle`, así que una ficha puede cambiar sin que
`fecha_modificacion` se entere.

```sql
CREATE INDEX IF NOT EXISTS idx_relevamientos_modificacion
  ON padron.relevamientos (fecha_modificacion DESC);

CREATE INDEX IF NOT EXISTS idx_relevamientos_fecha_detalle
  ON padron.relevamientos (fecha_detalle DESC);
```

**Por qué polling y no WebSocket**: `public/` es JS plano sin build y el servidor es
chico. Un GET cada 30 s que en el caso normal devuelve una lista vacía cuesta menos que
mantener una conexión por usuario, y no agrega una segunda forma de hablar con el
servidor.

---

## Fase 3 — Identidad por persona · S

Decidido: **un usuario por persona, la cuenta no se comparte.** No hay código.

- Alta de los usuarios con el rol que corresponda (`npm run seed:usuarios` crea el
  administrador; el resto sale de la pantalla de usuarios, que ya existe).
- En `CLAUDE.md`, entre las reglas que no se rompen: *la cuenta es personal*. La razón
  importa más que la regla — `padron.auditoria` y el `actualizado_por` de la fase 2
  atribuyen por usuario, y una sola cuenta compartida los deja mintiendo a los dos.

**Lo que esta decisión elimina.** No hace falta tocar `active_sessions` ni
`core/security/sessions.js`. La clave primaria por `user_id`, el `ON CONFLICT (user_id)`
del login y la caché por jti quedan exactamente como están, que es lo que conviene: ese
archivo es donde vive el ahorro de consultas del refactor y lo peor que se le puede hacer
es abrirlo sin necesidad.

**La consecuencia que sí queda**, y que hay que avisar al dar de alta: una misma persona
no puede estar logueada en dos dispositivos a la vez; entrar desde el celular cierra la
sesión de la computadora. Es el comportamiento actual y es deliberado. Si en algún momento
molesta de verdad —alguien relevando en la calle con el teléfono y consultando desde la
oficina— es un ítem propio, no un agregado a este.

**El orden de esta fase respecto de las otras es el punto entero.** Dar de alta al segundo
usuario antes de desplegar las fases 0 a 2 es exactamente el escenario que esta spec viene
a evitar. El alta es la última tarea, no la primera.

---

## Alternativas descartadas

**Bloqueo pesimista de la ficha.** "Juan está editando este DNI, no podés entrar." Exige
liberar el lock, y una pestaña que se cierra sin avisar deja fichas trabadas hasta que
vence un TTL. Termina siendo un TTL igual, más una pantalla de "trabado por alguien que
ya se fue". La concurrencia optimista tiene el mismo efecto útil (nadie pisa a nadie) sin
estado que haya que liberar.

**Señal de presencia sin bloqueo** ("Juan tiene esta ficha abierta") — es la mitad buena
del lock: informa y no impide. Como todas relevan los mismos DNIs, el caso que justifica
esto **sí va a pasar**, así que deja de ser especulación: es el ítem 014.

No entra igual en esta spec, por dos razones. Primero, llega tarde: avisa mientras alguien
escribe, pero el que evita la pérdida es el 409, y el 409 no necesita presencia para
funcionar. Segundo, es la única pieza de todo esto que necesita estado efímero de
servidor —quién tiene abierto qué, con heartbeat y expiración— y ese estado es justo el
que se rompe en silencio si algún día hay dos instancias. Conviene tenerlo como ítem
separado, tomado con el sistema ya en uso y sabiendo cuántos 409 aparecen por día. Si son
dos por semana, no hay nada que construir.

**Merge automático de observaciones.** Concatenar los dos textos ante un conflicto
inventa contenido que nadie escribió. Ante un conflicto decide una persona.

**Último-que-escribe-gana, pero avisando después.** Mucho más barato que el 409, y ya
casi existe: la auditoría guarda `datos_anteriores`. Se descarta porque el aviso llega
cuando el dato ya se perdió, y recuperarlo es un trabajo manual contra la tabla de
auditoría.

**Serializar por DNI con `pg_advisory_xact_lock`.** Resuelve la escritura simultánea
exacta, pero no el problema real, que es que alguien guarda datos viejos **minutos**
después de haberlos leído. El lock los serializa y los dos ganan igual; el segundo sigue
pisando.

**Redis / segunda instancia.** Ítem 010, y no hace falta: multiusuario no es
multi-instancia.

---

## Fuera de esta spec, detectado en el camino

Van al backlog como ítems propios, no acá:

- **013 — Importación de CSV sin serializar.** Dos importaciones simultáneas corren dos
  `COPY` + `INSERT ... ON CONFLICT` sobre `padron.votantes` a la vez. No corrompe (el
  upsert es por DNI y no toca `relevamientos`), pero duplica el trabajo y compite por el
  pool. Un `pg_advisory_xact_lock` al principio de la transacción y un 409 para la
  segunda lo resuelven en pocas líneas.
- **014 — Señal de presencia en la ficha.** Ver alternativas descartadas: se toma con el
  sistema ya en uso por varias personas y con la cuenta de 409 por día a la vista.
- **001 — Escapar los datos del votante**, que ya está en el backlog y empeora con más
  gente cargando texto libre: una observación con `</textarea><script>` se ejecuta en la
  pantalla de todos los demás. Con un solo usuario el XSS es casi auto-infligido; con
  varios es una persona ejecutando código en la sesión de otra, que puede tener más
  permisos. **Eso sube a 001 de prioridad, no la baja** — y conviene hacerlo antes del
  alta del segundo usuario, junto con las fases 1 y 2.
