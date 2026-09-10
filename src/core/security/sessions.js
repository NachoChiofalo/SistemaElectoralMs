/**
 * Estado de sesion: revocacion, sesion unica por usuario e inactividad.
 *
 * Este archivo es donde se cobra la mayor parte del ahorro del refactor. Antes, cada
 * request protegido ejecutaba cuatro consultas contra Supabase:
 *
 *   1. SELECT en token_blacklist
 *   2. SELECT en active_sessions
 *   3. UPDATE de active_sessions.last_activity   <- una escritura POR REQUEST
 *   4. SELECT del usuario con su rol
 *
 * Ahora las tres lecturas son una sola consulta, cacheada en memoria por un TTL corto,
 * y la escritura de last_activity es write-behind: como mucho un UPDATE por usuario
 * cada ACTIVITY_WRITE_INTERVAL_MS. En el caso tipico, un request protegido no toca la
 * base para autenticarse.
 *
 * La cache es local al proceso, que es exactamente lo que la vuelve correcta: con un
 * solo proceso, un login o un logout invalidan la cache de forma inmediata y exacta.
 * Si el sistema volviera a escalar a varias instancias, esto necesitaria Redis.
 */

const db = require('../db');
const { config } = require('../config');
const { logger } = require('../logger');
const { errores } = require('../errors');

const { cacheTtlMs, cacheMax, timeoutInactividadMs, intervaloEscrituraActividadMs } = config.sesiones;

/** jti -> { usuario, verificadaEn, ultimaActividad } — Map ordenado por insercion (LRU). */
const cache = new Map();

/** userId -> { ultimaActividad, ultimaEscritura } — cola de escrituras diferidas. */
const actividadPendiente = new Map();

/**
 * Todo el estado de sesion en una sola consulta: usuario + rol + sesion activa +
 * si el jti esta revocado.
 */
const SQL_ESTADO_SESION = `
  SELECT
    u.id, u.username, u.nombre_completo, u.email, u.activo,
    r.nombre AS rol,
    s.session_jti,
    s.last_activity,
    EXISTS (SELECT 1 FROM token_blacklist b WHERE b.token_jti = $2) AS revocado
  FROM usuarios u
  LEFT JOIN roles r ON u.rol_id = r.id
  LEFT JOIN active_sessions s ON s.user_id = u.id
  WHERE u.id = $1
`;

function recordar(jti, entrada) {
  // LRU simple: reinsertar mueve al final; el mas viejo esta al principio.
  cache.delete(jti);
  cache.set(jti, entrada);
  while (cache.size > cacheMax) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * Registra actividad del usuario. Escribe a la base solo si paso el intervalo.
 * No se espera el resultado: un fallo al persistir actividad no debe fallar el request.
 */
function registrarActividad(userId, ahora) {
  const previo = actividadPendiente.get(userId);

  if (!previo) {
    actividadPendiente.set(userId, { ultimaActividad: ahora, ultimaEscritura: ahora });
    return;
  }

  previo.ultimaActividad = ahora;

  if (ahora - previo.ultimaEscritura < intervaloEscrituraActividadMs) return;

  previo.ultimaEscritura = ahora;
  db.query(
    'UPDATE active_sessions SET last_activity = CURRENT_TIMESTAMP WHERE user_id = $1',
    [userId],
  ).catch((error) => logger.warn('No se pudo persistir last_activity', { userId, error: error.message }));
}

/**
 * Valida el estado de sesion de un token ya verificado criptograficamente.
 *
 * @param {object} claims  Payload devuelto por jwt.verificar().
 * @returns {Promise<object>} Usuario para req.user.
 * @throws {AppError} 401 si la sesion no es utilizable.
 */
async function validar(claims) {
  const ahora = Date.now();
  const enCache = cache.get(claims.jti);

  if (enCache && ahora - enCache.verificadaEn < cacheTtlMs) {
    // La inactividad se mide contra la actividad real en memoria, que es mas precisa
    // que la que quedo persistida.
    if (ahora - enCache.ultimaActividad > timeoutInactividadMs) {
      cache.delete(claims.jti);
      await cerrarPorInactividad(claims.id);
      throw errores.noAutenticado('Sesion expirada por inactividad');
    }

    enCache.ultimaActividad = ahora;
    recordar(claims.jti, enCache);
    registrarActividad(claims.id, ahora);
    return enCache.usuario;
  }

  const fila = await db.unaFila(SQL_ESTADO_SESION, [claims.id, claims.jti]);

  if (!fila) throw errores.noAutenticado('Usuario no valido o inactivo');
  if (fila.revocado) throw errores.noAutenticado('Token revocado');
  if (!fila.activo) throw errores.noAutenticado('Usuario no valido o inactivo');

  if (!fila.session_jti || fila.session_jti !== claims.jti) {
    throw errores.noAutenticado('Sesion invalida. El usuario ha iniciado sesion en otro dispositivo');
  }

  // Si hay actividad mas reciente en memoria que en la base (write-behind pendiente),
  // vale la de memoria.
  const persistida = new Date(fila.last_activity).getTime();
  const enMemoria = actividadPendiente.get(claims.id)?.ultimaActividad ?? 0;
  const ultimaActividad = Math.max(persistida, enMemoria);

  if (ahora - ultimaActividad > timeoutInactividadMs) {
    await cerrarPorInactividad(claims.id);
    throw errores.noAutenticado('Sesion expirada por inactividad');
  }

  const usuario = {
    id: fila.id,
    username: fila.username,
    nombre_completo: fila.nombre_completo,
    email: fila.email,
    rol: fila.rol,
    activo: fila.activo,
    // Los permisos viajan en el token: es lo que permite autorizar sin consultar.
    permisos: claims.permisos || [],
    jti: claims.jti,
  };

  recordar(claims.jti, { usuario, verificadaEn: ahora, ultimaActividad: ahora });
  registrarActividad(claims.id, ahora);

  return usuario;
}

async function cerrarPorInactividad(userId) {
  actividadPendiente.delete(userId);
  try {
    await db.query('DELETE FROM active_sessions WHERE user_id = $1', [userId]);
  } catch (error) {
    logger.warn('No se pudo eliminar la sesion expirada', { userId, error: error.message });
  }
}

/** Descarta una sesion puntual de la cache. Lo llama el logout. */
function invalidar(jti) {
  if (jti) cache.delete(jti);
}

/**
 * Descarta todas las sesiones cacheadas de un usuario.
 * Lo llaman el login (que invalida la sesion anterior), la desactivacion de un usuario
 * y el cambio de rol o de contrasena.
 */
function invalidarUsuario(userId) {
  const id = Number(userId);
  for (const [jti, entrada] of cache) {
    if (entrada.usuario.id === id) cache.delete(jti);
  }
  actividadPendiente.delete(id);
}

/** Persiste la actividad pendiente. Se llama en el apagado ordenado. */
async function vaciarActividad() {
  const pendientes = [...actividadPendiente.entries()]
    .filter(([, v]) => v.ultimaActividad > v.ultimaEscritura);

  if (pendientes.length === 0) return;

  await Promise.allSettled(pendientes.map(([userId, v]) => db.query(
    'UPDATE active_sessions SET last_activity = $2 WHERE user_id = $1',
    [userId, new Date(v.ultimaActividad)],
  )));

  logger.info(`Actividad de ${pendientes.length} sesion(es) persistida al cerrar`);
}

function estado() {
  return { sesionesCacheadas: cache.size, actividadPendiente: actividadPendiente.size };
}

module.exports = { validar, invalidar, invalidarUsuario, vaciarActividad, estado };
