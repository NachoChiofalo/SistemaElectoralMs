/**
 * Gestion de usuarios: perfil propio y ABM para administradores.
 *
 * Cada operacion que cambia rol, estado o contrasena invalida la cache de sesion del
 * usuario afectado, para que el cambio tenga efecto en el proximo request y no dentro
 * de un TTL.
 */

const bcrypt = require('bcryptjs');
const sesiones = require('../../core/security/sessions');
const { errores } = require('../../core/errors');
const { COSTO_BCRYPT } = require('./service');

// El formulario del web-admin valida 6 (UsuariosComponent.js:444). Subir el minimo del
// lado del servidor sin tocar el cliente produciria un rechazo que el usuario no puede
// anticipar, asi que se mantiene alineado. Conviene subirlo en ambos lados a la vez.
const LARGO_MINIMO_PASSWORD = 6;

class UsersService {
  constructor(repositorio, auditoria) {
    this.repo = repositorio;
    this.auditoria = auditoria;
  }

  async porId(userId) {
    const usuario = await this.repo.porId(userId);
    if (!usuario) throw errores.noEncontrado('Usuario no encontrado');
    return usuario;
  }

  todos() {
    return this.repo.todos();
  }

  roles() {
    return this.repo.roles();
  }

  async actualizarPerfil(userId, datos) {
    const usuario = await this.repo.actualizarPerfil(userId, datos);
    if (!usuario) throw errores.noEncontrado('Usuario no encontrado');
    return usuario;
  }

  async crear({ username, password, nombre_completo, email, rol }, req) {
    validarPassword(password);

    if (await this.repo.existeUsername(username)) {
      throw errores.conflicto('El username ya existe');
    }

    const rolFila = await this.repo.rolPorNombre(rol);
    if (!rolFila) throw errores.solicitudInvalida(`El rol '${rol}' no existe`);

    const nuevo = await this.repo.crearUsuario({
      username,
      passwordHash: await bcrypt.hash(password, COSTO_BCRYPT),
      nombre_completo,
      email,
      rolId: rolFila.id,
    });

    nuevo.rol = rol;

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'USUARIO',
      entidad_id: nuevo.id,
      datos_nuevos: { username, nombre_completo, email, rol },
      detalles: `Usuario '${username}' creado con rol ${rol}`,
    });

    return nuevo;
  }

  async actualizar(userId, { nombre_completo, email, rol, activo }, req) {
    const previo = await this.repo.porId(userId);
    if (!previo) throw errores.noEncontrado('Usuario no encontrado');

    let rolId;
    if (rol) {
      const rolFila = await this.repo.rolPorNombre(rol);
      if (!rolFila) throw errores.solicitudInvalida(`El rol '${rol}' no existe`);
      rolId = rolFila.id;
    }

    const actualizado = await this.repo.actualizarUsuario(userId, { nombre_completo, email, rolId, activo });
    if (!actualizado) throw errores.noEncontrado('Usuario no encontrado');

    // El rol viaja dentro del token: hasta que el usuario renueve sesion seguiria con
    // los permisos viejos. Invalidar la cache fuerza la revalidacion inmediata.
    sesiones.invalidarUsuario(userId);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'MODIFICAR',
      entidad: 'USUARIO',
      entidad_id: userId,
      datos_anteriores: { nombre_completo: previo.nombre_completo, email: previo.email, rol: previo.rol, activo: previo.activo },
      datos_nuevos: { nombre_completo, email, rol, activo },
      detalles: `Usuario '${previo.username}' modificado`,
    });

    return actualizado;
  }

  async cambiarEstado(userId, activo, req) {
    const usuario = await this.repo.cambiarEstado(userId, activo);
    if (!usuario) throw errores.noEncontrado('Usuario no encontrado');

    // Desactivar a alguien tiene que echarlo ya, no cuando venza su token.
    sesiones.invalidarUsuario(userId);

    await this.auditoria.registrarDeRequest(req, {
      operacion: activo ? 'ACTIVAR' : 'DESACTIVAR',
      entidad: 'USUARIO',
      entidad_id: userId,
      datos_nuevos: { activo },
      detalles: `Usuario '${usuario.username}' ${activo ? 'activado' : 'desactivado'}`,
    });

    return usuario;
  }

  async cambiarPasswordPropia(userId, passwordActual, passwordNueva, req) {
    validarPassword(passwordNueva);

    const fila = await this.repo.hashPorId(userId);
    if (!fila) throw errores.noEncontrado('Usuario no encontrado');

    if (!await bcrypt.compare(passwordActual, fila.password_hash)) {
      throw errores.noAutenticado('Contrasena actual incorrecta');
    }

    await this.repo.cambiarPassword(userId, await bcrypt.hash(passwordNueva, COSTO_BCRYPT));
    sesiones.invalidarUsuario(userId);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'MODIFICAR',
      entidad: 'USUARIO',
      entidad_id: userId,
      detalles: 'Cambio de contrasena propio',
    });
  }

  async resetearPassword(userId, passwordNueva, req) {
    validarPassword(passwordNueva);

    const actualizado = await this.repo.cambiarPassword(userId, await bcrypt.hash(passwordNueva, COSTO_BCRYPT));
    if (!actualizado) throw errores.noEncontrado('Usuario no encontrado');

    sesiones.invalidarUsuario(userId);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'MODIFICAR',
      entidad: 'USUARIO',
      entidad_id: userId,
      detalles: 'Contrasena reseteada por un administrador',
    });
  }
}

function validarPassword(password) {
  if (!password || password.length < LARGO_MINIMO_PASSWORD) {
    throw errores.solicitudInvalida(`La contrasena debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
  }
}

module.exports = { UsersService, LARGO_MINIMO_PASSWORD };
