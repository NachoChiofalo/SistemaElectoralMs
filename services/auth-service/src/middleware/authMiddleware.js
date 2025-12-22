const AuthService = require('../services/AuthService');
const Database = require('../database/Database');

const database = new Database();
const authService = new AuthService(database);

/**
 * Middleware de autenticación JWT
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
    
    try {
      const userData = await authService.verifyToken(token);
      req.user = userData;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: error.message || 'Token inválido'
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

module.exports = authMiddleware;