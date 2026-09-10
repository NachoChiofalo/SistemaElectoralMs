# Cómo agregar un módulo

Un módulo es una carpeta bajo `src/modules/` con un `module.js` que exporta el
contrato. El arranque se encarga del resto: corre sus migraciones, monta su router y
le inyecta la base, el logger y los servicios de los módulos anteriores.

Hay dos permisos ya definidos en la migración de auth para módulos previstos —
`fiscales.view` / `fiscales.edit` y `comicio.view` / `comicio.edit` — y sus páginas
existen en `public/fiscales.html` y `public/comicio.html`. Si el próximo módulo es uno
de esos, los permisos ya están.

---

## Los cinco pasos

### 1. Crear la carpeta

```
src/modules/fiscales/
├── module.js              el contrato
├── routes.js              HTTP: leer la request, responder
├── service.js             reglas de negocio
├── repository.js          SQL
└── migrations/
    └── 001_esquema_fiscales.sql
```

La separación no es ceremonia: `routes` no sabe SQL, `repository` no sabe de HTTP, y
`service` no conoce ni `req` ni `res` salvo para pasárselo a auditoría. Es lo que
permite testear el servicio sin levantar un servidor ni una base.

### 2. Escribir la primera migración

Archivos `.sql` con prefijo numérico de tres dígitos. Corren una sola vez, en orden,
dentro de una transacción, y quedan registrados en `public.schema_migrations`.

```sql
-- src/modules/fiscales/migrations/001_esquema_fiscales.sql
CREATE TABLE IF NOT EXISTS padron.fiscales (
    id         SERIAL PRIMARY KEY,
    dni        VARCHAR(20) REFERENCES padron.votantes(dni),
    mesa       VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Una migración aplicada **no se edita nunca**: se agrega la siguiente. El runner guarda
un checksum y avisa si un archivo ya aplicado cambió en disco.

### 3. Declarar los permisos

Si el módulo necesita permisos nuevos, van en una migración **propia del módulo**, no
en la de auth:

```sql
-- src/modules/fiscales/migrations/002_permisos_fiscales.sql
INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES
    ('fiscales.asignar', 'Asignar Fiscales', 'Asignar fiscales a mesas', 'fiscales')
ON CONFLICT (codigo) DO NOTHING;

-- El administrador recibe todo permiso nuevo automáticamente.
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p
WHERE r.nombre = 'administrador' AND p.codigo = 'fiscales.asignar'
ON CONFLICT DO NOTHING;
```

### 4. Escribir el `module.js`

```js
const path = require('path');
const FiscalesRepository = require('./repository');
const { FiscalesService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name:        'fiscales',              // identifica sus migraciones; no cambiarlo después
  basePath:    '/api/fiscales',
  migrations:  path.join(__dirname, 'migrations'),
  requiresAuth: true,                   // aplica requireAuth a TODO el router
  permissions: ['fiscales.view', 'fiscales.edit'],

  register({ db, config, services, logger }) {
    const repo     = new FiscalesRepository(db);
    const servicio = new FiscalesService(repo, services.auditoria, logger);

    return {
      router:   construirRutas(servicio),
      provides: { fiscales: servicio },   // lo que exponés a los módulos siguientes
    };
  },

  async onStart({ logger }) {},          // opcional: tareas al arrancar
  async onStop() {},                     // opcional: limpiar timers, cerrar recursos
};
```

Qué recibe `register`:

| | |
|---|---|
| `db` | El pool compartido. `query`, `unaFila`, `filas`, `transaccion`, `conexion`. **Nunca** crear un `Pool` propio. |
| `config` | La configuración ya validada. No leer `process.env` directamente. |
| `services` | Lo que expusieron los módulos anteriores. Hoy: `auditoria`, `auth`, `usuarios`, `padron`. |
| `logger` | Logger con el nombre del módulo ya puesto. |

### 5. Sumar la línea

```js
// src/modules/index.js
module.exports = [
  require('./auditoria/module'),
  require('./auth/module'),
  require('./padron/module'),
  require('./fiscales/module'),   // <-- acá
];
```

**El orden importa.** Un módulo solo ve en `services` lo que expusieron los que están
antes. Por eso `auditoria` va primero: los demás la consumen. No hay resolución
automática de dependencias a propósito — que la relación se lea de un vistazo vale más
que el automatismo.

El orden también resuelve prefijos que se solapan. `auditoria` se monta en
`/api/padron/auditoria` y `padron` en `/api/padron`: como auditoría va antes, captura
su prefijo y el resto cae en padrón. Al revés, daría 404.

---

## Después

```bash
npm run migrate:status    # ver qué quedó pendiente
npm run migrate           # aplicarlo
npm test                  # los tests de integración verifican el montaje solos
npm run dev
```

`test/integracion.test.js` recorre `src/modules` y comprueba, para cada módulo, que
sus migraciones existan, que estén numeradas y que todo permiso que declare exista en
alguna migración. No hace falta tocarlo.

---

## Convenciones que conviene respetar

**Toda respuesta lleva `success`.** Es lo que el frontend espera:
`{ success: true, data: ... }` y `{ success: false, message: ... }`.

**Los errores se lanzan, no se responden.** Usar `errores.*` de `core/errors` y envolver
los handlers async en `asyncHandler`. El manejador central traduce y da la forma:

```js
const { asyncHandler, errores } = require('../../core/errors');

router.get('/:id', asyncHandler(async (req, res) => {
  const fiscal = await servicio.porId(req.params.id);
  if (!fiscal) throw errores.noEncontrado('Fiscal no encontrado');
  res.json({ success: true, data: fiscal });
}));
```

Los códigos de PostgreSQL ya están mapeados: un `unique_violation` sale como 409 sin
que haya que escribir nada.

**Autorizar por permiso, no por rol.** `requirePermission('fiscales.edit')` sobrevive a
que mañana se cree un rol nuevo; `requireRol('administrador')` no. Los permisos viajan
en el token, así que la comprobación no consulta la base.

**Auditar lo que modifica datos.** `services.auditoria.registrarDeRequest(req, {...})`
toma el usuario y la IP de la request. Nunca lanza: un fallo al auditar no voltea la
operación auditada.

**Toda escritura invalida lo que cachea.** Si el módulo cachea agregaciones, cualquier
escritura tiene que limpiarlas; si toca usuarios, rol o estado, llamar a
`sesiones.invalidarUsuario(id)`. Ver `PadronService.cache` y `UsersService` como
referencia.

**Paginar con techo.** Un `?limite=` sin máximo es una forma de tumbar el proceso desde
el navegador. El padrón corta en 500, auditoría en 200.

**Nada de `new Pool()`.** La versión de microservicios tenía ocho instancias de
`Database`, cada una con su pool: hasta 120 conexiones potenciales contra Supabase. El
pool es uno solo y se recibe por parámetro.
