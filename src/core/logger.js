/**
 * Logger del proceso.
 *
 * Reemplaza morgan('combined') y los console.log sueltos. En produccion emite JSON
 * en una linea (barato de serializar, facil de filtrar); en desarrollo, texto legible.
 */

const { config } = require('./config');

const NIVELES = { error: 50, warn: 40, info: 30, debug: 20 };
const nivelMinimo = NIVELES[config.log.nivel] ?? NIVELES.info;

const COLOR = {
  error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m', reset: '\x1b[0m',
};

// Nunca deben salir a los logs, ni siquiera truncados.
const SENSIBLES = new Set(['password', 'password_hash', 'passwordActual', 'passwordNueva', 'token', 'accessToken', 'refreshToken', 'authorization', 'jwt_secret']);

function limpiar(datos) {
  if (!datos || typeof datos !== 'object') return datos;
  const salida = Array.isArray(datos) ? [] : {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (SENSIBLES.has(clave)) salida[clave] = '[oculto]';
    else if (valor && typeof valor === 'object') salida[clave] = limpiar(valor);
    else salida[clave] = valor;
  }
  return salida;
}

function emitir(nivel, mensaje, datos) {
  if (NIVELES[nivel] < nivelMinimo) return;

  const contexto = datos instanceof Error
    ? { error: datos.message, stack: config.esProduccion ? undefined : datos.stack }
    : limpiar(datos);

  if (config.esProduccion) {
    process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), nivel, msg: mensaje, ...contexto })}\n`);
    return;
  }

  const extra = contexto && Object.keys(contexto).length ? ` ${JSON.stringify(contexto)}` : '';
  process.stdout.write(`${COLOR[nivel]}${nivel.padEnd(5)}${COLOR.reset} ${mensaje}${extra}\n`);
}

const logger = {
  error: (msg, datos) => emitir('error', msg, datos),
  warn: (msg, datos) => emitir('warn', msg, datos),
  info: (msg, datos) => emitir('info', msg, datos),
  debug: (msg, datos) => emitir('debug', msg, datos),

  /** Logger con contexto fijo, para que un modulo no repita su nombre en cada llamada. */
  hijo(contextoFijo) {
    const conContexto = (nivel) => (msg, datos) => emitir(
      nivel,
      msg,
      datos instanceof Error ? datos : { ...contextoFijo, ...(datos || {}) },
    );
    return {
      error: conContexto('error'),
      warn: conContexto('warn'),
      info: conContexto('info'),
      debug: conContexto('debug'),
      hijo: (mas) => logger.hijo({ ...contextoFijo, ...mas }),
    };
  },
};

/**
 * Middleware de acceso. Una linea por request, al terminar, con la duracion real.
 * Los health checks se loguean en debug para no inundar en produccion.
 */
function middlewareAcceso(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const esRuido = req.path === '/health' && res.statusCode < 400;
    const nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : esRuido ? 'debug' : 'info';

    emitir(nivel, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      ms: Math.round(ms),
      usuario: req.user?.username,
    });
  });

  next();
}

module.exports = { logger, middlewareAcceso };
