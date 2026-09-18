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
aplicación entera. Hay un test que falla si entra un color suelto.

Es también lo que permitió rehacer la identidad visual entera —de navy y dorado con
degradados a una escala neutra con acento grafito y superficies planas— tocando casi
sólo `design-system.css`. Los degradados y las sombras siguen existiendo como tokens, pero con valores
planos y `none`: así se apagan en todos sus usos sin perseguir cada regla.

**Un solo pool de PostgreSQL.** Se recibe por inyección (`db` en `register`). Nunca
`new Pool()`. La versión anterior tenía ocho instancias de `Database`, cada una con su
pool: hasta 120 conexiones potenciales contra Supabase.

**`process.env` solo se lee en `core/config.js`.** El resto usa `config`.

**Los errores se lanzan, no se responden.** `errores.*` de `core/errors` + `asyncHandler`.
Nada de `res.status(500).json(...)` dentro de un handler.

**El esquema se cambia con migraciones, y toda migración tiene que ser idempotente**
(`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Verificado: `npm run migrate` corrido
directo contra una base con las tablas y datos del sistema viejo no tocó lo existente
y sembró lo que faltaba. Eso es lo que permite no usar `migrate:adopt` — que existe
pero es más arriesgado, porque salta migraciones enteras sin ejecutarlas. Una
migración aplicada no se edita: se agrega la siguiente.

**Toda ruta de datos exige token.** Los módulos declaran `requiresAuth: true` y el
factory lo aplica a todo el router, para que una ruta nueva nazca protegida.

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
| Importación por COPY | `src/modules/padron/importer.js` |
| Exportación en streaming | `src/modules/padron/exporter.js` |
| Iconos y tipografía del frontend | `scripts/build-assets.js` |
| Qué dibujo de Lucide es cada `fa-*` | `scripts/iconos-lucide.js` |
| Gráficos del frontend | `public/src/lib/microchart.js` |
| Servido de estáticos y caché | `src/core/estaticos.js` |
| Tokens, paleta y modo oscuro | `public/src/styles/design-system.css` |
| Por qué el frontend es como es | [docs/FRONTEND.md](docs/FRONTEND.md) |
| Selector de tema claro/oscuro | `public/src/tema.js` |

Cada módulo sigue el mismo corte: `routes` (HTTP) → `service` (reglas) → `repository`
(SQL). `routes` no escribe SQL; `repository` no conoce `req`/`res`.

---

## Comandos

```bash
npm run dev              # con --watch
npm test                 # 89 tests, no necesitan base
npm run migrate:status   # qué está aplicado
npm run migrate          # aplicar pendientes
npm run seed:usuarios    # crear el administrador
npm run build:assets     # iconos, fuentes, ?v= y precomprimidos de public/
```

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
iconos son máscaras CSS con dibujos de Lucide (31 KB, **3,9 KB en Brotli**), Inter se
sirve desde acá y los gráficos son `microchart.js` (5 KB gzip). Hay un test que falla si
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

## Deuda conocida

- El acento de la interfaz es grafito, no un color. Azul, rojo y gris ya significan
  PJ, UCR e indeciso, y verde y ámbar significan éxito y advertencia: cualquier acento
  cromático competiría con un dato. Por eso existe `--ds-on-primary` aparte de
  `--ds-text-inverse`: el acento se invierte entre temas, pero las píldoras de partido
  son azul y rojo en los dos y su texto es blanco siempre.
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
- Quedan páginas sin backend: `fiscales.html` y `comicio.html`. Sus permisos ya están
  en la migración de auth.
- `padron-styles.css`, `resultados-styles.css`, `auditoria-styles.css` y
  `usuarios-styles.css` definen las mismas clases (`.stat-card`, `.stat-icon`,
  `.stat-label`) con medidas distintas. Hoy no choca porque ninguna página carga dos de
  esas hojas a la vez, pero es una trampa puesta: la primera página que combine dos
  módulos va a ver componentes deformes. Consolidarlas es trabajo pendiente.
- `debug.html`, `test-api.html` y `test-padron.html` se sirven públicamente en
  producción. No cargan el design system y quedaron fuera del test de tokens.
- La tabla del padrón no tiene encabezado fijo. Se probó y se revirtió: `position:
  sticky` necesita que el contenedor tenga scroll propio, y esa barra vertical angosta
  el área útil hasta empujar la última de las once columnas fuera de la vista. Además
  cambia el modelo de scroll (la rueda mueve la tabla, no la página), que hay que
  probar usándolo. Vale la pena, pero como cambio verificado a mano.
- `PadronComponent.renderizarTabla` interpola los datos del votante en HTML sin
  escapar: `${votante.apellido}`, `${observacion}`, `value="${telefono}"`. Una
  observación que contenga `</textarea><script>` se ejecuta. Los datos entran por carga
  manual y por importación de CSV, así que es alcanzable. **Es anterior a cualquier
  trabajo de rediseño y sigue abierto.**
- Sin tests de integración contra una base real. Los 89 tests corren sin PostgreSQL;
  lo que toca la base se verifica con el snapshot de contrato.
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
