# 021 — Una instancia aislada por municipio

> Estado: borrador (esperando las decisiones de la sección "Decisiones abiertas")
> Tamaño estimado: M

## Problema

El sistema se quiere usar en varios municipios, y **los datos de uno no pueden cruzarse
nunca con los de otro**. El dato en juego es un padrón con la opinión política de cada
persona, su teléfono y si recibe ayuda social. La opinión política es dato sensible bajo la
ley argentina de protección de datos personales (25.326). Esto es una señal de riesgo, no
asesoramiento legal: conviene que lo revise alguien con ese perfil antes del segundo
municipio.

Hoy el sistema es de un solo municipio, y eso está repartido como supuestos implícitos:

- **Las opciones políticas están escritas en el esquema y en el código.**
  `padron/migrations/001_esquema_padron.sql:27` tiene
  `CHECK (opcion_politica IN ('PJ', 'UCR', 'Indeciso'))`; `padron/service.js:11` repite la
  lista; `padron/repository.js` tiene columnas fijas `votos_pj`/`votos_ucr` (y sus
  porcentajes, y las combinaciones con empleados, ayuda social, nuevos y fallecidos, unas
  veinte líneas); y `ResultadosComponent.js`, `PadronComponent.js` y `dashboard.js` dibujan
  `PJ` y `UCR` como literales (unas 40 apariciones). Un municipio con otros partidos no puede
  usar el sistema, ni siquiera aislado.
- **El municipio no tiene nombre en la aplicación.** No hay forma de mostrar de qué
  instancia es cada pantalla, y con varias instancias abiertas a la vez en el navegador eso
  es una fuente real de errores (cargar un dato en el municipio equivocado).
- **No hay procedimiento para operar más de una base.** `npm run migrate` y
  `scripts/preflight-migraciones.js` leen una única `DATABASE_URL`. Hacerlo a mano N veces es
  la forma de olvidarse una.
- **No hay staging** (`CLAUDE.md`: `DATABASE_URL` es producción). Con más instancias, cada
  cambio de esquema es más riesgoso, no menos.

## Modelo comercial (condiciona todo lo demás)

El sistema se **vende por separado a cada cliente**: un partido político contrata el sistema
para **una localidad** (por ejemplo Alcira Gigena, Berrotarán, Baigorria), y gestiona
únicamente lo electoral de esa localidad. Consecuencias que el diseño toma como dadas:

- **El cliente es el partido, no el municipio.** "Municipio" en esta spec quiere decir
  "localidad del cliente". Las opciones políticas, la intención de voto y los resultados
  se leen desde la mirada de ese partido; dos clientes en la misma localidad (partidos
  rivales) serían dos instancias que **no pueden ver nada una de la otra**, razón de más para
  el aislamiento físico.
- **Nadie gestiona más de una localidad.** No hay usuario con acceso a varias instancias, ni
  reportes cruzados, ni panel de administración de clientes para ellos. Cada instancia tiene
  sus usuarios, y se descarta para siempre, no solo para la v1, cualquier función que mezcle
  localidades.
- **Cada cliente es un contrato.** Por eso el costo de infraestructura por instancia es parte
  del precio, y la titularidad de la cuenta de hosting y de los datos (quién puede pedir la baja
  o un backup) es una decisión comercial y legal, no solo técnica (D3, D7).
- **El número de clientes puede crecer por ventas**, no por decisión técnica. Por eso las
  condiciones para reabrir la decisión (abajo) miran la carga de operar instancias, no solo
  la cantidad.
- **El padrón es un dato regulado.** Los partidos lo reciben de la autoridad electoral para
  fines electorales, con restricciones de uso. Qué cláusulas de uso, confidencialidad y baja
  lleva el contrato con cada partido lo define quien redacte el contrato; el sistema debe
  poder cumplirlas (exportar, borrar la instancia entera).

## Por qué esta solución y no multitenancy

Se evaluó compartir una base con `tenant_id` en cada tabla y se descartó **por ahora**; el
diseño completo queda en [alternativa-multitenancy](alternativa-multitenancy/spec.md).
Resumen de la razón:

