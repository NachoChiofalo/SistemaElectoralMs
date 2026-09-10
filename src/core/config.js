/**
 * Configuracion del sistema. Unico lugar donde se lee process.env.
 *
 * Se valida al arrancar: si falta algo indispensable en produccion, el proceso no
 * levanta. Es preferible fallar en el arranque que descubrirlo en el primer login.
 */

// Los tests fijan las variables que necesitan a mano y esperan que NO exista conexion
// a base salvo que la agreguen ellos mismos. Si se cargara .env aca, un .env local con
// una DATABASE_URL real (de Supabase, por ejemplo) se colaria en cada test suite y
// terminaria conectando a produccion sin que nadie lo pidiera.
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config();
}

const MINUTO = 60 * 1000;

function bool(value, porDefecto) {
  if (value === undefined || value === '') return porDefecto;
  return value === 'true' || value === '1';
}

function entero(value, porDefecto) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : porDefecto;
}

/**
 * Limpia la DATABASE_URL de artefactos comunes al copiarla desde el panel de Supabase
 * o desde un .env mal editado: el prefijo "DATABASE_URL=" repetido y las comillas.
 */
function normalizarDatabaseUrl(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^DATABASE_URL\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '');
}

/**
 * Supabase exige TLS. Devuelve la connectionString sin el parametro sslmode (que pg
 * ignora) mas la config de ssl equivalente.
 */
function construirConexion() {
  const url = normalizarDatabaseUrl(process.env.DATABASE_URL);

  if (!url) {
    return {
      descripcion: `${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`,
      esLocal: true,
      opciones: {
        host: process.env.DB_HOST || 'localhost',
        port: entero(process.env.DB_PORT, 5432),
        database: process.env.DB_NAME || 'sistema_electoral',
        user: process.env.DB_USER || 'electoral_user',
        password: process.env.DB_PASSWORD || 'electoral_password',
      },
    };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL no es una URL valida de PostgreSQL');
  }

  const host = (parsed.hostname || '').toLowerCase();
  const esLocal = host === 'localhost' || host === '127.0.0.1';
  const sslmode = (process.env.PGSSLMODE || parsed.searchParams.get('sslmode') || '').toLowerCase();
  const usarSsl = !esLocal && sslmode !== 'disable';

  parsed.searchParams.delete('sslmode');

  return {
    descripcion: `${parsed.hostname}:${parsed.port || 5432}`,
    esLocal,
    // Supabase usa un certificado que no encadena a una CA del sistema por defecto;
    // verify-full solo si se pide explicitamente y se provee el bundle.
    opciones: {
      connectionString: parsed.toString(),
      ssl: usarSsl ? { rejectUnauthorized: sslmode === 'verify-full' } : false,
    },
  };
}

const entorno = process.env.NODE_ENV || 'development';
const esProduccion = entorno === 'production';
const conexion = construirConexion();

const config = {
  entorno,
  esProduccion,
  puerto: entero(process.env.PORT || process.env.GATEWAY_PORT, 8080),

  db: {
    ...conexion.opciones,
    descripcion: conexion.descripcion,
    // Un solo pool para todo el proceso. Supabase limita conexiones concurrentes por
    // proyecto; 8 cubre el trafico real de esta aplicacion con margen.
    max: entero(process.env.DB_POOL_MAX, 8),
    min: 0,
    idleTimeoutMillis: entero(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: entero(process.env.DB_CONNECT_TIMEOUT_MS, 10_000),
    // Corta consultas colgadas antes de que agoten el pool.
    statement_timeout: entero(process.env.DB_STATEMENT_TIMEOUT_MS, 20_000),
  },

  jwt: {
    secreto: process.env.JWT_SECRET || '',
    expiracion: process.env.JWT_EXPIRATION || '2h',
    expiracionRefresh: process.env.REFRESH_TOKEN_EXPIRATION || '7d',
    emisor: 'auth-service',
    audiencia: 'electoral-system',
  },

  sesiones: {
    // Cierre por inactividad, verificado en cada request.
    timeoutInactividadMs: entero(process.env.INACTIVITY_TIMEOUT_MINUTES, 30) * MINUTO,
    // Cuanto vive una sesion verificada en la cache antes de revalidar contra la base.
    cacheTtlMs: entero(process.env.SESSION_CACHE_TTL_MS, 30_000),
    cacheMax: entero(process.env.SESSION_CACHE_MAX, 500),
    // Con que frecuencia, como maximo, se persiste last_activity de un usuario.
    intervaloEscrituraActividadMs: entero(process.env.ACTIVITY_WRITE_INTERVAL_MS, 60_000),
  },

  http: {
    // Detras del proxy de Render/nginx hace falta para que req.ip sea el real.
    trustProxy: process.env.TRUST_PROXY === undefined ? 1 : process.env.TRUST_PROXY,
    origenesCors: [
      'http://localhost:3000',
      'http://localhost:8080',
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      process.env.PUBLIC_EXTERNAL_URL,
      process.env.RENDER_EXTERNAL_URL,
    ].filter(Boolean),
    rateLimit: {
      activo: bool(process.env.RATE_LIMIT_ENABLED, true),
      ventanaMs: entero(process.env.RATE_LIMIT_WINDOW_MS, 15 * MINUTO),
      max: entero(process.env.RATE_LIMIT_MAX, 1000),
    },
    limiteBody: process.env.BODY_LIMIT || '10mb',
    cacheEstaticosMs: entero(process.env.STATIC_CACHE_MS, 3600_000),
  },

  log: {
    nivel: process.env.LOG_LEVEL || (esProduccion ? 'info' : 'debug'),
  },
};

/**
 * Valida lo indispensable. En desarrollo avisa; en produccion aborta.
 */
function validar() {
  const errores = [];
  const avisos = [];

  if (!config.jwt.secreto) {
    errores.push('JWT_SECRET no esta definido');
  } else if (config.jwt.secreto.length < 32) {
    (esProduccion ? errores : avisos).push('JWT_SECRET tiene menos de 32 caracteres');
  }

  if (!process.env.DATABASE_URL && esProduccion) {
    errores.push('DATABASE_URL no esta definido (requerido en produccion)');
  }

  if (esProduccion && conexion.esLocal) {
    avisos.push('La base apunta a localhost estando en produccion');
  }

  return { errores, avisos };
}

module.exports = { config, validar };
