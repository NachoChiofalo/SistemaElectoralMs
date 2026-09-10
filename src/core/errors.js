/**
 * Errores de aplicacion y su traduccion a respuestas HTTP.
 *
 * Todas las respuestas de error del sistema tienen la misma forma
 * { success: false, message, ... } — que es la que el frontend ya consume.
 */

const { config } = require('./config');
const { logger } = require('./logger');

class AppError extends Error {
  constructor(mensaje, status = 500, codigo = undefined, detalles = undefined) {
    super(mensaje);
    this.name = 'AppError';
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
    // Un AppError es una condicion esperada del dominio, no un bug: no ensucia el log
    // de errores con stack traces.
    this.esperado = true;
  }
}

const errores = {
  solicitudInvalida: (msg = 'Solicitud invalida', detalles) => new AppError(msg, 400, 'BAD_REQUEST', detalles),
  noAutenticado: (msg = 'Token de acceso requerido') => new AppError(msg, 401, 'UNAUTHENTICATED'),
  sinPermiso: (msg = 'Acceso denegado') => new AppError(msg, 403, 'INSUFFICIENT_PERMISSIONS'),
  noEncontrado: (msg = 'Recurso no encontrado') => new AppError(msg, 404, 'NOT_FOUND'),
  conflicto: (msg = 'El recurso ya existe') => new AppError(msg, 409, 'CONFLICT'),
  demasiadoGrande: (msg = 'El archivo excede el tamano permitido') => new AppError(msg, 413, 'PAYLOAD_TOO_LARGE'),
  interno: (msg = 'Error interno del servidor') => new AppError(msg, 500, 'INTERNAL_ERROR'),
};

/** Codigos de PostgreSQL que corresponden a un error del cliente, no del servidor. */
const PG_A_HTTP = {
  '23505': [409, 'El registro ya existe'],            // unique_violation
  '23503': [400, 'Referencia a un registro inexistente'], // foreign_key_violation
  '23502': [400, 'Falta un campo obligatorio'],       // not_null_violation
  '23514': [400, 'Un valor no cumple las restricciones'], // check_violation
  '22P02': [400, 'Formato de dato invalido'],         // invalid_text_representation
  '57014': [503, 'La consulta tardo demasiado'],      // query_canceled (statement_timeout)
};

function traducir(error) {
  if (error instanceof AppError) return error;

  // Body JSON malformado (lo lanza express.json).
  if (error.type === 'entity.parse.failed') return errores.solicitudInvalida('JSON invalido en el cuerpo de la peticion');
  if (error.type === 'entity.too.large') return errores.demasiadoGrande('El cuerpo de la peticion es demasiado grande');

  // Multer.
  if (error.code === 'LIMIT_FILE_SIZE') return errores.demasiadoGrande();
  if (error.code === 'LIMIT_UNEXPECTED_FILE') return errores.solicitudInvalida('Campo de archivo inesperado');

  if (error.code && PG_A_HTTP[error.code]) {
    const [status, mensaje] = PG_A_HTTP[error.code];
    return new AppError(mensaje, status, `PG_${error.code}`);
  }

  // Base inalcanzable: es un 503, no un 500 — reintentar tiene sentido.
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code)) {
    return new AppError('Servicio de base de datos no disponible', 503, 'DB_UNAVAILABLE');
  }

  return null; // error no reconocido: es un bug
}

/** Envuelve un handler async para que sus rechazos lleguen al manejador de errores. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function manejadorNoEncontrado(req, res) {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado',
    path: req.originalUrl,
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifica el handler por aridad 4
function manejadorErrores(error, req, res, next) {
  const traducido = traducir(error);

  if (!traducido) {
    logger.error(`Error no manejado en ${req.method} ${req.originalUrl}`, error);
  } else if (traducido.status >= 500) {
    logger.error(`${traducido.message} en ${req.method} ${req.originalUrl}`, { codigo: traducido.codigo });
  }

  const status = traducido?.status ?? 500;
  const cuerpo = {
    success: false,
    message: traducido?.message ?? 'Error interno del servidor',
  };

  if (traducido?.codigo) cuerpo.code = traducido.codigo;
  if (traducido?.detalles) cuerpo.errors = traducido.detalles;
  // El detalle crudo solo fuera de produccion: puede filtrar estructura interna.
  if (!config.esProduccion && !traducido) cuerpo.detail = error.message;

  res.status(status).json(cuerpo);
}

module.exports = { AppError, errores, asyncHandler, manejadorErrores, manejadorNoEncontrado };