- Con `tenant_id`, que los datos no se crucen depende de que **cada consulta** de seis
  repositorios (~1.640 líneas) lleve su filtro. Un olvido es una fuga. Con una base por
  municipio ese error **no puede ocurrir**: no es una cuestión de cuidado sino de
  arquitectura.
- Casi no toca código de negocio: cada instancia es el mismo código con otro `DATABASE_URL`.
- Backup, baja, exportación y contratos de cada municipio son "esa base entera".
- Con un desarrollador y migraciones manuales, la carga de operar N instancias es
  aceptable hasta unos 8 o 10 municipios (ver "Cuándo reabrir esta decisión").

El costo se acepta con los ojos abiertos: más servicios y más bases que pagar, y cada
migración y cada despliegue se repite por instancia.

## Alcance

- **Instancia** = un servicio en Render + un proyecto de Supabase + variables de entorno
  propias, todo desde **la misma rama y la misma imagen**. Sin ramas por municipio.
- Opciones políticas **configurables por instancia** (tabla en la base), sin `PJ`/`UCR` en
  el esquema ni en el código; la instancia actual conserva `PJ`/`UCR`/`Indeciso`.
- Nombre del municipio en la aplicación, configurado por variable de entorno.
- Herramientas para operar varias bases: estado de migraciones y preflight sobre todas,
  migración **de a una y confirmada**.
- Una instancia `demo` con datos ficticios que sirva de staging real.
- Inventario de instancias (sin secretos) y runbooks: alta de un municipio, actualización
  de todas, backup y baja.
- Verificación de que ninguna configuración compartida (secretos, CORS) permita que una
  instancia acepte lo de otra.

## Fuera de alcance

- Multitenancy (`tenant_id`, RLS, tenant en la sesión). Alternativa documentada.
- Un panel central para dar de alta municipios o administrar varias instancias desde una
  sola pantalla.
- Un usuario con acceso a varios municipios con una sola cuenta. Cada instancia tiene sus
  usuarios; una persona que trabaja en dos municipios tiene dos cuentas.
- Datos compartidos entre instancias (catálogos, padrón común).
- Personalizar la apariencia por municipio (logo, paleta). Solo el nombre.
- Facturación o planes comerciales.

## Criterios de aceptación

- [ ] Una instancia con opciones políticas distintas (por ejemplo `FP`/`PRO`/`Indeciso`)
      funciona de punta a punta: relevar, ver el padrón, resultados, dashboard, exportar,
      comicio. Ningún `PJ`/`UCR` aparece en pantalla, ni en un CSV exportado, salvo que esté
      configurado.
- [ ] La instancia actual se comporta **idéntica**: mismos números en resultados, mismo
      orden, mismos colores, antes y después. Se comprueba comparando las respuestas de los
      endpoints de estadísticas contra el snapshot (`scripts/api-snapshot.js`) de antes del cambio.
- [ ] El `CHECK` de `opcion_politica` queda reemplazado por una clave foránea a la tabla
      de opciones, y borrar una opción que tiene relevamientos es un 409, no una pérdida
      silenciosa (mismo criterio que G2).
- [ ] El nombre del municipio se ve en el encabezado de todas las páginas y en el `<title>`;
      si la variable no está, la aplicación no falla.
- [ ] En producción, la aplicación se niega a arrancar si `JWT_SECRET` está repetido entre
      instancias de la lista conocida (comprobación en el script de operación, no en runtime:
      el proceso no conoce a las otras instancias).
- [ ] `node scripts/instancias.js status` muestra, para cada instancia, la versión de
      migraciones aplicadas y las pendientes, **solo lectura**.
- [ ] `node scripts/instancias.js migrate <slug>` migra **una** instancia, muestra el
      estado antes, pide confirmación y no admite "todas a la vez".
- [ ] Existe una instancia `demo` con datos ficticios y se puede usar para probar una
      migración antes de aplicarla a un municipio real.
- [ ] Hay runbooks de alta y de actualización, probados una vez de punta a punta con la
      instancia `demo` creada desde cero.
- [ ] `npm test` pasa entero, con una suite que ejecuta los flujos de padrón y resultados
      con **dos juegos distintos de opciones políticas**.
