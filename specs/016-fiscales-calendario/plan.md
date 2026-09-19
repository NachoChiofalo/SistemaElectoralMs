# 016 — Plan

## Enfoque

Módulo nuevo `src/modules/fiscales`, mismo patrón que `comicio` y `listas`. Dos tablas en
el schema `elecciones`: `fiscales` (el registro de datos) y `fiscal_asignaciones`
(mesa_id, fiscal_id, desde `TIME`, hasta `TIME`). Los dos chequeos de solapamiento
(misma mesa, mismo fiscal) son comparaciones de rango de `TIME` — Postgres las resuelve
nativamente con `<`/`>` sin necesidad de la comparación de tuplas que usa el rango de
padrón en 015 (acá el orden ya es un tipo nativo).

Los permisos `fiscales.view`/`fiscales.edit` ya existen (`auth/migrations/002`), igual
que pasó con `comicio.*` en 015: no hace falta migración de permisos propia.

Frontend: reemplaza la cáscara de `public/fiscales.html`. Dos secciones — el padrón de
fiscales (tabla + modal, calcado de `ListasComponent`) y, eligiendo un comicio y una
mesa, el calendario de esa mesa (franjas ya asignadas + alta de una franja nueva) más un
selector de hora que muestra la agenda completa del comicio a esa hora.

## Archivos que se tocan

| Archivo | Qué cambia |
|---|---|
| `src/modules/fiscales/migrations/001_esquema_fiscales.sql` | `elecciones.fiscales`, `elecciones.fiscal_asignaciones` (`CHECK` de horario 08:00–18:00 y `hasta > desde`). |
| `src/modules/fiscales/repository.js` | CRUD de fiscal y asignación, chequeos de solapamiento (por mesa y por fiscal), agenda por hora. |
| `src/modules/fiscales/service.js` | Validaciones, auditoría. |
| `src/modules/fiscales/routes.js` | Rutas gateadas por `fiscales.view`/`fiscales.edit`. |
| `src/modules/fiscales/module.js` | Contrato del módulo. |
| `src/modules/index.js` | Suma `require('./fiscales/module')` después de `comicio` (necesita `elecciones.mesas`). |
| `test/fiscales.test.js` | Tests del service (mocks) + rutas. |
| `public/fiscales.html` | Reemplaza la cáscara. |
| `public/src/components/FiscalesComponent.js` | Padrón de fiscales + calendario por mesa + agenda por hora. |
| `public/src/pages/fiscales.js` | Init de página (permiso `fiscales.view`). |
| `public/src/styles/fiscales-styles.css` | Estilos propios (calcado de `comicio-styles.css`). |
| `public/src/services/ApiService.js` | Métodos de fiscales/asignaciones/agenda. |
| `public/src/components/NavbarComponent.js` | Item "Fiscales" gateado por `fiscales.view`. |
| `public/src/pages/dashboard.js` | Tarjeta de fiscales pasa de `coming-soon` a `available`. |
| `docs/BACKLOG.md` | 016 a 🟢 al arrancar, a ⬛ al cerrar. |

## Orden de trabajo

1. Migración `001_esquema_fiscales.sql`. — se verifica con `migrate:status` corrida dos
   veces, contra Postgres real (Docker).
2. `repository.js`: CRUD de `fiscales`.
3. `repository.js`: `solapaConMesa(mesaId, desde, hasta, excluirId)`,
   `solapaConFiscal(fiscalId, desde, hasta, excluirId)`, CRUD de `fiscal_asignaciones`.
4. `repository.js`: `agendaDeComicio(comicioId, hora)` — por cada mesa del comicio, el
   fiscal cuya franja contiene `hora`.
5. `service.js`: valida horario (08:00–18:00, `hasta > desde`), ambos solapamientos,
   existencia de mesa/fiscal. Audita.
6. `routes.js` + `module.js` + línea en `index.js`.
7. `npm run migrate` (Docker) + `npm test`.
8. Frontend: `FiscalesComponent.js` (padrón de fiscales, selector de comicio/mesa,
   calendario de la mesa, agenda por hora).
9. `NavbarComponent.js` y `dashboard.js`.
10. `npm run build:assets`, `npm test`.
11. Smoke en navegador real contra Postgres real: alta de fiscal, asignación válida,
    asignación solapada en la misma mesa (rechazada), asignación solapada para el mismo
    fiscal en otra mesa (rechazada), agenda por hora, edición y borrado.
12. Cerrar: `docs/BACKLOG.md` 016 → ⬛.

## Alternativas descartadas

| Opción | Por qué no |
|---|---|
| Cuenta de usuario para cada fiscal | No está pedido; agrega un rol nuevo, pantallas propias y gestión de contraseñas para un caso de uso que el backlog no describe (el fiscal no usa el sistema). |
| Sólo validar solapamiento por mesa, no por fiscal | Deja pasar un dato imposible en la realidad (un fiscal en dos mesas a la vez) por un costo bajo de evitarlo — misma consulta, otro `WHERE`. |
| Bloques de franja fijos (ej. de una hora) en vez de horario libre | El pedido no fija una granularidad. Restringir ahora es una decisión de UX sin un problema real que la motive todavía — queda anotado como riesgo, no como alcance. |
| Un módulo aparte para "agenda" en vez de un endpoint dentro de `fiscales` | La agenda es sólo una lectura derivada de `fiscal_asignaciones`; separarla en otro módulo agrega indirección sin necesidad. |

## Cómo se verifica el conjunto

```bash
npm run migrate:status
npm run migrate
npm test                 # incluye fiscales.test.js e integracion.test.js
npm run build:assets     # sin dejar el arbol sucio
```

Smoke manual en navegador real (Docker + Postgres): login, alta de fiscal, asignación a
mesa, solapamiento por mesa (409 visible), solapamiento por fiscal (409 visible), agenda
por hora, edición y borrado. Sin errores de consola.
