# 012 — Tareas

Cada paso se verifica solo. Un paso que no se puede verificar sin el siguiente está mal
cortado.

---

## Fase 0 — Escritura parcial

- [ ] **0.1** Tomar el snapshot base con el servidor levantado:
      `node scripts/api-snapshot.js --base http://localhost:8080 --out specs/012-multiusuario/snapshot-antes.json`
      *Verifica:* el archivo existe. **No trae el PUT de relevamientos**: la lista del
      script es de sólo lectura a propósito. Sirve para ver que no se movió nada más.
- [x] **0.2** `repository.upsertRelevamiento`: `COALESCE($n, padron.relevamientos.<campo>)`
      en la rama `DO UPDATE`, defaults en `VALUES`.
      *Verifica:* test que escribe sólo `telefono` y relee la fila — `observacion` y
      `opcion_politica` intactas.
- [x] **0.3** Test de ausente-vs-vacío: `{ observacion: '' }` vacía; `{}` sin esa clave no
      toca. *Verifica:* `npm test`.
- [x] **0.4** `service.actualizarRelevamiento`: campos ausentes como `null`,
      `opcionPolitica` opcional pero validada cuando viene, 400 si no viene ningún campo
      conocido. *Verifica:* test del 400 y test de la opción política inválida, que tiene
      que seguir fallando igual que hoy.
- [x] **0.5** `routes.js`: sacar el `if (!opcionPolitica) throw`.
      *Verifica:* `npm test` y un PUT a mano con sólo `telefono` → 200.
- [x] **0.6** `ApiService.actualizarRelevamiento(dni, campos)` serializa sólo las claves
      presentes. *Verifica:* en la consola del navegador, un PUT con un solo campo en el
      cuerpo (pestaña Network).
- [x] **0.7** `PadronComponent.guardarPanel`: un único PUT + el POST de condiciones.
      *Verifica:* Network muestra 2 requests al guardar, no 5.
- [x] **0.8** `actualizarTelefono`, `actualizarObservacion` y `cambiarOpcionPolitica` sin
      GET previo, mandando un solo campo.
      *Verifica:* cambiar la opción política de una fila no altera la observación de ese
      DNI (mirarla antes y después).
- [ ] **0.9** Prueba manual de la pérdida original: abrir ficha, cargar teléfono **y**
      observación, guardar, recargar la página. Los dos valores están.
- [ ] **0.10** Snapshot después: **sin diferencias**.
      *Verifica:* `--compare specs/012-multiusuario/snapshot-antes.json`.

- [x] **0.11** Sacar `actualizarTelefono` y `actualizarObservacion`: `guardarPanel` era
      su único llamador y quedaron muertos. El plan decía que había otros; no los hay.
      *Verifica:* `grep -rn "actualizarTelefono\|actualizarObservacion" public/` no
      devuelve usos.
- [x] **0.12** `npm run build:assets` después de tocar `public/`, y `npm test` en verde.
      *Verifica:* el test de `?v=` y el de precomprimidos pasan.
- [x] **0.13** `CLAUDE.md`: la regla de escritura parcial entre las que no se rompen, y
      el conteo de tests al día. La mitad de la versión se agrega en la fase 1.

---

## Fase 1 — Concurrencia optimista

- [x] **1.1** Migración `004_version_relevamientos.sql` con `ADD COLUMN IF NOT EXISTS`
      (la `003` se la llevó la fase 2, que se hizo antes).
      *Verifica:* `npm run migrate:status`, y correrla dos veces. **Pendiente: necesita base.**
- [x] **1.2** `GET /relevamientos/:dni` devuelve `version`.
      *Verifica:* test de forma de la respuesta.
- [x] **1.3** `upsertRelevamiento` acepta `version_esperada`: `WHERE version = $7` más
      tres `IS DISTINCT FROM` (que es el 1.5), e incrementa `version`.
      *Verifica:* test — versión correcta → 200 y `version + 1`.
- [x] **1.4** El service distingue cero filas por versión vieja (409 con el estado actual)
      de DNI inexistente (404). *Verifica:* un test para cada uno.
- [x] **1.5** `version` no se incrementa si ningún valor cambió.
      *Verifica:* guardar dos veces lo mismo deja la versión igual.
- [~] **1.6** Test de carrera: dos PUT con la misma versión sin `await` entre ellos →
      exactamente un 200 y un 409. **Hecho a nivel service**, con un repo falso que imita
      el `WHERE`. Que Postgres serialice de verdad dos `ON CONFLICT DO UPDATE` sobre la
      misma fila **sigue sin probarse**: necesita base real y espera al ítem 003.
- [x] **1.7** El panel guarda y manda la versión leída.
      *Verifica:* la versión viaja en el cuerpo (Network).
