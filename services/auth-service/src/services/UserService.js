const bcrypt = require('bcryptjs');

class UserService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Obtener usuario por ID
   */
  async getUserById(userId) {
    const client = await this.db.getConnection();
    
    try {
      const result = await client.query(
        `SELECT u.id, u.username, u.nombre_completo, u.email, r.nombre as rol, u.activo, u.created_at
         FROM usuarios u
         LEFT JOIN roles r ON u.rol_id = r.id
         WHERE u.id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Obtener todos los usuarios
   */
  async getAllUsers() {
    const client = await this.db.getConnection();
    
    try {
      const result = await client.query(`
        SELECT u.id, u.username, u.nombre_completo, u.email, r.nombre as rol, u.activo, u.created_at
        FROM usuarios u
        LEFT JOIN roles r ON u.rol_id = r.id
        ORDER BY u.created_at DESC
      `);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Crear nuevo usuario
   */
  async createUser(userData) {
    const { username, password, nombre_completo, email, rol = 'encargado_relevamiento' } = userData;
    
    const client = await this.db.getConnection();
    
    try {
      // Verificar si el username ya existe
      const existingUser = await client.query(
        'SELECT id FROM usuarios WHERE username = $1',
        [username]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('El username ya existe');
      }

      // Hash de la contraseña
      const passwordHash = await bcrypt.hash(password, 12);

      // Obtener rol_id
      const rolResult = await client.query(
        'SELECT id FROM roles WHERE nombre = $1',
        [rol]
      );
      if (rolResult.rows.length === 0) {
        throw new Error(`El rol '${rol}' no existe`);
      }
      const rolId = rolResult.rows[0].id;

      // Insertar usuario
      const result = await client.query(`
        INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, username, nombre_completo, email, activo, created_at
      `, [username, passwordHash, nombre_completo, email, rolId]);

      const newUser = result.rows[0];
      newUser.rol = rol;

      return newUser;
    } finally {
      client.release();
    }
  }

  /**
   * Actualizar perfil de usuario
   */
  async updateProfile(userId, updateData) {
    const { nombre_completo, email } = updateData;
    
    const client = await this.db.getConnection();
    
    try {
      const result = await client.query(`
        UPDATE usuarios 
        SET nombre_completo = COALESCE($1, nombre_completo),
            email = COALESCE($2, email),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, username, nombre_completo, email, activo
      `, [nombre_completo, email, userId]);

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Cambiar contraseña
   */
  async changePassword(userId, currentPassword, newPassword) {
    const client = await this.db.getConnection();
    
    try {
      // Obtener usuario actual
      const userResult = await client.query(
        'SELECT password_hash FROM usuarios WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Verificar contraseña actual
      const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
      if (!isValidPassword) {
        throw new Error('Contraseña actual incorrecta');
      }

      // Hash nueva contraseña
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      // Actualizar contraseña
      await client.query(`
        UPDATE usuarios 
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [newPasswordHash, userId]);

    } finally {
      client.release();
    }
  }

  /**
   * Actualizar usuario completo (admin)
   */
  async updateUser(userId, userData) {
    const { nombre_completo, email, rol, activo } = userData;

    const client = await this.db.getConnection();

    try {
      // Si se cambió el rol, obtener el nuevo rol_id
      let rolId = undefined;
      if (rol) {
        const rolResult = await client.query(
          'SELECT id FROM roles WHERE nombre = $1',
          [rol]
        );
        if (rolResult.rows.length === 0) {
          throw new Error(`El rol '${rol}' no existe`);
        }
        rolId = rolResult.rows[0].id;
      }

      const result = await client.query(`
        UPDATE usuarios
        SET nombre_completo = COALESCE($1, nombre_completo),
            email = COALESCE($2, email),
            rol_id = COALESCE($3, rol_id),
            activo = COALESCE($4, activo),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING id, username, nombre_completo, email, activo, rol_id
      `, [nombre_completo, email, rolId, activo, userId]);

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      // Obtener el nombre del rol para la respuesta
      const user = result.rows[0];
      const roleResult = await client.query(
        'SELECT nombre FROM roles WHERE id = $1',
        [user.rol_id]
      );
      user.rol = roleResult.rows.length > 0 ? roleResult.rows[0].nombre : null;
      delete user.rol_id;

      return user;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener todos los roles disponibles
   */
  async getAllRoles() {
    const client = await this.db.getConnection();

    try {
      const result = await client.query(`
        SELECT id, nombre, descripcion
        FROM roles
        ORDER BY nombre
      `);
      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Resetear contraseña de un usuario (admin, sin requerir la actual)
   */
  async resetPassword(userId, newPassword) {
    const client = await this.db.getConnection();

    try {
      const userResult = await client.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      await client.query(`
        UPDATE usuarios
        SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [newPasswordHash, userId]);
    } finally {
      client.release();
    }
  }

  /**
   * Activar/desactivar usuario
   */
  async toggleUserStatus(userId, activo) {
    const client = await this.db.getConnection();
    
    try {
      const result = await client.query(`
        UPDATE usuarios 
        SET activo = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, username, nombre_completo, email, activo
      `, [activo, userId]);

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }
}

module.exports = UserService;