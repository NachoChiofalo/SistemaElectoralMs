/**
 * Reglas de negocio de comicios, mesas y votos. No conoce req/res salvo para pasarlo a
 * auditoria (mismo patron que el resto de los modulos).
 */

const { errores } = require('../../core/errors');

const TIPOS_ELECCION = ['provincial', 'municipal', 'nacional'];
const COLORES_FUERZA = 8; // cantidad de tokens --ds-fuerza-1..8 en design-system.css

function validarDatosComicio({ nombre, tipoEleccion }) {
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    throw errores.solicitudInvalida('El nombre del comicio es obligatorio');
  }
  if (!TIPOS_ELECCION.includes(tipoEleccion)) {
    throw errores.solicitudInvalida(`tipoEleccion invalido: tiene que ser uno de ${TIPOS_ELECCION.join(', ')}`);
  }
}

function validarDatosFuerza({ nombre, sigla, color }) {
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    throw errores.solicitudInvalida('El nombre de la fuerza es obligatorio');
  }
  if (sigla !== undefined && sigla !== null && typeof sigla !== 'string') {
    throw errores.solicitudInvalida('La sigla de la fuerza tiene que ser texto');
  }
  if (!Number.isInteger(color) || color < 1 || color > COLORES_FUERZA) {
    throw errores.solicitudInvalida(`El color tiene que ser un entero entre 1 y ${COLORES_FUERZA}`);
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

  // ---- Fuerzas ----

  async crearFuerza(req, datos) {
    validarDatosFuerza(datos);
    const fuerza = await this.repo.crearFuerza(datos);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'fuerza',
      entidad_id: fuerza.id,
      datos_nuevos: fuerza,
    });

    return fuerza;
  }

  async listarFuerzas() {
    return this.repo.listarFuerzas();
  }

  async actualizarFuerza(req, id, datos) {
    const existente = await this.repo.fuerzaPorId(id);
    if (!existente) throw errores.noEncontrado('Fuerza no encontrada');

    validarDatosFuerza(datos);
    const fuerza = await this.repo.actualizarFuerza(id, datos);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'fuerza',
      entidad_id: id,
      datos_anteriores: existente,
      datos_nuevos: fuerza,
    });

    return fuerza;
  }

  async eliminarFuerza(req, id) {
    const existente = await this.repo.fuerzaPorId(id);
    if (!existente) throw errores.noEncontrado('Fuerza no encontrada');

    await this.repo.eliminarFuerza(id);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'fuerza',
      entidad_id: id,
      datos_anteriores: existente,
    });
  }

  // ---- Comicios ----

  async crearComicio(req, datos, fuerzaIds) {
    validarDatosComicio(datos);
    await this._validarFuerzas(fuerzaIds);

    const comicio = await this.repo.crearComicio(datos, fuerzaIds);

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

  async actualizarComicio(req, id, datos, fuerzaIds) {
    const existente = await this.repo.porIdComicio(id);
    if (!existente) throw errores.noEncontrado('Comicio no encontrado');

    validarDatosComicio(datos);
    await this._validarFuerzas(fuerzaIds);

    await this.repo.actualizarComicio(id, datos, fuerzaIds);
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

  async _validarFuerzas(fuerzaIds) {
    if (!Array.isArray(fuerzaIds) || fuerzaIds.length === 0) {
      throw errores.solicitudInvalida('El comicio necesita al menos una fuerza participante');
    }
    const existentes = await this.repo.fuerzasExistentes(fuerzaIds);
    const faltantes = fuerzaIds.filter((id) => !existentes.includes(id));
    if (faltantes.length > 0) {
      throw errores.solicitudInvalida(`Las fuerzas ${faltantes.join(', ')} no existen`);
    }
  }

  // ---- Mesas ----

  async crearMesa(req, comicioId, { numero, desdeDni, hastaDni }) {
    const comicio = await this.repo.porIdComicio(comicioId);
    if (!comicio) throw errores.noEncontrado('Comicio no encontrado');

    if (!Number.isInteger(numero) || numero <= 0) {
      throw errores.solicitudInvalida('El numero de mesa tiene que ser un entero positivo');
    }

    // La validacion del rango (si se manda) y el INSERT corren en la misma
    // transaccion, bajo el lock de este comicio: dos POST concurrentes con rangos que
    // se cruzan no pueden pasar los dos el chequeo de solapamiento antes de que
    // cualquiera de los dos inserte (ver G1).
    let rango = null;
    const mesa = await this.repo.db.transaccion(async (cliente) => {
      await this.repo.lockComicio(cliente, comicioId);
      if (desdeDni || hastaDni) {
        rango = await this._validarRango(cliente, comicioId, desdeDni, hastaDni, null);
      }
      return this.repo.crearMesa(cliente, comicioId, { numero, desdeDni, hastaDni });
    });

    // Fuera de la transaccion, ya comprometida: contarVotantesEnRango no depende de lo
    // que se acaba de escribir, y leerla por el pool antes de este punto violaria la
    // regla de CLAUDE.md de no leer por el pool dentro de una transaccion.
    const cantidadVotantes = rango ? await this.repo.contarVotantesEnRango(rango.desde, rango.hasta) : null;

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

    if (!Number.isInteger(numero) || numero <= 0) {
      throw errores.solicitudInvalida('El numero de mesa tiene que ser un entero positivo');
    }

    let rango = null;
    const mesa = await this.repo.db.transaccion(async (cliente) => {
      await this.repo.lockComicio(cliente, comicioId);
      if (desdeDni || hastaDni) {
        rango = await this._validarRango(cliente, comicioId, desdeDni, hastaDni, mesaId);
      }
      return this.repo.actualizarMesa(cliente, mesaId, { numero, desdeDni, hastaDni });
    });

    const cantidadVotantes = rango ? await this.repo.contarVotantesEnRango(rango.desde, rango.hasta) : null;

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

  /**
   * El rango es opcional, pero si se manda uno de los dos DNI hay que mandar el otro.
   * `cliente`: corre dentro de la transaccion de `crearMesa`/`actualizarMesa`, con el
   * lock de `lockComicio` ya tomado -- el chequeo de solapamiento y el INSERT/UPDATE
   * que sigue tienen que ver el mismo estado, o dos requests concurrentes podrian pasar
   * los dos el chequeo antes de que cualquiera escriba (ver G1).
   */
  async _validarRango(cliente, comicioId, desdeDni, hastaDni, excluirMesaId) {
    if (!desdeDni || !hastaDni) {
      throw errores.solicitudInvalida('El rango de padrón necesita los dos DNI (desde y hasta), o ninguno');
    }

    const [desde, hasta] = await Promise.all([
      this.repo.votante(desdeDni, cliente),
      this.repo.votante(hastaDni, cliente),
    ]);
    if (!desde) throw errores.solicitudInvalida(`No existe un votante con DNI ${desdeDni}`);
    if (!hasta) throw errores.solicitudInvalida(`No existe un votante con DNI ${hastaDni}`);

    if (antesQue(hasta, desde)) {
      throw errores.solicitudInvalida('El DNI "hasta" no puede ir antes que el DNI "desde" en el orden del padrón');
    }

    const solapadas = await this.repo.mesasSolapadas(comicioId, desde, hasta, excluirMesaId, cliente);
    if (solapadas.length > 0) {
      throw errores.conflicto(
        `El rango se solapa con la mesa ${solapadas[0].numero}`,
        { mesas: solapadas },
      );
    }

    return { desde, hasta };
  }

  // ---- Votos ----

  async cargarVotos(req, comicioId, mesaId, { blancos, nulos, porFuerza }) {
    const mesa = await this.repo.mesaPorId(mesaId);
    if (!mesa || mesa.comicio_id !== comicioId) throw errores.noEncontrado('Mesa no encontrada');

    this._validarCantidad(blancos, 'blancos');
    this._validarCantidad(nulos, 'nulos');

    if (!Array.isArray(porFuerza)) throw errores.solicitudInvalida('porFuerza tiene que ser un array');

    const fuerzasDelComicio = (await this.repo.fuerzasDeComicio(comicioId)).map((f) => f.id);
    const vistas = new Set();
    for (const voto of porFuerza) {
      // La misma fuerza dos veces violaria la clave primaria compuesta recien en el
      // INSERT, y volveria como un 500 en vez de un 400 (BE-028).
      if (vistas.has(voto.fuerzaId)) {
        throw errores.solicitudInvalida(`La fuerza ${voto.fuerzaId} aparece mas de una vez`);
      }
      vistas.add(voto.fuerzaId);
      if (!fuerzasDelComicio.includes(voto.fuerzaId)) {
        throw errores.solicitudInvalida(`La fuerza ${voto.fuerzaId} no participa de este comicio`);
      }
      this._validarCantidad(voto.cantidad, `voto de la fuerza ${voto.fuerzaId}`);
    }

    const resultado = await this.repo.reemplazarVotos(mesaId, { blancos, nulos, porFuerza });

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

module.exports = { ComicioService, TIPOS_ELECCION, COLORES_FUERZA };
