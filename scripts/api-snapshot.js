#!/usr/bin/env node
/**
 * Snapshot de contrato de la API.
 *
 * Golpea todos los endpoints de solo lectura del sistema y guarda la FORMA de cada
 * respuesta (status + estructura, sin valores volatiles). Sirve como red de seguridad
 * durante la refactorizacion a monolito modular: si una fase rompe el contrato que
 * consume el frontend, la comparacion lo marca.
 *
 *   Capturar linea de base (sistema viejo corriendo):
 *     node scripts/api-snapshot.js --base http://localhost:8080 --out scripts/snapshots/before.json
 *
 *   Verificar despues de una fase:
 *     node scripts/api-snapshot.js --base http://localhost:8080 --compare scripts/snapshots/before.json
 *
 * Credenciales: --user / --pass, o SNAPSHOT_USER / SNAPSHOT_PASS.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- argumentos

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base || process.env.SNAPSHOT_BASE || 'http://localhost:8080').replace(/\/$/, '');
const USER = args.user || process.env.SNAPSHOT_USER || 'admin';
const PASS = args.pass || process.env.SNAPSHOT_PASS || 'admin123';

// ------------------------------------------------------- endpoints a relevar

// Solo lectura salvo el login. Nada de esta lista modifica datos del padron.
const ENDPOINTS = [
  { method: 'GET', path: '/health', auth: false },

  { method: 'POST', path: '/api/auth/verify', auth: true, body: {} },
  { method: 'GET', path: '/api/auth/me', auth: true },

  { method: 'GET', path: '/api/users', auth: true },
  { method: 'GET', path: '/api/users/profile', auth: true },
  { method: 'GET', path: '/api/users/roles', auth: true },

  { method: 'GET', path: '/api/padron/health', auth: true },
  { method: 'GET', path: '/api/padron/estado', auth: true },
  { method: 'GET', path: '/api/padron/estadisticas', auth: true },
  { method: 'GET', path: '/api/padron/configuracion', auth: true },
  { method: 'GET', path: '/api/padron/filtros', auth: true },
  { method: 'GET', path: '/api/padron/votantes?pagina=1', auth: true },
  { method: 'GET', path: '/api/padron/votantes?pagina=2&limite=10', auth: true },
  { method: 'GET', path: '/api/padron/votantes?apellido=a', auth: true },
  { method: 'GET', path: '/api/padron/resultados/estadisticas-avanzadas', auth: true },
  { method: 'GET', path: '/api/padron/resultados/por-sexo', auth: true },
  { method: 'GET', path: '/api/padron/resultados/por-rango-etario', auth: true },
  { method: 'GET', path: '/api/padron/resultados/por-circuito', auth: true },
  { method: 'GET', path: '/api/padron/resultados/condiciones-detalladas', auth: true },
  { method: 'GET', path: '/api/padron/condiciones-especiales', auth: true },
  { method: 'GET', path: '/api/padron/estadisticas-condiciones-especiales', auth: true },
  { method: 'GET', path: '/api/padron/auditoria', auth: true },
  { method: 'GET', path: '/api/padron/auditoria/estadisticas', auth: true },

  // Casos de error: el contrato incluye como falla, no solo como responde bien.
  { method: 'GET', path: '/api/padron/votantes', auth: false, expectUnauthorized: true },
  { method: 'GET', path: '/api/padron/votantes/00000000', auth: true },
  { method: 'GET', path: '/api/padron/detalle-votante/00000000', auth: true },
  { method: 'GET', path: '/api/no-existe', auth: true },
];

// ------------------------------------------------------------ normalizacion

// Campos cuyo VALOR cambia entre corridas: nos importa que existan y de que tipo son,
// no cuanto valen.
const VOLATILE = new Set([
  'timestamp', 'uptime', 'fecha', 'fechas', 'createdAt', 'created_at', 'updatedAt',
  'updated_at', 'fecha_relevamiento', 'fecha_modificacion', 'last_activity',
  'ultimo_acceso', 'accessToken', 'refreshToken', 'token', 'expiresIn', 'iat', 'exp',
  'jti', 'duracion', 'duration', 'services', 'detail', 'stack',
]);

/**
 * Reduce un valor a su forma: tipos en lugar de valores, y el primer elemento de cada
 * array como muestra de su forma. Dos respuestas con los mismos datos en distinto orden
 * o con distintos IDs producen la misma forma.
 */
