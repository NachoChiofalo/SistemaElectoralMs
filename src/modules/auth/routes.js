const express = require('express');
const { asyncHandler, errores } = require('../../core/errors');
const { requireAuth, requireAdmin } = require('../../core/security/authorize');
const jwtHelper = require('../../core/security/jwt');

/**
 * Rutas de /api/auth y /api/users.
 *
 * El modulo se monta SIN requiresAuth porque el login tiene que ser publico; cada ruta
 * protegida declara requireAuth explicitamente.
 */
function construirRutas(auth, usuarios) {
  const router = express.Router();

  // ==================== /api/auth ====================
  const rutasAuth = express.Router();

  rutasAuth.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
      throw errores.solicitudInvalida('Username y password son requeridos');
    }

    const resultado = await auth.login(username, password, req);
    res.json({ success: true, message: 'Login exitoso', data: resultado });
  }));

  rutasAuth.post('/logout', asyncHandler(async (req, res) => {
    const token = jwtHelper.extraerDeHeader(req);
    if (!token) throw errores.noAutenticado('Token no proporcionado');

    // No pasa por requireAuth a proposito: cerrar una sesion ya vencida debe funcionar.
    await auth.logout(token, req);
    res.json({ success: true, message: 'Logout exitoso' });
  }));

  /**
   * Verificacion de token. Internamente ya no se usa —requireAuth lo resuelve en
   * proceso— pero se mantiene expuesto por si algun cliente externo depende de el.
   */
  rutasAuth.post('/verify', requireAuth, (req, res) => {
    res.json({
      success: true,
      message: 'Token valido',
      data: {
        id: req.user.id,
        username: req.user.username,
        nombre_completo: req.user.nombre_completo,
        email: req.user.email,
        rol: req.user.rol,
        activo: req.user.activo,
      },
    });
  });

  rutasAuth.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) throw errores.solicitudInvalida('Refresh token requerido');

    const resultado = await auth.renovar(refreshToken);
    res.json({ success: true, message: 'Token renovado exitosamente', data: resultado });
  }));

  rutasAuth.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const perfil = await auth.perfilCompleto(req.user.id);
    res.json({ success: true, message: 'Usuario obtenido exitosamente', data: perfil });
  }));

  // ==================== /api/users ====================
  const rutasUsuarios = express.Router();
  rutasUsuarios.use(requireAuth);

  rutasUsuarios.get('/profile', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await usuarios.porId(req.user.id) });
  }));

  rutasUsuarios.put('/profile', asyncHandler(async (req, res) => {
    const { nombre_completo, email } = req.body || {};
    const actualizado = await usuarios.actualizarPerfil(req.user.id, { nombre_completo, email });
    res.json({ success: true, message: 'Perfil actualizado exitosamente', data: actualizado });
  }));

  rutasUsuarios.post('/change-password', asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      throw errores.solicitudInvalida('Contrasena actual y nueva son requeridas');
    }

    await usuarios.cambiarPasswordPropia(req.user.id, currentPassword, newPassword, req);
    res.json({ success: true, message: 'Contrasena actualizada exitosamente' });
  }));

  // --- de aca en adelante, solo administradores ---

  rutasUsuarios.get('/roles', requireAdmin, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await usuarios.roles() });
  }));

  rutasUsuarios.get('/', requireAdmin, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await usuarios.todos() });
  }));

  rutasUsuarios.post('/', requireAdmin, asyncHandler(async (req, res) => {
    const { username, password, nombre_completo, email, rol } = req.body || {};

    if (!username || !password || !nombre_completo) {
      throw errores.solicitudInvalida('Username, password y nombre completo son requeridos');
    }

    const nuevo = await usuarios.crear(
      { username, password, nombre_completo, email, rol: rol || 'encargado_relevamiento' },
      req,
    );

    res.status(201).json({ success: true, message: 'Usuario creado exitosamente', data: nuevo });
  }));

  rutasUsuarios.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
    const id = idDeParametro(req);
    const { nombre_completo, email, rol, activo } = req.body || {};

    const actualizado = await usuarios.actualizar(id, { nombre_completo, email, rol, activo }, req);
    res.json({ success: true, message: 'Usuario actualizado exitosamente', data: actualizado });
  }));

  rutasUsuarios.patch('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
    const id = idDeParametro(req);
    const { activo } = req.body || {};

    if (typeof activo !== 'boolean') {
      throw errores.solicitudInvalida('El campo activo debe ser un valor booleano');
    }

    // Un administrador que se desactiva a si mismo deja el sistema sin quien lo
    // reactive por la interfaz.
    if (id === req.user.id && activo === false) {
      throw errores.solicitudInvalida('No podes desactivar tu propio usuario');
    }

    const actualizado = await usuarios.cambiarEstado(id, activo, req);
    res.json({
      success: true,
      message: activo ? 'Usuario activado exitosamente' : 'Usuario desactivado exitosamente',
      data: actualizado,
    });
  }));

  rutasUsuarios.post('/:id/reset-password', requireAdmin, asyncHandler(async (req, res) => {
    const id = idDeParametro(req);
    const { newPassword } = req.body || {};

    await usuarios.resetearPassword(id, newPassword, req);
    res.json({ success: true, message: 'Contrasena reseteada exitosamente' });
  }));

  router.use('/auth', rutasAuth);
  router.use('/users', rutasUsuarios);

  return router;
}

function idDeParametro(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw errores.solicitudInvalida('El id de usuario debe ser un numero');
  }
  return id;
}

module.exports = construirRutas;
