/**
 * Middlewares de autenticacion y autorizacion.
 *
 * Reemplazan al authMiddleware del gateway (que verificaba por HTTP contra
 * auth-service) y al userContextMiddleware del padron (que reconstruia req.user
 * leyendo headers X-User-*). Ahora req.user se puebla una sola vez, en proceso, y
 * los modulos lo reciben tal cual.
 */

const jwtHelper = require('./jwt');
const sesiones = require('./sessions');
const { errores, asyncHandler } = require('../errors');

/**
 * Exige un token valido con sesion activa. Deja el usuario en req.user.
 */
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = jwtHelper.extraerDeHeader(req);
  if (!token) throw errores.noAutenticado();

  const claims = jwtHelper.verificar(token);
  req.user = await sesiones.validar(claims);
  req.token = token;

  next();
});

/**
 * Puebla req.user si hay un token utilizable, pero no bloquea si no lo hay.
 * Para endpoints que cambian de comportamiento segun haya o no sesion.
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = jwtHelper.extraerDeHeader(req);
  if (!token) return next();

  try {
    const claims = jwtHelper.verificar(token);
    req.user = await sesiones.validar(claims);
    req.token = token;
  } catch {
    // Token presente pero inutilizable: se sigue como anonimo.
  }

  next();
});

/**
 * Exige un permiso concreto. Los permisos viajan en el token, asi que la
 * comprobacion no consulta la base.
 */
function requirePermission(...permisos) {
  const requeridos = permisos.flat();

  return (req, res, next) => {
    if (!req.user) return next(errores.noAutenticado('Autenticacion requerida'));

    const propios = req.user.permisos || [];
    if (requeridos.some((p) => propios.includes(p))) return next();

    return next(errores.sinPermiso(
      requeridos.length === 1
        ? `Acceso denegado: se requiere el permiso "${requeridos[0]}"`
        : `Acceso denegado: se requiere uno de estos permisos: ${requeridos.join(', ')}`,
    ));
  };
}

/** Exige uno de los roles indicados. Preferir requirePermission cuando aplique. */
function requireRol(...roles) {
  const permitidos = roles.flat();

  return (req, res, next) => {
    if (!req.user) return next(errores.noAutenticado('Autenticacion requerida'));
    if (permitidos.includes(req.user.rol)) return next();

    return next(errores.sinPermiso(
      permitidos.length === 1 && permitidos[0] === 'administrador'
        ? 'Acceso denegado: se requieren permisos de administrador'
        : `Acceso denegado: se requiere uno de estos roles: ${permitidos.join(', ')}`,
    ));
  };
}

const requireAdmin = requireRol('administrador');

module.exports = { requireAuth, optionalAuth, requirePermission, requireRol, requireAdmin };
