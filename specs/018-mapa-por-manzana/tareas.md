# 018 — Tareas (etapa 1)

El paso a paso para implementar [la spec](spec.md) según [el plan](plan.md). Cada paso se verifica solo:
un paso que no se puede verificar sin el siguiente está mal cortado.

**Reglas para todo el trabajo**

- Nada toca producción hasta la fase 8, y la fase 8 la corre el dueño. Toda prueba con base va contra el
  Postgres descartable de `CLAUDE.md` (`DATABASE_URL_TEST`), y toda prueba con datos de Alcira usa un padrón
  **sintético** o las capas públicas, nunca el padrón real.
- Cada fase cierra con `npm test` en verde. Si toca `public/`, también con `npm run build:assets`.
- Un commit por fase como mínimo; ninguna fase deja el sistema roto para la siguiente.

**Orden y dependencias**

```
F0 ─► F1 ─► F2 ─► F3 ─► F4 ─► F5 ─► F6 ─► F7 ─► F8
                                  └─► F6 puede empezar con datos de prueba en cuanto el contrato de F5 esté fijo
```

| Fase | Qué deja hecho | Tamaño |
|---|---|---|
| F0 | Decisiones por defecto confirmadas y línea base | S |
| F1 | La lógica de ubicación como módulo, sin cambiar su comportamiento | S |
| F2 | Esquema, permiso y módulo vacío montado | S |
| F3 | Script de carga de capas | M |
| F4 | Votantes ubicados, con recálculo al importar | M |
| F5 | API completa, con el umbral en el servidor | M |
| F6 | Pantalla del mapa | L |
| F7 | Rendimiento medido y documentación | S |
| F8 | Despliegue (lo corre el dueño) | S |

---

## F0 — Preparación

- [x] **0.1** Confirmar con el dueño las tres decisiones que tomé por defecto en la spec:
      (a) la lista por manzana **no** muestra la opción política; (b) el nivel superior se rotula
      **"Radio censal"** hasta cerrar [022](../../docs/BACKLOG.md); (c) un votante cargado a mano queda
      **"sin calcular"** hasta el próximo recálculo.
      *Verifica:* la tabla de decisiones de la spec registra la respuesta.
- [x] **0.2** Snapshot de contrato con el servidor levantado contra la base descartable:
      `node scripts/api-snapshot.js --out specs/018-mapa-por-manzana/snapshot-antes.json`.
      *Verifica:* el archivo existe. Sirve para probar al final que no cambió ningún endpoint existente.

## F1 — Mudar la ubicación a un módulo

- [x] **1.1** `src/modules/territorio/ubicacion.js` con las funciones puras que hoy están en
      `scripts/medir-geocodificacion.js`: reparación de texto, términos, separación calle/número,
      candidatas, orientación, índice, `resolver` y `ESTADOS`. Sin red, sin base, sin `process.env`.
      *Verifica:* `test/geocodificacion.test.js` importa desde el módulo y sus 17 tests pasan **sin cambiar
      una línea de los asserts**.
- [x] **1.2** `src/modules/territorio/capas.js`: descarga paginada y normalización de tramos, manzanas y
      radios censales (`Radios2022`, por envolvente). `fetch` se recibe por parámetro para poder probarlo.
      *Verifica:* tests con un `fetch` falso y respuestas guardadas: paginación (`exceededTransferLimit`),
      nombres con caracteres rotos, error del servicio con reintentos y mensaje claro.
- [x] **1.3** `asignarSectores(manzanas, radios)` en `capas.js`: cada manzana al radio que contiene su centroide.
      *Verifica:* test con polígonos sintéticos (una manzana adentro, una afuera → sin barrio).
- [x] **1.4** El script de medición pasa a importar `ubicacion.js` y `capas.js`.
      *Verifica:* `--localidad ALCIRA --probar "GRAL PAZ 353"` sigue dando manzana 58600, y
      `npm run medir:geocodificacion` contra el padrón real sigue dando 73 % (**lo corre el dueño**; con `--probar` ya da los mismos resultados).