- [x] **1.8** UI del 409: el panel no se cierra, muestra el valor del servidor junto al
      propio, ofrece reintentar o descartar.
      *Verifica:* a mano con dos pestañas, y confirmar que lo tipeado nunca se pierde.
- [x] **1.9** `npm test` en verde (110 tests). El `snapshot` **queda pendiente**: necesita
      el servidor levantado contra una base.
- [x] **1.10** Cada 409 se loguea con el DNI y los dos usuarios (`logger.info`).
      *Verifica:* provocar un conflicto y encontrarlo en el log. Es el insumo del 014.

---

## Fase 2 — Ver lo ajeno

> **Se hizo antes que la fase 1**, por pedido. Consecuencia: la ficha se abre fresca y
> se ve quién tocó qué, pero **dos personas todavía pueden pisarse el mismo campo** —
> eso lo cierra el 409 de la fase 1. La numeración de migraciones se corrió: ésta quedó
> como `003` y la de `version` será la `004`.

- [x] **2.1** Migración `003_autoria_relevamientos.sql` (`actualizado_por`,
      `actualizado_por_username`) + índices sobre `fecha_modificacion DESC` y
      `fecha_detalle DESC`.
      *Verifica:* `migrate:status` y correrla dos veces. **Pendiente: necesita base.**
- [x] **2.2** El service llena las dos columnas desde `req.user`. `repository` sigue sin
      ver `req`. *Verifica:* test del service con un `req` falso.
- [x] **2.3** `GET /relevamientos/:dni` devuelve autor y fecha. *Verifica:* snapshot.
- [x] **2.4** `abrirPanel` relee la ficha del servidor antes de dibujar y muestra la firma.
      *Verifica:* cambiar el dato desde otra pestaña y abrir el panel — se ve el valor
      nuevo, no el del snapshot.
- [x] **2.5** `GET /api/padron/cambios?desde=` devuelve los DNIs modificados.
      *Verifica:* test de la ruta y del permiso (`padron.view`).
- [x] **2.6** La tabla consulta cada 30 s y marca las filas cambiadas.
      *Verifica:* con el foco dentro de un control, una ronda de marcado no lo mueve ni
      pierde lo tipeado.
- [x] **2.7** La marca usa sólo tokens `--ds-*`. *Verifica:* el test de colores del
      design system.
- [x] **2.8** Sacada la compatibilidad `IS NULL`: la versión es obligatoria.
      *Verifica:* un PUT sin versión → 400, en la ruta **y** en el service — con
      `WHERE version = NULL` la escritura no matchea nunca, así que sin la validación la
      respuesta habría sido 200 sin haber guardado nada.

- [x] **2.9** Guard de apertura: dos clics seguidos ya no pueden dejar abierta la ficha
      equivocada, ahora que abrir implica esperar al servidor.
      *Verifica:* `fichaPedida` se compara después del await y `cerrarPanel` la anula.
- [x] **2.10** `history` agregado a `scripts/iconos-lucide.js` (lo pedía la firma), y
      `build:assets` corrido. *Verifica:* `npm test` — iconos, `?v=` y precomprimidos.

---

## Fase 3 — Identidad por persona

Cero código. **Nada de esto se hace antes de que las fases 0, 1 y 2 estén en producción**:
el alta del segundo usuario es el momento en que el sistema empieza a perder datos, y es
una fecha que controlamos.

- [ ] **3.1** Confirmar que 0, 1 y 2 están desplegadas. *Verifica:* un PUT con versión
      vieja contra producción responde 409.
- [x] **3.2** Hacer el ítem 001 (escapado) antes del alta. Con una sola persona el XSS del
      padrón es casi auto-infligido; con varias, no. **Hecho**, junto con el ítem 013
      (lock de importación). Los dos quedaron cerrados en el backlog.
- [ ] **3.3** Crear un usuario por persona, con su rol. *Verifica:* cada una entra con el
      suyo y ve sólo lo que su rol permite.
- [ ] **3.4** `CLAUDE.md`, reglas que no se rompen: la cuenta es personal, porque la
      auditoría y `actualizado_por` atribuyen por usuario.
      *Verifica:* está escrito el porqué, no sólo la regla.
- [ ] **3.5** Avisar al dar de alta: una misma persona no puede tener dos dispositivos
      logueados a la vez; el segundo login cierra el primero. Es deliberado.
- [ ] **3.6** Después de una semana de uso real, mirar cuántos 409 se loguearon (paso 1.10)
      y decidir el ítem 014 con ese número, no con una intuición.

---

## Cierre

- [ ] Actualizar `docs/BACKLOG.md`: 012 a ⬛, y confirmar el estado de 013 y 014.
- [ ] `CLAUDE.md`: agregar a las reglas que no se rompen — *una escritura de relevamiento
      sólo manda los campos que la persona editó, y viaja con su versión*. Es la regla que
      todo este trabajo deja instalada, y la que se pierde primero si no está escrita.
