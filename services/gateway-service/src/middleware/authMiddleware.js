const axios = require('axios');

/**
 * Middleware de autenticación para API Gateway
 * Verifica tokens JWT contra el servicio de auth
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token de acceso requerido'
      });
    }

    const token = authHeader.substring(7);
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';

    try {
      // Verificar token contra el servicio de auth
      const response = await axios.post(
        `${authServiceUrl}/api/auth/verify`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      if (response.data.success && response.data.data) {
        // Agregar datos del usuario a la request
        req.user = response.data.data;
        next();
      } else {
        return res.status(401).json({
          success: false,
          message: 'Token inválido'
        });
      }

    } catch (error) {
      console.error('Error verificando token:', error.message);

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          message: 'Servicio de autenticación no disponible'
        });
      }

      if (error.response?.status === 401) {
        return res.status(401).json({
          success: false,
          message: error.response.data?.message || 'Token inválido'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Error verificando autenticación'
      });
    }

  } catch (error) {
    console.error('Error en auth middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

/**
 * Middleware opcional de autenticación - no bloquea si no hay token
 */
const optionalAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    await authMiddleware(req, res, next);
  } catch (error) {
    // Si hay error en auth opcional, continúa sin usuario
    console.warn('Auth opcional falló:', error.message);
    next();
  }
};

/**
 * Middleware para verificar rol de administrador
 */
const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Autenticación requerida'
    });
  }

  if (req.user.rol !== 'administrador') {
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: se requieren permisos de administrador'
    });
  }

  next();
};

module.exports = {
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware
};