## F2 — Esquema, permiso y módulo

- [x] **2.1** `territorio/migrations/001_esquema_territorio.sql`: esquema `territorio` y las tablas del plan
      (`configuracion` de una sola fila, `calles_tramos`, `manzanas` con id `BIGINT` de la fuente, `sectores`,
      `ubicaciones` con `detalle`), `CHECK` del estado contra la lista de `ESTADOS`, índices en
      `ubicaciones (manzana_id)` y `manzanas (sector_id)`, y `ubicaciones.dni` con `ON DELETE CASCADE`.
      Todo con `IF NOT EXISTS`.
      *Verifica:* migrar dos veces seguidas en la base descartable no falla ni cambia nada.
- [x] **2.2** `territorio/migrations/002_permiso_territorio.sql`: permiso `territorio.view` y su asignación al
      administrador, con el mismo patrón que `listas/002`.
      *Verifica:* test de integración: el administrador lo tiene; el encargado y el consultor no.
- [x] **2.3** `territorio/module.js` (`basePath: '/api/territorio'`, `requiresAuth: true`) y su línea en
      `src/modules/index.js`, **después de `padron`**. Router vacío por ahora.
      *Verifica:* el subtest "la app arranca contra esta base" sigue pasando.
- [x] **2.4** `test/migraciones.test.js` borra también el esquema `territorio` al limpiar.
      *Verifica:* la suite con base corre dos veces seguidas sin restos de la anterior.

## F3 — Carga de capas

- [x] **3.1** Repositorio: `reemplazarCapas(cliente, { tramos, manzanas, sectores, configuracion })` en una
      transacción. Vacía `ubicaciones` (se recalcula enseguida) y conserva los ids de origen de las manzanas.
      Inserta por lotes (`unnest` / `jsonb_to_recordset`), no fila por fila.
      *Verifica:* test con capas sintéticas: dos cargas seguidas dejan exactamente lo mismo.
- [x] **3.2** `scripts/territorio-cargar.js` y `npm run territorio:cargar`. Sin `--si` **solo muestra** destino
      (host de la base), localidad y conteos; con `--si` escribe. Al terminar llama a `reubicar()`
      (que llega en F4: hasta entonces, solo carga).
      *Verifica:* carga de Alcira en la base descartable: 431 tramos, 163 manzanas, el 100 % con radio.
      Correrlo de nuevo no cambia los conteos.
- [x] **3.3** La carga queda registrada: `configuracion.cargado_en`, fuente y localidad, y una línea en el log.
      *Verifica:* `SELECT * FROM territorio.configuracion` después de cargar.

## F4 — Ubicar el padrón

- [x] **4.1** Repositorio: leer `dni, domicilio` de todos los votantes y guardar ubicaciones por lotes de 1.000
      con `INSERT … ON CONFLICT (dni) DO UPDATE`.
      *Verifica:* test con 2.500 votantes sintéticos (tres lotes): ninguno perdido ni repetido.
- [x] **4.2** `TerritorioService.reubicar()`: advisory lock propio (constante documentada junto a
      `LOCK_IMPORTACION`), capas leídas de la base, índice en memoria, resolución, escritura en una
      transacción. Devuelve el resumen por estado y loguea la duración.
      *Verifica:* integración con capas y padrón sintéticos: resumen exacto, dos corridas dan lo mismo, y dos
      corridas simultáneas no se pisan (una espera).
- [x] **4.3** `PadronService.alCambiar(oyente)` y el aviso, con el tipo de cambio, en los puntos donde hoy
      invalida su caché. Un oyente que lanza se loguea y no rompe la operación.
      *Verifica:* tests unitarios del padrón: un oyente que lanza no hace fallar `actualizarRelevamiento` ni
      `importar`; el resto de la suite del padrón pasa sin tocarla.
