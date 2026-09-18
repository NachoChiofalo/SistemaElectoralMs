# El frontend

`public/` es JavaScript plano, sin framework, sin bundler y sin paso de compilación. Es
una decisión, no una deuda: el servidor lo sirve tal cual está en disco.

Este documento explica **por qué** está como está. Para las reglas que no se rompen,
mirá [CLAUDE.md](../CLAUDE.md).

---

## Lo que gobierna todo: el presupuesto

El sistema corre en un VPS chico. Cada decisión de este frontend se tomó contra ese
límite, y la regla es simple: **una pantalla no puede costar más de lo que cuesta hoy**.

Estado actual de una visita nueva a la pantalla más pesada:

| | Antes | Ahora |
|---|---|---|
| Transferido | ~450 KB | **117 KB Brotli** |
| Orígenes | 3 (cdnjs, jsDelivr, Google Fonts) | **1** |
| Visita repetida | ~16 revalidaciones | **1 request, 2,3 KB** |

No hay framework de UI, ni Tailwind, ni librería de gráficos, ni fuentes externas. No es
ascetismo: cada una de esas cosas se evaluó y se descartó por costo contra beneficio en
esta superficie concreta.

---

## Sin terceros

Antes cada página pedía Font Awesome completo y Google Fonts a dos CDN, y `resultados`
sumaba Chart.js. **Sólo Font Awesome eran 175 KB transferidos para usar 79 iconos de los
~2000 que trae.**

Hoy no se le pide nada a nadie:

