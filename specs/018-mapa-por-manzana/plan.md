# 018 — Plan

Cómo se implementa [la spec](spec.md). El paso a paso ejecutable está en [tareas.md](tareas.md). Cada tarea se puede mergear sola y ninguna toca producción hasta
que se corra la migración a mano (orden de `CLAUDE.md`).

## Enfoque

Un módulo nuevo, **`territorio`**, con su esquema propio. Depende de `padron` (como `comicio` o `fiscales`),
nunca al revés. Todo el cálculo geográfico ocurre **una vez, en lote**, al importar el padrón o al cargar las
capas; después cada pantalla lee agregados con una consulta indexada. No hay llamadas externas en uso, no hay
PostGIS y no hay librería de mapas.

La lógica de ubicación **ya existe y está probada**: `scripts/medir-geocodificacion.js` (funciones puras,
17 tests, medida contra el padrón real y verificada contra Google Maps). La primera tarea es mudarla a un
módulo reutilizable; el script de medición pasa a importarla.

## Diseño

### 1. Modelo de datos (esquema `territorio`)

```
territorio.configuracion    (una fila)  localidad, departamento, umbral_privacidad DEFAULT 10,
                                         etiqueta_barrio DEFAULT 'Radio censal', cargado_en, fuente
territorio.calles_tramos    id, nombre, aii, afi, aid, afd, camino JSONB   (el sentido de la numeracion se deduce en cada calculo)
territorio.manzanas         id BIGINT PK (el ID de la capa de origen), anillos JSONB, sector_id → sectores
territorio.sectores         id, codigo (LINK del radio), nombre ('Radio 3.2'), tipo ('radio_censal'),
                            anillos JSONB, poblacion_2022, viviendas_2022
territorio.ubicaciones      dni PK → padron.votantes ON DELETE CASCADE,
                            estado, detalle (la calle o el rango que explica un pendiente),
                            manzana_id → manzanas, lat, lon, calle, numero,
                            aproximada, estimado, calculado_en TIMESTAMPTZ
```

- `ubicaciones` es **1:1 con los votantes y vive en el esquema del módulo**: así `padron` no sabe que existe
  un mapa. El **ID de la manzana es el de la fuente**, estable entre cargas: la etapa 2 (manzanas visitadas)
  depende de eso.
- Índices: `ubicaciones (manzana_id)` y `manzanas (sector_id)`. Un votante sin fila en `ubicaciones` es
  "sin calcular" y se cuenta aparte.
- Permiso nuevo `territorio.view`, concedido solo al rol administrador (mismo patrón que `listas/002`).

### 2. Ubicación (`src/modules/territorio/ubicacion.js`)

Es lo que hoy está en el script de medición, sin cambios de comportamiento:

1. Reparar caracteres rotos, quitar acentos, normalizar tipo de vía, títulos y abreviaturas.
2. Separar calle y número (acepta texto después: `274 CENTRO`); número 0 y esquinas se tratan aparte.
3. Buscar la calle por términos (sin iniciales ni títulos, tolerando una letra de error). Una coincidencia solo
   por apellido es **"calle parecida"** y queda pendiente.
4. Buscar la cuadra cuyo rango (según paridad) contiene el número. Deducir el sentido de la numeración
   encadenando cuadras vecinas, o por tendencia, o —solo desde el 600— por cercanía al centro (99 % de acierto
   medido).
5. Interpolar sobre la cuadra (acotado a su parte central), correr 14 m hacia el lado que corresponde
   (impares a la izquierda al crecer la numeración), con reintentos hacia afuera para bulevares anchos.
6. Punto en polígono contra las manzanas (con caja envolvente como filtro previo).

Corre en un servicio, `reubicar()`: lee `dni, domicilio` de todos los votantes, resuelve en memoria (~500 tramos,
~200 manzanas) y vuelca con `INSERT … ON CONFLICT (dni) DO UPDATE` en lotes por `unnest`, dentro de una
transacción y bajo un advisory lock propio (como el importador). Se dispara:

- después de **importar un CSV**. `padron` se registra antes que `territorio` y, por la regla de
  `modules/index.js`, no puede consumir sus servicios. Por eso la dependencia va al revés: `PadronService`
  expone `alCambiar(oyente)` y avisa en los mismos puntos donde hoy invalida su caché (relevamiento, detalle,
  votante, importación, opciones). `territorio` se suscribe al registrarse: ante cualquier cambio invalida su
  caché, y ante una importación además reubica. Un oyente que falla se loguea y **nunca** hace fallar la
  operación del padrón;
- al terminar la **carga de capas**;
- con un botón "Recalcular" del administrador (auditado).

Un votante creado a mano queda "sin calcular" hasta la próxima corrida; no se ubica en caliente.

### 3. Carga de capas (`scripts/territorio-cargar.js`)

`npm run territorio:cargar -- --localidad ALCIRA [--departamento "RIO CUARTO"]`, corrido por el dueño del
sistema, como `seed:usuarios`:

