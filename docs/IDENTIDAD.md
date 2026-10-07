# Identidad de ÁGORA

Esta es la referencia de marca: paleta, tipografía, logo e ícono. Es normativa, no
descriptiva — si un cambio de diseño no coincide con este documento, el documento gana
y el diseño se corrige (o este archivo se actualiza a propósito, en el mismo commit que
el cambio).

La única implementación de estos valores es
[`public/src/styles/design-system.css`](../public/src/styles/design-system.css). Este
documento explica **qué son y por qué**; ese archivo es donde viven de verdad, como
tokens `--ds-*`. Nunca se escribe un color o un peso de fuente literal en ningún otro
archivo de `public/` — la regla completa está en [CLAUDE.md](../CLAUDE.md).

---

## Paleta

Cinco colores. No hay un sexto.

| Uso | Nombre | Hex | Token |
|---|---|---|---|
| Ícono, texto, botones primarios | Grafito casi negro ("Principal") | `#1C1C1C` | `--ds-primary-700` / `--ds-text-primary` |
| Botones y texto secundario | Gris oscuro ("Secundario") | `#343434` | `--ds-primary-600` |
| Fondo de página en modo claro | Blanco cálido | `#FAFAF9` | `--ds-bg-page` |
| Fondo de página en modo oscuro | Negro carbón ("fondo alternativo") | `#202020` | `--modo-oscuro-bg-page` |
| Tarjetas, superficie invertida, texto en modo oscuro | Blanco | `#FFFFFF` | `--ds-bg-card` / `--ds-text-inverse` / `--modo-oscuro-text-primary` |

`#1C1C1C` sobre `#FAFAF9` es la combinación principal — así se ve el 90% de la interfaz
en modo claro. El resto de la escala de grises (`--ds-primary-50` a `--ds-primary-900`,
más `--ds-secondary-*` y `--ds-accent-*`, que duplican la misma rampa a propósito, ver
el comentario en `design-system.css`) son pasos intermedios para bordes, fondos sutiles
y estados de hover: existen para que estos cinco colores tengan dónde apoyarse, no para
competir con ellos.

**Los colores de partido están completamente libres.** PJ es azul, UCR es rojo, éxito es
verde, advertencia es ámbar — esos tokens (`--ds-party-*`, `--ds-success-*`,
`--ds-warning-*`, `--ds-danger-*`, `--ds-info-*`, `--ds-fuerza-*`) no forman parte de
esta identidad y no cambian con ella. La razón de que el acento de la interfaz sea
grafito y no un color es exactamente para no competir con estos: ver el comentario en la
sección 2 de `design-system.css`.

### Modo oscuro

No es una inversión matemática de la paleta clara. El fondo alternativo (`#202020`) y
sus superficies derivadas (`--modo-oscuro-bg-card`, `-elevated`, `-subtle`, `-muted`)
suben en pasos pequeños para que una tarjeta siga recortándose del fondo sin usar
sombra, igual que en modo claro. El texto y el ícono pasan a blanco puro (`#FFFFFF`,
la "versión invertida"): sobre `#202020` alcanza para leerse bien, y unificarlo con
`--ds-text-inverse` evita inventar un sexto color. Los colores de partido se aclaran
(`--modo-oscuro-party-*`) porque el azul y el rojo institucionales quedan casi
invisibles sobre un fondo oscuro — ese es un ajuste de legibilidad, no de identidad.

---

## Tipografía

**Inter**, servida desde el mismo origen (`public/src/styles/fonts.css`, generado por
`scripts/build-assets.js`) — nunca desde Google Fonts ni ningún otro CDN. Ver
[FRONTEND.md](FRONTEND.md) para el porqué de eso.

| Uso | Peso | Token |
|---|---|---|
| Logo / wordmark "ÁGORA" | 600 (SemiBold), alternativa 700 (Bold) para más contundencia | — (ver "Logo e ícono" abajo) |
| Títulos de página y de sección | 600 / 700 | `--ds-weight-semibold` / `--ds-weight-bold` |
| Texto de interfaz | 400 / 500 | `--ds-weight-normal` / `--ds-weight-medium` |

El logo actual (`public/assets/images/agora-logo.png`) ya está renderizado en Bold —
es una imagen fija, no texto en vivo, así que su peso no se controla desde CSS. El
token `--ds-weight-semibold` es el que corresponde si alguna vez se rehace el asset.

**Tracking**: los títulos usan `--ds-tracking-tight` (-0.02em) — Inter se ve suelto en
tamaños grandes si no se aprieta. La única excepción es el wordmark en mayúsculas
("ÁGORA" como texto, no como imagen): ahí corresponde `--ds-tracking-brand` (+1.5%),
que existe sólo para ese caso y no se usa en ningún otro lado de la interfaz. Hoy no hay
ningún uso vivo de ese token porque el wordmark siempre es la imagen del logo; queda
documentado para el día que haga falta escribir "ÁGORA" como texto real (por ejemplo,
en un elemento donde una imagen no sea viable).

---

## Logo e ícono

Dos assets, los dos en `public/assets/images/`, los dos PNG con fondo transparente y
tinta fija en `#1C1C1C` (no `currentColor`: son imágenes rasterizadas, no íconos CSS):

- **`agora-logo.png`** — el lockup completo: ícono + "ÁGORA". Se usa en el login y en
  el navbar, donde hay espacio para el nombre completo.
- **`agora-icon.png`** — sólo el símbolo, recortado del mismo lockup. Se usa como
  favicon (`<link rel="icon">` en las 8 páginas) y en cualquier lugar chico donde el
  nombre no entre o sobre. **Nunca se usa el lockup completo como favicon** — a 16px la
  palabra "ÁGORA" es ilegible y sólo ensucia el ícono.

### Por qué son PNG y no SVG/CSS

El resto de los íconos del sistema son máscaras CSS generadas desde Lucide (ver
[FRONTEND.md](FRONTEND.md)), lo que les da color vía `currentColor` y los hace gratis en
bytes. El logo es la única excepción a propósito: es una marca con trazos y detalles
que no vienen del set de Lucide, así que vive como imagen. El costo es que no seguía
`currentColor` — de ahí el ajuste de abajo para que igual respete el tema.

### Modo oscuro

Como es tinta fija (`#1C1C1C`) sobre transparencia, en modo oscuro se invierte con
`filter: invert(1)` (ver `.navbar-logo` en `navbar-styles.css` y `.login-logo img` en
`login-styles.css`) en vez de cambiar el archivo. Es la única parte de la interfaz
donde el modo oscuro se resuelve con un filtro CSS y no con un token — porque es la
única superficie que es una imagen y no puede leer `--ds-*` directamente.

### Si se rehace el logo

Si el ícono o el wordmark cambian, hay que:

1. Reemplazar `agora-logo.png` y volver a recortar `agora-icon.png` a partir del
   mismo archivo (mismo `#1C1C1C`, mismo fondo transparente).
2. No hace falta tocar `build-assets.js`: las imágenes no pasan por su pipeline de
   versionado (`?v=`) ni de precompresión, a diferencia de `.css`/`.js`/`.woff2`. Un
   cambio de logo no se ve reflejado si el navegador tiene la URL vieja en caché salvo
   que se renombre el archivo o se agregue un query string a mano en los `<img src=...>`
   y en los `<link rel="icon">` que lo referencian.
3. Confirmar que el nuevo recorte del ícono sea legible a 16×16 (tamaño real de un
   favicon de pestaña) antes de reemplazar `agora-icon.png`.