- **Iconos**: dibujos de [Lucide](https://lucide.dev), emitidos como reglas CSS con
  `mask-image`. 30,7 KB en disco, **3,9 KB en Brotli**.
- **Tipografía**: Inter servida desde el mismo origen, subset latin, cuatro pesos.
- **Gráficos**: `src/lib/microchart.js`, 5 KB gzip.

Hay un test que falla si vuelve a aparecer un `<link>` a un CDN. No es purismo: son bytes
que no controlamos, una conexión TLS extra y un punto de falla fuera del VPS.

### Los iconos no son un sprite

Se emiten como CSS y no como sprite SVG por una razón concreta: **el markup no cambia**.
`<i class="fas fa-user">` sigue siendo válido, y los iconos que se arman en runtime
—`class="fas ${op.icon}"` en `AuditoriaComponent` y `NavbarComponent`— siguen andando sin
tocarlos. El color sale de `currentColor`, así que heredan igual que cuando eran fuente.

Eso es lo que permitió **cambiar el set de iconos entero, de Font Awesome a Lucide, sin
tocar una línea de HTML**. La equivalencia vive en `scripts/iconos-lucide.js`.

El markup además sigue usando nombres de Font Awesome 5 (`fa-save`, `fa-times`,
`fa-users-cog`). No se migraron: traducirlos es una entrada en un mapa, y migrarlos sería
un diff de 181 usos sin ninguna ganancia.

### microchart en lugar de Chart.js

`resultados` bajaba 205 KB de Chart.js para dibujar dos tipos de gráfico: tres doughnut y
tres bar. El resto del paquete —líneas, radar, burbujas, escalas logarítmicas, el motor
de canvas— viajaba en cada visita sin que nada lo llamara.

`microchart.js` expone `window.Chart` con la misma firma, así que los seis puntos de
llamada quedaron sin tocar. Dibuja en SVG y no en canvas: el texto queda seleccionable y
legible para un lector de pantalla, el gráfico se reescala sin redibujarse ni verse
borroso en HiDPI, y no hay que multiplicar por `devicePixelRatio` a mano.

Soporta exactamente lo que el componente pide. Si hace falta un tipo nuevo, se agrega ahí:
el punto no es reimplementar Chart.js, es no pagarlo entero.

---

## Cómo se sirve

`src/core/estaticos.js`. Dos cosas que en un VPS chico se notan.

**No se comprime por request.** `compression()` sigue montado para la API, que es
dinámica, pero gzipear los mismos 43 KB de CSS en cada visita es CPU que se le resta a
atender pedidos. `npm run build:assets` deja un `.br` y un `.gz` al lado de cada archivo
y el servidor los entrega tal cual.

El índice se arma una sola vez al arrancar y **descarta todo comprimido más viejo que su
fuente**. Olvidarse del build degrada a comprimir en vivo, nunca a servir contenido
desactualizado.

**Las visitas repetidas no piden nada.** El HTML referencia `archivo.css?v=<hash>`, y eso
se cachea un año con `immutable`; el HTML sigue en `no-cache`, que es lo que hace que un
`?v=` nuevo se vea al instante.

> ⚠️ **El riesgo de esto**: editar un asset y no correr el build. El `?v=` queda viejo y
> los navegadores que ya lo tienen se quedan con la versión anterior **un año**, sin forma
> práctica de invalidarla. Por eso hay un test que compara cada `?v=` contra el hash real
> del archivo. Conviene que el build corra en CI, no sólo a mano.

---

## El design system

`src/styles/design-system.css` es la única fuente de verdad del color. **En `public/` no
se escribe `#hex` ni `white`**: todo sale de un token `--ds-*`, y hay un test que falla si
entra un color suelto.

No es prolijidad. Es lo que permite redefinir la aplicación entera desde un archivo — y es
lo que hizo posible rehacer la identidad visual dos veces sin perseguir reglas por seis
hojas de estilo.

### El acento no es un color

Es grafito: un valor de luminosidad.

En esta pantalla el color **ya significa cosas**: azul es PJ, rojo es UCR, gris es
indeciso, verde es éxito, ámbar es advertencia. Cualquier acento cromático compite con
alguno de esos, y en una tabla donde se leen mil filas eso se paga caro. El grafito no
puede confundirse con ningún dato porque no tiene matiz, y deja que el único color fuerte
de la pantalla sea el que de verdad informa.

### Tokens que existen por una razón no obvia

| Token | Por qué existe |
|---|---|
| `--ds-on-primary` | Texto sobre el acento. No alcanza `--ds-text-inverse`: ese es blanco siempre porque también rotula las píldoras de PJ y UCR, que son azul y rojo en los dos temas. El acento, en cambio, se invierte entre claro y oscuro. |
| `--ds-*-on-tint` | Texto sobre un fondo teñido (badges, íconos de estadística). En claro funcionan los pasos -500/-600 de la rampa; en oscuro el fondo se oscurece y el texto seguiría oscuro, con lo que el badge desaparece. |
| `--ds-contrast-bg` | Negro puro, sólo para `prefers-contrast: high`. Es token y no literal para que se vea que el valor extremo es deliberado. |
| `--ds-gradient-*` | Ya no son gradientes: son colores planos. Conservan el nombre porque están referenciados en seis hojas, y cambiar el valor los aplana todos de una vez. |

### Modo oscuro

Automático por `prefers-color-scheme`, con selector de tres estados en la barra
(Automático / Claro / Oscuro). `src/tema.js` se carga en el `<head>` **sin `defer`**: si
se aplicara después, quien eligió oscuro vería un destello blanco en cada navegación.

Los valores oscuros viven una sola vez en `--modo-oscuro-*` y se asignan dos veces —para
quien tiene el sistema en oscuro y para quien lo eligió a mano—, porque CSS no permite
combinar un selector dentro de una media query con uno fuera.

---

## Estructura de las pantallas

La navegación tiene **un solo nivel**. La barra superior es el único menú.

| Pantalla | Qué responde |
|---|---|
| **Inicio** | Cuánto se lleva relevado y dónde falta. Es una pantalla de situación, no un menú. |
| **Padrón** | Encontrar a una persona y registrar su preferencia. |
| **Resultados** | Cómo se reparte, dónde falta, a quién se relevó, qué condiciones tiene. |
| **Usuarios / Auditoría** | Administración. |

Es superior y no lateral porque la tabla del padrón necesita todo el ancho: una barra
lateral le come 240px permanentes a la pantalla que más los necesita, para navegar entre
cuatro destinos.

### Padrón: encontrar y cargar son cosas distintas

La tabla tenía **once columnas y siete controles editables por fila**. Con 50 registros
por página eso son ~350 controles de formulario en el DOM.

Hoy la tabla sirve para **encontrar** —ocho columnas, de sólo lectura salvo la opción
política— y el **panel lateral** (`abrirPanel`) para cargar: teléfono, observación y las
cuatro condiciones. La página pasó a ~45 controles.

La opción política se quedó inline a propósito: es la acción de alta frecuencia y hacerla
en un clic es el punto del sistema. Lo que se movió es lo que se usa en una minoría de los
registros.

Es un panel y no un modal, también a propósito: la tabla queda visible al lado y no se
pierde el lugar en la lista.

### Resultados: secciones, no pestañas

Cuatro pestañas escondían cuatro respuestas cortas. Eso obliga a recordar en cuál estaba
cada una y a hacer un clic para comparar dos cortes que entran juntos en pantalla.

Apiladas se recorren con scroll. Y eliminó un `setTimeout`: los gráficos se dibujaban de a
uno al abrir cada pestaña porque un canvas oculto mide cero.

El **corte por circuito** existía en la API (`/api/padron/resultados/por-circuito`) y no
se mostraba en ninguna pantalla, siendo el único que dice *adónde ir a relevar*. Va como
tabla y no como gráfico porque "cuántos faltan en el circuito 3" es una cantidad exacta,
no una proporción.

---

## El build

```bash
npm run build:assets
```

No compila nada. Genera:

1. `src/styles/icons.css` — las máscaras, a partir de los dibujos de Lucide
2. `src/styles/fonts.css` + `assets/fonts/*.woff2` — Inter
3. El `?v=<hash>` en las referencias del HTML
4. Los `.br` y `.gz` de cada archivo de texto

**La salida se versiona en git**, porque el Dockerfile copia `public/` tal cual y no
instala devDependencies. Correlo después de tocar cualquier cosa en `public/`; si un icono
referenciado no tiene entrada en el mapa, el script falla en vez de emitir un CSS con un
hueco silencioso.

---

## Los tests del frontend

`test/assets.test.js`, sin base de datos. No prueban que se vea bien —eso no se
automatizó— sino que **no se degrade en silencio**:

- Todo icono usado en `public/` tiene dibujo
- El `?v=` de cada referencia coincide con el hash real del archivo
- Los precomprimidos no están más viejos que su fuente, y no quedan huérfanos
- Ninguna página volvió a pedirle algo a un CDN
- No entró ningún color fuera del design system

Cada uno existe porque cubre un modo de falla que **no se ve** hasta que ya está en
producción.

---

## Deuda conocida

- **`PadronComponent.renderizarTabla` interpola datos en HTML sin escapar**:
  `${votante.apellido}`, `${observacion}`, `value="${telefono}"`. Una observación con
  `</textarea><script>` se ejecuta. Los datos entran por carga manual y por importación de
  CSV, así que es alcanzable. Es anterior a todo el trabajo de rediseño y **sigue
  abierto**. Es lo próximo que conviene arreglar.
- **La CSP lleva `'unsafe-inline'` en `script-src`.** Corta la carga de recursos externos,
  `<base>` y el framing, pero no frena XSS inline. Sacarlo exige eliminar los bloques
  `<script>` de cada página y todos los `onclick=`, incluidos los que los componentes
  generan en sus plantillas.
- **Clases con el mismo nombre y medidas distintas** en cuatro hojas (`.stat-card`,
  `.stat-icon`, `.stat-label`). Hoy no choca porque ninguna página carga dos de esas hojas
  a la vez, pero es una trampa puesta para el primer módulo que las mezcle.
- **La tabla del padrón no tiene encabezado fijo.** Se probó y se revirtió: `position:
  sticky` necesita que el contenedor tenga scroll propio, y esa barra vertical angosta el
  área hasta empujar la última columna fuera de la vista. Además cambia el modelo de
  scroll. Vale la pena, pero como cambio verificado a mano.
- **El listado pagina con `OFFSET`.** Con ~5.500 filas no molesta.
