# Reporte de Auditoría de Seguridad y Concurrencia - Ágora

Este documento presenta los hallazgos de la auditoría integral de código realizada sobre el sistema electoral "Ágora", con enfoque en robustez, seguridad estricta y alta concurrencia.

---

## 1. Concurrencia y Condiciones de Carrera

### [Media] TOCTOU y Riesgos de Aislamiento en Reemplazo de Votos
- **Archivo:** `src/modules/comicio/repository.js`
- **Líneas:** ~333-352 (función `reemplazarVotos`)
- **Descripción:** La función `reemplazarVotos` utiliza una transacción explícita (`BEGIN ... COMMIT`) para ejecutar un `UPDATE` y un `DELETE` seguidos de varios `INSERT`. Sin embargo, la función que lee el estado final (`votosDeMesa()`) se llama **fuera** de esta transacción utilizando una nueva conexión del pool. Además, no se emplea bloqueo de fila explícito (ej. `SELECT ... FOR UPDATE`) sobre la mesa antes de eliminar e insertar votos.
- **Impacto:** Si dos peticiones concurrentes de `cargarVotos` se ejecutan para la misma mesa, existe una pequeña ventana donde los `DELETE` e `INSERT` de ambas transacciones podrían entrelazarse dependiendo del nivel de aislamiento (por defecto READ COMMITTED). Aunque el último en confirmar "gana", podría generarse inconsistencia transitoria o cuellos de botella por falta de un bloqueo pesimista en la raíz de la entidad `mesa`.
- **Propuesta:** Adquirir un bloqueo explícito a nivel de fila (`SELECT ... FOR UPDATE` sobre la mesa) al inicio de la transacción en `reemplazarVotos` para serializar de forma segura las modificaciones concurrentes.

### [Media] Sobreescritura Silenciosa en Detalles de Votante
- **Archivo:** `src/modules/padron/repository.js`
- **Líneas:** ~308 (función `guardarDetalle`)
- **Descripción:** A diferencia de `upsertRelevamiento` que utiliza concurrencia optimista mediante la columna `version`, `guardarDetalle` omite completamente el chequeo de versiones (`ON CONFLICT (dni) DO UPDATE SET...`).
- **Impacto:** Condiciones de carrera entre usuarios editando los detalles especiales de un votante simultáneamente. La última escritura sobreescribe a la anterior sin advertencia ni conflicto HTTP 409, causando posible pérdida de datos introducidos manualmente.
- **Propuesta:** Implementar validación optimista en `guardarDetalle` (verificando la versión esperada o implementando un mecanismo de `last_modified` como en `relevamientos`) antes de permitir el `UPDATE`.

---

## 2. Seguridad y Validación de Datos (Defensive Security)

### [Crítica] Límite de Tamaño de Cuerpo de Petición Precede al Rate Limit (BE-036)
- **Archivo:** `src/core/app.js`
- **Líneas:** 118-120, 142-152
- **Descripción:** El parseo del cuerpo de la petición (`express.json()` y `express.urlencoded()`) con un límite de tamaño considerable (`config.http.limiteBody`, por defecto 10MB) se ejecuta antes de aplicar el `express-rate-limit` a la ruta global `/api/`.
- **Impacto:** Ataque de Denegación de Servicio (DoS). Un atacante puede agotar los recursos de CPU y memoria del servidor enviando ráfagas de payloads de 10MB; el parser de Node debe procesar todo el cuerpo en memoria antes de que el middleware de rate limit pueda rechazar el request por límite de cuota.
- **Propuesta:** Invertir el orden de los middlewares. Inicializar el `rateLimit` antes de los middlewares `express.json` y `express.urlencoded`, de modo que el servidor rechace las peticiones infractoras rápidamente (HTTP 429) antes de incurrir en el costo del parseo.

### [Alta] Ausencia de Validación de Rango en `anioNac` (BE-046)
- **Archivo:** `src/modules/padron/service.js`
- **Líneas:** ~143-158 (función `crearVotante`)
- **Descripción:** Aunque existe una validación básica que verifica que el año sea mayor a 1900 y menor al año actual, no se realizan validaciones estrictas cruzadas de tipos y límites lógicos exhaustivos en todos los vectores de ingesta (por ejemplo, en la importación de CSV o actualizaciones que omiten el service).
- **Impacto:** Corrupción lógica de datos y resultados estadísticos anómalos. Las estadísticas agrupadas por edad (`estadisticasPorRangoEtario`) podrían lanzar errores o inflar las categorías residuales ("Sin definir").
- **Propuesta:** Forzar un `CHECK` a nivel de esquema en PostgreSQL (`CHECK (anio_nac IS NULL OR (anio_nac > 1900 AND anio_nac <= extract(year from current_date)))`) para garantizar que la base de datos sea la última línea de defensa independientemente de la capa de aplicación.

---

## 3. Bugs lógicos y Casos Borde

### [Baja] Manejo Inconsistente de "Notas Vacías" como NULL (BE-051)
- **Archivo:** `src/modules/listas/repository.js`
- **Líneas:** ~104
- **Descripción:** Las notas enviadas vacías (`""`) podrían estar siendo coaccionadas incorrectamente a `NULL` debido a la evaluación falsy en operaciones o inserciones (`candidato.notas || null`).
- **Impacto:** Se pierde semántica entre la intención de "borrar el contenido de la nota" y el estado de "nunca se ingresó una nota".
- **Propuesta:** Emplear el operador de coalescencia nula (`??`) en todos los mapeos de la API (ej. `candidato.notas ?? null`) en lugar de cortocircuitos lógicos tradicionales.

---

## 4. Trazabilidad y Auditoría

### [Baja] Auditoría de Eliminación en Cascada
- **Archivo:** `src/modules/comicio/service.js`
- **Líneas:** ~254-275 (función `eliminarMesa`)
- **Descripción:** Eliminar una mesa requiere que primero esté vacía de votos o fiscales, pero el registro de auditoría almacena la mesa eliminada (`datos_anteriores: existente`) sin adjuntar el historial anidado (los IDs de los votos que se hayan eliminado explícitamente en el pasado).
- **Impacto:** Traza de auditoría potencialmente incompleta en escenarios complejos donde dependencias fueron alteradas justo antes del borrado de la mesa raíz.
- **Propuesta:** Asegurar que los registros del log almacenen un volcado (snapshot) más profundo del estado de la tabla secundaria si su manipulación es relevante para el trackeo forense.