1. Descarga tramos de calle, manzanas (por envolvente de la localidad) y radios (por envolvente).
2. Repara el texto de los nombres, orienta las cuadras y asigna cada manzana a un radio por su centroide.
3. Reemplaza las capas en una transacción (ids de origen estables) y llama a `reubicar()`.

Es la **única** llamada externa del módulo y no corre en el servidor web. Los pasos de esta carga que son
ciclo de vida (refresco, alta de localidad, licencia) se formalizan en [023](../../docs/BACKLOG.md).

### 4. API (todas `requirePermission('territorio.view')`)

| Ruta | Devuelve | Cache |
|---|---|---|
| `GET /api/territorio/geometria` | Barrios y manzanas (anillos redondeados a 5 decimales) | `ETag`, larga |
| `GET /api/territorio/estadisticas` | Por manzana y por barrio: votantes, relevados, avance, y —si pasa el umbral— opción líder y desglose | 60 s, se invalida al escribir un relevamiento |
| `GET /api/territorio/zonas/:tipo/:id` | **Toda** la información de la zona; para una manzana, también la de su barrio | 60 s |
| `GET /api/territorio/manzanas/:id/votantes` | Lista paginada: nombre, domicilio, estado de relevamiento, enlace a la ficha | — |
| `GET /api/territorio/sin-ubicar` | Cuántos y por qué, con las calles más frecuentes | 60 s |
| `POST /api/territorio/reubicar` | Dispara el cálculo; responde con el resumen | — |

Las estadísticas son **una sola consulta** `GROUP BY manzana_id` sobre `votantes ⟕ relevamientos ⟕ ubicaciones`
(el mismo molde que `por-circuito`). Las del barrio **se suman de las de sus manzanas en memoria**, sin otra
consulta. El detalle de una zona usa el mismo agregado filtrado por `manzana_id` o por `sector_id` (a través
de `manzanas`), con las condiciones especiales y los cortes por sexo y edad que ya calcula Resultados.

### 5. Privacidad: el umbral vive en el servidor

Una función única, `aplicarUmbral(zona, umbral)`, es la **última** que toca cada respuesta. Si `relevados < umbral`
devuelve solo `{ votantes, relevados, avance, desglose_oculto: true }`: ni opción líder, ni desglose por
opción, ni condiciones, ni cortes que crucen con la opción. Un test recorre **todas** las rutas con una zona
chica y verifica que ningún campo sensible aparece, para que una ruta futura no se olvide de pasar por ahí.

### 6. Frontend

- Página `mapa.html` y `MapaComponent.js`, con el ítem "Mapa" en el menú solo para quien tenga `territorio.view`.
- **SVG propio**, proyección equirrectangular con corrección por latitud, el mismo enfoque liviano que
  `microchart.js`. Selector de nivel (barrio / manzana), selector de color (avance / opción líder), contador
  de "sin ubicar" fijo. La zona sin datos suficientes se pinta neutra.
- **Panel de zona**: manzana y barrio lado a lado con las mismas métricas; la lista de la manzana en una
  pestaña del panel.
- **Colores**: la escala de avance necesita tokens nuevos `--ds-mapa-1..5` con su variante oscura; la opción
  líder reutiliza las clases `op-N` de 021. Sin un solo `#hex` nuevo.
- La etiqueta del nivel superior sale de `configuracion.etiqueta_barrio` ("Radio censal" por defecto), para no
  decir "barrio" mientras sean radios del censo.

### 7. Rendimiento (resumen de lo medido)

| Dato | Alcira | Berrotarán |
|---|---|---|
| Tramos de calle / manzanas / radios | 431 / 163 / 19 | 553 / 223 / 17 |
| Manzanas en JSON | 29 KB (4 KB brotli) | 38 KB (5 KB brotli) |
| Radios en JSON | 33 KB (5 KB brotli) | 26 KB (4 KB brotli) |
| Votantes a ubicar | 5.518 | — |

La ubicación completa son ~1 millón de comparaciones simples (votantes × manzanas, con caja envolvente como
filtro): milisegundos de CPU. La base gana una tabla de ~5.500 filas y un índice.

### 8. Medido en la implementación (padrón sintético de 5.500 votantes sobre las capas reales de Alcira)

| Qué | Resultado |
|---|---|
|  completo | 0,9 s la primera corrida, 0,5 s las siguientes; dos simultáneas no se pisan |
| Ubicados (padrón sintético) | 74,5 % (el real medido: 73,0 %) |
| Estadísticas de todas las manzanas (una consulta) | 7,8 ms |
| Detalle de una manzana (4 consultas en paralelo) | 0,8 a 3 ms cada una |
| Lista de una manzana | 2,9 ms, por el índice de . Con 5.500 votantes Postgres prefiere leer el padrón entero (0,5 ms); con 55.000 pasa solo al índice del padrón (4 ms) |

La API usa  (no ) como tipo de zona: .

## Orden de trabajo

