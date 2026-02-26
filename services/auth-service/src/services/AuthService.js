const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class AuthService {
  constructor(database) {
    this.db = database;
    this.jwtSecret = process.env.JWT_SECRET;
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    this.jwtExpiration = process.env.JWT_EXPIRATION || '24h';
    this.refreshTokenExpiration = process.env.REFRESH_TOKEN_EXPIRATION || '7d';
  }

  /**
   * Inicializar usuarios por defecto
   */
  async initializeDefaultUsers() {
    const client = await this.db.getConnection();
    
    try {
      // Crear tabla de roles
      await client.query(`
        CREATE TABLE IF NOT EXISTS roles (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(50) UNIQUE NOT NULL,
          descripcion TEXT,
          activo BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Crear tabla de permisos
      await client.query(`
        CREATE TABLE IF NOT EXISTS permisos (
          id SERIAL PRIMARY KEY,
          codigo VARCHAR(50) UNIQUE NOT NULL,
          nombre VARCHAR(100) NOT NULL,
          descripcion TEXT,
          modulo VARCHAR(50) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Crear tabla de relación roles-permisos
      await client.query(`
        CREATE TABLE IF NOT EXISTS rol_permisos (
          id SERIAL PRIMARY KEY,
          rol_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
          permiso_id INTEGER REFERENCES permisos(id) ON DELETE CASCADE,
          UNIQUE(rol_id, permiso_id)
        );
      `);

      // Actualizar tabla de usuarios para usar roles
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='rol_id') THEN
            ALTER TABLE usuarios ADD COLUMN rol_id INTEGER REFERENCES roles(id);
            UPDATE usuarios SET rol_id = 1 WHERE rol = 'admin';
            UPDATE usuarios SET rol_id = 2 WHERE rol = 'encargado';
            ALTER TABLE usuarios DROP COLUMN IF EXISTS rol;
          END IF;
        END $$;
      `);

      // Crear tabla de usuarios actualizada si no existe
      await client.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          nombre_completo VARCHAR(100) NOT NULL,
          email VARCHAR(100),
          rol_id INTEGER REFERENCES roles(id),
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

      // Inicializar roles por defecto
      await this.initializeDefaultRoles(client);
      
      // Inicializar permisos por defecto
      await this.initializeDefaultPermissions(client);
      
      // Asignar permisos a roles
      await this.assignDefaultRolePermissions(client);

      // Verificar si ya existe el usuario admin
      const adminExists = await client.query(
        'SELECT id FROM usuarios WHERE username = $1',
        ['admin']
      );

      if (adminExists.rows.length === 0) {
        // Obtener rol de administrador
        const adminRol = await client.query('SELECT id FROM roles WHERE nombre = $1', ['administrador']);
        const adminRolId = adminRol.rows[0]?.id || 1;
        
        // Crear usuario administrador por defecto
        const adminPassword = await bcrypt.hash('admin123', 12);
        
        await client.query(`
          INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          'admin',
          adminPassword,
          'Administrador del Sistema',
          'admin@electoral.gov.ar',
          adminRolId
        ]);

        console.log('✅ Usuario administrador creado');
      }

      // Crear usuarios de ejemplo con diferentes roles
      const usuariosEjemplo = [
        {
          username: 'consultor1',
          password: 'consultor123',
          nombre: 'Ana Rodríguez',
          email: 'ana.rodriguez@electoral.gov.ar',
          rol: 'consultor'
        },
        {
          username: 'encargado1',
          password: 'encargado123',
          nombre: 'Juan Pérez',
          email: 'juan.perez@electoral.gov.ar',
          rol: 'encargado_relevamiento'
        },
        {
          username: 'encargado2',
          password: 'encargado123',
          nombre: 'María González',
          email: 'maria.gonzalez@electoral.gov.ar',
          rol: 'encargado_relevamiento'
        }
      ];

      for (const usuario of usuariosEjemplo) {
        const exists = await client.query(
          'SELECT id FROM usuarios WHERE username = $1',
          [usuario.username]
        );

        if (exists.rows.length === 0) {
          // Obtener rol
          const rol = await client.query('SELECT id FROM roles WHERE nombre = $1', [usuario.rol]);
          const rolId = rol.rows[0]?.id;
          
          if (rolId) {
            const hashedPassword = await bcrypt.hash(usuario.password, 12);
            
            await client.query(`
              INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
              VALUES ($1, $2, $3, $4, $5)
            `, [
              usuario.username,
              hashedPassword,
              usuario.nombre,
              usuario.email,
              rolId
            ]);
            
            console.log(`✅ Usuario ${usuario.rol} creado: ${usuario.username}`);
          }
        }
      }

    } finally {
      client.release();
    }
  }

  /**
   * Inicializar roles por defecto
   */
  async initializeDefaultRoles(client) {
    const roles = [
      { nombre: 'administrador', descripcion: 'Acceso completo al sistema electoral' },
      { nombre: 'consultor', descripcion: 'Acceso de solo lectura a estadísticas y resultados' },
      { nombre: 'encargado_relevamiento', descripcion: 'Acceso a gestión del padrón electoral' }
    ];

    for (const rol of roles) {
      const exists = await client.query('SELECT id FROM roles WHERE nombre = $1', [rol.nombre]);
      
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO roles (nombre, descripcion) VALUES ($1, $2)',
          [rol.nombre, rol.descripcion]
        );
        console.log(`✅ Rol creado: ${rol.nombre}`);
      }
    }
  }

  /**
   * Inicializar permisos por defecto
   */
  async initializeDefaultPermissions(client) {
    const permisos = [
      // Permisos del Dashboard
      { codigo: 'dashboard.view', nombre: 'Ver Dashboard', descripcion: 'Acceso al panel principal', modulo: 'dashboard' },
      
      // Permisos del Padrón
      { codigo: 'padron.view', nombre: 'Ver Padrón', descripcion: 'Consultar padrón electoral', modulo: 'padron' },
      { codigo: 'padron.edit', nombre: 'Editar Padrón', descripcion: 'Modificar datos del padrón', modulo: 'padron' },
      { codigo: 'padron.relevamiento', nombre: 'Relevamiento', descripcion: 'Realizar relevamientos del padrón', modulo: 'padron' },
      { codigo: 'padron.export', nombre: 'Exportar Padrón', descripcion: 'Exportar datos del padrón', modulo: 'padron' },
      
      // Permisos de Resultados/Estadísticas
      { codigo: 'resultados.view', nombre: 'Ver Resultados', descripcion: 'Consultar estadísticas y resultados', modulo: 'resultados' },
      { codigo: 'resultados.export', nombre: 'Exportar Resultados', descripcion: 'Exportar reportes estadísticos', modulo: 'resultados' },
      
      // Permisos de Fiscales (futuro)
      { codigo: 'fiscales.view', nombre: 'Ver Fiscales', descripcion: 'Consultar fiscales de mesa', modulo: 'fiscales' },
      { codigo: 'fiscales.edit', nombre: 'Gestionar Fiscales', descripcion: 'Administrar fiscales de mesa', modulo: 'fiscales' },
      
      // Permisos de Comicio (futuro)
      { codigo: 'comicio.view', nombre: 'Ver Comicio', descripcion: 'Consultar lugares de votación', modulo: 'comicio' },
      { codigo: 'comicio.edit', nombre: 'Gestionar Comicio', descripcion: 'Administrar lugares de votación', modulo: 'comicio' },
      
      // Permisos de Administración
      { codigo: 'admin.users', nombre: 'Gestión de Usuarios', descripcion: 'Administrar usuarios del sistema', modulo: 'admin' },
      { codigo: 'admin.roles', nombre: 'Gestión de Roles', descripcion: 'Administrar roles y permisos', modulo: 'admin' },
      { codigo: 'admin.system', nombre: 'Configuración Sistema', descripcion: 'Configurar parámetros del sistema', modulo: 'admin' }
    ];

    for (const permiso of permisos) {
      const exists = await client.query('SELECT id FROM permisos WHERE codigo = $1', [permiso.codigo]);
      
      if (exists.rows.length === 0) {
        await client.query(
          'INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES ($1, $2, $3, $4)',
          [permiso.codigo, permiso.nombre, permiso.descripcion, permiso.modulo]
        );
      }
    }
    console.log('✅ Permisos inicializados correctamente');
  }

  /**
   * Asignar permisos por defecto a roles
   */
  async assignDefaultRolePermissions(client) {
    // Obtener roles
    const roles = await client.query('SELECT id, nombre FROM roles');
    const roleMap = {};
    roles.rows.forEach(role => roleMap[role.nombre] = role.id);

    // Obtener permisos
    const permisos = await client.query('SELECT id, codigo FROM permisos');
    const permisosMap = {};
    permisos.rows.forEach(permiso => permisosMap[permiso.codigo] = permiso.id);

    // Definir asignaciones de permisos por rol
    const asignaciones = {
      'administrador': Object.values(permisosMap), // Todos los permisos
      'consultor': [
        permisosMap['dashboard.view'],
        permisosMap['resultados.view'],
        permisosMap['resultados.export']
      ],
      'encargado_relevamiento': [
        permisosMap['dashboard.view'],
        permisosMap['padron.view'],
        permisosMap['padron.edit'],
        permisosMap['padron.relevamiento'],
        permisosMap['padron.export']
      ]
    };

    // Asignar permisos a cada rol
    for (const [rolNombre, permisosIds] of Object.entries(asignaciones)) {
      const rolId = roleMap[rolNombre];
      if (!rolId) continue;

      for (const permisoId of permisosIds) {
        if (!permisoId) continue;

        // Verificar si ya existe la asignación
        const exists = await client.query(
          'SELECT id FROM rol_permisos WHERE rol_id = $1 AND permiso_id = $2',
          [rolId, permisoId]
        );

        if (exists.rows.length === 0) {
          await client.query(
            'INSERT INTO rol_permisos (rol_id, permiso_id) VALUES ($1, $2)',
            [rolId, permisoId]
          );
        }
      }
      console.log(`✅ Permisos asignados al rol: ${rolNombre}`);
    }
  }

  /**
   * Autenticar usuario
   */
  async login(username, password) {
    const client = await this.db.getConnection();
    
    try {
      // Buscar usuario con rol y permisos
      const userResult = await client.query(`
        SELECT 
          u.id, u.username, u.password_hash, u.nombre_completo, u.email, u.activo,
          r.nombre as rol_nombre, r.descripcion as rol_descripcion,
          ARRAY_AGG(p.nombre) FILTER (WHERE p.nombre IS NOT NULL) as permisos
        FROM usuarios u
        LEFT JOIN roles r ON u.rol_id = r.id
        LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
        LEFT JOIN permisos p ON rp.permiso_id = p.id
        WHERE u.username = $1
        GROUP BY u.id, u.username, u.password_hash, u.nombre_completo, u.email, u.activo, r.nombre, r.descripcion
      `, [username]);

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
          rol: user.rol_nombre,
          rol_descripcion: user.rol_descripcion,
          permisos: user.permisos || []
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
        rol: user.rol_nombre || user.rol,
        permisos: user.permisos || [],
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
          `SELECT u.id, u.username, u.nombre_completo, u.email, r.nombre as rol, u.activo
           FROM usuarios u
           LEFT JOIN roles r ON u.rol_id = r.id
           WHERE u.id = $1`,
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
        SELECT rt.user_id, u.username, u.nombre_completo, u.email, r.nombre as rol, u.activo
        FROM refresh_tokens rt
        JOIN usuarios u ON rt.user_id = u.id
        LEFT JOIN roles r ON u.rol_id = r.id
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

  /**
   * Obtener usuario con información completa de roles y permisos
   */
  async getUserWithPermissions(userId) {
    const client = await this.db.getConnection();
    
    try {
      const result = await client.query(`
        SELECT 
          u.id, u.username, u.nombre_completo, u.email, u.activo,
          r.nombre as rol_nombre, r.descripcion as rol_descripcion,
          ARRAY_AGG(p.codigo) FILTER (WHERE p.codigo IS NOT NULL) as permisos,
          ARRAY_AGG(p.modulo) FILTER (WHERE p.modulo IS NOT NULL) as modulos
        FROM usuarios u
        LEFT JOIN roles r ON u.rol_id = r.id
        LEFT JOIN rol_permisos rp ON r.id = rp.rol_id
        LEFT JOIN permisos p ON rp.permiso_id = p.id
        WHERE u.id = $1 AND u.activo = true
        GROUP BY u.id, u.username, u.nombre_completo, u.email, u.activo, r.nombre, r.descripcion
      `, [userId]);

      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      const user = result.rows[0];
      
      return {
        id: user.id,
        username: user.username,
        nombre_completo: user.nombre_completo,
        email: user.email,
        rol: user.rol_nombre,
        rol_descripcion: user.rol_descripcion,
        permisos: user.permisos || [],
        modulos_disponibles: [...new Set(user.modulos || [])].filter(Boolean)
      };
      
    } finally {
      client.release();
    }
  }

  /**
   * Verificar si un usuario tiene un permiso específico
   */
  async hasPermission(userId, permissionCode) {
    const client = await this.db.getConnection();
    
    try {
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM usuarios u
        JOIN roles r ON u.rol_id = r.id
        JOIN rol_permisos rp ON r.id = rp.rol_id
        JOIN permisos p ON rp.permiso_id = p.id
        WHERE u.id = $1 AND p.codigo = $2 AND u.activo = true AND r.activo = true
      `, [userId, permissionCode]);

      return parseInt(result.rows[0].count) > 0;
      
    } finally {
      client.release();
    }
  }
}

module.exports = AuthService;