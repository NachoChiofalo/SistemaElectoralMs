const AuditoriaLog = require('../models/AuditoriaLog');

class AuditoriaService {
    constructor() {
        this.auditoriaLog = new AuditoriaLog();
    }

    async registrarOperacion(req, operacion, entidad, entidad_id, datos_anteriores, datos_nuevos, detalles) {
        try {
            const usuario = req.user || {};
            const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';

            await this.auditoriaLog.registrar({
                usuario_id: usuario.id || 0,
                usuario_nombre: usuario.nombre_completo || 'Sistema',
                usuario_username: usuario.username || 'sistema',
                operacion,
                entidad,
                entidad_id: entidad_id ? String(entidad_id) : null,
                datos_anteriores,
                datos_nuevos,
                detalles,
                ip_address: ip
            });
        } catch (error) {
            // No fallar la operacion principal por error de auditoria
            console.error('Error registrando auditoria:', error.message);
        }
    }

    async consultarAuditoria(filtros) {
        return await this.auditoriaLog.obtenerConFiltros(filtros);
    }

    async obtenerEstadisticas(filtros) {
        return await this.auditoriaLog.obtenerEstadisticas(filtros);
    }

    async obtenerPorId(id) {
        return await this.auditoriaLog.obtenerPorId(id);
    }
}

module.exports = AuditoriaService;
