# Sistema Electoral — guía para trabajar en este repo

Monolito modular en Node 20. Un proceso sirve la API y el frontend. La base es
PostgreSQL en **Supabase** y no se cambia.

Antes esto eran microservicios (`gateway-service`, `auth-service`, `padron-service` y
un contenedor con `serve` para el frontend). Si encontrás documentación, ramas o
comentarios que hablen de puertos 3001/3002/8080 separados, están desactualizados.

---

## Reglas que no se rompen

**No tocar el frontend para cambiar el backend.** `public/` consume `/api/*` con
`window.location.origin`. Si un cambio de servidor obliga a editar `public/`, el cambio
está mal planteado. La excepción es una feature nueva que necesite UI nueva.

**Ningún color fuera del design system.** En `public/` no se escribe `#hex` ni `white`:
todo sale de un token `--ds-*` de `design-system.css`. No es prolijidad — es lo único
que hace posible el modo oscuro, porque redefinir los tokens alcanza para cambiar la
aplicación entera. Hay un test que falla si entra un color suelto, en css, html **y js**
(los estilos inline dentro de plantillas también cuentan: los modales de sesión llevaban
`background:white` y eran lo único que no seguía el tema).

Es también lo que permitió rehacer la identidad visual entera —de navy y dorado con
degradados a una escala neutra con acento grafito y superficies planas— tocando casi
sólo `design-system.css`. Los degradados y las sombras siguen existiendo como tokens, pero con valores
planos y `none`: así se apagan en todos sus usos sin perseguir cada regla.

**Un solo pool de PostgreSQL.** Se recibe por inyección (`db` en `register`). Nunca
`new Pool()`. La versión anterior tenía ocho instancias de `Database`, cada una con su
pool: hasta 120 conexiones potenciales contra Supabase.

**Dentro de una transacción, nada de leer por el pool.** `db.transaccion(fn)` da un
`cliente` propio; `fn` tiene que usarlo para *todo* lo que necesite ver sus propios
cambios sin confirmar — otra conexión del pool está en `READ COMMITTED` y no los ve
todavía. El bug real: `ComicioRepository.reemplazarVotos` mandaba el `UPDATE`/`INSERT`
por `cliente` pero releía el resultado con `this.db` (el pool) *antes* del `COMMIT`, y
la respuesta volvía con los valores viejos aunque la escritura ya estaba hecha. Si hace
falta releer algo recién escrito, se hace después de que `transaccion()` resuelve (ya
comprometido), no adentro del callback.

**`process.env` solo se lee en `core/config.js`.** El resto usa `config`.

**Los errores se lanzan, no se responden.** `errores.*` de `core/errors` + `asyncHandler`.
Nada de `res.status(500).json(...)` dentro de un handler.

