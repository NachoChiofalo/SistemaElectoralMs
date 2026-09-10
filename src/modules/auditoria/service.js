/**
 * Registro y consulta de auditoria.
 *
 * Lo consumen tanto el modulo auth (eventos de sesion) como el modulo padron
 * (altas y modificaciones de votantes y relevamientos).
 */

class AuditoriaService {
  constructor(repositorio, logger) {
    this.repo = repositorio;
    this.logger = logger;
  }

  /**
   * Registra un evento. Nunca lanza: un fallo al auditar no debe voltear la operacion
   * que se estaba auditando. Si falla, queda en el log del proceso.
   */
  async registrar(evento) {
    try {
      await this.repo.insertar(evento);
    } catch (error) {
      this.logger.error('No se pudo registrar el evento de auditoria', {
        operacion: evento.operacion,
        entidad: evento.entidad,
        error: error.message,
      });
    }
  }

  /**
   * Registra un evento tomando el usuario y la IP de la request.
   * Es la forma habitual de llamar desde una ruta.
   */
  async registrarDeRequest(req, { operacion, entidad, entidad_id, datos_anteriores, datos_nuevos, detalles }) {
    const usuario = req.user || {};

    return this.registrar({
      usuario_id: usuario.id ?? 0,
      usuario_nombre: usuario.nombre_completo || 'Sistema',
      usuario_username: usuario.username || 'sistema',
      operacion,
      entidad,
      entidad_id,
      datos_anteriores,
      datos_nuevos,
      detalles,
      ip_address: ipDeRequest(req),
    });
  }

  consultar(filtros) {
    return this.repo.listar(filtros);
  }

  estadisticas(filtros) {
    return this.repo.estadisticas(filtros);
  }

  porId(id) {
    return this.repo.porId(id);
  }
}

/**
 * IP real del cliente. Con 'trust proxy' configurado, req.ip ya la resuelve; el
 * fallback cubre las llamadas donde no hay objeto request completo de Express.
 */
function ipDeRequest(req) {
  if (req.ip) return req.ip;
  const reenviada = req.headers?.['x-forwarded-for'];
  if (reenviada) return String(reenviada).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = { AuditoriaService, ipDeRequest };
