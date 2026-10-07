/**
 * Logica de autenticacion: login, renovacion y cierre de sesion.
 *
 * Lo que antes hacia AuthService.verifyToken (verificar firma + cuatro consultas)
 * ya no vive aca: es core/security/jwt + core/security/sessions, que corren en el
 * middleware sin pasar por HTTP.
 */

const bcrypt = require('bcryptjs');
const jwtHelper = require('../../core/security/jwt');
const sesiones = require('../../core/security/sessions');
const { errores } = require('../../core/errors');
const { config } = require('../../core/config');
const { ipDeRequest } = require('../auditoria/service');

const COSTO_BCRYPT = 12;

// Hash de una clave que nadie conoce, con el mismo costo que los reales: cuando el
// usuario no existe se compara contra este para que la respuesta tarde lo mismo que con
// una clave incorrecta, y el tiempo no delate que cuentas existen (BE-007).
const HASH_FALSO = bcrypt.hashSync('clave-que-no-pertenece-a-nadie', COSTO_BCRYPT);
const DIAS_REFRESH = 7;

class AuthService {
  constructor(repositorio, auditoria, logger) {
    this.repo = repositorio;
    this.auditoria = auditoria;
    this.logger = logger;
  }

  /**
   * Autentica y abre sesion.
   *
   * @throws {AppError} 401 con credenciales invalidas, 403 si el usuario esta inactivo.
   */
  async login(username, password, req) {
    const ip = ipDeRequest(req);
    const usuario = await this.repo.porUsername(typeof username === 'string' ? username.trim() : username);

    if (!usuario) {
      await bcrypt.compare(password, HASH_FALSO);
      await this.auditoria.registrar({
        usuario_username: username,
        operacion: 'LOGIN_FALLIDO',
        entidad: 'SESION',
        detalles: `Intento de login fallido: usuario '${username}' no encontrado`,
        ip_address: ip,
      });
      // Mismo mensaje que para contrasena incorrecta: distinguirlos permitiria
      // enumerar usuarios validos.
      throw errores.noAutenticado('Credenciales invalidas');
    }

    if (!usuario.activo) {
      await this.auditoria.registrar({
        usuario_id: usuario.id,
        usuario_nombre: usuario.nombre_completo,
        usuario_username: usuario.username,
        operacion: 'LOGIN_FALLIDO',
        entidad: 'SESION',
        entidad_id: usuario.id,
        detalles: 'Intento de login fallido: usuario inactivo',
        ip_address: ip,
      });
      throw errores.sinPermiso('Usuario inactivo');
    }

    const passwordValida = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValida) {
      await this.auditoria.registrar({
        usuario_id: usuario.id,
        usuario_nombre: usuario.nombre_completo,
        usuario_username: usuario.username,
        operacion: 'LOGIN_FALLIDO',
        entidad: 'SESION',
        entidad_id: usuario.id,
        detalles: 'Intento de login fallido: contrasena incorrecta',
        ip_address: ip,
      });
      throw errores.noAutenticado('Credenciales invalidas');
    }

    const tokens = await this.abrirSesion(usuario);

    await this.auditoria.registrar({
      usuario_id: usuario.id,
      usuario_nombre: usuario.nombre_completo,
      usuario_username: usuario.username,
      operacion: 'LOGIN',
      entidad: 'SESION',
      entidad_id: usuario.id,
      detalles: `Login exitoso. Rol: ${usuario.rol_nombre}`,
      ip_address: ip,
    });

