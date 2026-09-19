/**
 * Reglas de negocio de fiscales y sus asignaciones a mesas por franja horaria.
 */

const { errores } = require('../../core/errors');

const HORA_APERTURA = '08:00';
const HORA_CIERRE = '18:00';
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function validarHora(valor, etiqueta) {
  if (typeof valor !== 'string' || !FORMATO_HORA.test(valor)) {
    throw errores.solicitudInvalida(`${etiqueta} tiene que tener formato HH:MM`);
  }
}

function validarFranja(desde, hasta) {
  validarHora(desde, 'desde');
  validarHora(hasta, 'hasta');
  if (desde < HORA_APERTURA || hasta > HORA_CIERRE) {
    throw errores.solicitudInvalida(`La franja tiene que estar entre ${HORA_APERTURA} y ${HORA_CIERRE}`);
  }
  if (hasta <= desde) {
    throw errores.solicitudInvalida('"hasta" tiene que ser posterior a "desde"');
  }
}

function validarDatosFiscal({ nombre }) {
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    throw errores.solicitudInvalida('El nombre del fiscal es obligatorio');
  }
}

class FiscalesService {
  constructor(repo, auditoria) {
    this.repo = repo;
    this.auditoria = auditoria;
  }

  // ---- Fiscales ----

  async crear(req, datos) {
    validarDatosFiscal(datos);
    const fiscal = await this.repo.crear(datos);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'fiscal',
      entidad_id: fiscal.id,
      datos_nuevos: fiscal,
    });

    return fiscal;
  }

  async porId(id) {
    return this.repo.porId(id);
  }

  async listar({ page = 1, limit = 25 } = {}) {
    return this.repo.listar({
      page: Math.max(Number(page) || 1, 1),
      limit: Math.min(Number(limit) || 25, 100),
    });
  }

  async actualizar(req, id, datos) {
    const existente = await this.repo.porId(id);
    if (!existente) throw errores.noEncontrado('Fiscal no encontrado');

    validarDatosFiscal(datos);
    const fiscal = await this.repo.actualizar(id, datos);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'fiscal',
      entidad_id: id,
      datos_anteriores: existente,
      datos_nuevos: fiscal,
    });

    return fiscal;
  }

  async eliminar(req, id) {
    const existente = await this.repo.porId(id);
    if (!existente) throw errores.noEncontrado('Fiscal no encontrado');

    await this.repo.eliminar(id);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'fiscal',
      entidad_id: id,
      datos_anteriores: existente,
    });
  }

  // ---- Asignaciones ----

  async crearAsignacion(req, mesaId, { fiscalId, desde, hasta }) {
    const mesa = await this.repo.mesa(mesaId);
    if (!mesa) throw errores.noEncontrado('Mesa no encontrada');

    const fiscal = await this.repo.porId(fiscalId);
    if (!fiscal) throw errores.noEncontrado('Fiscal no encontrado');

    validarFranja(desde, hasta);
    await this._validarSinSolapamiento(mesaId, fiscalId, desde, hasta, null);

    const asignacion = await this.repo.crearAsignacion({ mesaId, fiscalId, desde, hasta });

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'fiscal_asignacion',
      entidad_id: asignacion.id,
      datos_nuevos: asignacion,
    });

    return { ...asignacion, fiscal_nombre: fiscal.nombre };
  }

  async actualizarAsignacion(req, asignacionId, { fiscalId, desde, hasta }) {
    const existente = await this.repo.asignacionPorId(asignacionId);
    if (!existente) throw errores.noEncontrado('Asignación no encontrada');

    const fiscal = await this.repo.porId(fiscalId);
    if (!fiscal) throw errores.noEncontrado('Fiscal no encontrado');

    validarFranja(desde, hasta);
    await this._validarSinSolapamiento(existente.mesa_id, fiscalId, desde, hasta, asignacionId);

    const asignacion = await this.repo.actualizarAsignacion(asignacionId, { fiscalId, desde, hasta });

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'fiscal_asignacion',
      entidad_id: asignacionId,
      datos_anteriores: existente,
      datos_nuevos: asignacion,
    });

    return { ...asignacion, fiscal_nombre: fiscal.nombre };
  }

  async eliminarAsignacion(req, asignacionId) {
    const existente = await this.repo.asignacionPorId(asignacionId);
    if (!existente) throw errores.noEncontrado('Asignación no encontrada');

    await this.repo.eliminarAsignacion(asignacionId);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'fiscal_asignacion',
      entidad_id: asignacionId,
      datos_anteriores: existente,
    });
  }

  async asignacionesDeMesa(mesaId) {
    const mesa = await this.repo.mesa(mesaId);
    if (!mesa) throw errores.noEncontrado('Mesa no encontrada');
    return this.repo.asignacionesDeMesa(mesaId);
  }

  async _validarSinSolapamiento(mesaId, fiscalId, desde, hasta, excluirId) {
    const [porMesa, porFiscal] = await Promise.all([
      this.repo.solapaConMesa(mesaId, desde, hasta, excluirId),
      this.repo.solapaConFiscal(fiscalId, desde, hasta, excluirId),
    ]);

    if (porMesa.length > 0) {
      throw errores.conflicto(
        `Esta mesa ya tiene a ${porMesa[0].fiscal_nombre} asignado en ese horario`,
        { asignaciones: porMesa },
      );
    }
    if (porFiscal.length > 0) {
      throw errores.conflicto(
        `Este fiscal ya está asignado a la mesa ${porFiscal[0].mesa_numero} en ese horario`,
        { asignaciones: porFiscal },
      );
    }
  }

  // ---- Agenda ----

  async agendaDeComicio(comicioId, hora) {
    validarHora(hora, 'hora');
    return this.repo.agendaDeComicio(comicioId, hora);
  }
}

module.exports = { FiscalesService, HORA_APERTURA, HORA_CIERRE };
