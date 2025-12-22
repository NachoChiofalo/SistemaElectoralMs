const express = require('express');
const AuthService = require('../services/AuthService');
const Database = require('../database/Database');

const router = express.Router();
const database = new Database();
const authService = new AuthService(database);

// POST /api/auth/login - Iniciar sesión
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username y password son requeridos'
      });
    }

    const result = await authService.login(username, password);
    
    res.json({
      success: true,
      message: 'Login exitoso',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout - Cerrar sesión (blacklist token)
router.post('/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token no proporcionado'
      });
    }

    const token = authHeader.substring(7);
    await authService.logout(token);
    
    res.json({
      success: true,
      message: 'Logout exitoso'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/verify - Verificar token
router.post('/verify', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token no proporcionado'
      });
    }

    const token = authHeader.substring(7);
    const userData = await authService.verifyToken(token);
    
    res.json({
      success: true,
      message: 'Token válido',
      data: userData
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/refresh - Renovar token
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token requerido'
      });
    }

    const result = await authService.refreshToken(refreshToken);
    
    res.json({
      success: true,
      message: 'Token renovado exitosamente',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;