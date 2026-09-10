/**
 * Acceso a datos de autenticacion y usuarios.
 *
 * Antes las consultas estaban mezcladas con la logica en AuthService (813 lineas) y
 * UserService (289), cada uno con su propio Pool. Aca estan todas juntas y usan la
 * conexion compartida.
 */

const SELECT_USUARIO = `
  SELECT u.id, u.username, u.nombre_completo, u.email, r.nombre AS rol, u.activo, u.created_at
  FROM usuarios u
  LEFT JOIN roles r ON u.rol_id = r.id
`;

class AuthRepository {
  constructor(db) {
    this.db = db;
  }

  // ---------------------------------------------------------------- login

  /** Usuario con su hash, rol y permisos, en una sola consulta. */
  porUsername(username) {
    return this.db.unaFila(
      `SELECT
         u.id, u.username, u.password_hash, u.nombre_completo, u.email, u.activo,
         r.nombre AS rol_nombre, r.descripcion AS rol_descripcion,
         ARRAY_REMOVE(ARRAY_AGG(p.codigo), NULL) AS permisos
       FROM usuarios u
       LEFT JOIN roles r ON u.rol_id = r.id
       LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
       LEFT JOIN permisos p ON rp.permiso_id = p.id
       WHERE u.username = $1
       GROUP BY u.id, r.nombre, r.descripcion`,
      [username],
    );
  }

  /** Usuario con permisos y modulos disponibles. Alimenta GET /api/auth/me. */
  conPermisos(userId) {
    return this.db.unaFila(
      `SELECT
         u.id, u.username, u.nombre_completo, u.email, u.activo,
         r.nombre AS rol_nombre, r.descripcion AS rol_descripcion,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.codigo), NULL) AS permisos,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.modulo), NULL) AS modulos
       FROM usuarios u
       LEFT JOIN roles r ON u.rol_id = r.id
       LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
       LEFT JOIN permisos p ON rp.permiso_id = p.id
       WHERE u.id = $1 AND u.activo = true
       GROUP BY u.id, r.nombre, r.descripcion`,
      [userId],
    );
  }

  // -------------------------------------------------------------- sesiones

  /**
   * Registra la sesion recien creada: guarda el refresh token y reemplaza la sesion
   * activa del usuario. Va en una transaccion porque dejar una sin la otra produce
   * una sesion que no se puede renovar o un token que no autentica.
   */
  async abrirSesion({ userId, jti, refreshToken, expiraRefresh }) {
    await this.db.transaccion(async (cliente) => {
      await cliente.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, refreshToken, expiraRefresh],
      );
      await cliente.query(
        `INSERT INTO active_sessions (user_id, session_jti, last_activity)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE
           SET session_jti = EXCLUDED.session_jti, last_activity = CURRENT_TIMESTAMP`,
        [userId, jti],
      );
    });
  }

  /** Refresh token vigente junto con el usuario al que pertenece. */
  porRefreshToken(token) {
    return this.db.unaFila(
      `SELECT
         rt.user_id AS id, u.username, u.nombre_completo, u.email, u.activo,
         r.nombre AS rol_nombre,
         ARRAY_REMOVE(ARRAY_AGG(p.codigo), NULL) AS permisos
       FROM refresh_tokens rt
       JOIN usuarios u ON rt.user_id = u.id
       LEFT JOIN roles r ON u.rol_id = r.id
       LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
       LEFT JOIN permisos p ON rp.permiso_id = p.id
       WHERE rt.token = $1 AND rt.expires_at > CURRENT_TIMESTAMP
       GROUP BY rt.user_id, u.username, u.nombre_completo, u.email, u.activo, r.nombre`,
      [token],
    );
  }

  borrarRefreshToken(token) {
    return this.db.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
  }

  /**
   * Cierra la sesion: revoca el jti, borra los refresh tokens del usuario y elimina
   * la sesion activa. Aprovecha para purgar la blacklist vencida.
   */
  async cerrarSesion({ jti, expira, userId }) {
    await this.db.transaccion(async (cliente) => {
      if (jti) {
        await cliente.query(
          `INSERT INTO token_blacklist (token_jti, expires_at) VALUES ($1, $2)
           ON CONFLICT (token_jti) DO NOTHING`,
          [jti, expira],
        );
      }
      if (userId) {
        await cliente.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
        await cliente.query('DELETE FROM active_sessions WHERE user_id = $1', [userId]);
      }
    });
  }

  /**
   * Purga tokens vencidos. Antes corria en cada logout; ahora es una tarea periodica,
   * porque borrar filas vencidas no tiene por que estar en el camino del usuario.
   */
  async purgarVencidos() {
    const blacklist = await this.db.query('DELETE FROM token_blacklist WHERE expires_at < CURRENT_TIMESTAMP');
    const refresh = await this.db.query('DELETE FROM refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP');
    return { blacklist: blacklist.rowCount, refresh: refresh.rowCount };
  }

  // -------------------------------------------------------------- usuarios

  porId(userId) {
    return this.db.unaFila(`${SELECT_USUARIO} WHERE u.id = $1`, [userId]);
  }

  todos() {
    return this.db.filas(`${SELECT_USUARIO} ORDER BY u.created_at DESC`);
  }

  hashPorId(userId) {
    return this.db.unaFila('SELECT password_hash FROM usuarios WHERE id = $1', [userId]);
  }

  existeUsername(username) {
    return this.db.unaFila('SELECT id FROM usuarios WHERE username = $1', [username]);
  }

  rolPorNombre(nombre) {
    return this.db.unaFila('SELECT id FROM roles WHERE nombre = $1', [nombre]);
  }

  roles() {
    return this.db.filas('SELECT id, nombre, descripcion FROM roles ORDER BY nombre');
  }

  crearUsuario({ username, passwordHash, nombre_completo, email, rolId }) {
    return this.db.unaFila(
      `INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, nombre_completo, email, activo, created_at`,
      [username, passwordHash, nombre_completo, email, rolId],
    );
  }

  actualizarPerfil(userId, { nombre_completo, email }) {
    return this.db.unaFila(
      `UPDATE usuarios
       SET nombre_completo = COALESCE($1, nombre_completo),
           email           = COALESCE($2, email),
           updated_at      = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, username, nombre_completo, email, activo`,
      [nombre_completo, email, userId],
    );
  }

  /** Devuelve el usuario ya con el nombre del rol resuelto, sin una segunda consulta. */
  actualizarUsuario(userId, { nombre_completo, email, rolId, activo }) {
    return this.db.unaFila(
      `WITH actualizado AS (
         UPDATE usuarios
         SET nombre_completo = COALESCE($1, nombre_completo),
             email           = COALESCE($2, email),
             rol_id          = COALESCE($3, rol_id),
             activo          = COALESCE($4, activo),
             updated_at      = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING id, username, nombre_completo, email, activo, rol_id
       )
       SELECT a.id, a.username, a.nombre_completo, a.email, a.activo, r.nombre AS rol
       FROM actualizado a
       LEFT JOIN roles r ON a.rol_id = r.id`,
      [nombre_completo, email, rolId, activo, userId],
    );
  }

  cambiarPassword(userId, passwordHash) {
    return this.db.unaFila(
      `UPDATE usuarios SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING id`,
      [passwordHash, userId],
    );
  }

  cambiarEstado(userId, activo) {
    return this.db.unaFila(
      `UPDATE usuarios SET activo = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, username, nombre_completo, email, activo`,
      [activo, userId],
    );
  }
}

module.exports = AuthRepository;
