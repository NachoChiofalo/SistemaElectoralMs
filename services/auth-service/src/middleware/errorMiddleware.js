/**
 * Middleware de manejo de errores
 */
const errorMiddleware = (error, req, res, next) => {
  console.error('Error capturado por middleware:', {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Errores de validación específicos
  if (error.message?.includes('ya existe')) {
    return res.status(409).json({
      success: false,
      message: error.message
    });
  }

  if (error.message?.includes('no encontrado')) {
    return res.status(404).json({
      success: false,
      message: error.message
    });
  }

  if (error.message?.includes('Credenciales inválidas') || 
      error.message?.includes('Token inválido') ||
      error.message?.includes('Token expirado')) {
    return res.status(401).json({
      success: false,
      message: error.message
    });
  }

  if (error.message?.includes('Acceso denegado') ||
      error.message?.includes('permisos')) {
    return res.status(403).json({
      success: false,
      message: error.message
    });
  }

  // Error por defecto
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && {
      error: error.message,
      stack: error.stack
    })
  });
};

module.exports = errorMiddleware;