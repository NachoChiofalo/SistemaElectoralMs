const express = require('express');
const UserService = require('../services/UserService');
const Database = require('../database/Database');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();
const database = new Database();
const userService = new UserService(database);

// Middleware de autenticación para todas las rutas
router.use(authMiddleware);

// GET /api/users/profile - Obtener perfil del usuario actual
router.get('/profile', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await userService.getUserById(userId);
    
    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/profile - Actualizar perfil
router.put('/profile', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { nombre_completo, email } = req.body;

    const updatedUser = await userService.updateProfile(userId, {
      nombre_completo,
      email
    });
    
    res.json({
      success: true,
      message: 'Perfil actualizado exitosamente',
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/users/change-password - Cambiar contraseña
router.post('/change-password', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Contraseña actual y nueva son requeridas'
      });
    }

    await userService.changePassword(userId, currentPassword, newPassword);
    
    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente'
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/users - Listar usuarios (solo admin)
router.get('/', async (req, res, next) => {
  try {
    // Verificar permisos de administrador
    if (req.user.rol !== 'administrador') {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: se requieren permisos de administrador'
      });
    }

    const users = await userService.getAllUsers();
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/users - Crear nuevo usuario (solo admin)
router.post('/', async (req, res, next) => {
  try {
    if (req.user.rol !== 'administrador') {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: se requieren permisos de administrador'
      });
    }

    const { username, password, nombre_completo, email, rol } = req.body;

    if (!username || !password || !nombre_completo) {
      return res.status(400).json({
        success: false,
        message: 'Username, password y nombre completo son requeridos'
      });
    }

    const newUser = await userService.createUser({
      username,
      password,
      nombre_completo,
      email,
      rol: rol || 'encargado_relevamiento'
    });
    
    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente',
      data: newUser
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;