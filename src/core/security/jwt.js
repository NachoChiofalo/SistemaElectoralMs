/**
 * Firma y verificacion de JWT, en proceso.
 *
 * Antes el gateway verificaba cada token haciendo POST a auth-service/api/auth/verify
 * por HTTP, con timeout de 5 s, teniendo el mismo JWT_SECRET a mano. Ahora es una
 * llamada a funcion.
 *
 * El formato del token no cambia: mismos claims, mismo issuer y misma audience, para
 * que los tokens emitidos antes del deploy sigan siendo validos.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { config } = require('../config');
const { errores } = require('../errors');

const OPCIONES_COMUNES = {
  issuer: config.jwt.emisor,
  audience: config.jwt.audiencia,
};

/**
 * Emite un access token. El jti identifica la sesion: es lo que se compara contra
 * active_sessions y lo que se agrega a token_blacklist en el logout.
 */
function firmar(usuario, jti = crypto.randomUUID()) {
  const token = jwt.sign(
    {
      id: usuario.id,
      username: usuario.username,
      rol: usuario.rol_nombre || usuario.rol,
      permisos: usuario.permisos || [],
      jti,
    },
    config.jwt.secreto,
    { ...OPCIONES_COMUNES, expiresIn: config.jwt.expiracion },
  );

  return { token, jti };
}

function nuevoRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Verifica firma, vigencia, issuer y audience. No toca la base: la validez de la
 * SESION (revocacion, sesion unica, inactividad) la resuelve core/security/sessions.
 *
 * @throws {AppError} 401 si el token no es utilizable.
 */
function verificar(token) {
  try {
    return jwt.verify(token, config.jwt.secreto, OPCIONES_COMUNES);
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw errores.noAutenticado('Token expirado');
    if (error.name === 'JsonWebTokenError') throw errores.noAutenticado('Token invalido');
    throw errores.noAutenticado('No se pudo verificar el token');
  }
}

/** Lee los claims sin validar la firma. Solo para el logout, que acepta tokens vencidos. */
function decodificar(token) {
  return jwt.decode(token);
}

/** Extrae el token del header Authorization, o null si no hay uno utilizable. */
function extraerDeHeader(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

module.exports = { firmar, verificar, decodificar, extraerDeHeader, nuevoRefreshToken };
