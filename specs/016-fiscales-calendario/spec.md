# 016 — Gestión de fiscales por mesa con calendario

> Estado: aprobada
> Tamaño estimado: L

## Problema

`public/fiscales.html` existe como cáscara ("Próximamente") sin backend. No hay forma de
registrar fiscales, asignarlos a una mesa, ni de saber quién cubre una mesa en un horario
dado. Los permisos `fiscales.view`/`fiscales.edit` ya están sembrados desde 2025.

## Por qué ahora

Es más específico que el 007 original: cada mesa necesita uno o más fiscales, pero sólo
uno presente en cada momento — eso exige un calendario por franja horaria (8 a 18hs), no
sólo una asignación fija. Depende de 015 (ya cerrado): no hay mesa a la que asignar un
fiscal hasta que existiera el módulo de comicio.

## Alcance

- **Fiscal**: registro de datos — nombre completo, DNI (opcional), teléfono (opcional).
  Alta/edición/baja/listado. **No tiene cuenta de usuario del sistema**: es información
  que alguien con `fiscales.edit` carga y asigna, el fiscal nunca entra a loguearse.
- **Asignación de fiscal a mesa por franja horaria**: un fiscal cubre una mesa entre una
  hora "desde" y una hora "hasta", ambas dentro de 08:00–18:00. Alta/edición/baja.
- **Dos fiscales no pueden cubrir la misma mesa al mismo tiempo**: franjas que se
  solapan en la misma mesa se rechazan (409).
- **Un mismo fiscal no puede estar asignado a dos mesas al mismo tiempo**: franjas que
  se solapan para el mismo fiscal, aunque sean mesas distintas, se rechazan (409). No
  puede estar en dos lugares a la vez.
- **Vista de quién cubre qué mesa en un horario dado**: dado un comicio y una hora,
  devuelve para cada una de sus mesas qué fiscal está presente (o ninguno).

## Fuera de alcance

- Cuenta de usuario o login para el fiscal — es un registro de datos, no un rol del
  sistema.
- Capacitación online, control de asistencia real (marcar llegada/salida) — el backlog
  original de 007 los mencionaba, pero el pedido concreto de 016 es el calendario, no
  seguimiento en tiempo real.
- Múltiples días/fechas de elección: el calendario es sólo horas (8–18hs) de un único día
  de comicio, igual que el resto del sistema no modela fechas de elección distintas.
- Notificaciones al fiscal (SMS, email) sobre su franja asignada.

## Criterios de aceptación

- [ ] `POST /api/fiscales` crea un fiscal (nombre, DNI opcional, teléfono opcional);
      responde 201.
- [ ] `GET /api/fiscales` lista fiscales, paginado con techo.
- [ ] `PUT /api/fiscales/:id` edita datos del fiscal. `DELETE` lo borra (y sus
      asignaciones).
- [ ] `POST /api/fiscales/mesas/:mesaId/asignaciones` asigna un fiscal a una mesa con
      franja `desde`/`hasta` (formato `HH:MM`); responde 201.
- [ ] Franja fuera de 08:00–18:00, o `hasta` <= `desde`, da 400.
- [ ] Dos franjas que se solapan en la misma mesa: la segunda da 409.
- [ ] Dos franjas que se solapan para el mismo fiscal, en mesas distintas: la segunda
      da 409.
- [ ] Franjas contiguas (una termina cuando la otra empieza) no chocan, ni en la misma
      mesa ni para el mismo fiscal.
- [ ] `PUT`/`DELETE /api/fiscales/asignaciones/:id` edita/borra una franja.
- [ ] `GET /api/fiscales/mesas/:mesaId/asignaciones` lista las franjas de una mesa,
      ordenadas por hora, con el nombre del fiscal.
- [ ] `GET /api/fiscales/comicio/:comicioId/agenda?hora=HH:MM` devuelve, para cada mesa
      del comicio, el fiscal presente a esa hora (o `null`).
- [ ] `GET`/escritura exigen `fiscales.view`/`fiscales.edit`.
- [ ] Alta, edición y baja de fiscal y de asignación quedan auditadas.
- [ ] Frontend: `public/fiscales.html` reemplaza la cáscara — gestión del padrón de
      fiscales (tabla + modal), y una vista por comicio/mesa para asignar franjas y ver
      la agenda de un horario.
- [ ] Ítem visible en navbar y dashboard, gateado por `fiscales.view`.
- [ ] `npm test` en verde; probado de punta a punta en un navegador real contra Postgres
      real (mismo nivel que 015 y 017).

## Restricciones

- **Costo de servidor por delante del alcance**: volumen bajo esperado (un puñado de
  fiscales, pocas franjas por mesa). Los chequeos de solapamiento son comparaciones de
  hora (`TIME`), sin joins pesados ni caché.
- **Un solo pool, migraciones idempotentes, errores lanzados, permisos por request,
  `process.env` sólo en `config.js`.**
- **Auditar lo que modifica datos.**
- **Toda escritura de asignación se valida contra las dos reglas de solapamiento en la
  misma operación** (mesa y fiscal), no en pasos separados que puedan dejar un estado a
  medias.
- **El módulo lee `elecciones.mesas` directamente** (mismo precedente que `comicio`
  leyendo `elecciones.listas`): los módulos comparten un solo pool y un solo schema
  `elecciones`, no hay necesidad de exponer un servicio cruzado sólo para una validación
  de existencia.

## Riesgos

- **Granularidad de franja libre (cualquier `HH:MM`, no bloques fijos de una hora)**
  puede generar agendas difíciles de leer si se cargan franjas muy finas. No se restringe
  en este ítem — restringir a bloques fijos es una decisión de UX que se toma si aparece
  el problema en uso real.
- **El chequeo de "mismo fiscal en dos mesas" no distingue viajar entre mesas cercanas
  de un salto imposible**: cualquier solapamiento de horario se rechaza igual, aunque en
  la práctica dos franjas consecutivas en mesas distintas del mismo comicio sean
  perfectamente cubribles. Es una simplificación deliberada: no hay noción de distancia
  entre mesas en el sistema.