- [x] **4.4** `territorio` se suscribe al registrarse: invalida su caché ante cualquier cambio y reubica,
      fuera de la respuesta, ante una importación.
      *Verifica:* integración: importar un CSV chico deja los votantes nuevos ubicados sin acción manual.
- [x] **4.5** Un votante sin fila en `ubicaciones` cuenta como "sin calcular".
      *Verifica:* test: crear un votante a mano y pedir el resumen.

## F5 — API

Todas las rutas con `requirePermission('territorio.view')`.

- [x] **5.1** Exportar desde `padron/repository.js` los fragmentos de agregados por opción (`porOpcion`,
      `agregadosVoto`) para no duplicar el SQL. Las opciones salen de `services.padron.opciones`.
      *Verifica:* la suite del padrón pasa sin cambios.
- [x] **5.2** `aplicarUmbral(zona, umbral)`: única función que recorta una zona bajo el umbral a
      `{ votantes, relevados, avance, desglose_oculto: true }`.
      *Verifica:* tests unitarios en el borde (9, 10 y 11 relevados) y con umbral configurado distinto de 10.
- [x] **5.3** `GET /estadisticas`: **una** consulta `GROUP BY manzana_id`; los barrios se suman en memoria;
      contadores de "sin ubicar" y "sin calcular"; caché de 60 s invalidada por el padrón; umbral al final.
      *Verifica:* integración: `ubicados + sin ubicar + sin calcular = total`, y cada barrio es la suma exacta
      de sus manzanas.
- [x] **5.4** `GET /zonas/:tipo/:id`: total, relevados, avance, por opción, por sexo, por rango etario y
      condiciones especiales; para una manzana también su barrio. 404 si la zona no existe.
      *Verifica:* integración contra valores calculados a mano sobre el padrón sintético.
- [x] **5.5** `GET /manzanas/:id/votantes`: paginada, ordenada por calle y número; nombre, domicilio, relevado
      sí/no y fecha. **Sin opción política.**
      *Verifica:* test de forma de la respuesta (la clave de la opción no existe) y del orden.
- [x] **5.6** `GET /sin-ubicar`: cuántos por estado y los detalles más frecuentes.
      *Verifica:* integración: coincide con el resumen de `reubicar()`.
- [x] **5.7** `GET /geometria`: barrios y manzanas con coordenadas a 5 decimales.
      *Verifica:* un segundo pedido con `If-None-Match` responde 304 (Express emite ETag por defecto; si no, se
      calcula), y el cuerpo de Alcira pesa menos de 60 KB comprimido.
- [x] **5.8** `POST /reubicar`: solo administrador, auditado como `REUBICAR`, responde el resumen.
      *Verifica:* test de auditoría y de permiso.
- [x] **5.9** El test del umbral **recorre todas las rutas** con una zona de 3 relevados y falla si aparece
      cualquier clave sensible (opción, desglose, condiciones, líder).
      *Verifica:* agregar a propósito una ruta que se salte `aplicarUmbral` hace fallar el test (se prueba y se
      saca).
- [x] **5.10** Permisos (quedaron en `test/territorio.test.js`, recorriendo las rutas del router): cada ruta da 403 sin `territorio.view` y no 403 con él.
      *Verifica:* `npm test`.
- [x] **5.11** `EXPLAIN (ANALYZE, BUFFERS)` de estadísticas, zona y lista sobre 5.500 votantes sintéticos.
      *Verifica:* la lista usa el índice de `manzana_id`; los números quedan anotados en el plan.

## F6 — Pantalla

- [ ] **6.1** Tokens `--ds-mapa-0..5` (0 = sin datos o bajo el umbral) en `design-system.css`, con modo oscuro.
      *Verifica:* el test de colores sueltos pasa.
- [ ] **6.2** `public/src/lib/geometria-svg.js`: proyección equirrectangular con corrección por latitud y paso de
      anillos a `path` SVG, ajustado a un `viewBox`. Función pura.
      *Verifica:* test en node: un cuadrado conocido da el `path` esperado y el norte queda arriba.
