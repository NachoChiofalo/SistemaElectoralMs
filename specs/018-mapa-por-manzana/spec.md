# 018 — Mapa por manzana y barrio

> Estado: aprobada (decisiones del 2026-10-08) — etapa 1
> Tamaño estimado: L

## Problema

El padrón guarda el domicilio de cada votante como **texto libre** (`padron.votantes.domicilio`,
por ejemplo `GRAL PAZ 353`) y no hay ninguna vista geográfica:

- Para saber **dónde falta relevar** hay que mirar el listado y adivinar. El único corte territorial es
  el circuito (`162 - ALCIRA`), que en una localidad chica es todo el pueblo: no distingue una zona de otra.
- No se pueden sacar estadísticas por zona (avance, opción política, condiciones especiales).
- **El casa por casa no tiene soporte**: quien sale a relevar no tiene una lista ordenada de a quién
  visitar en una manzana.

Intentos previos fallaron por la fuente de datos: Nominatim devuelve el centro del pueblo cuando no
encuentra la calle (puntos apilados que parecen resueltos), y Georef no trae numeración de calles en
localidades chicas (probado en Alcira y Berrotarán: rango `0-0`, toda dirección con número devuelve vacío).

## Por qué ahora

La factibilidad **ya está medida** (2026-10-08, ver el ítem 018 de `BACKLOG.md`):

- La Dirección de Estadística y Censos de Córdoba publica el callejero **con numeración por cuadra**
  y las **manzanas** de cada localidad. Alcira: 431 tramos de calle y 163 manzanas.
- Sobre el padrón real de Alcira (5.518 votantes), el algoritmo ubica al **73,0 %** en una manzana, y
  el techo realista es ~80 %.
- El lado de la calle (par/impar) se verificó contra Google Maps: coincide en 6 de 7 domicilios y el
  séptimo se explica por una inconsistencia de Google.
- Los polígonos pesan poco: manzanas de Alcira 29 KB (4 KB comprimidos).

Además desbloquea [020](../../docs/BACKLOG.md) (pronósticos por mesa), que no puede existir sin una
sectorización real del padrón.

## Decisiones tomadas

Todas del 2026-10-08, de la persona dueña del producto.

| # | Tema | Decisión |
|---|---|---|
| 1 | Para qué sirve | Los tres usos: **ver el avance**, **salir a relevar** (casa por casa) y **analizar** (opción política por zona). |
| 2 | Qué es una zona | **Manzana + barrio**, y de **ambos** niveles se debe poder ver **toda** la información, no un resumen. |
| 3 | Lo que no se ubica | Se muestra siempre "N votantes sin ubicar", con su motivo. La asignación manual y los alias de calle **quedan para la etapa 2**. |
| 4 | Privacidad | **Umbral de 10 relevados**: por debajo no se muestra el desglose. Todo el módulo es **solo para el administrador** por ahora. |
| 5 | Qué muestra el mapa | Color por **avance** y por **opción líder**. Al tocar una zona: estadísticas completas. Filtros como en Resultados. |
| 6 | Manzanas visitadas | Se marca la **manzana entera**, con quién y cuándo. **Etapa 2.** |
| 7 | Ciclo de vida de los datos | Cómo se refrescan las capas, el alta de una localidad nueva y la licencia: **se deja para más adelante** (ver [023](../../docs/BACKLOG.md)). |
| 8 | Barrios | Se arranca con los **radios censales** del INDEC como "barrio", y hay una **tarea aparte** para corroborar que sirvan (ver [022](../../docs/BACKLOG.md)). **La lista de votantes por manzana entra en la etapa 1.** El acceso del encargado y del consultor es etapa 2. |
| 9 | Lista por manzana | Muestra nombre, domicilio y si fue relevado, **sin la opción política** de cada persona (la opción se ve en la ficha). Confirmado. |
| 10 | Rótulo del nivel superior | **"Radio censal"** mientras no se cierre 022; es una configuración de la instancia. Confirmado. |
| 11 | Votante cargado a mano | Queda **"sin calcular"** hasta el próximo recálculo (al importar o con el botón). Confirmado. |

## Alcance (etapa 1)

