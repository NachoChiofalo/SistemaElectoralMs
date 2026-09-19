# Varias personas sobre el mismo padrón

El sistema lo usa más de una persona a la vez, todas sobre el mismo padrón y los mismos
DNIs. Este documento explica **cómo hace para que no se pisen**, y —tan importante como
eso— **qué sigue sin cubrir**.

Para las reglas que no se rompen, mirá [CLAUDE.md](../CLAUDE.md). Para el alcance, los
criterios y lo que se descartó con su razón, [specs/012-multiusuario/](../specs/012-multiusuario/spec.md).

---

## El problema, en hechos

Antes de esto, dos personas cargando al mismo tiempo se borraban datos entre sí y
**ninguna de las dos se enteraba**: el servidor respondía 200 en los dos casos. Había
cuatro mecanismos distintos, y el primero fallaba incluso con una sola persona.

**1. El panel mandaba dos escrituras en paralelo a la misma fila.** `guardarPanel` hacía
`Promise.all([actualizarTelefono(...), actualizarObservacion(...)])`, y cada una de esas
era un read-modify-write: leía el relevamiento entero "para preservar los otros campos" y
lo reescribía completo. Las dos leían el mismo estado previo, así que la que llegaba
última pisaba el campo de la otra. Cargar teléfono y observación juntos perdía uno de los
dos.

**2. Toda escritura era un reemplazo total, sin versión.** Entre el `GET` y el `PUT` de
`cambiarOpcionPolitica` cabía la escritura de cualquier otra persona, y se perdía.

**3. La ficha se llenaba desde un snapshot en memoria.** `abrirPanel` leía de
`votantesEnPantalla`, la página cargada la última vez que se tocó un filtro. Una pestaña
abierta hacía veinte minutos guardaba encima de veinte minutos de trabajo ajeno.

**4. Una sola sesión por usuario.** Con una cuenta compartida, cada login expulsaba al
anterior.

---

## Las tres capas, y qué cubre cada una

El orden importa, porque cada capa resuelve lo que la anterior no puede.

### 1. Escritura parcial — conflictos entre campos distintos

**Un campo que no viaja en el cuerpo no se escribe.** Quien carga un teléfono no
reescribe la observación, así que no puede pisarla, y no hace falta ningún mecanismo de
coordinación para eso.

El contrato, que se sostiene en las tres capas (ruta, service, repositorio):

| El cuerpo trae | Significa |
|---|---|
| `"telefono": "3511234"` | escribir ese valor |
| `"telefono": ""` | **vaciar** el campo |
| la clave ausente | **no tocar** el campo |

`null` no se usa: sería un tercer caso sin significado propio. La distinción
ausente-vs-vacío es la que sostiene todo lo demás, y tiene su propio test — un `|| ''` en
cualquier capa la rompe, porque convierte "no me lo mandaron" en "borralo".

En SQL, el `COALESCE` de la rama `DO UPDATE` va contra el **parámetro**, no contra
`EXCLUDED`:

```sql
ON CONFLICT (dni) DO UPDATE SET
  observacion = COALESCE($3, padron.relevamientos.observacion)
```

`EXCLUDED` ya trae el default aplicado en `VALUES`, así que usarlo volvería a escribir
`''` encima de lo que hubiera.

**Lo que esta capa no cubre:** dos personas editando *el mismo* campo.

### 2. Concurrencia optimista — el mismo campo

Ahí no hay truco de SQL que salve a las dos. Alguien tiene que perder; lo único que se
puede elegir es **si se entera**.

`padron.relevamientos` lleva `version`. El `GET` la devuelve, el cliente la guarda y la
manda de vuelta al escribir:

```sql
ON CONFLICT (dni) DO UPDATE SET
  ...,
  version = padron.relevamientos.version + 1
WHERE padron.relevamientos.version = $7
  AND ( COALESCE($2, ...) IS DISTINCT FROM ... OR ... )
RETURNING *
```

