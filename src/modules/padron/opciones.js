/**
 * Opciones politicas de la instancia (021): las que una persona puede marcar al relevar.
 *
 * Antes eran tres literales ('PJ', 'UCR', 'Indeciso') en un CHECK, en el servicio, en el
 * SQL de resultados y en la UI. Cada cliente tiene las suyas, asi que viven en
 * padron.opciones_politicas y este es el unico lugar que las lee.
 *
 * Se guardan en memoria: la tabla tiene un puñado de filas, se consulta en cada validacion
 * de un relevamiento y en cada estadistica, y casi no cambia. Es la misma razon por la que
 * la sesion se cachea en core/security/sessions.js. El TTL corto cubre el caso de que alguien
 * las cambie directo en la base (un script de alta) con el servidor andando.
 */

const { errores } = require('../../core/errors');

const TTL_MS = 60_000;
const MAX_OPCIONES = 10;
const CODIGO_VALIDO = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

class OpcionesPoliticas {
  /**
   * @param repo        PadronRepository
   * @param auditoria   servicio de auditoria
   * @param alCambiar   se llama despues de toda escritura; el padron lo usa para tirar el
   *                    cache de resultados, que dibuja una columna por opcion.
   */
  constructor(repo, auditoria, alCambiar = () => {}) {
    this.repo = repo;
    this.auditoria = auditoria;
    this.alCambiar = alCambiar;
    this.cache = null;
    this.vence = 0;
  }

  invalidar() {
    this.cache = null;
    this.vence = 0;
  }

  /** Todas las opciones, en el orden en que se muestran. */
  async listar() {
    if (this.cache && Date.now() < this.vence) return this.cache;

    const filas = await this.repo.opcionesPoliticas();
    this.cache = filas.map(aOpcion);
    this.vence = Date.now() + TTL_MS;
    return this.cache;
  }

  async codigos() {
    return (await this.listar()).map((o) => o.codigo);
  }

  /** El codigo de la opcion que se asigna sola a un relevamiento nuevo. */
  async neutra() {
    const neutra = (await this.listar()).find((o) => o.esNeutra);
    return neutra ? neutra.codigo : null;
  }

  // ------------------------------------------------------------ escritura

  async crear(cuerpo, req) {
    const datos = validar(cuerpo, { creando: true });

    const existentes = await this.listar();
    if (existentes.length >= MAX_OPCIONES) {
      throw errores.conflicto(`No puede haber mas de ${MAX_OPCIONES} opciones politicas`);
    }
    if (existentes.some((o) => o.codigo.toLowerCase() === datos.codigo.toLowerCase())) {
      throw errores.conflicto(`Ya existe una opcion con el codigo "${datos.codigo}"`);
    }

    // Va al final salvo que digan otra cosa.
    const orden = datos.orden ?? (Math.max(0, ...existentes.map((o) => o.orden)) + 1);
    const fila = await this.repo.crearOpcionPolitica({ ...datos, orden });
    this.despuesDeEscribir();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'CREAR',
      entidad: 'opcion_politica',
      entidad_id: fila.codigo,
      datos_nuevos: fila,
    });

    return aOpcion(fila);
  }

  async actualizar(codigo, cuerpo, req) {
    const anterior = await this.repo.opcionPoliticaPorCodigo(codigo);
    if (!anterior) throw errores.noEncontrado('Opcion politica no encontrada');

    const datos = validar(cuerpo, { creando: false, esNeutra: anterior.es_neutra });
    if (Object.keys(datos).length === 0) {
      throw errores.solicitudInvalida('Hay que mandar al menos uno de: etiqueta, color, orden');
    }

    const fila = await this.repo.actualizarOpcionPolitica(codigo, datos);
    this.despuesDeEscribir();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'EDITAR',
      entidad: 'opcion_politica',
      entidad_id: codigo,
      datos_anteriores: anterior,
      datos_nuevos: fila,
    });

    return aOpcion(fila);
  }

  async eliminar(codigo, req) {
    const anterior = await this.repo.opcionPoliticaPorCodigo(codigo);
    if (!anterior) throw errores.noEncontrado('Opcion politica no encontrada');

    if (anterior.es_neutra) {
      throw errores.conflicto('La opcion neutra no se puede borrar: es la que se asigna a un relevamiento nuevo');
    }

    const enUso = await this.repo.contarRelevamientosDeOpcion(codigo);
    if (enUso > 0) {
      throw errores.conflicto(
        `La opcion "${codigo}" esta marcada en ${enUso} relevamiento(s): no se puede borrar sin perderlos`,
      );
    }

    await this.repo.eliminarOpcionPolitica(codigo);
    this.despuesDeEscribir();

    await this.auditoria.registrarDeRequest(req, {
      operacion: 'ELIMINAR',
      entidad: 'opcion_politica',
      entidad_id: codigo,
      datos_anteriores: anterior,
    });
  }

  despuesDeEscribir() {
    this.invalidar();
    this.alCambiar();
  }
}

function aOpcion(fila) {
  return {
    codigo: fila.codigo,
    etiqueta: fila.etiqueta,
    color: fila.color === null || fila.color === undefined ? null : Number(fila.color),
    orden: Number(fila.orden),
    esNeutra: Boolean(fila.es_neutra),
  };
}

/**
 * Valida el cuerpo. Al crear, `codigo`, `etiqueta` y `color` son obligatorios; al editar solo
 * viajan los campos que cambian, y el codigo no se puede tocar (es lo que guardan los
 * relevamientos). La opcion neutra no tiene color: siempre es el gris de "indeciso".
 */
function validar(cuerpo = {}, { creando, esNeutra = false }) {
  const datos = {};

  if (creando) {
    const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo.trim() : '';
    if (!codigo || codigo.length > 20 || !CODIGO_VALIDO.test(codigo)) {
      throw errores.solicitudInvalida(
        'codigo es obligatorio: hasta 20 caracteres, letras, numeros, espacios y . _ -',
      );
    }
    datos.codigo = codigo;
  } else if (cuerpo.codigo !== undefined) {
    throw errores.solicitudInvalida('El codigo no se puede cambiar: lo guardan los relevamientos');
  }

  if (creando || cuerpo.etiqueta !== undefined) {
    const etiqueta = typeof cuerpo.etiqueta === 'string' ? cuerpo.etiqueta.trim() : '';
    if (!etiqueta || etiqueta.length > 50) {
      throw errores.solicitudInvalida('etiqueta es obligatoria y tiene hasta 50 caracteres');
    }
    datos.etiqueta = etiqueta;
  }

  if (creando || cuerpo.color !== undefined) {
    if (esNeutra) {
      throw errores.solicitudInvalida('La opcion neutra no lleva color');
    }
    const color = Number(cuerpo.color);
    if (!Number.isInteger(color) || color < 1 || color > 8) {
      throw errores.solicitudInvalida('color tiene que ser un entero de 1 a 8');
    }
    datos.color = color;
  }

  if (cuerpo.orden !== undefined) {
    const orden = Number(cuerpo.orden);
    if (!Number.isInteger(orden) || orden < 0 || orden > 1000) {
      throw errores.solicitudInvalida('orden tiene que ser un entero entre 0 y 1000');
    }
    datos.orden = orden;
  }

  return datos;
}

module.exports = { OpcionesPoliticas, MAX_OPCIONES };