    return {
      user: {
        id: usuario.id,
        username: usuario.username,
        nombre_completo: usuario.nombre_completo,
        email: usuario.email,
        rol: usuario.rol_nombre,
        rol_descripcion: usuario.rol_descripcion,
        permisos: usuario.permisos || [],
      },
      ...tokens,
    };
  }

  /** Emite los tokens y persiste la sesion. Invalida en cache la sesion anterior. */
  async abrirSesion(usuario) {
    const { token, jti } = jwtHelper.firmar(usuario);
    const refreshToken = jwtHelper.nuevoRefreshToken();

    const expiraRefresh = new Date();
    expiraRefresh.setDate(expiraRefresh.getDate() + DIAS_REFRESH);

    // Se persiste el hash, nunca el valor crudo: una fuga de la tabla no equivale a
    // fugar credenciales activas. El cliente sigue recibiendo el valor crudo.
    await this.repo.abrirSesion({
      userId: usuario.id,
      jti,
      refreshToken: jwtHelper.hashRefreshToken(refreshToken),
      expiraRefresh,
    });

    // Solo hay una sesion por usuario: la anterior deja de valer en el mismo instante
    // en que se abre esta, tambien en la cache en memoria.
    sesiones.invalidarUsuario(usuario.id);

    return { accessToken: token, refreshToken, expiresIn: config.jwt.expiracion };
  }

  /**
   * Renueva la sesion consumiendo un refresh token (de un solo uso).
   *
   * @throws {AppError} 401 si el refresh token no es valido o vencio.
   */
  async renovar(refreshToken, req) {
    const usuario = await this.repo.porRefreshToken(jwtHelper.hashRefreshToken(refreshToken));

    if (!usuario) throw errores.noAutenticado('Refresh token invalido o expirado');
    if (!usuario.activo) throw errores.sinPermiso('Usuario inactivo');

    // abrirSesion() borra todos los refresh tokens del usuario -incluido este- antes
    // de guardar el nuevo: no hace falta un borrado puntual aparte.
    const tokens = await this.abrirSesion(usuario);

    // Reemplaza la sesion anterior igual que un login (ver abrirSesion) -- sin este
    // evento, esa vuelta a autenticarse quedaba invisible para auditoria (BE-016).
    await this.auditoria.registrar({
      usuario_id: usuario.id,
      usuario_nombre: usuario.nombre_completo,
      usuario_username: usuario.username,
      operacion: 'REFRESH',
      entidad: 'SESION',
      entidad_id: usuario.id,
      detalles: 'Sesion renovada via refresh token',
      ip_address: ipDeRequest(req),
    });

    return {
      user: {
        id: usuario.id,
        username: usuario.username,
        nombre_completo: usuario.nombre_completo,
        email: usuario.email,
        rol: usuario.rol_nombre,
      },
      ...tokens,
    };
  }

  /**
   * Cierra la sesion. No falla nunca: si el token es ilegible o la base no responde,
   * el cliente igual debe poder desloguearse. La ruta no pasa por requireAuth a
   * proposito -una sesion ya vencida tiene que poder cerrarse-, pero el token igual
   * tiene que tener una firma valida: sin esto, cualquiera podia forjar un JWT con el
   * id de otro usuario y forzarle el cierre de sesion (ver specs/G3-sesion-jwt).
   */
  async logout(token, req) {
    try {
      const claims = jwtHelper.verificarIgnorandoExpiracion(token);
      if (!claims) return;

      await this.repo.cerrarSesion({
        jti: claims.jti,
        expira: claims.exp ? new Date(claims.exp * 1000) : new Date(Date.now() + 86_400_000),
        userId: claims.id,
      });

      sesiones.invalidar(claims.jti);
      if (claims.id) sesiones.invalidarUsuario(claims.id);

      if (claims.id) {
        await this.auditoria.registrar({
          usuario_id: claims.id,
          usuario_username: claims.username,
          operacion: 'LOGOUT',
          entidad: 'SESION',
          entidad_id: claims.id,
          detalles: 'Cierre de sesion',
          ip_address: ipDeRequest(req),
        });
      }
    } catch (error) {
      this.logger.warn('Error durante el logout, se responde exitoso igual', { error: error.message });
    }
  }

  /**
   * Datos del usuario con permisos y modulos. Alimenta GET /api/auth/me, que el
   * frontend usa para armar la navegacion.
   */
  async perfilCompleto(userId) {
    const fila = await this.repo.conPermisos(userId);
    if (!fila) throw errores.noEncontrado('Usuario no encontrado');

    return {
      id: fila.id,
      username: fila.username,
      nombre_completo: fila.nombre_completo,
      email: fila.email,
      rol: fila.rol_nombre,
      rol_descripcion: fila.rol_descripcion,
      permisos: fila.permisos || [],
      modulos_disponibles: [...new Set(fila.modulos || [])].filter(Boolean),
    };
  }

  /** Borra tokens vencidos. La corre una tarea periodica, no el camino del usuario. */
  async purgarTokensVencidos() {
    const { blacklist, refresh } = await this.repo.purgarVencidos();
    if (blacklist + refresh > 0) {
      this.logger.info('Tokens vencidos purgados', { blacklist, refresh });
    }
  }
}

module.exports = { AuthService, COSTO_BCRYPT };