- [ ] **6.3** `mapa.html`, `pages/mapa.js` (si no tiene `territorio.view`, vuelve al inicio) y el ítem "Mapa" en
      `NavbarComponent` con `permission: 'territorio.view'`.
      *Verifica:* como encargado el ítem no aparece y la URL directa redirige.
- [ ] **6.4** `MapaComponent`: pide geometría y estadísticas en paralelo; dibuja manzanas y contornos de barrio;
      selectores de nivel (barrio / manzana) y de color (avance / opción líder); leyenda con texto; contador
      de "sin ubicar" siempre visible.
      *Verifica:* recorrido manual (6.11).
- [ ] **6.5** Panel de zona: la manzana y su barrio lado a lado, con las mismas métricas; el aviso de
      "menos de 10 relevados" cuando corresponde.
      *Verifica:* recorrido manual.
- [ ] **6.6** Pestaña "Votantes" de la manzana, paginada, con enlace a la ficha.
      *Verifica:* recorrido manual.
- [ ] **6.7** El padrón abre una ficha desde la URL (`index.html?dni=…`), que hoy no existe y la lista necesita.
      *Verifica:* abrir la URL con un DNI muestra su panel; con un DNI inexistente, el listado normal.
- [ ] **6.8** Panel de "sin ubicar" (motivos y detalles más frecuentes) y botón "Recalcular" con confirmación en
      un modal propio (no `confirm()` del navegador).
      *Verifica:* recorrido manual.
- [ ] **6.9** Accesibilidad: cada zona es enfocable con teclado, con `aria-label` que dice zona, votantes y avance;
      el color nunca es la única señal (la leyenda tiene texto).
      *Verifica:* recorrer el mapa solo con Tab y Enter.
- [ ] **6.10** `npm run build:assets` y tests estáticos (escapado, CSP, colores, `?v=`).
      *Verifica:* `npm test`.
- [ ] **6.11** Recorrido manual en Chrome contra la base descartable con las capas de Alcira y un padrón
      sintético: administrador ve todo; encargado no; zona bajo el umbral sin desglose (también en la
      respuesta de red); lista ordenada y enlace a la ficha; modo claro y oscuro; ventana angosta.
      *Verifica:* capturas en la descripción del commit de cierre.

## F7 — Rendimiento y documentación

- [ ] **7.1** Medir y anotar en el plan: `reubicar()` con 5.500 votantes sintéticos (< 2 s), tamaños de
      `/geometria` y `/estadisticas`, y el `EXPLAIN` de 5.11.
      *Verifica:* los números de la spec se cumplen; si no, se corrige antes de seguir.
- [ ] **7.2** Snapshot después y comparación con el de 0.2.
      *Verifica:* `--compare`: ningún endpoint existente cambió.
- [ ] **7.3** `CLAUDE.md`: el módulo en el mapa, la regla "la ubicación se calcula en lote y ninguna ruta hace
      geometría en vivo", el comando de carga, y el conteo de tests.
      *Verifica:* lectura.
- [ ] **7.4** `BACKLOG.md`: avance de 018.
      *Verifica:* lectura.

## F8 — Despliegue (lo corre el dueño)

Las migraciones solo crean el esquema nuevo e insertan un permiso: no tocan datos existentes. La carga de capas
escribe únicamente en `territorio`.

- [ ] **8.1** `npm run migrate:status` y backup.
- [ ] **8.2** `npm run migrate` (crea `territorio` y el permiso), y recién después `git push`.
- [ ] **8.3** `npm run territorio:cargar -- --localidad ALCIRA` **sin** `--si` contra producción: revisar el host
      que muestra y los conteos (431 / 163 / 19).
- [ ] **8.4** Con `--si`: carga y ubicación del padrón real.
      *Verifica:* el resumen da ~73 % ubicado, como la medición.
- [ ] **8.5** Prueba en producción como administrador: el mapa de Alcira, una manzana con su lista, una zona bajo el
      umbral, "sin ubicar". Y como encargado: sin acceso.
