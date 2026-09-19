/**
 * Acceso a datos de comicios, mesas y votos.
 *
 * El rango de una mesa son dos DNIs; la cantidad de votantes y el solapamiento entre
 * mesas se calculan contra padron.votantes con comparaciones de tupla
 * (apellido, nombre, dni) -- el mismo orden que ya usa el listado del padron. No hay
 * tabla que copie quien vota en que mesa.
 */

/** SQL de una tupla de orden, para comparar contra (apellido, nombre, dni). */
const TUPLA = (i) => `($${i}, $${i + 1}, $${i + 2})`;

class ComicioRepository {
  constructor(db) {
    this.db = db;
  }

  // ---- Votante (soporte para validar/ordenar rangos) ----

  /** { dni, apellido, nombre } o null. Es lo que define la posicion de un DNI en el orden del padron. */
  async votante(dni) {
    return this.db.unaFila('SELECT dni, apellido, nombre FROM padron.votantes WHERE dni = $1', [dni]);
  }

  // ---- Comicios ----

  async crearComicio({ nombre, tipoEleccion }, listaIds) {
    return this.db.transaccion(async (cliente) => {
      const { rows: [comicio] } = await cliente.query(
        `INSERT INTO elecciones.comicios (nombre, tipo_eleccion) VALUES ($1, $2)
         RETURNING id, nombre, tipo_eleccion, created_at`,
        [nombre, tipoEleccion],
      );
      await this._insertarListas(cliente, comicio.id, listaIds);
      return comicio;
    });
  }

  async porIdComicio(id) {
    const comicio = await this.db.unaFila(
      'SELECT id, nombre, tipo_eleccion, created_at FROM elecciones.comicios WHERE id = $1',
      [id],
    );
    if (!comicio) return null;

    const [listas, mesas] = await Promise.all([
      this.listasDeComicio(id),
      this.mesasDeComicio(id),
    ]);

    return { ...comicio, listas, mesas };
  }

  async listasDeComicio(comicioId) {
    return this.db.filas(
      `SELECT l.id, l.nombre
       FROM elecciones.comicio_listas cl
       JOIN elecciones.listas l ON l.id = cl.lista_id
       WHERE cl.comicio_id = $1
       ORDER BY l.nombre`,
      [comicioId],
    );
  }