**El esquema se cambia con migraciones, y toda migración tiene que ser idempotente**
(`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Verificado: `npm run migrate` corrido
directo contra una base con las tablas y datos del sistema viejo no tocó lo existente
y sembró lo que faltaba. Eso es lo que permite no usar `migrate:adopt` — que existe
pero es más arriesgado, porque salta migraciones enteras sin ejecutarlas. Una
migración aplicada no se edita: se agrega la siguiente.

**Las migraciones NO corren solas al desplegar.** `render.yaml` declara un `dockerCommand`
con `npm run migrate`, pero el servicio real arranca con el `CMD` del Dockerfile
(`node src/server.js`), que se niega a levantar si hay migraciones pendientes. El orden es:
`npm run migrate:status` → backup → `npm run migrate` → recién ahí push/deploy. Si se hace
al revés, el deploy falla al arrancar (sin tocar la base) y sigue sirviendo la versión anterior.

**No hay base de staging: `DATABASE_URL` es la de producción.** `npm run migrate`
corrido desde un checkout local aplica directo contra Supabase real — lo confirmó
`npm run migrate:status` al implementar [G3](specs/G3-sesion-jwt/spec.md). Una migración que
sólo crea esquema (`CREATE TABLE IF NOT EXISTS`) es de bajo riesgo correrla sin avisar;
una que además toca datos existentes (`DELETE`, `UPDATE`, purgar algo) puede afectar
sesiones o datos de gente usando el sistema en ese momento, y se confirma con la
persona antes de correrla — no hay forma de probarla primero en otro lado.

**Las opciones políticas no se escriben en el código.** Cada instancia (un cliente, una
localidad) tiene las suyas en `padron.opciones_politicas`, y se configuran desde la pantalla
Configuración (solo administrador). Ni el esquema, ni el SQL, ni el frontend pueden nombrar
`'PJ'` o `'UCR'`: el backend las lee de `OpcionesPoliticas` (`padron/opciones.js`, con caché
en memoria) y el frontend de `window.opcionesPoliticas` (`lib/opciones.js`). Los resultados no
traen una columna por opción sino objetos `votos` y `porcentajes` `{ codigo: n }`; el color es un
índice 1–8 a `--ds-fuerza-N` (clase `op-N`), nunca un hex. Un test falla si un literal vuelve a
entrar. El `codigo` de una opción no se renombra (lo guardan los relevamientos); una opción con
relevamientos no se borra. Ver [021](specs/021-instancia-por-municipio/spec.md).

**La ubicación de los votantes en el mapa se calcula en lote; ninguna ruta hace geometría en vivo.**
`territorio` ubica a cada votante en una manzana al importar el padrón (se suscribe a
`PadronService.alCambiar`; el padrón no sabe que el mapa existe) o con el botón "Recalcular", y lo deja
en `territorio.ubicaciones`. Las rutas leen agregados con una consulta indexada. Las capas (calles con
alturas, manzanas, radios censales) se copian a la base con `npm run territorio:cargar`: ninguna ruta
le pide nada al portal de Estadística, y nada del padrón sale del servidor. Un domicilio que no se
puede resolver queda pendiente con su motivo, **nunca** con un punto inventado (la base lo impide). Y
**el umbral de privacidad lo aplica el servidor**: una zona con menos relevados que el umbral (10 por
defecto) responde solo totales y avance; un test recorre todas las rutas del mapa buscando un desglose
que se escape. Ver [018](specs/018-mapa-por-manzana/spec.md).

**Ningún dato de usuario entra a una plantilla sin `escaparHtml`.** Está en
`public/src/lib/escapar.js` y lo cargan todas las páginas. Escapa las comillas además de
`<`, `>` y `&`, porque este frontend interpola dentro de atributos (`value=`, `title=`,
`onclick=`) y ahí el truco de `textContent`/`innerHTML` no alcanza. Un dato que va por
`setAttribute` o `textContent` **no** se escapa: el DOM no parsea HTML ahí, y escaparlo
mostraría `&amp;` en un apellido con "&". Hay un test que falla si una interpolación
vuelve a entrar cruda.

**El frontend se mide.** [docs/DESIGN.md](docs/DESIGN.md) es la dirección visual y los tests la
sostienen; una regla de estas no se discute con una captura, se rompe con un test que falla:
- *Contraste*: texto y texto-sobre-relleno cumplen 4,5:1 en los dos temas
  (`test/design-tokens.test.js` lee los valores reales del CSS). Un token que se aclara un
  poco rompe todas las pantallas a la vez y ningún otro test lo ve.
- *Nunca `transition: all`*: se listan las propiedades que cambian. El test lo impide.
- *Foco*: nunca `outline: none` sin reemplazo; el anillo es `--ds-shadow-focus` (sólido).
- *Sin scroll horizontal*: ni en móvil ni en escritorio. La navegación es una barra lateral
  (240 px, o 68 colapsada) y el contenido se corre por `--nav-ancho`; el lugar se reserva en CSS
  (`body:has(#navbar-container)`) y no cuando JS dibuja la barra, o la página salta al cargar.
- *Una pantalla es igual a las demás*: contenedor `main#contenido` (1440 px), cabecera con
  `h1` + subtítulo + acciones, encabezado de tabla y botones salen de `design-system.css`
  (sección "Pantalla"). Una hoja de pantalla no define su ancho, su título ni su botón.
- *El tema de entrada es el oscuro*; "Sistema" es una elección guardada, no la ausencia de
  elección (`tema.js`). El claro es el espejo del oscuro y se mide igual.
- *Teclado en lo que dibuja*: gráficos (`microchart.js`) y mapa tienen un solo tope de
  tabulación y flechas; el calendario de fiscales trae su tabla. Lo miden
  `scripts/verificar-componentes.js` y `scripts/verificar-mapa.js`.
- *Todo control tiene nombre accesible y se opera con teclado*; todo lo asíncrono tiene
  estado cargando, vacío y error visibles (el toast es sólo para lo transitorio).
- *Un patrón, un componente*: botón, campo, diálogo, aviso, tabla, pestañas y paginación
  salen de `design-system.css` y `public/src/lib/`; no se redefinen por pantalla.
- *Sin `onclick=` ni `style="display:none"`*: delegación con `data-action` y atributo
  `hidden`. Es lo que deja a la CSP en condiciones de perder el `'unsafe-inline'` de estilos.

**Toda ruta de datos exige token.** Los módulos declaran `requiresAuth: true` y el
factory lo aplica a todo el router, para que una ruta nueva nazca protegida.

**Una escritura manda sólo los campos que la persona editó, y dice qué versión leyó.**
En `relevamientos`, la clave ausente **no toca** el campo (`COALESCE($n, tabla.campo)`) y
la cadena vacía lo vacía. Nunca se lee una fila para "preservar" los otros campos y
reenviarlos: entre esa lectura y la escritura, lo que haya guardado otra persona se
pierde, y el sistema lo responde con un 200. Esa era la forma del bug que arregló
[012](specs/012-multiusuario/spec.md), y el panel del padrón lo hacía dos veces en
paralelo contra la misma fila. Tampoco se mandan dos escrituras simultáneas a una misma
fila, aunque toquen columnas distintas.

Y **`version` es obligatoria**: el `UPDATE` lleva `WHERE version = $n`, así que si otra
persona escribió en el medio la fila no se toca y la respuesta es 409 con el estado del
servidor. La comprobación y la escritura son la **misma sentencia** — un `SELECT` seguido
de un `UPDATE` tendría la carrera que esto viene a cerrar. No hay escritura a ciegas: sin
versión es 400, y ante la duda el cliente manda 0, que no coincide con ninguna fila
existente y fuerza el 409. Nadie mergea dos textos en conflicto: decide una persona.

**La cuenta es personal, nunca compartida.** `actualizado_por` y la auditoría atribuyen
cada cambio a un usuario puntual — una cuenta usada por varias personas rompe esa
atribución en silencio, y el 409 deja de decir "otra persona está editando esto" para
decir "vos mismo, en otra pestaña". Por eso un segundo login cierra el primero (sesión
única): no es una limitación a tolerar, es lo que hace que "quién tocó esto" siga
significando algo con más de un usuario activo, que es exactamente el escenario que
[012](specs/012-multiusuario/spec.md) vino a sostener.

---

## Mapa

| Necesitás… | Está en |
|---|---|
| Config y validación de entorno | `src/core/config.js` |
| El pool y los helpers de SQL | `src/core/db.js` |
| Login, tokens, sesión única, inactividad | `src/core/security/` |
| Middlewares de autenticación y permisos | `src/core/security/authorize.js` |
| Montaje de la app y de los módulos | `src/core/app.js` |
| La lista de módulos | `src/modules/index.js` |
| Registro de auditoría | `src/modules/auditoria/` |
| Usuarios, roles, permisos | `src/modules/auth/` |
| Votantes, relevamientos, resultados | `src/modules/padron/` |
| Listas electorales (borradores) y candidatos | `src/modules/listas/` (schema propio `elecciones`, no `padron` — una lista de candidatos no es un dato del votante) |
| Comicios, mesas y votos | `src/modules/comicio/` (mismo schema `elecciones`). El rango de una mesa son dos DNIs, no una tabla votante↔mesa — se calcula contra `padron.votantes` con el mismo orden (apellido, nombre, dni) que ya usa el listado del padrón |
| Fiscales y su calendario por mesa | `src/modules/fiscales/` (mismo schema `elecciones`). El fiscal es un registro de datos, sin cuenta de usuario — nunca se loguea. Una asignación valida dos solapamientos, no uno: que la mesa no tenga dos fiscales a la vez, y que el mismo fiscal no esté en dos mesas a la vez |
| Importación por COPY | `src/modules/padron/importer.js` |
| Exportación en streaming | `src/modules/padron/exporter.js` |
| Iconos y tipografía del frontend | `scripts/build-assets.js` |
| Qué dibujo de Lucide es cada `fa-*` | `scripts/iconos-lucide.js` |
| Gráficos del frontend | `public/src/lib/microchart.js` |
| Servido de estáticos y caché | `src/core/estaticos.js` |
| Tokens, paleta y modo oscuro | `public/src/styles/design-system.css` |
| Escapado de datos en el frontend | `public/src/lib/escapar.js` |
| Quién tocó una ficha y qué cambió | `padron.relevamientos.actualizado_por`, `GET /api/padron/cambios` |
| Por qué el frontend es como es | [docs/FRONTEND.md](docs/FRONTEND.md) |
| Paleta, tipografía, logo e ícono — la identidad de marca | [docs/IDENTIDAD.md](docs/IDENTIDAD.md) |
| Cómo hace el sistema para que dos personas no se pisen | [docs/MULTIUSUARIO.md](docs/MULTIUSUARIO.md) |
| Selector de tema claro/oscuro (oscuro por defecto) | `public/src/tema.js` |
| Barra lateral, logo como máscara, colapso | `public/src/components/NavbarComponent.js`, `public/src/styles/navbar-styles.css` |
| Dirección visual, contraste, forma, movimiento y reglas de verificación del frontend | [docs/DESIGN.md](docs/DESIGN.md) |
| Opciones políticas de la instancia (qué se puede marcar al relevar) | `src/modules/padron/opciones.js`, `public/src/lib/opciones.js`, pantalla `configuracion.html` |
| Mapa por manzana y radio censal (018) | `src/modules/territorio/` (esquema `territorio`, solo administrador por `territorio.view`). Cómo se ubica un domicilio: `ubicacion.js`; de dónde salen las capas: `capas.js`; el umbral de privacidad: `aplicarUmbral` en `service.js`; el dibujo: `public/src/components/MapaComponent.js` y `lib/geometria-svg.js` |

Cada módulo sigue el mismo corte: `routes` (HTTP) → `service` (reglas) → `repository`
(SQL). `routes` no escribe SQL; `repository` no conoce `req`/`res`.

---

## Comandos

```bash
npm run dev              # con --watch
npm test                 # ~330 tests; los de Postgres real se saltean sin DATABASE_URL_TEST
npm run migrate:status   # qué está aplicado
npm run migrate          # aplicar pendientes
npm run seed:usuarios    # crear el administrador
npm run build:assets     # iconos, fuentes, ?v= y precomprimidos de public/
npm run territorio:cargar -- ALCIRA      # capas del mapa (018): muestra qué haría; con "si" al final, carga
npm run medir:geocodificacion                          # solo lectura: cuánto del padrón se ubica en una manzana
node scripts/verificar-frontend.js [etiqueta]          # capturas + axe + scroll horizontal de las 10 pantallas (ver abajo)
node scripts/verificar-componentes.js --url=...   # teclado y foco: barra, diálogos, pestañas, gráficos, calendario
node scripts/verificar-mapa.js --url=...          # mapa con capas sintéticas interceptadas: teclado, pestañas, lista, axe
```

**`verificar-frontend.js` no se corre contra producción.** No hay staging, así que un login
desde acá cierra la sesión de la cuenta que se use (sesión única) y las capturas muestran el
padrón real. Se usa contra una base descartable: un Postgres en Docker con las migraciones y
`scripts/datos-prueba-frontend.sql` y `scripts/datos-prueba-comicio.js` (datos sintéticos), un usuario propio y `DATABASE_URL`
apuntando ahí. Credenciales por `VERIFICAR_USUARIO` / `VERIFICAR_CLAVE`; `verificacion/` está
en `.gitignore`.

---

## Dónde está el rendimiento

El sistema corre en un servidor chico. Tres cosas cargan con casi todo el ahorro; antes
de tocarlas, entender por qué son como son.

**`core/security/sessions.js`.** Antes cada request protegido hacía un salto HTTP al
auth-service más cuatro consultas (blacklist, sesión activa, `UPDATE last_activity`,
usuario). Ahora es `jwt.verify` en proceso más una caché en memoria, y `last_activity`
se persiste con write-behind. En el caso típico, autenticarse no toca la base.

La caché es local al proceso, y eso es lo que la hace correcta: login, logout, cambio de
rol y desactivación la invalidan de forma exacta e inmediata. **Con más de una
instancia, esto necesita Redis.** Es el supuesto que sostiene el diseño.

**`modules/padron/importer.js`.** El importador viejo hacía
`.on('data', async fila => await insertar(fila))`: sin pausar el stream, lanzaba miles
de INSERT en paralelo. Ahora es COPY a una tabla temporal con backpressure real. No
volver a insertar fila por fila.

**`modules/padron/service.js` → `CacheResultados`.** Los cinco endpoints de
`resultados/*` agregan sobre todo el padrón. Se cachean 60 s y **toda escritura de
relevamiento invalida el caché** — si agregás una escritura, invalidá.

**`public/` no le pide nada a ningún tercero.** Antes cada página cargaba Font Awesome
entero y Google Fonts desde dos CDN, y `resultados.html` sumaba Chart.js: sólo Font
Awesome eran 175 KB transferidos para usar 79 iconos de los ~2000 que trae. Ahora los
iconos son máscaras CSS con dibujos de Lucide (31 KB, **3,9 KB en Brotli**), Geist Sans y
Geist Mono se sirven desde acá y los gráficos son `microchart.js` (5 KB gzip). Hay un test que falla si
vuelve a aparecer un `<link>` a un CDN, porque son bytes que no controlamos y un punto
de falla fuera del VPS.

El markup sigue usando los nombres de Font Awesome 5 (`fa-save`, `fa-users-cog`) en sus
181 usos: la equivalencia con Lucide vive en `scripts/iconos-lucide.js`, así que cambiar
de set de iconos no toca ni una línea de HTML.

**`core/estaticos.js`.** `compression()` sigue montado para la API, que es dinámica,
pero los estáticos no se comprimen por request: `build-assets` deja un `.br` y un `.gz`
al lado de cada archivo y acá se entregan tal cual. El índice se arma una sola vez al
arrancar y **descarta todo comprimido más viejo que su fuente**: olvidarse del build
degrada a comprimir en vivo, nunca a servir contenido desactualizado.

El HTML referencia `archivo.css?v=<hash>`, y eso se cachea un año con `immutable`; el
HTML sigue en `no-cache`, que es lo que hace que un `?v=` nuevo se vea al instante. Una
visita repetida pasa de ~16 condicionales a un solo request. **El riesgo de esto es
editar un asset y no correr el build**: el `?v=` queda viejo y los navegadores que ya lo
tienen se quedan con la versión anterior un año. Por eso hay un test que compara cada
`?v=` contra el hash real del archivo.

---

## Contrato de la API

`scripts/api-snapshot.js` releva la forma de las respuestas y compara contra una línea
de base. Correrlo antes y después de cualquier cambio que toque rutas:

```bash
node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before.json
```

---

## Cómo se trabaja

Spec primero: nada que no sea trivial arranca en el editor. Ver [docs/SDD.md](docs/SDD.md)
para el ciclo y [docs/BACKLOG.md](docs/BACKLOG.md) para lo que falta, priorizado.

La "constitución" de ese proceso son las **Reglas que no se rompen** de más arriba.

---

## Deuda conocida

Priorizada, con alcance y criterios, en [docs/BACKLOG.md](docs/BACKLOG.md). Acá queda lo
que hay que entender para no repetirla:

- El acento de la interfaz es grafito, no un color. Azul, rojo y gris ya significan
  PJ, UCR e indeciso, y verde y ámbar significan éxito y advertencia: cualquier acento
  cromático competiría con un dato. Por eso existe `--ds-on-primary` aparte de
  `--ds-text-inverse`: el acento se invierte entre temas. El texto de una píldora de
  opción **no es blanco fijo**: cada relleno trae el suyo (`--opcion-on`, par de
  `--opcion-color`), porque sobre el verde, el ámbar y el cian de claro el blanco no llega
  a 4,5:1 y en oscuro los ocho rellenos son pasteles. Lo mide `test/design-tokens.test.js`.
- La carga de teléfono, observación y condiciones vive en el panel lateral del padrón
  (`abrirPanel`), no en la tabla. La tabla es para encontrar gente; el panel, para
  cargarle datos. Eso bajó la página de ~350 controles de formulario a ~45.
- El listado de votantes pagina con `OFFSET`. Con el padrón actual (~5.500 filas) no
  molesta; si crece mucho, conviene keyset — pero eso cambia el contrato de paginación
  que consume el frontend. El exportador ya usa keyset.
- `public/` es JS plano sin build. Es una decisión, no un olvido: no hay que
  compilarlo ni servirlo aparte. `npm run build:assets` no lo contradice: no compila
  nada, genera `icons.css`, `fonts.css` y los woff2 a partir de devDependencies. La
  salida se versiona, porque el Dockerfile copia `public/` tal cual y no instala
  devDependencies. Si agregás un icono al markup, corré el script — hay un test que
  lo exige.
- El frontend se escribió contra Font Awesome 5 y usa nombres que en la 6 cambiaron
  (`fa-save`, `fa-times`, `fa-home`). `build-assets.js` los traduce leyendo la
  metadata del paquete, así que no hace falta migrar el markup.
- Una página no puede cargar dos hojas que definan la misma clase base (`.stat-card` fue la
  que lo rompió: ver 005). Hay un test que lo impide, pero sólo mira `.stat-card`.
- La tabla del padrón no tiene encabezado fijo. Se probó y se revirtió: `position:
  sticky` necesita que el contenedor tenga scroll propio, y esa barra vertical angosta
  el área útil hasta empujar la última de las once columnas fuera de la vista. Además
  cambia el modelo de scroll (la rueda mueve la tabla, no la página), que hay que
  probar usándolo. Vale la pena, pero como cambio verificado a mano.
- La CSP está activa pero con `'unsafe-inline'` en `script-src`. Corta la carga de
  recursos externos, `<base>` y el framing, pero **no frena XSS inline**, que es lo que
  más importa. Para sacar ese `'unsafe-inline'` hay que eliminar los bloques `<script>`
  de cada página y todos los `onclick=`, incluidos los que los componentes generan
  dentro de sus plantillas. Es un trabajo que toca todo el frontend.

---

## Agregar un módulo

[docs/AGREGAR-MODULO.md](docs/AGREGAR-MODULO.md). Carpeta nueva con `module.js` y una
línea en `src/modules/index.js`. El orden de esa lista importa: un módulo solo ve los
servicios de los que están antes.