1. **Ubicar a cada votante en una manzana** a partir de su domicilio, al importar el padrón. Se guarda el
   resultado (manzana, coordenadas aproximadas y, si no se pudo, el motivo).
2. **Capas territoriales propias de la instancia**: calles, manzanas y radios censales, guardadas en la
   base. Se cargan con un script que corre el dueño del sistema (`npm run territorio:cargar`).
3. **Dos niveles de zona**: la **manzana** y el **barrio** (radio censal), cada manzana dentro de un barrio.
4. **Mapa** (SVG propio, sin mapa de fondo de terceros) con selector de nivel, coloreable por avance o por
   opción líder, y contador visible de votantes sin ubicar.
5. **Panel de zona** con toda la información de la manzana **y** del barrio al que pertenece, a la vez:
   total de votantes, relevados, avance, desglose por opción política, por sexo, por rango etario y
   condiciones especiales (empleados municipales, ayuda social, nuevos votantes, fallecidos).
6. **Lista de votantes de una manzana**, ordenada por calle y número, para el casa por casa.
7. **Umbral de privacidad** aplicado en el servidor.
8. **Pantalla de "sin ubicar"**: cuántos y por qué, con las calles más frecuentes.

## Fuera de alcance (etapa 1)

- Manzanas visitadas, con quién y cuándo (**etapa 2**, [024](../../docs/BACKLOG.md)).
- Acceso del **encargado de relevamiento** y del **consultor** (**etapa 2**; qué ven es una decisión abierta).
- Asignación manual de una manzana a un votante y tabla de **alias de calles** (**etapa 2**).
- Barrios **definidos por el usuario** (por CSV o dibujados). El modelo los admite; no hay pantalla.
- Mapa de calles de fondo.
- Refresco de las capas, alta de localidad nueva por runbook y licencia de los datos ([023](../../docs/BACKLOG.md)).
- Pronósticos por mesa ([020](../../docs/BACKLOG.md)).
- Cualquier uso fuera del administrador.

## Criterios de aceptación

**Ubicación**
- [ ] Sobre el padrón de Alcira, `ubicados + sin ubicar = total de votantes`, exacto, sin ninguno perdido
      ni contado dos veces. Un votante agregado después de la última corrida cuenta como "sin calcular".
- [ ] Al menos el **70 %** del padrón de Alcira queda ubicado en una manzana (la medición actual es 73,0 %).
- [ ] Un domicilio que no se puede resolver **nunca recibe coordenadas ni manzana**: queda con su motivo
      (sin domicilio, sin número, esquina, número 0, calle no encontrada, calle parecida, cuadra no
      cubierta, sentido dudoso, borde sin manzana).
- [ ] Las calles "parecidas" (mismo apellido, otro nombre) **no** se ubican sin confirmación.
- [ ] Reubicar es idempotente: correrlo dos veces seguidas no cambia nada.
- [ ] Después de importar un CSV, los votantes quedan ubicados sin acción manual.

**Mapa y zonas**
- [ ] Toda manzana pertenece a un barrio, o figura como "sin barrio" (con los radios 2022: 100 % en Alcira y
      en Berrotarán).
- [ ] El panel de una manzana muestra **también** el barrio al que pertenece, con las mismas métricas.
- [ ] Las métricas de un barrio son la **suma exacta** de las de sus manzanas más sus votantes sin manzana
      (que no tienen barrio: se informan aparte).
- [ ] El mapa se dibuja **sin pedirle nada a un tercero**: la política de seguridad (`script-src 'self'`) no
      cambia y un test lo comprueba.
- [ ] Los colores salen de tokens `--ds-*` (avance) y de las clases `op-N` (opción), nunca de un hex, y
      funcionan en modo oscuro.

**Privacidad y permisos**
- [ ] Una zona con **menos de 10 relevados** devuelve, **desde la API**, solo total de votantes, relevados y
      avance: ni desglose por opción, ni condiciones especiales, ni opción líder. No alcanza con ocultarlo
      en pantalla; un test llama a la API.
- [ ] El umbral es una configuración de la instancia (por defecto 10), no una constante en el código.
- [ ] Todas las rutas exigen el permiso `territorio.view`, que solo tiene el rol administrador: el
      encargado y el consultor reciben 403 y no ven el ítem del menú.
