# 021 — Multitenancy: un mismo sistema para varios municipios

> **Alternativa descartada por ahora.** La decisión vigente es [una instancia aislada por municipio](../spec.md); este diseño se retoma si se cumple alguna condición de "Cuándo reabrir esta decisión" de esa spec.

> Estado: borrador (esperando las decisiones de la sección "Decisiones abiertas")
> Tamaño estimado: L

## Problema

Hoy el sistema es de **un solo municipio**, y eso no está declarado en ningún lado: está
repartido en el esquema y en el código como supuestos implícitos.

- `padron.votantes` tiene `dni` como clave primaria (`padron/migrations/001_esquema_padron.sql`).
  No hay forma de decir "este votante es del municipio X".
- `padron.relevamientos` tiene `UNIQUE (dni)` y `CHECK (opcion_politica IN ('PJ','UCR','Indeciso'))`:
  las opciones políticas de **un** municipio están escritas en el esquema, y hay referencias
  a `PJ`/`UCR` en `padron/repository.js`, `padron/service.js` y cuatro componentes del frontend.
- `usuarios.username` es único global y no tiene organización. Un usuario ve todo.
- `comicios`, `mesas`, `fuerzas`, `listas`, `fiscales` y `padron.auditoria` no tienen ningún
  campo que los asigne a un dueño.
- La vista `padron.estadisticas_condiciones_especiales` agrega **toda** la tabla
  (`padron/repository.js:346`).
- El importador usa un único advisory lock global y reemplaza datos sin noción de dueño.
- El rate limit, la caché de sesión y los logs no conocen el concepto de organización.

Si se carga el padrón de un segundo municipio hoy, los dos se mezclan en las mismas tablas,
las estadísticas suman ambos y cualquier usuario de uno ve los datos del otro. No es un
"todavía no soportado": es una fuga de datos.

El dato en juego es de **máxima sensibilidad**: un padrón con la opinión política de cada
persona, su teléfono y si recibe ayuda social. La opinión política es dato sensible bajo la
ley argentina de protección de datos personales (25.326). Un aislamiento mal hecho entre
municipios no es un bug de UX; es una brecha reportable. (Esto es una señal de riesgo, no
asesoramiento legal: conviene que lo revise alguien con ese perfil antes del segundo
cliente.)

## Por qué ahora

El sistema está recién estabilizado (backlog P0–P3 cerrado, 273 tests, una sola organización
real). **Es el momento más barato para hacerlo**: 5.518 votantes y un único tenant implican
backfill instantáneo y cero migraciones de datos entre organizaciones. Cada módulo nuevo que
se escriba antes (018 mapa, 014 presencia, 020 pronósticos) agrega consultas que después hay
que revisar una por una. Postergarlo convierte este cambio en uno más caro y más riesgoso.

## Alcance

- Concepto de **tenant** (municipio) como dueño de todo dato de negocio.
- Aislamiento garantizado a nivel de datos, comprobado por tests con dos tenants.
- Cada usuario pertenece a un tenant; el tenant viaja en la sesión, no en la URL.
- Configuración por tenant de lo que hoy está fijo: opciones políticas, tipos de elección,
  nombre visible.
- Rol de plataforma (`superadmin`) y alta de un tenant nuevo sin tocar la base a mano.
- Importación del padrón por tenant.
- Auditoría, logs y límites de uso con noción de tenant.
- Migración de lo existente como **tenant #1**, sin downtime y sin romper la versión
  que sigue sirviendo mientras se despliega.

## Fuera de alcance

- Un usuario que pertenece a **varios** tenants a la vez (consultor que trabaja con dos
  municipios). Se deja la puerta abierta (ver plan, "Diseño") pero no se construye.
- Base de datos o schema separado por tenant (ver alternativas descartadas).
- Subdominio por municipio y dominios propios. El tenant se deduce del usuario; el subdominio
  es una decisión posterior y aditiva.
- Facturación, planes, cuotas comerciales.
- Datos compartidos entre tenants (un padrón nacional común). Cada tenant carga el suyo.
- Rediseño del frontend. Solo lo que haga falta: nombre del tenant y opciones políticas dinámicas.

## Criterios de aceptación

- [ ] Existe `tenants` y **toda** tabla de negocio tiene `tenant_id NOT NULL` con FK.
      Un test enumera las tablas de los esquemas `padron`/`elecciones`/`public` y falla si
      aparece una tabla nueva sin `tenant_id` y sin estar en una lista explícita de
      "tablas globales" (`roles`, `permisos`, `rol_permisos`, `tenants`, `schema_migrations`).