Si otra persona escribió en el medio, su escritura ya movió `version`, el `WHERE` no
matchea, **la fila no se toca** y `RETURNING` vuelve vacío. Eso es un 409 con el estado
actual del servidor en el cuerpo.

**Lo que lo hace hermético es que la comprobación y la escritura son una sola
sentencia.** Un `SELECT version` seguido de un `UPDATE` tendría exactamente la carrera
que el punto 1 del problema describe: entre las dos consultas se mete la escritura del
otro.

**Por qué un entero y no `fecha_modificacion`:** el timestamp ya existe, pero su
resolución no garantiza distinguir dos escrituras seguidas, y compararlo obliga a viajar
fechas serializadas con su formato y su zona. Un entero es exacto.

**Por qué los `IS DISTINCT FROM`:** guardar un valor idéntico al que ya estaba no
incrementa la versión. No es una optimización — es lo que evita que un guardado sin
cambios mueva la firma de "última edición" y le marque la fila como novedad a todos los
demás.

Ese `AND` mete un tercer caso de cero filas, y hay que desambiguarlo releyendo:

| Cero filas, y al releer… | Qué es | Respuesta |
|---|---|---|
| la versión coincide | no había nada que cambiar | **200**, fila intacta |
| la versión es otra | alguien escribió en el medio | **409** con su estado |
| no hay fila | el votante se borró | **404** |

**La versión es obligatoria.** No hay escritura a ciegas: sin versión es 400. Cuidado con
cómo falla eso, que es la trampa de todo este diseño — `WHERE version = NULL` **no
matchea nunca**, así que una llamada sin versión no daría error: devolvería 200 sin haber
escrito nada. Por eso se valida en la ruta *y* en el service, y hay un test. Un no-op
silencioso es peor que un error.

**Versión 0** significa "leí que este votante no tenía relevamiento". Si en el medio
alguien lo creó, la fila real está en 1, el 0 no coincide y sale el 409 que corresponde.
Es también el valor al que cae el cliente ante cualquier duda: no coincide con ninguna
fila existente, así que en la duda se consulta en vez de pisar.

### 3. Ver lo ajeno — antes de escribir

Las dos capas anteriores evitan la pérdida. Ésta evita el trabajo al pedo y el susto.

- **`padron.relevamientos` guarda quién la tocó** (`actualizado_por`,
  `actualizado_por_username`). El panel lo muestra arriba de todo: *"Última edición:
  jperez, hace 3 min"*. Va arriba y no al pie porque sirve para decidir si cargar encima,
  y eso se decide antes de escribir.
- **`abrirPanel` relee la ficha del servidor.** El snapshot del listado quedó sólo para
  la identidad del votante, que no cambia. Esto es además lo que hace que la versión
  sirva: si se mandara la de una página cargada hace veinte minutos, el 409 saltaría
  siempre — y un aviso que salta siempre se aprende a ignorar.
- **`GET /api/padron/cambios?desde=` cada 30 s** marca las filas que otra persona movió.

Sobre esa marca, tres reglas:

1. **Marca, nunca redibuja.** Redibujar una fila borraría lo que alguien está tipeando en
   ella: la misma pérdida de datos que veníamos a arreglar, por otra puerta.
2. **No marca lo propio.** Sin ese filtro, cambiar una opción política marcaría la propia
   fila y la señal se volvería ruido en una tarde.
3. **No corre con la pestaña en segundo plano.** No hay nadie mirando, y al volver la
   página se recarga entera.

**Por qué polling y no WebSocket:** `public/` es JS plano sin build y el servidor es
chico. Un GET cada 30 s que en el caso normal vuelve vacío cuesta menos que mantener una
conexión por usuario, y no agrega una segunda forma de hablar con el servidor.

---

## Qué ve la persona cuando hay conflicto

