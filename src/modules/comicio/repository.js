/**
 * Acceso a datos de comicios, mesas y votos.
 *
 * El rango de una mesa son dos DNIs (opcional); la cantidad de votantes y el
 * solapamiento entre mesas se calculan contra padron.votantes con comparaciones de
 * tupla (apellido, nombre, dni) -- el mismo orden que ya usa el listado del padron. No
 * hay tabla que copie quien vota en que mesa.
 */

/** SQL de una tupla de orden, para comparar contra (apellido, nombre, dni). */
const TUPLA = (i) => `($${i}, $${i + 1}, $${i + 2})`;

/**
 * Namespace fijo del advisory lock de mesas (primer argumento de
 * pg_advisory_xact_lock). Junto con el comicioId como segundo argumento, serializa solo
 * la creacion/edicion de mesas de ESE comicio -- no todas las mesas del sistema. El
 * valor es arbitrario: solo tiene que no chocar con el de otro lock advisory del
 * proyecto (hoy no hay ningun otro).
 */
const NAMESPACE_LOCK_MESAS = 851234;

class ComicioRepository {
  constructor(db) {
    this.db = db;
  }

  // ---- Votante (soporte para validar/ordenar rangos) ----

  /**
   * { dni, apellido, nombre } o null. Es lo que define la posicion de un DNI en el
   * orden del padron. `ejecutor` opcional para correr dentro de una transaccion
   * (recibe el `cliente`, que tiene la misma forma de `.query()` que `this.db`) --
   * hace falta cuando esta llamada participa de la validacion de rango bajo lock de
   * crearMesa/actualizarMesa (ver G1).
   */
  async votante(dni, ejecutor = this.db) {
    const { rows } = await ejecutor.query('SELECT dni, apellido, nombre FROM padron.votantes WHERE dni = $1', [dni]);
    return rows[0] ?? null;
  }

  // ---- Fuerzas ----

  async crearFuerza({ nombre, sigla, color, listaId }) {
    return this.db.unaFila(
      `INSERT INTO elecciones.fuerzas (nombre, sigla, color, lista_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, sigla, color, lista_id, created_at`,
      [nombre, sigla || null, color, listaId || null],
    );
  }

  async listarFuerzas() {
    return this.db.filas(
      'SELECT id, nombre, sigla, color, lista_id, created_at FROM elecciones.fuerzas ORDER BY nombre',
    );
  }

  async fuerzaPorId(id) {
    return this.db.unaFila(
      'SELECT id, nombre, sigla, color, lista_id, created_at FROM elecciones.fuerzas WHERE id = $1',
      [id],
    );
  }

  async actualizarFuerza(id, { nombre, sigla, color, listaId }) {
    return this.db.unaFila(
      `UPDATE elecciones.fuerzas SET nombre = $2, sigla = $3, color = $4, lista_id = $5
       WHERE id = $1
       RETURNING id, nombre, sigla, color, lista_id, created_at`,
      [id, nombre, sigla || null, color, listaId || null],
    );
  }

  async eliminarFuerza(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.fuerzas WHERE id = $1', [id]);
    return rowCount > 0;
  }

  /** ids de elecciones.fuerzas que existen, de entre los pedidos. Para validar en el service. */
  async fuerzasExistentes(fuerzaIds) {
    if (fuerzaIds.length === 0) return [];
    const { rows } = await this.db.query(
      'SELECT id FROM elecciones.fuerzas WHERE id = ANY($1::int[])',
      [fuerzaIds],
    );
    return rows.map((r) => r.id);
  }

  // ---- Comicios ----

  async crearComicio({ nombre, tipoEleccion }, fuerzaIds) {
    return this.db.transaccion(async (cliente) => {
      const { rows: [comicio] } = await cliente.query(
        `INSERT INTO elecciones.comicios (nombre, tipo_eleccion) VALUES ($1, $2)
         RETURNING id, nombre, tipo_eleccion, created_at`,
        [nombre, tipoEleccion],
      );
      await this._insertarFuerzas(cliente, comicio.id, fuerzaIds);
      return comicio;
    });
  }