- [ ] Con dos tenants cargados, un usuario del A recibe **404** (no 403: no se revela que
      existe) al pedir por id cualquier recurso del B, en **todos** los endpoints que reciben
      un id. Hay un test que recorre las rutas, no una lista escrita a mano.
- [ ] Los listados, búsquedas, estadísticas, exportaciones y resultados de A no incluyen
      una sola fila de B. Test con datos distinguibles en ambos.
- [ ] El mismo DNI puede existir en dos tenants sin conflicto de clave.
- [ ] Un usuario de A no puede crear/editar un recurso apuntando a un id de B (por ejemplo,
      una mesa con `padron_desde_dni` de B, o una asignación con un `fiscal_id` de B).
- [ ] La importación del padrón de A no bloquea ni toca los datos de B.
- [ ] El token lleva el tenant, pero la **autoridad es la base**: si se cambia el tenant de
      un usuario o se lo desactiva, deja de funcionar dentro del TTL de la caché de sesión.
- [ ] Un tenant se da de alta con un solo comando (`npm run tenant:crear`) que deja un
      administrador listo para iniciar sesión.
- [ ] `padron.auditoria` registra `tenant_id` en cada evento y el listado de auditoría solo
      muestra los del tenant del solicitante (el `superadmin` ve todos, y su acceso queda
      auditado).
- [ ] Las opciones políticas dejan de estar escritas en el esquema y en el código: cada
      tenant define las suyas. El tenant #1 conserva `PJ`/`UCR`/`Indeciso` sin cambio visible.
- [ ] **Rendimiento:** ningún endpoint agrega una consulta a la base por el hecho de ser
      multitenant (el tenant sale de la sesión cacheada), y todo índice de búsqueda/listado
      empieza por `tenant_id`. Se compara con el estado previo usando `EXPLAIN` sobre las
      consultas del listado del padrón y las estadísticas.
- [ ] La migración sobre la base real del tenant #1 no requiere detener el servicio, y el
      código viejo sigue funcionando entre `npm run migrate` y el deploy (compatibilidad
      hacia atrás de cada migración intermedia).
- [ ] `npm test` pasa con la suite existente (el tenant #1 se comporta igual que hoy) más la
      suite nueva de aislamiento.

## Restricciones

- **El frontend no cambia para cambiar el backend.** El tenant se infiere de la sesión, así
  que `public/` sigue pidiendo `/api/*` con `window.location.origin`. Las únicas excepciones
  son la UI nueva imprescindible (opciones políticas dinámicas, nombre del tenant).
- **Migraciones idempotentes, aplicadas a mano, antes del deploy**, y la que toca datos
  existentes (el backfill a tenant #1) se confirma con la persona antes de correrla: no hay
  staging, `DATABASE_URL` es producción.
- **Un solo pool.** Nada de un pool por tenant ni de `SET search_path` por conexión.
- **Rendimiento primero** (memoria del proyecto): el costo de servidor condiciona el diseño
  antes que el alcance. Supabase es plan limitado; ver "Capacidad" en el plan.
- **La cuenta es personal.** Una cuenta nunca se comparte entre tenants.

## Decisiones abiertas

Las respuestas cambian el plan; las recomendaciones son las que asume el plan.

| # | Pregunta | Recomendación asumida |
|---|---|---|
| D1 | ¿Cómo se resuelve el tenant en cada request? | **Por el usuario** (`usuarios.tenant_id`), sin subdominio. No toca el frontend y funciona en el plan free de Render. |
| D2 | ¿El `username` es único global o por tenant? | **Global**, como hoy: el login no necesita pedir el municipio. Si más adelante se quiere por tenant, hay que pasar a subdominio. |
| D3 | ¿Un padrón por tenant, o un padrón nacional compartido con relevamientos por tenant? | **Un padrón por tenant.** Más simple y más seguro; duplica filas, no riesgo. |
| D4 | ¿El `superadmin` ve datos de los tenants? | **No** por defecto: solo administra tenants y usuarios. Ver datos de negocio de un tenant requiere acción explícita y auditada. |
| D5 | ¿Qué pasa con los datos de un tenant que se da de baja? | Desactivar (soft) y exportar; borrado físico solo con pedido escrito. |
| D6 | ¿Cuántos municipios y de qué tamaño se esperan en el primer año? | Dimensiona la fase de capacidad y si hace falta RLS (fase 6). |
