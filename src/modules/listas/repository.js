/**
 * Acceso a datos de listas electorales (borradores) y sus candidatos.
 */

class ListasRepository {
  constructor(db) {
    this.db = db;
  }

  /** Crea una lista y sus candidatos en una sola transaccion. */
  async crear({ nombre, tipoEleccion, cantidadLugares }, candidatos) {
    return this.db.transaccion(async (cliente) => {
      const { rows: [lista] } = await cliente.query(
        `INSERT INTO elecciones.listas (nombre, tipo_eleccion, cantidad_lugares)
         VALUES ($1, $2, $3)
         RETURNING id, nombre, tipo_eleccion, cantidad_lugares, created_at`,
        [nombre, tipoEleccion, cantidadLugares],
      );

      await this._insertarCandidatos(cliente, lista.id, candidatos);

      return { ...lista, candidatos: this._ordenados(candidatos) };
    });
  }

  /** Lista con sus candidatos (y suplentes) ordenados, o null si no existe. */
  async porId(id) {
    const lista = await this.db.unaFila(
      'SELECT id, nombre, tipo_eleccion, cantidad_lugares, created_at FROM elecciones.listas WHERE id = $1',
      [id],
    );
    if (!lista) return null;

    const candidatosPorLista = await this._candidatosDeListas([id]);
    lista.candidatos = candidatosPorLista.get(id) || [];
    return lista;
  }

  /**
   * Listado paginado, con los candidatos y suplentes completos de cada lista: la
   * pantalla los muestra ahi mismo, sin pedir el detalle aparte. El volumen esperado
   * (unas pocas listas por eleccion, con pocos candidatos cada una) es lo que hace que
   * esto siga siendo tres consultas en total y no N+1: una para las listas de la
   * pagina, una para todos sus candidatos y una para todos los suplentes de esos
   * candidatos.
   */
  async listar({ page, limit }) {
    const offset = (page - 1) * limit;

    const [registros, { total }] = await Promise.all([
      this.db.filas(
        `SELECT id, nombre, tipo_eleccion, cantidad_lugares, created_at
         FROM elecciones.listas
         ORDER BY created_at DESC, id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.db.unaFila('SELECT COUNT(*)::int AS total FROM elecciones.listas'),
    ]);

    const candidatosPorLista = await this._candidatosDeListas(registros.map((l) => l.id));
    for (const lista of registros) {
      lista.candidatos = candidatosPorLista.get(lista.id) || [];
    }

    return { registros, total, page, limit };
  }

  /**
   * Actualiza nombre/tipo/cantidad de lugares y reemplaza el set completo de candidatos
   * (con sus suplentes) en UNA transaccion: si el reemplazo falla, los datos de la lista
   * tampoco cambian (BE-011). Antes eran dos transacciones y un corte entre ambas dejaba
   * metadata nueva con candidatos viejos.
   */
  async actualizarCompleta(id, { nombre, tipoEleccion, cantidadLugares }, candidatos) {
    return this.db.transaccion(async (cliente) => {
      const { rows: [lista] } = await cliente.query(
        `UPDATE elecciones.listas
         SET nombre = $2, tipo_eleccion = $3, cantidad_lugares = $4
         WHERE id = $1
         RETURNING id, nombre, tipo_eleccion, cantidad_lugares, created_at`,
        [id, nombre, tipoEleccion, cantidadLugares],
      );
      // El ON DELETE CASCADE de `suplentes` se lleva puesto a los suplentes de los
      // candidatos borrados: no hace falta un DELETE aparte para ellos.
      await cliente.query('DELETE FROM elecciones.candidatos WHERE lista_id = $1', [id]);
      await this._insertarCandidatos(cliente, id, candidatos);
      return { lista, candidatos: this._ordenados(candidatos) };
    });
  }

  /** true si la lista existia y se borro. */
  async eliminar(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.listas WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async _insertarCandidatos(cliente, listaId, candidatos) {
    for (const candidato of candidatos) {
      const { rows: [fila] } = await cliente.query(
        `INSERT INTO elecciones.candidatos (lista_id, nombre, orden, notas)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [listaId, candidato.nombre, candidato.orden, candidato.notas ?? null],
      );
      await this._insertarSuplentes(cliente, fila.id, candidato.suplentes || []);
    }
  }

  async _insertarSuplentes(cliente, candidatoId, suplentes) {
    for (const suplente of suplentes) {
      await cliente.query(
        'INSERT INTO elecciones.suplentes (candidato_id, nombre, orden) VALUES ($1, $2, $3)',
        [candidatoId, suplente.nombre, suplente.orden],
      );
    }
  }

  /** Mapa lista_id -> candidatos (con sus suplentes), para varias listas a la vez. */
  async _candidatosDeListas(listaIds) {
    const mapa = new Map();
    if (listaIds.length === 0) return mapa;

    const candidatos = await this.db.filas(
      `SELECT id, lista_id, nombre, orden, notas FROM elecciones.candidatos
       WHERE lista_id = ANY($1) ORDER BY orden`,
      [listaIds],
    );

    const suplentesPorCandidato = await this._suplentesDeCandidatos(candidatos.map((c) => c.id));

    for (const candidato of candidatos) {
      candidato.suplentes = suplentesPorCandidato.get(candidato.id) || [];
      if (!mapa.has(candidato.lista_id)) mapa.set(candidato.lista_id, []);
      mapa.get(candidato.lista_id).push(candidato);
    }
    return mapa;
  }

  /** Mapa candidato_id -> suplentes, para varios candidatos a la vez. */
  async _suplentesDeCandidatos(candidatoIds) {
    const mapa = new Map();
    if (candidatoIds.length === 0) return mapa;

    const suplentes = await this.db.filas(
      `SELECT id, candidato_id, nombre, orden FROM elecciones.suplentes
       WHERE candidato_id = ANY($1) ORDER BY orden`,
      [candidatoIds],
    );

    for (const suplente of suplentes) {
      if (!mapa.has(suplente.candidato_id)) mapa.set(suplente.candidato_id, []);
      mapa.get(suplente.candidato_id).push(suplente);
    }
    return mapa;
  }

  _ordenados(candidatos) {
    return [...candidatos]
      .sort((a, b) => a.orden - b.orden)
      .map((c) => ({ ...c, suplentes: [...(c.suplentes || [])].sort((a, b) => a.orden - b.orden) }));
  }
}

module.exports = { ListasRepository };