El panel **no se cierra**. Lo que escribió sigue en los campos, y abajo aparece lo que hay
en el servidor con quién lo puso, más dos botones: *Guardar lo mío igual* o *Quedarme con
lo del servidor*.

**Nadie mergea dos textos automáticamente.** Concatenarlos inventaría contenido que no
escribió ninguno de los dos. Ante un conflicto decide una persona.

Lo mismo desde la tabla: cambiar la opción política manda la versión del listado, y si
alguien ya la marcó, avisa y recarga en vez de pisar.

La regla que hay que sostener al tocar esta UI: **lo que la persona escribió no se pierde
por ningún camino del 409.**

---

## El esquema

```sql
-- 003_autoria_relevamientos.sql
ALTER TABLE padron.relevamientos
    ADD COLUMN IF NOT EXISTS actualizado_por          INTEGER,
    ADD COLUMN IF NOT EXISTS actualizado_por_username VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_relevamientos_modificacion  ON padron.relevamientos (fecha_modificacion DESC);
CREATE INDEX IF NOT EXISTS idx_relevamientos_fecha_detalle ON padron.relevamientos (fecha_detalle DESC);

-- 004_version_relevamientos.sql
ALTER TABLE padron.relevamientos
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
```

**Sin foreign key a `usuarios`, y con el username desnormalizado** al lado del id, igual
que `padron.auditoria`. El panel necesita mostrar un nombre y no un número, y un JOIN
entre esquemas en el camino del listado es justo lo que este repo evita. El costo es el de
cualquier desnormalización: si alguien se renombra, las filas viejas siguen diciendo el
nombre anterior. Para una firma de "quién tocó esto" eso es correcto, no un defecto.

**Dos índices de fecha, no uno**: las condiciones especiales se guardan por otro endpoint
y sólo mueven `fecha_detalle`, así que una ficha puede cambiar sin que
`fecha_modificacion` se entere.

`version` arranca en 1 sin backfill, que es exactamente lo que hace falta.

---

## El contrato de la API

| Endpoint | Qué cambió |
|---|---|
| `PUT /api/padron/relevamientos/:dni` | Sólo escribe los campos presentes. `opcionPolitica` dejó de ser obligatoria. **`version` es obligatoria.** Puede responder 409. |
| `GET /api/padron/relevamientos/:dni` | Agrega `version` y `actualizadoPor`. |
| `GET /api/padron/votantes` | Cada `relevamiento` trae `version`, para que la tabla pueda escribir sin releer. |
| `GET /api/padron/cambios?desde=<ISO>` | **Nuevo.** DNIs modificados desde ese momento, con su autor. Permiso `padron.view`. |
| `POST /api/padron/importar-csv` | Puede responder 409 si ya hay una importación en curso. |

El cuerpo del 409 trae el estado del servidor **con la misma forma que una lectura
normal**:

```json
{ "success": false, "code": "CONFLICT",
  "message": "Otra persona modifico esta ficha mientras la editabas",
  "errors": { "actual": { "opcionPolitica": "PJ", "observacion": "...",
                          "telefono": "...", "actualizadoPor": "ana", "version": 7 } } }
```

Que sea la misma forma es a propósito: si no, la UI necesitaría dos caminos para dibujar
lo mismo.

Ojo con `scripts/api-snapshot.js`: su lista de endpoints es de sólo lectura a propósito
(«Nada de esta lista modifica datos del padron»), así que **el PUT no está ahí** y estos
cambios de contrato no los ve. Sirve para confirmar que no se movió nada más.

---

## Lo que el multiusuario arrastró

Dos cosas que no eran "concurrencia" pero que cambian de gravedad cuando el sistema lo
usan varias personas:

**Escapado de datos (ítem 001).** `PadronComponent` interpolaba datos del votante en HTML
sin escapar. Con una sola persona el XSS es casi auto-infligido; con varias es una
ejecutando código en la sesión de otra, que puede tener más permisos. Ahora hay un helper
único en `public/src/lib/escapar.js` que **escapa también las comillas** — las dos copias
que existían usaban `textContent`/`innerHTML`, que deja pasar `"` y `'` y por lo tanto no
sirve dentro de un atributo, y este frontend interpola en `value=`, `title=` y `onclick=`.

