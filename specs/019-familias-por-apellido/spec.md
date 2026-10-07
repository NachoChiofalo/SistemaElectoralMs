# 019 — Métricas de familias por apellido

> Estado: cerrada
> Tamaño estimado: S

## Problema

El padrón no tiene ninguna métrica que agrupe votantes por apellido para detectar
núcleos familiares: hoy `resultados/*` corta por circuito, sexo y edad, pero no dice
"hay 38 Gómez en el padrón, 12 ya relevados, 9 PJ". Esa agrupación es la que permite
ir a una casa y relevar a varios integrantes de una sola visita.

## Por qué ahora

Es una extensión chica de las métricas existentes que no depende de ningún otro ítem
(`docs/BACKLOG.md`, P3). Con las personas ya relevando en campo (012), saber dónde se
concentran los apellidos repetidos ordena el trabajo.

## Alcance

- `GET /api/padron/resultados/por-familia`: los apellidos que comparten al menos
  `minimo` votantes (default 2), con total de integrantes, relevados y desglose PJ / UCR /
  Indeciso, ordenados por cantidad de integrantes. Un resumen: cuántos apellidos se
  repiten y cuántas personas caen en ellos.
- Parámetros `minimo` (2–50) y `limite` (1–100, default 50), recortados al rango en el
  service: el cliente no puede pedir una agrupación sin techo.
- En Resultados, un bloque **"Apellidos repetidos"** que se carga **a pedido** (botón),
  no con la pantalla.

## Fuera de alcance

- Afinidad entre apellidos distintos (compuestos, "de", abreviaturas) o por domicilio:
  agrupar por domicilio sería una métrica mejor de "núcleo familiar" y es parte de 018.
- Exportarlo a CSV.

## Costo (regla de rendimiento del proyecto)

- **Dos consultas agregadas**, sin N+1: `GROUP BY apellido` sobre `votantes LEFT JOIN
  relevamientos`, con `HAVING` y `LIMIT`, más un conteo para el resumen. Sobre ~5.500
  filas es un recorrido de la tabla cada una.
- **Cacheada 60 s** en `CacheResultados` con clave por parámetros, e invalidada por
  cualquier escritura de relevamiento, igual que los otros `resultados/*`.
- Cantidad de claves de caché acotada por el rango de parámetros.
- Payload: a lo sumo 100 filas de 6 campos.
- **Carga a pedido en la UI**: no suma una consulta a cada visita de Resultados.

## Criterios de aceptación

- [x] El endpoint devuelve, por apellido compartido, integrantes, relevados y PJ/UCR/Indeciso,
      ordenados por integrantes descendente, y respeta `minimo` y `limite`.
- [x] Valores fuera de rango o no numéricos se recortan; no devuelven 500.
- [x] Exige `resultados.view`.
- [x] Una segunda llamada dentro de 60 s no vuelve a consultar la base.
- [x] El bloque de la UI no pide nada hasta que se aprieta el botón, y escapa el apellido.
- [x] La consulta funciona contra Postgres real (test de integración).

## Restricciones

- Un apellido común no es una familia: Gómez y Pérez agrupan gente sin parentesco. El
  bloque lo dice en pantalla en vez de prometer más de lo que mide.
- Ningún dato de usuario entra a una plantilla sin `escaparHtml`; sin `onclick=` inline.

## Riesgos

- Leer el número como "familias" cuando son apellidos: mitigado con el texto de ayuda.
- Normalización: `GOMEZ` y `Gómez` son apellidos distintos para Postgres. El padrón
  oficial viene en mayúsculas, así que se agrupa tal cual y no se agrega `unaccent`.