  async listarComicios({ page, limit }) {
    const offset = (page - 1) * limit;
    const [registros, { total }] = await Promise.all([
      // Conteos de listas/mesas: barato dado el volumen esperado (pocos comicios), y
      // la tabla del listado los necesita -- mismo criterio que candidatos_count en 017.
      this.db.filas(
        `SELECT c.id, c.nombre, c.tipo_eleccion, c.created_at,
                (SELECT COUNT(*)::int FROM elecciones.comicio_listas cl WHERE cl.comicio_id = c.id) AS listas_count,
                (SELECT COUNT(*)::int FROM elecciones.mesas m WHERE m.comicio_id = c.id) AS mesas_count
         FROM elecciones.comicios c
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.db.unaFila('SELECT COUNT(*)::int AS total FROM elecciones.comicios'),
    ]);
    return { registros, total, page, limit };
  }

  async actualizarComicio(id, { nombre, tipoEleccion }, listaIds) {
    return this.db.transaccion(async (cliente) => {
      const { rows: [comicio] } = await cliente.query(
        `UPDATE elecciones.comicios SET nombre = $2, tipo_eleccion = $3
         WHERE id = $1
         RETURNING id, nombre, tipo_eleccion, created_at`,
        [id, nombre, tipoEleccion],
      );
      await cliente.query('DELETE FROM elecciones.comicio_listas WHERE comicio_id = $1', [id]);
      await this._insertarListas(cliente, id, listaIds);
      return comicio;
    });
  }

  async eliminarComicio(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.comicios WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async _insertarListas(cliente, comicioId, listaIds) {
    for (const listaId of listaIds) {
      await cliente.query(
        'INSERT INTO elecciones.comicio_listas (comicio_id, lista_id) VALUES ($1, $2)',
        [comicioId, listaId],
      );
    }
  }

  /** ids de elecciones.listas que existen, de entre los pedidos. Para validar en el service. */
  async listasExistentes(listaIds) {
    if (listaIds.length === 0) return [];
    const { rows } = await this.db.query(
      'SELECT id FROM elecciones.listas WHERE id = ANY($1::int[])',
      [listaIds],
    );
    return rows.map((r) => r.id);
  }

  // ---- Mesas ----

  async contarVotantesEnRango(desde, hasta) {
    const { total } = await this.db.unaFila(
      `SELECT COUNT(*)::int AS total
       FROM padron.votantes
       WHERE (apellido, nombre, dni) >= ${TUPLA(1)}
         AND (apellido, nombre, dni) <= ${TUPLA(4)}`,
      [desde.apellido, desde.nombre, desde.dni, hasta.apellido, hasta.nombre, hasta.dni],
    );
    return total;
  }

  /** Mesas del comicio cuyo rango se cruza con [desde, hasta]. Vacio si no hay ninguna. */
  async mesasSolapadas(comicioId, desde, hasta, excluirMesaId = null) {
    return this.db.filas(
      `SELECT m.id, m.numero
       FROM elecciones.mesas m
       JOIN padron.votantes vd ON vd.dni = m.padron_desde_dni
       JOIN padron.votantes vh ON vh.dni = m.padron_hasta_dni
       WHERE m.comicio_id = $1
         AND ($2::integer IS NULL OR m.id != $2)
         AND NOT (
           ROW(${TUPLA(3).slice(1, -1)}) < ROW(vd.apellido, vd.nombre, vd.dni)
           OR
           ROW(vh.apellido, vh.nombre, vh.dni) < ROW(${TUPLA(6).slice(1, -1)})
         )`,
      [comicioId, excluirMesaId, hasta.apellido, hasta.nombre, hasta.dni, desde.apellido, desde.nombre, desde.dni],
    );
  }

  async crearMesa(comicioId, { numero, desdeDni, hastaDni }) {
    return this.db.unaFila(
      `INSERT INTO elecciones.mesas (comicio_id, numero, padron_desde_dni, padron_hasta_dni)
       VALUES ($1, $2, $3, $4)
       RETURNING id, comicio_id, numero, padron_desde_dni, padron_hasta_dni, votos_blancos, votos_nulos`,
      [comicioId, numero, desdeDni, hastaDni],
    );
  }

  async mesaPorId(mesaId) {
    return this.db.unaFila(
      `SELECT id, comicio_id, numero, padron_desde_dni, padron_hasta_dni, votos_blancos, votos_nulos
       FROM elecciones.mesas WHERE id = $1`,
      [mesaId],
    );
  }

  async mesasDeComicio(comicioId) {
    return this.db.filas(
      `SELECT m.id, m.comicio_id, m.numero, m.padron_desde_dni, m.padron_hasta_dni,
              m.votos_blancos, m.votos_nulos,
              (SELECT COUNT(*)::int FROM padron.votantes v
                JOIN padron.votantes vd ON vd.dni = m.padron_desde_dni
                JOIN padron.votantes vh ON vh.dni = m.padron_hasta_dni
                WHERE (v.apellido, v.nombre, v.dni) >= (vd.apellido, vd.nombre, vd.dni)
                  AND (v.apellido, v.nombre, v.dni) <= (vh.apellido, vh.nombre, vh.dni)
              ) AS cantidad_votantes
       FROM elecciones.mesas m
       WHERE m.comicio_id = $1
       ORDER BY m.numero`,
      [comicioId],
    );
  }

  async actualizarMesa(mesaId, { numero, desdeDni, hastaDni }) {
    return this.db.unaFila(
      `UPDATE elecciones.mesas SET numero = $2, padron_desde_dni = $3, padron_hasta_dni = $4
       WHERE id = $1
       RETURNING id, comicio_id, numero, padron_desde_dni, padron_hasta_dni, votos_blancos, votos_nulos`,
      [mesaId, numero, desdeDni, hastaDni],
    );
  }

  async eliminarMesa(mesaId) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.mesas WHERE id = $1', [mesaId]);
    return rowCount > 0;
  }

  // ---- Votos ----

  async reemplazarVotos(mesaId, { blancos, nulos, porLista }) {
    // votosDeMesa() lee por el pool, no por `cliente`: llamarla DENTRO de la
    // transaccion leeria el estado antes del COMMIT (otra conexion, read committed) y
    // devolveria null/vacio pese a que el UPDATE ya se mando. Por eso se lee despues
    // de que transaccion() resuelve, cuando el commit ya esta hecho.
    await this.db.transaccion(async (cliente) => {
      await cliente.query(
        'UPDATE elecciones.mesas SET votos_blancos = $2, votos_nulos = $3 WHERE id = $1',
        [mesaId, blancos, nulos],
      );
      await cliente.query('DELETE FROM elecciones.votos_lista WHERE mesa_id = $1', [mesaId]);
      for (const { listaId, cantidad } of porLista) {
        await cliente.query(
          'INSERT INTO elecciones.votos_lista (mesa_id, lista_id, cantidad) VALUES ($1, $2, $3)',
          [mesaId, listaId, cantidad],
        );
      }
    });
    return this.votosDeMesa(mesaId);
  }

  async votosDeMesa(mesaId) {
    const [mesa, porLista] = await Promise.all([
      this.mesaPorId(mesaId),
      this.db.filas(
        `SELECT vl.lista_id, l.nombre AS lista_nombre, vl.cantidad
         FROM elecciones.votos_lista vl
         JOIN elecciones.listas l ON l.id = vl.lista_id
         WHERE vl.mesa_id = $1
         ORDER BY l.nombre`,
        [mesaId],
      ),
    ]);
    return { blancos: mesa.votos_blancos, nulos: mesa.votos_nulos, porLista };
  }

  // ---- Metricas ----

  async metricas(comicioId) {
    const [totalesPorLista, blancosNulos, mesas, votantesAsignados] = await Promise.all([
      this.db.filas(
        `SELECT l.id AS lista_id, l.nombre AS lista_nombre, COALESCE(SUM(vl.cantidad), 0)::int AS votos
         FROM elecciones.comicio_listas cl
         JOIN elecciones.listas l ON l.id = cl.lista_id
         LEFT JOIN elecciones.votos_lista vl
           ON vl.lista_id = l.id AND vl.mesa_id IN (SELECT id FROM elecciones.mesas WHERE comicio_id = $1)
         WHERE cl.comicio_id = $1
         GROUP BY l.id, l.nombre
         ORDER BY l.nombre`,
        [comicioId],
      ),
      this.db.unaFila(
        `SELECT COALESCE(SUM(votos_blancos), 0)::int AS blancos, COALESCE(SUM(votos_nulos), 0)::int AS nulos
         FROM elecciones.mesas WHERE comicio_id = $1`,
        [comicioId],
      ),
      this.db.unaFila(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE votos_blancos IS NOT NULL)::int AS con_votos
         FROM elecciones.mesas WHERE comicio_id = $1`,
        [comicioId],
      ),
      this.db.unaFila(
        `SELECT COALESCE(SUM(
           (SELECT COUNT(*)::int FROM padron.votantes v
             JOIN padron.votantes vd ON vd.dni = m.padron_desde_dni
             JOIN padron.votantes vh ON vh.dni = m.padron_hasta_dni
             WHERE (v.apellido, v.nombre, v.dni) >= (vd.apellido, vd.nombre, vd.dni)
               AND (v.apellido, v.nombre, v.dni) <= (vh.apellido, vh.nombre, vh.dni))
         ), 0)::int AS total
         FROM elecciones.mesas m WHERE m.comicio_id = $1`,
        [comicioId],
      ),
    ]);

    const votosLista = totalesPorLista.reduce((acc, l) => acc + l.votos, 0);
    const emitidos = votosLista + blancosNulos.blancos + blancosNulos.nulos;

    return {
      porLista: totalesPorLista,
      blancos: blancosNulos.blancos,
      nulos: blancosNulos.nulos,
      emitidos,
      mesasConVotos: mesas.con_votos,
      mesasTotal: mesas.total,
      votantesAsignados: votantesAsignados.total,
      participacion: votantesAsignados.total > 0 ? emitidos / votantesAsignados.total : null,
    };
  }
}

module.exports = { ComicioRepository };
