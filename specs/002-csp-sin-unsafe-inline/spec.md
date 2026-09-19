# 002 — Sacar `unsafe-inline` de `script-src`

> Estado: en curso — código completo (pasos 1 a 4.1 y 4.3), falta el smoke manual en
> navegador (4.2) y el snapshot de contrato con credenciales reales (4.4) antes de cerrar.
> Tamaño estimado: L

## Problema

La CSP está activa desde `src/core/app.js:87` y corta recursos externos, `<base>` y el
framing. Pero `script-src` incluye `'unsafe-inline'` (línea 91), y mientras esté ahí la
CSP **no frena la ejecución de un `<script>` inline ni de un `onclick=`**, que es
justamente el vector que un XSS necesita para hacer algo.

Hoy el frontend depende de eso para funcionar:

- **25 atributos `onclick=`** repartidos en 4 archivos: `PadronComponent.js` (17),
  `DetalleVotanteComponent.js` (4), `dashboard.html` (1), `resultados.html` (3). La
  mayoría llama a un método de un componente global (`onclick="padronComponent.
  guardarPanel()"`), y algunos interpolan un valor dinámico en el propio atributo
  (`onclick="padronComponent.irAPagina(${i})"`, `onclick="padronComponent.
  abrirPanel('${dni}')"`).
- **Un bloque `<script>` inline por página**, en las 8 páginas HTML de `public/`
  (`auditoria`, `comicio`, `dashboard`, `fiscales`, `index`, `resultados`,
  `root-redirect`, `usuarios`). Es código de arranque corto — típicamente registrar
  `DOMContentLoaded` para inicializar el navbar — pero sigue siendo inline.

001 (ya hecho) resolvió que un dato de usuario no pueda inyectar HTML/JS ejecutable. Pero
esa es una barrera de una sola capa: si mañana aparece una interpolación sin escapar —en
código nuevo, o en un caso que 001 no cubrió— hoy se ejecuta igual, porque nada en la CSP
lo impide.

## Por qué ahora

Es la otra mitad de la seguridad P0 del backlog, y la única que queda sin tomar: 001 tapa
los agujeros conocidos, 002 hace que los que no se conocen tampoco sirvan. Postergarlo dejа
la CSP funcionando como "reduce superficie real, pero no cubre XSS inline" —tal como ya lo
dice el comentario en `app.js:79-83`— indefinidamente, sin que haya ningún otro ítem del
backlog que dependa de esto para empezar. La razón para hacerlo ahora es que ya no hay
nada bloqueándolo: 001 es prerrequisito natural y está cerrado.

## Alcance

- Sacar `'unsafe-inline'` de `script-src` en `src/core/app.js`.
- Eliminar los 25 `onclick=` de `public/` y reemplazar la forma en que esos botones
  disparan sus acciones, sin depender de script inline.
- Eliminar el bloque `<script>` inline de las 8 páginas HTML y mover ese código de
  arranque a un archivo con `src=`.
- Un test que verifique que la CSP servida realmente no lleva `'unsafe-inline'` en
  `script-src`.

## Fuera de alcance

- **`style-src`**, que también lleva `'unsafe-inline'` (`app.js:92`). Los estilos inline
  no ejecutan JavaScript: es una superficie de ataque distinta y bastante más baja, y el
  frontend usa `style=""` con variables del design system para valores dinámicos (colores
  de partido, barras de gráfico) en varios lugares — sacarlo es un trabajo aparte, no
  bloqueado por este.
- **001** (escapado de datos del votante). Ya está hecho; esta spec no lo revisa de nuevo,
  aunque se apoya en que siga cubierto.
- **Rediseñar cómo se estructura cualquier página** aprovechando el viaje. El comportamiento
  visible de cada página no cambia: lo único que cambia es el mecanismo que conecta un
  clic con el método que ya se ejecuta hoy.
- **Nonces o hashes por script** como mecanismo — es una decisión de implementación, va en
  el plan.

## Criterios de aceptación

- [ ] `script-src` en `src/core/app.js` no contiene `'unsafe-inline'`.
- [ ] Ningún archivo bajo `public/` contiene el atributo `onclick=` (verificable con
      `grep -r "onclick=" public/`, cero resultados fuera de comentarios).
- [ ] Ningún `.html` bajo `public/` contiene un `<script>` sin atributo `src`.
- [ ] Un test automático pide una página del frontend y verifica que el header
      `Content-Security-Policy` trae `script-src 'self'` sin `'unsafe-inline'`.
- [ ] Prueba manual, página por página (padrón, dashboard, resultados, auditoría,
      usuarios, comicio, fiscales, login/index): cada acción que hoy dispara un
      `onclick` —abrir/cerrar modal, guardar panel, paginar, cerrar sesión, etc.— sigue
      funcionando igual.
- [ ] La paginación del padrón y el panel de ficha (los dos casos que hoy interpolan un
      valor dinámico en el `onclick`) siguen operando sobre la fila/página correcta.
- [ ] `node scripts/api-snapshot.js` antes y después: sin diferencias — este cambio no
      toca ningún endpoint.

## Restricciones

- **No tocar el frontend para cambiar el backend** no aplica en sentido contrario acá: el
  cambio de backend (el header CSP) **exige** tocar `public/`, porque hoy el frontend sólo
  funciona gracias a lo que ese header permite. Lo que la regla sí prohíbe sigue en pie:
  no aprovechar el viaje para rediseñar nada que no haga falta tocar.
- **Ningún color fuera del design system.** Si el mecanismo elegido agrega clases o
  atributos nuevos al markup, ningún estilo nuevo sale de un `--ds-*`.
- **`routes` no escribe SQL; `repository` no conoce `req`/`res`.** No aplica de lleno —
  este ítem no toca esa capa— pero si el plan termina agregando algún endpoint no debería
  romperlo.

## Riesgos

- **Los dos `onclick` que interpolan un valor** (`irAPagina(${i})`, `abrirPanel('${dni}')`)
  son el punto donde más fácil es introducir un bug silencioso: un botón que sigue
  andando pero actúa sobre la fila o página equivocada, sin ningún error visible.
- **Sacar el `<script>` inline de una página sin migrar antes su inicialización** deja esa
  página con el navbar sin cargar o un componente sin arrancar, y no tira ningún error en
  consola que lo señale como causa — se ve como "la página no responde".
- **Cambiar el header antes de terminar la migración del markup** rompe el sitio entero de
  una: el orden importa — todo el `onclick`/`<script>` inline sale primero, el header se
  endurece al final, verificado página por página.
- **Cobertura despareja de la prueba manual.** No hay tests de integración de frontend en
  este repo (ver 003): el criterio de "cada página sigue funcionando" depende de que se
  pruebe *cada* página a mano, no sólo las más usadas (padrón, dashboard). `comicio.html`
  y `fiscales.html` son cáscaras sin backend — igual hay que confirmar que no rompen.