function shapeOf(value, key) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0])];
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = shapeOf(value[k], k);
    }
    return out;
  }
  if (key && VOLATILE.has(key)) return `<${typeof value}>`;
  if (typeof value === 'string') return '<string>';
  if (typeof value === 'number') return '<number>';
  return `<${typeof value}>`;
}

// ------------------------------------------------------------------ captura

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) {
    throw new Error(`Login fallo con ${res.status}. Revisa --user / --pass.`);
  }
  const json = await res.json();
  const token = json?.data?.accessToken;
  if (!token) throw new Error('El login no devolvio accessToken.');
  return { token, shape: shapeOf(json) };
}

async function capture(token) {
  const results = {};

  for (const ep of ENDPOINTS) {
    const id = `${ep.method} ${ep.path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (ep.auth && token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(`${BASE}${ep.path}`, {
        method: ep.method,
        headers,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });

      let body = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = `<non-json:${text.length > 0 ? 'body' : 'empty'}>`;
        }
      }

      results[id] = {
        status: res.status,
        contentType: (res.headers.get('content-type') || '').split(';')[0],
        shape: shapeOf(body),
      };
    } catch (error) {
      results[id] = { status: 'ERROR', error: error.message };
    }
  }

  return results;
}

// --------------------------------------------------------------- comparacion

function diff(before, after) {
  const problems = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of [...keys].sort()) {
    if (!(key in after)) {
      problems.push({ endpoint: key, issue: 'desaparecio del snapshot nuevo' });
      continue;
    }
    if (!(key in before)) continue; // endpoint nuevo: no rompe el contrato

    const b = before[key];
    const a = after[key];

    if (b.status !== a.status) {
      problems.push({ endpoint: key, issue: `status ${b.status} -> ${a.status}` });
    }
    if (b.contentType !== a.contentType) {
      problems.push({ endpoint: key, issue: `content-type ${b.contentType} -> ${a.contentType}` });
    }
    const bs = JSON.stringify(b.shape);
    const as = JSON.stringify(a.shape);
    if (bs !== as) {
      problems.push({ endpoint: key, issue: 'cambio la forma de la respuesta', before: b.shape, after: a.shape });
    }
  }

  return problems;
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`Base: ${BASE}`);

  const session = await login();
  console.log('Login OK');

  const snapshot = {
    base: BASE,
    capturedAt: new Date().toISOString(),
    endpoints: { 'POST /api/auth/login': { status: 200, contentType: 'application/json', shape: session.shape }, ...(await capture(session.token)) },
  };

  const total = Object.keys(snapshot.endpoints).length;
  const errores = Object.values(snapshot.endpoints).filter((r) => r.status === 'ERROR').length;
  console.log(`Relevados ${total} endpoints (${errores} inalcanzables)`);

  if (args.compare) {
    const previo = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
    const problems = diff(previo.endpoints, snapshot.endpoints);

    if (problems.length === 0) {
      console.log(`\nOK — el contrato coincide con ${args.compare}`);
      process.exit(0);
    }

    console.error(`\n${problems.length} diferencia(s) contra ${args.compare}:\n`);
    for (const p of problems) {
      console.error(`  ${p.endpoint}`);
      console.error(`    ${p.issue}`);
      if (p.before) {
        console.error(`    antes:   ${JSON.stringify(p.before)}`);
        console.error(`    despues: ${JSON.stringify(p.after)}`);
      }
    }
    process.exit(1);
  }

  const out = args.out || 'scripts/snapshots/snapshot.json';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`\nGuardado en ${out}`);
}

main().catch((error) => {
  console.error(`\nFallo: ${error.message}`);
  process.exit(1);
});
