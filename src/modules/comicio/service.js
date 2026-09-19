/**
 * Reglas de negocio de comicios, mesas y votos. No conoce req/res salvo para pasarlo a
 * auditoria (mismo patron que el resto de los modulos).
 */

const { errores } = require('../../core/errors');

const TIPOS_ELECCION = ['provincial', 'municipal', 'nacional'];

function validarDatosComicio({ nombre, tipoEleccion }) {
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    throw errores.solicitudInvalida('El nombre del comicio es obligatorio');
  }
  if (!TIPOS_ELECCION.includes(tipoEleccion)) {
    throw errores.solicitudInvalida(`tipoEleccion invalido: tiene que ser uno de ${TIPOS_ELECCION.join(', ')}`);
  }
}

/** true si a esta antes que b en el orden (apellido, nombre, dni). */
function antesQue(a, b) {
  if (a.apellido !== b.apellido) return a.apellido < b.apellido;
  if (a.nombre !== b.nombre) return a.nombre < b.nombre;
  return a.dni < b.dni;
}

class ComicioService {
  constructor(repo, auditoria) {
    this.repo = repo;
    this.auditoria = auditoria;
  }

  // ---- Comicios ----

  async crearComicio(req, datos, listaIds) {
    validarDatosComicio(datos);
    await this._validarListas(listaIds);

    const comicio = await this.repo.crearComicio(datos, listaIds);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'comicio',
      entidad_id: comicio.id,
      datos_nuevos: comicio,
    });

    return this.repo.porIdComicio(comicio.id);
  }

  async porIdComicio(id) {
    return this.repo.porIdComicio(id);
  }

  async listarComicios({ page = 1, limit = 25 } = {}) {
    return this.repo.listarComicios({
      page: Math.max(Number(page) || 1, 1),
      limit: Math.min(Number(limit) || 25, 100),
    });
  }

  async actualizarComicio(req, id, datos, listaIds) {
    const existente = await this.repo.porIdComicio(id);
    if (!existente) throw errores.noEncontrado('Comicio no encontrado');

    validarDatosComicio(datos);
    await this._validarListas(listaIds);

    await this.repo.actualizarComicio(id, datos, listaIds);
    const actualizado = await this.repo.porIdComicio(id);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'comicio',
      entidad_id: id,
      datos_anteriores: existente,
      datos_nuevos: actualizado,
    });

    return actualizado;
  }

  async eliminarComicio(req, id) {
    const existente = await this.repo.porIdComicio(id);
    if (!existente) throw errores.noEncontrado('Comicio no encontrado');

    await this.repo.eliminarComicio(id);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'comicio',
      entidad_id: id,
      datos_anteriores: existente,
    });
  }

  async _validarListas(listaIds) {
    if (!Array.isArray(listaIds) || listaIds.length === 0) {
      throw errores.solicitudInvalida('El comicio necesita al menos una lista participante');
    }
    const existentes = await this.repo.listasExistentes(listaIds);
    const faltantes = listaIds.filter((id) => !existentes.includes(id));
    if (faltantes.length > 0) {
      throw errores.solicitudInvalida(`Las listas ${faltantes.join(', ')} no existen`);
    }
  }

  // ---- Mesas ----

  async crearMesa(req, comicioId, { numero, desdeDni, hastaDni }) {
    const comicio = await this.repo.porIdComicio(comicioId);
    if (!comicio) throw errores.noEncontrado('Comicio no encontrado');

    const { desde, hasta } = await this._validarRango(comicioId, numero, desdeDni, hastaDni, null);

    const mesa = await this.repo.crearMesa(comicioId, { numero, desdeDni, hastaDni });
    const cantidadVotantes = await this.repo.contarVotantesEnRango(desde, hasta);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'mesa',
      entidad_id: mesa.id,
      datos_nuevos: mesa,
    });

    return { ...mesa, cantidad_votantes: cantidadVotantes };
  }

  async actualizarMesa(req, comicioId, mesaId, { numero, desdeDni, hastaDni }) {
    const existente = await this.repo.mesaPorId(mesaId);
    if (!existente || existente.comicio_id !== comicioId) throw errores.noEncontrado('Mesa no encontrada');

    const { desde, hasta } = await this._validarRango(comicioId, numero, desdeDni, hastaDni, mesaId);

    const mesa = await this.repo.actualizarMesa(mesaId, { numero, desdeDni, hastaDni });
    const cantidadVotantes = await this.repo.contarVotantesEnRango(desde, hasta);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'mesa',
      entidad_id: mesaId,
      datos_anteriores: existente,
      datos_nuevos: mesa,
    });

    return { ...mesa, cantidad_votantes: cantidadVotantes };
  }

  async eliminarMesa(req, comicioId, mesaId) {
    const existente = await this.repo.mesaPorId(mesaId);
    if (!existente || existente.comicio_id !== comicioId) throw errores.noEncontrado('Mesa no encontrada');

    await this.repo.eliminarMesa(mesaId);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'mesa',
      entidad_id: mesaId,
      datos_anteriores: existente,
    });
  }

  async _validarRango(comicioId, numero, desdeDni, hastaDni, excluirMesaId) {
    if (!Number.isInteger(numero) || numero <= 0) {
      throw errores.solicitudInvalida('El numero de mesa tiene que ser un entero positivo');
    }

    const [desde, hasta] = await Promise.all([this.repo.votante(desdeDni), this.repo.votante(hastaDni)]);
    if (!desde) throw errores.solicitudInvalida(`No existe un votante con DNI ${desdeDni}`);
    if (!hasta) throw errores.solicitudInvalida(`No existe un votante con DNI ${hastaDni}`);

    if (antesQue(hasta, desde)) {
      throw errores.solicitudInvalida('El DNI "hasta" no puede ir antes que el DNI "desde" en el orden del padrón');
    }

    const solapadas = await this.repo.mesasSolapadas(comicioId, desde, hasta, excluirMesaId);
    if (solapadas.length > 0) {
      throw errores.conflicto(
        `El rango se solapa con la mesa ${solapadas[0].numero}`,
        { mesas: solapadas },
      );
    }

    return { desde, hasta };
  }

  // ---- Votos ----

  async cargarVotos(req, comicioId, mesaId, { blancos, nulos, porLista }) {
    const mesa = await this.repo.mesaPorId(mesaId);
    if (!mesa || mesa.comicio_id !== comicioId) throw errores.noEncontrado('Mesa no encontrada');

    this._validarCantidad(blancos, 'blancos');
    this._validarCantidad(nulos, 'nulos');

    if (!Array.isArray(porLista)) throw errores.solicitudInvalida('porLista tiene que ser un array');

    const listasDelComicio = (await this.repo.listasDeComicio(comicioId)).map((l) => l.id);
    for (const voto of porLista) {
      if (!listasDelComicio.includes(voto.listaId)) {
        throw errores.solicitudInvalida(`La lista ${voto.listaId} no participa de este comicio`);
      }
      this._validarCantidad(voto.cantidad, `voto de la lista ${voto.listaId}`);
    }

    const resultado = await this.repo.reemplazarVotos(mesaId, { blancos, nulos, porLista });

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'votos_mesa',
      entidad_id: mesaId,
      datos_nuevos: resultado,
    });

    return resultado;
  }

  async votosDeMesa(comicioId, mesaId) {
    const mesa = await this.repo.mesaPorId(mesaId);
    if (!mesa || mesa.comicio_id !== comicioId) throw errores.noEncontrado('Mesa no encontrada');
    return this.repo.votosDeMesa(mesaId);
  }

  _validarCantidad(valor, etiqueta) {
    if (!Number.isInteger(valor) || valor < 0) {
      throw errores.solicitudInvalida(`La cantidad de votos ${etiqueta} tiene que ser un entero no negativo`);
    }
  }

  // ---- Metricas ----

  async metricas(comicioId) {
    const comicio = await this.repo.porIdComicio(comicioId);
    if (!comicio) throw errores.noEncontrado('Comicio no encontrado');
    return this.repo.metricas(comicioId);
  }
}

module.exports = { ComicioService, TIPOS_ELECCION };
