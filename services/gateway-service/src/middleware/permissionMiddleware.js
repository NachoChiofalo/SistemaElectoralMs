/**
 * Middleware de autorización basado en permisos para API Gateway
 * Verifica que el usuario tenga permisos específicos para acceder a recursos
 */

/**
 * Crear middleware de autorización para un permiso específico
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida'
      });
    }

    // Verificar si el usuario tiene el permiso requerido
    const userPermissions = req.user.permisos || [];
    const hasPermission = userPermissions.includes(permission);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: se requiere el permiso "${permission}"`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * Middleware que requiere cualquiera de los permisos especificados
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida'
      });
    }

    const userPermissions = req.user.permisos || [];
    const hasAnyPermission = permissions.some(permission => 
      userPermissions.includes(permission)
    );

    if (!hasAnyPermission) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: se requiere uno de estos permisos: ${permissions.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * Middleware que requiere todos los permisos especificados
 */
const requireAllPermissions = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida'
      });
    }

    const userPermissions = req.user.permisos || [];
    const hasAllPermissions = permissions.every(permission => 
      userPermissions.includes(permission)
    );

    if (!hasAllPermissions) {
      const missingPermissions = permissions.filter(permission => 
        !userPermissions.includes(permission)
      );
      
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: faltan estos permisos: ${missingPermissions.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * Middleware para verificar rol específico
 */
const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida'
      });
    }

    if (req.user.rol !== role) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: se requiere el rol "${role}"`,
        code: 'INSUFFICIENT_ROLE'
      });
    }

    next();
  };
};

/**
 * Middleware para verificar múltiples roles
 */
const requireAnyRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida'
      });
    }

    const hasRole = roles.includes(req.user.rol);

    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: se requiere uno de estos roles: ${roles.join(', ')}`,
        code: 'INSUFFICIENT_ROLE'
      });
    }

    next();
  };
};

/**
 * Verificar si el usuario es propietario del recurso o administrador
 */
const requireOwnershipOrAdmin = (getUserIdFromReq = (req) => req.params.userId) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida'
      });
    }

    const resourceUserId = getUserIdFromReq(req);
    const isOwner = req.user.id.toString() === resourceUserId.toString();
    const isAdmin = req.user.rol === 'administrador';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: solo el propietario o administrador puede acceder a este recurso',
        code: 'ACCESS_DENIED'
      });
    }

    next();
  };
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireRole,
  requireAnyRole,
  requireOwnershipOrAdmin
};