- [ ] **Rendimiento:** las estadísticas y el listado del padrón no son más lentos que hoy
      (`EXPLAIN (ANALYZE, BUFFERS)` antes y después). Las opciones se leen de una caché en
      memoria del proceso; no suman una consulta por request.

## Restricciones

- **El frontend no cambia para cambiar el backend.** Excepción reconocida: esta feature *es*
  UI nueva (opciones dinámicas en los selectores y en las pantallas de resultados), y por eso
  la regla permite tocar `public/`. El contrato de la API se amplía de forma **aditiva**
  durante la transición: los campos `votos_pj`/`votos_ucr` siguen existiendo hasta que el
  frontend deje de leerlos.
- **Ningún color fuera del design system.** Los colores de cada opción son un índice 1–8 hacia
  tokens `--ds-*`, igual que `elecciones.fuerzas.color` (`comicio/003`,
  `comicio/006`). No se introduce un `#hex` configurable.
- **Migraciones idempotentes, manuales y antes del deploy.** Cada instancia tiene su propio
  `DATABASE_URL`. La que toca datos se confirma con la persona; el backup es por base.
- **Sin ramas ni forks por municipio.** Si un municipio necesita algo distinto, es
  configuración o una opción general; nunca un `if (municipio === …)` en el código.
- **Un solo pool por proceso.** No cambia: cada instancia tiene su proceso.
- **Secretos distintos por instancia.** `JWT_SECRET` y la contraseña de la base no se
  reutilizan. Con secretos distintos, un token firmado en una instancia es inválido en las demás.
- **Un despliegue por rama despliega todas las instancias.** Render redespliega cada
  servicio conectado a la rama. Por eso la regla de `CLAUDE.md` se extiende: migrar **todas**
  las bases antes del push, o desactivar el auto-deploy de las que no se hayan migrado.

## Cuándo reabrir esta decisión

Volver a la alternativa multitenancy cuando se cumpla **alguna** de estas condiciones:

1. Hay (o se esperan en un año) **más de 8 o 10** instancias.
2. Se quiere alta de municipios sin intervención del desarrollador (autoservicio).
3. El tiempo de cada release (migrar + verificar + desplegar × N) supera lo que se puede
   absorber, o ya hubo una instancia que quedó desactualizada por olvido.
4. Se necesita un usuario con acceso a varios municipios, o reportes que crucen municipios
   con consentimiento.
5. El costo de hospedaje por instancia deja de cerrar.

## Decisiones abiertas

| # | Pregunta | Recomendación asumida |
|---|---|---|
| D1 | ¿Cuántos municipios en el primer año, y cuándo el segundo? | Define el nivel de automatización de la fase 4. Con 2–3, scripts y runbooks alcanzan. |
| D2 | ¿Plan de hosting para instancias con datos reales? | **De pago** en Render y Supabase para toda instancia real. El plan gratuito duerme el servicio, tiene límites de proyectos y de horas, y no tiene backups con retención; con datos sensibles no es una base responsable. Verificar los límites vigentes de ambos antes de decidir. |
| D3 | ¿Dónde se aloja cada instancia: bajo tu cuenta o bajo la del cliente (el partido)? | **Bajo tu cuenta**, con el costo incluido en el precio y el contrato definiendo la baja y la entrega de datos. Bajo la cuenta del cliente tendría acceso a la base y a los secretos, y el soporte se vuelve inmanejable con partidos sin perfil técnico. |
| D4 | ¿Dominio? | Una URL propia por instancia (`<municipio>.<dominio>`) es lo más claro para el usuario. Es solo DNS + certificado de Render, sin cambios de código. |
| D5 | ¿Quién tiene acceso técnico a las bases? | Solo vos. Un municipio no necesita la `DATABASE_URL`; lo que necesita es poder pedir un backup o la baja. |
| D7 | ¿Cuál es el costo mensual de infraestructura por cliente y cómo entra en el precio? | Calcularlo con los planes elegidos en D2 antes de la primera venta: base + servicio + dominio + tiempo de operación (migraciones, altas, soporte). Es el número que decide si el modelo escala. |
| D6 | ¿Las opciones políticas las edita el administrador del municipio o las fija el desarrollador al dar el alta? | Las fija el desarrollador en el alta (script) en la v1; una pantalla de edición es aditiva y se deja fuera de alcance. |
