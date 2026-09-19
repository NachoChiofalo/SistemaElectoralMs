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

  /** Lista con sus candidatos ordenados, o null si no existe. */
  async porId(id) {
    const lista = await this.db.unaFila(
      'SELECT id, nombre, tipo_eleccion, cantidad_lugares, created_at FROM elecciones.listas WHERE id = $1',
      [id],
    );
    if (!lista) return null;

    const candidatos = await this.db.filas(
      'SELECT id, nombre, orden FROM elecciones.candidatos WHERE lista_id = $1 ORDER BY orden',
      [id],
    );

    return { ...lista, candidatos };
  }

  /** Listado paginado, sin candidatos (se piden aparte con porId). */
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

    return { registros, total, page, limit };
  }

  /** Actualiza nombre/tipo/cantidad de lugares. No toca candidatos. */
  async actualizarDatos(id, { nombre, tipoEleccion, cantidadLugares }) {
    return this.db.unaFila(
      `UPDATE elecciones.listas
       SET nombre = $2, tipo_eleccion = $3, cantidad_lugares = $4
       WHERE id = $1
       RETURNING id, nombre, tipo_eleccion, cantidad_lugares, created_at`,
      [id, nombre, tipoEleccion, cantidadLugares],
    );
  }

  /** Reemplaza el set completo de candidatos de una lista, en una transaccion. */
  async reemplazarCandidatos(listaId, candidatos) {
    return this.db.transaccion(async (cliente) => {
      await cliente.query('DELETE FROM elecciones.candidatos WHERE lista_id = $1', [listaId]);
      await this._insertarCandidatos(cliente, listaId, candidatos);
      return this._ordenados(candidatos);
    });
  }

  /** true si la lista existia y se borro. */
  async eliminar(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.listas WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async _insertarCandidatos(cliente, listaId, candidatos) {
    for (const candidato of candidatos) {
      await cliente.query(
        'INSERT INTO elecciones.candidatos (lista_id, nombre, orden) VALUES ($1, $2, $3)',
        [listaId, candidato.nombre, candidato.orden],
      );
    }
  }

  _ordenados(candidatos) {
    return [...candidatos].sort((a, b) => a.orden - b.orden);
  }
}

module.exports = { ListasRepository };
