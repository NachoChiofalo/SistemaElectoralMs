# Cómo trabajamos: spec primero

Ningún cambio que no sea trivial arranca en el editor. Arranca en una spec.

No es burocracia. Es la respuesta a un problema concreto de este repo: **casi toda la
deuda que está anotada en [CLAUDE.md](../CLAUDE.md) entró porque alguien resolvió el
"cómo" sin haber escrito el "qué"**. La tabla del padrón llegó a once columnas y ~350
controles de formulario sin que nadie hubiera decidido nunca que la tabla servía para
cargar datos. El `unsafe-inline` de la CSP está ahí porque la CSP se puso después de que
el frontend ya generara `onclick=` en las plantillas.

---

## Las tres piezas

Cada ítem del backlog que se toma se convierte en una carpeta bajo `specs/`:

```
specs/003-escapado-padron/
├── spec.md      QUÉ y POR QUÉ. Sin una sola decisión de implementación.
├── plan.md      CÓMO. Archivos, orden, riesgos. Se escribe después de aprobar la spec.
└── tareas.md    La lista ejecutable. Se tacha a medida que avanza.
```

El número es correlativo y no se reusa. La carpeta queda aunque el ítem se descarte:
saber qué se decidió no hacer, y por qué, vale tanto como el código.

### `spec.md`

La regla dura: **si una frase se puede responder con "depende de cómo lo implementemos",
no va en la spec**. Va en el plan.

Tiene que poder leerla alguien que no vaya a escribir el código y decir si está bien.

| Sección | Qué contesta |
|---|---|
| Problema | Qué pasa hoy. En hechos observables, no en adjetivos. |
| Por qué ahora | Qué se desbloquea, o qué se rompe si se posterga. |
| Alcance | Qué entra. |
| **Fuera de alcance** | Qué explícitamente no entra, aunque sea tentador. |
| Criterios de aceptación | Lista verificable. Cada línea, un test o un paso manual. |
| Restricciones | Qué regla de `CLAUDE.md` aplica y aprieta acá. |
| Riesgos | Qué se puede romper sin que se note. |

**Los criterios de aceptación son el contrato.** Si uno no se puede verificar, no es un
criterio: es un deseo. "La tabla se ve mejor" no es criterio. "La tabla tiene 8 columnas
y ningún `<input>` fuera de la opción política" sí.

### `plan.md`

Archivos que se tocan, en qué orden, qué se verifica en cada paso, y qué se decidió
descartar con su razón. Es el lugar donde van las alternativas evaluadas — en seis meses,
eso es lo que evita rehacer el mismo análisis.

### `tareas.md`

Pasos chicos, cada uno con su verificación. Un paso que no se puede verificar solo es un
paso mal cortado.

---

## El ciclo

1. **Elegir** un ítem del [backlog](BACKLOG.md).
2. **Escribir `spec.md`** y aprobarla antes de seguir. Acá se discute el alcance.
3. **Escribir `plan.md`.** Acá se discute la técnica.
4. **Implementar** siguiendo `tareas.md`, verificando cada paso.
5. **Cerrar**: los criterios de aceptación se verifican uno por uno, y lo que aprendimos
   en el camino vuelve a `CLAUDE.md` o a `docs/`.

El paso 5 no es opcional. `CLAUDE.md` está útil hoy porque cada trabajo cerrado dejó ahí
lo que no se deduce del código.

---

## Qué no necesita spec

- Arreglar un typo, un texto, un color que quedó fuera de token.
- Un bug con causa evidente y arreglo de menos de diez líneas.
- Actualizar documentación.

Regla práctica: **si no sabés enumerar los criterios de aceptación en voz alta, necesita
spec.** Si los podés decir en una frase, escribí el commit y listo.

---

## La constitución

No se reescribe acá. Son las **"Reglas que no se rompen"** de [CLAUDE.md](../CLAUDE.md):
un solo pool, `process.env` sólo en `config.js`, los errores se lanzan, migraciones
idempotentes, toda ruta con token, ningún color fuera del design system, y no tocar el
frontend para cambiar el backend.

Una spec que necesite romper una de esas reglas es válida — pero tiene que decirlo en
"Restricciones", con la razón. Cambiar la constitución es una decisión aparte, y se toma
antes de empezar, no durante.
