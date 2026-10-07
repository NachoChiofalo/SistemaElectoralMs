/**
 * Reglas de negocio de listas electorales (borradores). No conoce req/res: recibe
 * datos ya extraidos por routes.js y, para auditar, el req completo (mismo patron que
 * el resto de los modulos).
 */

const { errores } = require('../../core/errors');

const TIPOS_ELECCION = ['provincial', 'municipal', 'nacional'];
const TOPE_CANDIDATOS = 60;
const TOPE_SUPLENTES = 10;
const TOPE_NOTAS = 2000;

function validarDatosLista({ nombre, tipoEleccion, cantidadLugares }) {
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    throw errores.solicitudInvalida('El nombre de la lista es obligatorio');
  }
  if (!TIPOS_ELECCION.includes(tipoEleccion)) {
    throw errores.solicitudInvalida(
      `tipoEleccion invalido: tiene que ser uno de ${TIPOS_ELECCION.join(', ')}`,
    );
  }
  if (!Number.isInteger(cantidadLugares) || cantidadLugares <= 0) {
    throw errores.solicitudInvalida('cantidadLugares tiene que ser un entero positivo');
  }
}

function validarSecuenciaOrden(ordenes, mensajeDuplicado, mensajeHueco) {
  const unicos = new Set(ordenes);
  if (unicos.size !== ordenes.length) {
    throw errores.solicitudInvalida(mensajeDuplicado);
  }

  const esperados = [...unicos].sort((a, b) => a - b);
  const secuenciaCompleta = esperados.every((orden, i) => orden === i + 1);
  if (!secuenciaCompleta) {
    throw errores.solicitudInvalida(mensajeHueco);
  }
}

function validarSuplentes(suplentes) {
  if (suplentes === undefined || suplentes === null) return;
  if (!Array.isArray(suplentes)) {
    throw errores.solicitudInvalida('Los suplentes de un candidato tienen que ser una lista');
  }
  if (suplentes.length > TOPE_SUPLENTES) {
    throw errores.solicitudInvalida(`No se aceptan mas de ${TOPE_SUPLENTES} suplentes por candidato`);
  }

  const ordenes = [];
  for (const suplente of suplentes) {
    if (!suplente.nombre || typeof suplente.nombre !== 'string' || !suplente.nombre.trim()) {
      throw errores.solicitudInvalida('Todo suplente necesita un nombre');
    }
    if (!Number.isInteger(suplente.orden) || suplente.orden <= 0) {
      throw errores.solicitudInvalida('El orden del suplente tiene que ser un entero positivo');
    }
    ordenes.push(suplente.orden);
  }

  validarSecuenciaOrden(
    ordenes,
    'Hay suplentes con el mismo orden para un mismo candidato',
    'El orden de los suplentes tiene que ser 1..N sin huecos',
  );
}

function validarCandidatos(candidatos) {
  if (!Array.isArray(candidatos) || candidatos.length === 0) {
    throw errores.solicitudInvalida('La lista necesita al menos un candidato');
  }
  if (candidatos.length > TOPE_CANDIDATOS) {
    throw errores.solicitudInvalida(`No se aceptan mas de ${TOPE_CANDIDATOS} candidatos por lista`);
  }

  const ordenes = [];
  for (const candidato of candidatos) {
    if (!candidato.nombre || typeof candidato.nombre !== 'string' || !candidato.nombre.trim()) {
      throw errores.solicitudInvalida('Todo candidato necesita un nombre');
    }
    if (!Number.isInteger(candidato.orden) || candidato.orden <= 0) {
      throw errores.solicitudInvalida('El orden del candidato tiene que ser un entero positivo');
    }
    if (candidato.notas !== undefined && candidato.notas !== null) {
      if (typeof candidato.notas !== 'string') {
        throw errores.solicitudInvalida('Las notas de un candidato tienen que ser texto');
      }
      if (candidato.notas.length > TOPE_NOTAS) {
        throw errores.solicitudInvalida(`Las notas de un candidato no pueden superar los ${TOPE_NOTAS} caracteres`);
      }
    }
    validarSuplentes(candidato.suplentes);
    ordenes.push(candidato.orden);
  }

  validarSecuenciaOrden(
    ordenes,
    'Hay candidatos con el mismo orden dentro de la lista',
    'El orden de los candidatos tiene que ser 1..N sin huecos',
  );
}

class ListasService {
  constructor(repo, auditoria) {
    this.repo = repo;
    this.auditoria = auditoria;
  }

  async crear(req, datos, candidatos) {
    validarDatosLista(datos);
    validarCandidatos(candidatos);

    const lista = await this.repo.crear(datos, candidatos);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'lista',
      entidad_id: lista.id,
      datos_nuevos: lista,
    });

    return lista;
  }

  async porId(id) {
    return this.repo.porId(id);
  }

  async listar({ page = 1, limit = 25 } = {}) {
    const limiteEfectivo = Math.min(Number(limit) || 25, 100);
    const paginaEfectiva = Math.max(Number(page) || 1, 1);
    return this.repo.listar({ page: paginaEfectiva, limit: limiteEfectivo });
  }

  async actualizar(req, id, datos, candidatos) {
    const existente = await this.repo.porId(id);
    if (!existente) throw errores.noEncontrado('Lista no encontrada');

    validarDatosLista(datos);
    validarCandidatos(candidatos);

    const { lista, candidatos: candidatosActualizados } = await this.repo.actualizarCompleta(id, datos, candidatos);
    const resultado = { ...lista, candidatos: candidatosActualizados };

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'lista',
      entidad_id: id,
      datos_anteriores: existente,
      datos_nuevos: resultado,
    });

    return resultado;
  }

  async eliminar(req, id) {
    const existente = await this.repo.porId(id);
    if (!existente) throw errores.noEncontrado('Lista no encontrada');

    await this.repo.eliminar(id);

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'lista',
      entidad_id: id,
      datos_anteriores: existente,
    });
  }
}

module.exports = { ListasService, TIPOS_ELECCION, TOPE_CANDIDATOS, TOPE_SUPLENTES, TOPE_NOTAS };
