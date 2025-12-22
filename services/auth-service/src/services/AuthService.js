const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class AuthService {
  constructor(database) {
    this.db = database;
    this.jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key';
    this.jwtExpiration = process.env.JWT_EXPIRATION || '24h';
    this.refreshTokenExpiration = process.env.REFRESH_TOKEN_EXPIRATION || '7d';
  }

  /**
   * Inicializar usuarios por defecto
   */
  async initializeDefaultUsers() {
    const client = await this.db.getConnection();
    
    try {
      // Crear tabla de usuarios si no existe
      await client.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          nombre_completo VARCHAR(100) NOT NULL,
          email VARCHAR(100),
          rol VARCHAR(20) DEFAULT 'encargado' CHECK (rol IN ('admin', 'encargado')),
          activo BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Crear tabla de refresh tokens
      await client.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
          token VARCHAR(255) UNIQUE NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Crear tabla de tokens blacklist
      await client.query(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
          id SERIAL PRIMARY KEY,
          token_jti VARCHAR(255) UNIQUE NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Verificar si ya existe el usuario admin
      const adminExists = await client.query(
        'SELECT id FROM usuarios WHERE username = $1',
        ['admin']
      );

      if (adminExists.rows.length === 0) {
        // Crear usuario administrador por defecto
        const adminPassword = await bcrypt.hash('admin123', 12);
        
        await client.query(`
          INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          'admin',
          adminPassword,
          'Administrador del Sistema',
          'admin@electoral.gov.ar',
          'admin'
        ]);

        console.log('✅ Usuario administrador creado: admin/admin123');
      }

      // Crear algunos encargados de ejemplo
      const encargadosEjemplo = [
        {
          username: 'encargado1',
          password: 'enc123',
          nombre: 'Juan Pérez',
          email: 'juan.perez@electoral.gov.ar'
        },
        {
          username: 'encargado2',
          password: 'enc123',
          nombre: 'María González',
          email: 'maria.gonzalez@electoral.gov.ar'
        }
      ];

      for (const encargado of encargadosEjemplo) {
        const exists = await client.query(
          'SELECT id FROM usuarios WHERE username = $1',
          [encargado.username]
        );

        if (exists.rows.length === 0) {
          const hashedPassword = await bcrypt.hash(encargado.password, 12);
          
          await client.query(`
            INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            encargado.username,
            hashedPassword,
            encargado.nombre,
            encargado.email,
            'encargado'
          ]);
        }
      }

    } finally {
      client.release();
    }
  }

  /**
   * Autenticar usuario
   */
  async login(username, password) {
    const client = await this.db.getConnection();
    
    try {
      // Buscar usuario
      const userResult = await client.query(
        'SELECT id, username, password_hash, nombre_completo, email, rol, activo FROM usuarios WHERE username = $1',
        [username]
      );

      if (userResult.rows.length === 0) {
        throw new Error('Credenciales inválidas');
      }

      const user = userResult.rows[0];

      if (!user.activo) {
        throw new Error('Usuario inactivo');
      }

      // Verificar contraseña
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        throw new Error('Credenciales inválidas');
      }

      // Generar tokens
      const tokens = await this.generateTokens(user);

      return {
        user: {
          id: user.id,
          username: user.username,
          nombre_completo: user.nombre_completo,
          email: user.email,
          rol: user.rol
        },
        ...tokens
      };

    } finally {
      client.release();
    }
  }

  /**
   * Generar JWT y refresh token
   */
  async generateTokens(user) {
    const jti = crypto.randomUUID();
    
    // JWT token
    const accessToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
        rol: user.rol,
        jti
      },
      this.jwtSecret,
      {
        expiresIn: this.jwtExpiration,
        issuer: 'auth-service',
        audience: 'electoral-system'
      }
    );

    // Refresh token
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshExpires = new Date();
    refreshExpires.setDate(refreshExpires.getDate() + 7); // 7 días

    // Guardar refresh token
    const client = await this.db.getConnection();
    try {
      await client.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, refreshExpires]
      );
    } finally {
      client.release();
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwtExpiration
    };
  }

  /**
   * Verificar token JWT
   */
  async verifyToken(token) {
    try {
      // Verificar JWT
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'auth-service',
        audience: 'electoral-system'
      });

      // Verificar si el token está en blacklist
      const client = await this.db.getConnection();
      try {
        const blacklistResult = await client.query(
          'SELECT id FROM token_blacklist WHERE token_jti = $1',
          [decoded.jti]
        );

        if (blacklistResult.rows.length > 0) {
          throw new Error('Token revocado');
        }

        // Obtener datos actuales del usuario
        const userResult = await client.query(
          'SELECT id, username, nombre_completo, email, rol, activo FROM usuarios WHERE id = $1',
          [decoded.id]
        );

        if (userResult.rows.length === 0 || !userResult.rows[0].activo) {
          throw new Error('Usuario no válido o inactivo');
        }

        return userResult.rows[0];

      } finally {
        client.release();
      }

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Token inválido');
      }
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token expirado');
      }
      throw error;
    }
  }

  /**
   * Renovar token usando refresh token
   */
  async refreshToken(refreshToken) {
    const client = await this.db.getConnection();
    
    try {
      // Verificar refresh token
      const tokenResult = await client.query(`
        SELECT rt.user_id, u.username, u.nombre_completo, u.email, u.rol, u.activo
        FROM refresh_tokens rt
        JOIN usuarios u ON rt.user_id = u.id
        WHERE rt.token = $1 AND rt.expires_at > CURRENT_TIMESTAMP
      `, [refreshToken]);

      if (tokenResult.rows.length === 0) {
        throw new Error('Refresh token inválido o expirado');
      }

      const user = tokenResult.rows[0];

      if (!user.activo) {
        throw new Error('Usuario inactivo');
      }

      // Eliminar el refresh token usado
      await client.query(
        'DELETE FROM refresh_tokens WHERE token = $1',
        [refreshToken]
      );

      // Generar nuevos tokens
      const tokens = await this.generateTokens(user);

      return {
        user: {
          id: user.user_id,
          username: user.username,
          nombre_completo: user.nombre_completo,
          email: user.email,
          rol: user.rol
        },
        ...tokens
      };

    } finally {
      client.release();
    }
  }

  /**
   * Cerrar sesión (blacklist token)
   */
  async logout(token) {
    try {
      const decoded = jwt.decode(token);
      
      if (decoded?.jti) {
        const client = await this.db.getConnection();
        try {
          // Agregar token a blacklist
          const expires = new Date(decoded.exp * 1000);
          
          await client.query(
            'INSERT INTO token_blacklist (token_jti, expires_at) VALUES ($1, $2) ON CONFLICT (token_jti) DO NOTHING',
            [decoded.jti, expires]
          );

          // Limpiar tokens expirados de blacklist
          await client.query(
            'DELETE FROM token_blacklist WHERE expires_at < CURRENT_TIMESTAMP'
          );

          // Eliminar refresh tokens del usuario
          if (decoded.id) {
            await client.query(
              'DELETE FROM refresh_tokens WHERE user_id = $1',
              [decoded.id]
            );
          }

        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.error('Error en logout:', error);
      // No lanzar error para que el logout siempre sea exitoso
    }
  }
}

module.exports = AuthService;