1. **Mudar la ubicación a `src/modules/territorio/ubicacion.js`.** El script de medición la importa. Se verifica con:
   los 17 tests actuales, sin cambios, y la corrida de medición da el mismo 73 %.
2. **Esquema y permiso** (`territorio/001`). Se verifica con: test de migración contra Postgres descartable,
   idempotencia, y que solo el administrador recibe `territorio.view`.
3. **Carga de capas** (`scripts/territorio-cargar.js` + normalización). Se verifica con: fixtures sin red, y una
   carga real de Alcira en un Postgres descartable (nunca en producción).
4. **Servicio `reubicar()` y gancho post-importación.** Se verifica con: padrón chico contra Postgres real,
   totales exactos, idempotencia, y la importación que no falla si la ubicación falla.
5. **Estadísticas, zonas, lista y "sin ubicar" + umbral.** Se verifica con: tests de permisos (403 para los demás
   roles), el test del umbral sobre todas las rutas, y `EXPLAIN` de las consultas.
6. **Frontend** (tokens, página, SVG, panel, lista, menú). Se verifica con: tests estáticos (sin colores sueltos,
   sin terceros), y el recorrido manual contra una base descartable con datos de Alcira, en claro y oscuro.
7. **Documentación**: `CLAUDE.md` (mapa del módulo y la regla de la ubicación en lote), runbook de la carga.

## Archivos que se tocan

| Área | Archivos |
|---|---|
| Módulo nuevo | `src/modules/territorio/` (`module.js`, `routes.js`, `service.js`, `repository.js`, `ubicacion.js`, `capas.js`, `migrations/001_…sql`) y su alta en `src/modules/index.js` |
| Padrón | `PadronService.alCambiar(oyente)` y el aviso en los puntos donde hoy invalida su caché; exportar los fragmentos SQL de agregados por opción para reutilizarlos |
| Scripts | `scripts/territorio-cargar.js`; `scripts/medir-geocodificacion.js` pasa a importar la lógica; `package.json` |
| Frontend | `public/mapa.html`, `components/MapaComponent.js`, `pages/mapa.js`, `styles/mapa-styles.css`, tokens en `design-system.css`, ítem en `NavbarComponent.js` |
| Tests | `test/territorio.test.js` (puros, permisos, umbral), `test/migraciones.test.js` (integración), `test/geocodificacion.test.js` (se conserva) |
| Docs | `CLAUDE.md`, `docs/BACKLOG.md` |

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| **Geocodificar con Georef o Nominatim** | Georef no tiene numeración en localidades chicas; Nominatim devuelve el centro del pueblo como si fuera un domicilio resuelto. Medido y descartado. |
| **Un punto por votante en el mapa** | Las coordenadas son interpoladas sobre la cuadra, no de la casa: pintar puntos prometería una precisión que no existe, y muestra a cada persona. La unidad es la manzana. |
| **PostGIS** | El punto en polígono se hace una vez en memoria, en lote. Una extensión más no baja el costo de ninguna consulta de uso. |
| **Leaflet / teselas de un tercero** | Cientos de KB de librería y una petición externa por vista; rompe la política de seguridad y la regla de rendimiento. 29 KB de SVG alcanzan. |
| **Dibujar los polígonos a mano** | Ya existen oficiales y completos. Se deja para barrios personalizados, no para la base. |
| **Ubicar en caliente cada votante nuevo** | Suma un cálculo a la ruta de alta y no cambia nada para quien mira el mapa. Se recalcula en lote. |
| **Consultar la API de Estadística en cada visita** | Depende de un tercero que ya tuvo una caída durante las pruebas, y lenta. Se copia a la base de cada instancia. |
| **`manzana_id` como columna de `padron.votantes`** | Obliga a `padron` a conocer el esquema del mapa y rompe el sentido de las dependencias entre módulos. |

## Cómo se verifica el conjunto

1. `DATABASE_URL_TEST=… npm test` contra el Postgres descartable (receta de `CLAUDE.md`).
2. `npm run medir:geocodificacion` contra el padrón real: sigue dando ≥ 70 % tras el cambio de módulo.
3. Recorrido manual como administrador **y** como encargado (403 en la API, sin ítem en el menú), con una zona
   bajo el umbral, en modo claro y oscuro.
4. Tamaños de respuesta y `EXPLAIN`, contra los números de la spec.
5. Antes de desplegar: preflight de la migración, backup, `npm run migrate`, `git push`, y recién entonces la
   carga de capas en producción (la corre el dueño, una vez).

## Etapa 2 (para no olvidar el orden)

[024](../../docs/BACKLOG.md): manzanas visitadas, acceso del encargado y del consultor (**requiere resolver antes
la resta que revela una zona oculta**), asignación manual de manzana y alias de calles confirmados por el
administrador. [022](../../docs/BACKLOG.md), [023](../../docs/BACKLOG.md) y [025](../../docs/BACKLOG.md) son
independientes y pueden hacerse en cualquier momento.