  async porIdComicio(id) {
    const comicio = await this.db.unaFila(
      'SELECT id, nombre, tipo_eleccion, created_at FROM elecciones.comicios WHERE id = $1',
      [id],
    );
    if (!comicio) return null;

    const [fuerzas, mesas] = await Promise.all([
      this.fuerzasDeComicio(id),
      this.mesasDeComicio(id),
    ]);

    return { ...comicio, fuerzas, mesas };
  }

  async fuerzasDeComicio(comicioId) {
    return this.db.filas(
      `SELECT f.id, f.nombre, f.sigla, f.color
       FROM elecciones.comicio_fuerzas cf
       JOIN elecciones.fuerzas f ON f.id = cf.fuerza_id
       WHERE cf.comicio_id = $1
       ORDER BY f.nombre`,
      [comicioId],
    );
  }

  async listarComicios({ page, limit }) {
    const offset = (page - 1) * limit;
    const [registros, { total }] = await Promise.all([
      // Conteos de fuerzas/mesas: barato dado el volumen esperado (pocos comicios), y
      // la tabla del listado los necesita -- mismo criterio que candidatos_count en 017.
      this.db.filas(
        `SELECT c.id, c.nombre, c.tipo_eleccion, c.created_at,
                (SELECT COUNT(*)::int FROM elecciones.comicio_fuerzas cf WHERE cf.comicio_id = c.id) AS fuerzas_count,
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

  async actualizarComicio(id, { nombre, tipoEleccion }, fuerzaIds) {
    return this.db.transaccion(async (cliente) => {
      const { rows: [comicio] } = await cliente.query(
        `UPDATE elecciones.comicios SET nombre = $2, tipo_eleccion = $3
         WHERE id = $1
         RETURNING id, nombre, tipo_eleccion, created_at`,
        [id, nombre, tipoEleccion],
      );
      await cliente.query('DELETE FROM elecciones.comicio_fuerzas WHERE comicio_id = $1', [id]);
      await this._insertarFuerzas(cliente, id, fuerzaIds);
      return comicio;
    });
  }

  async eliminarComicio(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.comicios WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async _insertarFuerzas(cliente, comicioId, fuerzaIds) {
    for (const fuerzaId of fuerzaIds) {
      await cliente.query(
        'INSERT INTO elecciones.comicio_fuerzas (comicio_id, fuerza_id) VALUES ($1, $2)',
        [comicioId, fuerzaId],
      );
    }
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

  /**
   * Mesas del comicio cuyo rango se cruza con [desde, hasta]. Vacio si no hay ninguna.
   * Las mesas sin rango (padron_desde_dni/hasta_dni NULL) nunca aparecen aca: el INNER
   * JOIN contra padron.votantes no matchea NULL, asi que quedan afuera de la
   * comparacion -- una mesa sin rango nunca se solapa con nada.
   * `ejecutor` opcional, misma razon que en `votante`.
   */
  async mesasSolapadas(comicioId, desde, hasta, excluirMesaId = null, ejecutor = this.db) {
    const { rows } = await ejecutor.query(
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
    return rows;
  }

  /**
   * Serializa la creacion/edicion de mesas de UN comicio (no de todos): dos personas
   * tocando comicios distintos no se bloquean entre si. `pg_advisory_xact_lock` se
   * libera solo al COMMIT/ROLLBACK de la transaccion de `cliente` -- nunca se llama
   * "unlock" a mano.
   */
  async lockComicio(cliente, comicioId) {
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [NAMESPACE_LOCK_MESAS, comicioId]);
  }

  /** `cliente`: corre dentro de la transaccion que ya tiene el lock de `lockComicio`. */
  async crearMesa(cliente, comicioId, { numero, desdeDni, hastaDni }) {
    const { rows: [mesa] } = await cliente.query(
      `INSERT INTO elecciones.mesas (comicio_id, numero, padron_desde_dni, padron_hasta_dni)
       VALUES ($1, $2, $3, $4)
       RETURNING id, comicio_id, numero, padron_desde_dni, padron_hasta_dni, votos_blancos, votos_nulos`,
      [comicioId, numero, desdeDni || null, hastaDni || null],
    );
    return mesa;
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
              CASE WHEN m.padron_desde_dni IS NULL OR m.padron_hasta_dni IS NULL THEN NULL
                ELSE (SELECT COUNT(*)::int FROM padron.votantes v
                  JOIN padron.votantes vd ON vd.dni = m.padron_desde_dni
                  JOIN padron.votantes vh ON vh.dni = m.padron_hasta_dni
                  WHERE (v.apellido, v.nombre, v.dni) >= (vd.apellido, vd.nombre, vd.dni)
                    AND (v.apellido, v.nombre, v.dni) <= (vh.apellido, vh.nombre, vh.dni)
                ) END AS cantidad_votantes
       FROM elecciones.mesas m
       WHERE m.comicio_id = $1
       ORDER BY m.numero`,
      [comicioId],
    );
  }

  /** `cliente`: corre dentro de la transaccion que ya tiene el lock de `lockComicio`. */
  async actualizarMesa(cliente, mesaId, { numero, desdeDni, hastaDni }) {
    const { rows: [mesa] } = await cliente.query(
      `UPDATE elecciones.mesas SET numero = $2, padron_desde_dni = $3, padron_hasta_dni = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING id, comicio_id, numero, padron_desde_dni, padron_hasta_dni, votos_blancos, votos_nulos`,
      [mesaId, numero, desdeDni || null, hastaDni || null],
    );
    return mesa;
  }

  async eliminarMesa(mesaId) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.mesas WHERE id = $1', [mesaId]);
    return rowCount > 0;
  }

  // ---- Votos ----

  async reemplazarVotos(mesaId, { blancos, nulos, porFuerza }) {
    // votosDeMesa() lee por el pool, no por `cliente`: llamarla DENTRO de la
    // transaccion leeria el estado antes del COMMIT (otra conexion, read committed) y
    // devolveria null/vacio pese a que el UPDATE ya se mando. Por eso se lee despues
    // de que transaccion() resuelve, cuando el commit ya esta hecho.
    await this.db.transaccion(async (cliente) => {
      await cliente.query(
        'UPDATE elecciones.mesas SET votos_blancos = $2, votos_nulos = $3, updated_at = NOW() WHERE id = $1',
        [mesaId, blancos, nulos],
      );
      await cliente.query('DELETE FROM elecciones.votos_fuerza WHERE mesa_id = $1', [mesaId]);
      for (const { fuerzaId, cantidad } of porFuerza) {
        await cliente.query(
          'INSERT INTO elecciones.votos_fuerza (mesa_id, fuerza_id, cantidad) VALUES ($1, $2, $3)',
          [mesaId, fuerzaId, cantidad],
        );
      }
    });
    return this.votosDeMesa(mesaId);
  }

  async votosDeMesa(mesaId) {
    const [mesa, porFuerza] = await Promise.all([
      this.mesaPorId(mesaId),
      this.db.filas(
        `SELECT vf.fuerza_id, f.nombre AS fuerza_nombre, vf.cantidad
         FROM elecciones.votos_fuerza vf
         JOIN elecciones.fuerzas f ON f.id = vf.fuerza_id
         WHERE vf.mesa_id = $1
         ORDER BY f.nombre`,
        [mesaId],
      ),
    ]);
    return { blancos: mesa.votos_blancos, nulos: mesa.votos_nulos, porFuerza };
  }

  // ---- Metricas ----

  async metricas(comicioId) {
    const [totalesPorFuerza, blancosNulos, mesas, votantesAsignados] = await Promise.all([
      this.db.filas(
        `SELECT f.id AS fuerza_id, f.nombre AS fuerza_nombre, f.color AS fuerza_color,
                COALESCE(SUM(vf.cantidad), 0)::int AS votos
         FROM elecciones.comicio_fuerzas cf
         JOIN elecciones.fuerzas f ON f.id = cf.fuerza_id
         LEFT JOIN elecciones.votos_fuerza vf
           ON vf.fuerza_id = f.id AND vf.mesa_id IN (SELECT id FROM elecciones.mesas WHERE comicio_id = $1)
         WHERE cf.comicio_id = $1
         GROUP BY f.id, f.nombre, f.color
         ORDER BY f.nombre`,
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
      // Mesas sin rango no matchean el INNER JOIN de la subconsulta y suman 0: correcto,
      // "votantes asignados" no incluye lo que no tiene rango asignado.
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

    const votosFuerza = totalesPorFuerza.reduce((acc, f) => acc + f.votos, 0);
    const emitidos = votosFuerza + blancosNulos.blancos + blancosNulos.nulos;

    return {
      porFuerza: totalesPorFuerza,
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
