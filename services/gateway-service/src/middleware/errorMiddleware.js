/**
 * Middleware de manejo de errores para API Gateway
 */
const errorMiddleware = (error, req, res, next) => {
  console.error('Error capturado por gateway middleware:', {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Errores de conectividad con servicios
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return res.status(503).json({
      success: false,
      message: 'Servicio temporalmente no disponible',
      code: 'SERVICE_UNAVAILABLE'
    });
  }

  // Errores de timeout
  if (error.code === 'ETIMEDOUT') {
    return res.status(504).json({
      success: false,
      message: 'Tiempo de espera agotado',
      code: 'TIMEOUT'
    });
  }

  // Errores de proxy
  if (error.message?.includes('proxy')) {
    return res.status(502).json({
      success: false,
      message: 'Error de comunicación con servicios internos',
      code: 'PROXY_ERROR'
    });
  }

  // Error por defecto
  res.status(500).json({
    success: false,
    message: 'Error interno del gateway',
    code: 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && {
      error: error.message,
      stack: error.stack
    })
  });
};

module.exports = errorMiddleware;