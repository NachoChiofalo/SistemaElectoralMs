# 015 — Plan

## Enfoque

Módulo nuevo `src/modules/comicio`, mismo patrón que `listas` (017). Tres tablas en el
schema `elecciones` (el mismo de 017, no uno nuevo): `comicios`, `comicio_listas` (join),
`mesas`. Los votos se guardan en `votos_lista` (una fila por lista por mesa) más dos
columnas (`votos_blancos`, `votos_nulos`) directamente en `mesas` — evita un `tipo` con
`lista_id` nullable y un CHECK para distinguir "voto a lista" de "blanco/nulo".

El rango de una mesa son dos DNIs (`padron_desde_dni`, `padron_hasta_dni`), FK a
`padron.votantes(dni)`. Nada se materializa: la cantidad de votantes y el solapamiento
entre mesas se calculan con comparaciones de tupla `(apellido, nombre, dni)` contra
`padron.votantes`, en el momento.

Los permisos `comicio.view`/`comicio.edit` ya existen (`auth/migrations/002`): no hace
falta una migración de permisos propia, sólo declararlos en `module.js`.

Frontend: reemplaza la cáscara de `public/comicio.html`. Una pantalla con dos niveles —
listado de comicios (crear/editar/borrar) y, al entrar a uno, sus mesas (crear/editar/
borrar, con la cantidad de votantes mostrada al guardar) más un editor de votos por mesa
y una sección de métricas. Mismo vocabulario visual que `listas-styles.css` (tabla, modal,
toast), con una hoja propia para lo que no se repite (drill-down de mesas, editor de
votos).

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `src/modules/comicio/migrations/001_esquema_comicio.sql` | `elecciones.comicios`, `elecciones.comicio_listas`, `elecciones.mesas`, `elecciones.votos_lista`. |
| `src/modules/comicio/repository.js` | SQL: CRUD de comicio/mesa/votos, conteo de votantes por rango, chequeo de solapamiento, métricas agregadas. |
| `src/modules/comicio/service.js` | Validaciones (tipo de elección, listas existentes, rango válido, sin solapamiento, votos no negativos, lista participante), auditoría. |
| `src/modules/comicio/routes.js` | Rutas de comicio, mesas y votos, gateadas por `comicio.view`/`comicio.edit`. |
| `src/modules/comicio/module.js` | Contrato del módulo. |
| `src/modules/index.js` | Suma `require('./comicio/module')` después de `listas`. |
| `test/comicio.test.js` | Tests del service (mocks) + rutas (permisos, 400/409). |
| `public/comicio.html` | Reemplaza la cáscara "Próximamente". |
| `public/src/components/ComicioComponent.js` | Listado de comicios, drill-down a mesas, editor de votos, métricas. |
| `public/src/pages/comicio.js` | Init de la página (permiso `comicio.view`, mismo patrón que `listas.js`). |
| `public/src/styles/comicio-styles.css` | Estilos propios del drill-down y el editor de votos; reutiliza clases ya definidas (`.modal-*`, `.form-*`, `.toast*`) tal como hace `listas-styles.css`. |
| `public/src/services/ApiService.js` | Métodos de comicio/mesas/votos. |
| `public/src/components/NavbarComponent.js` | Item "Comicio" gateado por `comicio.view` (saca el TODO implícito: hoy no está en la lista). |
| `public/src/pages/dashboard.js` | Tarjeta de comicio pasa de `coming-soon` a `available`. |
| `docs/BACKLOG.md` | 015 a 🟢 al arrancar, a ⬛ al cerrar. |

## Orden de trabajo

1. Migración `001_esquema_comicio.sql`. — se verifica con `migrate:status` corrida dos
   veces, contra Postgres real (Docker), igual que 017.
2. `repository.js`: CRUD de comicio y `comicio_listas` (reemplazo completo del set de
   listas en el `PUT`, mismo patrón que candidatos de 017).
3. `repository.js`: CRUD de mesa, `contarVotantesEnRango(desde, hasta)` con comparación
   de tuplas, `haySolapamiento(comicioId, desde, hasta, excluirMesaId)`.
4. `repository.js`: `reemplazarVotos(mesaId, { blancos, nulos, porLista })` en una
   transacción; `metricas(comicioId)` con agregaciones SQL.
5. `service.js`: valida tipo de elección (misma lista blanca que 017), listas existentes,
   rango (`hasta` no antes que `desde`, ambos DNIs existentes), sin solapamiento, número
   de mesa único por comicio, votos no negativos, `listaId` de un voto pertenece al
   comicio. Audita cada escritura.
6. `routes.js` + `module.js` + línea en `index.js`.
7. `npm run migrate` (test/desarrollo) + `npm test`.
8. Frontend: `ComicioComponent.js` — listado de comicios con el mismo esqueleto que
   `ListasComponent.js` (tabla + modal), drill-down a una vista de mesas dentro del
   comicio, editor de votos por mesa, sección de métricas.
9. `NavbarComponent.js` y `dashboard.js`: comicio pasa a estar disponible.
10. `npm run build:assets`, `npm test`.
11. Smoke en navegador real contra Postgres real: alta de comicio con listas, alta de
    mesa con rango válido, mesa con rango solapado (rechazada), carga de votos, métricas.
12. Cerrar: `docs/BACKLOG.md` 015 → ⬛.

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Tabla de asignación votante↔mesa | Duplica el padrón y hay que mantenerla sincronizada en cada importación de CSV (013). Un rango de dos DNIs más una consulta con comparación de tuplas da el mismo resultado sin ese costo de mantenimiento. |
| `votos` con `lista_id` nullable + `tipo` (`lista`/`blanco`/`nulo`) | Mismo dato con más superficie: cada consulta de "votos por lista" necesita filtrar `tipo = 'lista'`, y blancos/nulos son un valor por mesa, no una lista de filas. Dos columnas en `mesas` son más simples y no necesitan CHECK. |
| Circuito como entidad propia, cruzado con mesa | Fuera de alcance según la spec — el padrón ya tiene `circuito` como texto libre sin normalizar; formalizarlo es trabajo aparte que no bloquea esto. |
| Servicio `comicio` consumiendo `services.listas` para validar listas | Los módulos ya comparten un solo pool: la validación es una consulta directa a `elecciones.listas` desde el repositorio de `comicio`, sin acoplar los dos módulos a nivel de servicio (mismo criterio que usa `padron` con `auditoria`: sólo se consume lo que el módulo expone como servicio, no se leen tablas de otro módulo por atajo — acá la excepción es deliberada porque es sólo una validación de existencia, no lógica de negocio de listas). |

## Cómo se verifica el conjunto

```bash
npm run migrate:status
npm run migrate
npm test                 # incluye comicio.test.js e integracion.test.js
npm run build:assets     # sin dejar el arbol sucio
```

Smoke manual en navegador real (Docker + Postgres, mismo procedimiento que 017): login,
alta de comicio con listas, alta de mesas (una válida, una con rango solapado para
confirmar el 409), carga de votos por mesa, métricas, edición y borrado.
