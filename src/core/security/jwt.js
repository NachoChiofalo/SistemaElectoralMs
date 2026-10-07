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

// Se firma y se verifica con HS256 explicito: sin `algorithms`, verify() acepta lo que
// diga el header del token (BE-012).
const ALGORITMO = 'HS256';

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
    { ...OPCIONES_COMUNES, algorithm: ALGORITMO, expiresIn: config.jwt.expiracion },
  );

  return { token, jti };
}

function nuevoRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash del refresh token para persistirlo. Es un valor de alta entropia generado por
 * el propio servidor, no una contrasena elegida por una persona: alcanza con SHA-256,
 * sin el costo de bcrypt en cada /refresh.
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verifica firma, vigencia, issuer y audience. No toca la base: la validez de la
 * SESION (revocacion, sesion unica, inactividad) la resuelve core/security/sessions.
 *
 * @throws {AppError} 401 si el token no es utilizable.
 */
function verificar(token) {
  try {
    return jwt.verify(token, config.jwt.secreto, { ...OPCIONES_COMUNES, algorithms: [ALGORITMO] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw errores.noAutenticado('Token expirado');
    if (error.name === 'JsonWebTokenError') throw errores.noAutenticado('Token invalido');
    throw errores.noAutenticado('No se pudo verificar el token');
  }
}

/**
 * Verifica firma, issuer y audience igual que verificar(), pero sin exigir vigencia.
 * Solo para el logout: una sesion ya vencida tiene que poder cerrarse, pero el token
 * presentado tiene que ser uno que el servidor firmo alguna vez, no cualquier JSON con
 * forma de JWT.
 *
 * @throws {AppError} 401 si la firma, el issuer o la audience no son validos.
 */
function verificarIgnorandoExpiracion(token) {
  try {
    return jwt.verify(token, config.jwt.secreto, { ...OPCIONES_COMUNES, algorithms: [ALGORITMO], ignoreExpiration: true });
  } catch (error) {
    throw errores.noAutenticado('Token invalido');
  }
}

/** Extrae el token del header Authorization, o null si no hay uno utilizable. */
function extraerDeHeader(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

module.exports = {
  firmar,
  verificar,
  verificarIgnorandoExpiracion,
  extraerDeHeader,
  nuevoRefreshToken,
  hashRefreshToken,
};