Lo que va por `setAttribute` o `textContent` **no** se escapa: el DOM no parsea HTML ahí,
y escaparlo mostraría `&amp;` en un apellido con "&".

**Importación serializada (ítem 013).** `pg_try_advisory_xact_lock` al abrir la
transacción del importador: la segunda importación concurrente responde 409 en vez de
correr en paralelo compitiendo por el pool contra la gente que está relevando. `try_` y no
la versión que espera, porque esa dejaría el request colgado sin decir nada. El lock se
suelta solo al terminar la transacción —incluido el ROLLBACK y la caída del proceso—, así
que no hay nada que liberar a mano.

---

## Qué NO cubre

Decirlo es parte de que el diseño sea usable.

**Las condiciones especiales no llevan versión.** `POST /detalle-votante` no la chequea ni
la mueve. Dos razones: el panel guarda la ficha con dos requests seguidos contra la misma
fila, así que si este moviera la versión el segundo chocaría contra sí mismo; y la versión
cubre lo que se escribe a mano y duele perder —opción política, observación, teléfono—,
mientras que cuatro casillas se ven enteras en pantalla y el panel relee al abrirse.

**Dos dispositivos de la misma persona no conviven.** `active_sessions` tiene `user_id`
como clave primaria: entrar desde el celular cierra la sesión de la computadora. Es
deliberado y no se cambia; la cuenta es personal.

**Una sola instancia.** La caché de sesión de `core/security/sessions.js` y
`CacheResultados` son locales al proceso, **y eso es lo que las hace correctas**. Con dos
instancias hace falta Redis (ítem 010). Multiusuario no es multi-instancia: un proceso
Node atiende de sobra a las decenas de personas de esta elección.

**No hay señal de presencia** ("Juan tiene esta ficha abierta"). El 409 evita la pérdida,
pero avisa recién al guardar. Es el ítem 014, y se decide con datos: cada conflicto se
loguea con los dos usuarios (`logger.info`, que es dominio esperado y no falla), así que
después de una semana de uso se sabe si pasan dos veces por semana o veinte por día.

---

## Verificarlo a mano

El test de carrera real necesita base (ítem 003). Mientras tanto, con dos navegadores
distintos y dos usuarios:

1. Abrir la misma ficha en los dos.
2. En A: cambiar la observación y guardar.
3. En B: cambiar la observación y guardar → **409**, el panel no se cierra, se ve lo de A
   con su nombre, y lo que B escribió sigue en el campo.
4. En B elegir *Guardar lo mío igual* → entra, y la versión queda en la siguiente.
5. Sin recargar B, esperar 30 s después de un cambio de A en otra fila → esa fila queda
   marcada, y **nada de lo que B esté tipeando se pierde**.

Y el caso que fallaba con un solo usuario: abrir una ficha, cargar teléfono **y**
observación juntos, guardar, recargar. Los dos valores tienen que estar.

---

## Estado

Hecho en código, con 130 tests que corren sin base:

- Escritura parcial, concurrencia optimista, firma de autoría, aviso de cambios ajenos.
- Escapado (001) y lock de importación (013), los dos cerrados en el backlog.

Pendiente:

- **Aplicar las migraciones 003 y 004** (`npm run migrate`). Sin eso, nada de la versión
  ni de la autoría funciona contra la base real.
- La verificación manual de arriba y el snapshot de contrato.
- **Fase 3: un usuario por persona.** Es alta de usuarios, no código — y es lo último:
  dar de alta al segundo usuario antes de desplegar lo anterior es exactamente el
  escenario que todo esto viene a evitar.
- Test de carrera contra Postgres real (depende del ítem 003).