- [ ] La lista de votantes de una manzana **no muestra la opción política** de cada persona: muestra
      nombre, domicilio y si fue relevada, con acceso a la ficha del padrón.

**Rendimiento** (regla del proyecto: el costo de servidor va primero)
- [ ] Reubicar los 5.518 votantes de Alcira tarda **menos de 2 s**, en un solo proceso y sin llamadas externas.
- [ ] Las geometrías (calles, manzanas, radios) viajan una vez, con `ETag`, comprimidas: **menos de 60 KB**
      para Alcira. Las estadísticas viajan aparte, sin geometría.
- [ ] Las estadísticas por zona son **una sola consulta agrupada** con índice, y se cachean como las de
      Resultados; no hay una consulta por manzana.
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` de las estadísticas y de la lista de manzana no hace recorrido
      secuencial del padrón para la lista.
- [ ] Nada del módulo hace una llamada externa en uso normal. La única descarga externa es el script de
      carga, que corre a mano.

**Pruebas**
- [ ] `npm test` pasa entero. Las funciones de ubicación se prueban sin red con una calle y manzanas
      sintéticas (incluida una calle dibujada al revés de la numeración).
- [ ] Un test de integración contra Postgres real carga capas de prueba, ubica un padrón chico y verifica los
      totales y el umbral.
- [ ] Verificación manual con el administrador: el mapa de Alcira, una manzana con lista, una zona bajo el
      umbral, y el modo oscuro.

## Restricciones

- **Cuenta personal, acceso de administrador.** Todo el módulo cuelga de `territorio.view`, asignado solo
  al administrador. Abrirlo a otro rol es agregar el permiso a ese rol, sin tocar código (decisión de
  etapa 2).
- **El padrón no sale del servidor.** La comparación de domicilios con el callejero se hace aquí; solo se
  descargan capas públicas, y solo desde el script de carga.
- **Rendimiento primero** (memoria del proyecto): ubicación en lote al importar, ningún cálculo geográfico
  en cada visita, un solo pool, sin PostGIS, sin librería de mapas ni teselas.
- **Migraciones idempotentes, manuales y antes del deploy** (`CLAUDE.md`). Las tablas nuevas viven en su
  propio esquema (`territorio`) y dependen de `padron`, nunca al revés.
- **Ningún color fuera del design system.** La escala de avance necesita tokens nuevos con su variante
  oscura.
- **Ningún dato de usuario entra a una plantilla sin `escaparHtml`**: nombres de calle, de barrio y
  domicilios vienen de fuera.
- **Instancia por localidad** (021): cada instancia carga las capas de **su** localidad; el módulo no sabe
  que existen otras.

## Límites conocidos y riesgos

- **Cerca del 20 % no se va a ubicar** en una manzana (número 0, rural, esquinas, calles nuevas). Es parte del
  producto, y por eso el contador de "sin ubicar" es visible siempre.
- **Los radios censales no son barrios.** Son unidades del censo (en Alcira, 15 radios de unas decenas a unos
  cientos de viviendas). Sirven para arrancar y comparar contra la población del Censo 2022, pero puede que
  la gente piense en "barrios" de otra manera. De ahí la tarea [022](../../docs/BACKLOG.md).
- **Restar para descubrir.** Si un barrio muestra su desglose y todas sus manzanas menos una también, la
  resta revela la que está oculta. Es aceptable mientras el módulo sea solo del administrador, que ya ve el
  padrón completo; **hay que resolverlo antes de abrirlo a otro rol** (criterio de entrada de la etapa 2).
- **Calidad del dato de origen**: el callejero es de 2025 y un loteo nuevo puede faltar; el padrón trae
  caracteres rotos (`PEÃ‘A`), que el algoritmo repara pero conviene corregir en origen ([025](../../docs/BACKLOG.md)).
- **Licencia de las capas** no declarada por el portal. Pendiente de confirmar con la Dirección de
  Estadística antes de ofrecer esto como parte de un producto vendido ([023](../../docs/BACKLOG.md)).
- **Disponibilidad de la fuente**: el portal de datos de Estadística tuvo caída en su catálogo durante las
  pruebas. Por eso las capas se **copian** a la base de cada instancia y no se consultan en uso.
