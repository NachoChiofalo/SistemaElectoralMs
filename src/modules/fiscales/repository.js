/**
 * Acceso a datos de fiscales y sus asignaciones a mesas por franja horaria.
 */

class FiscalesRepository {
  constructor(db) {
    this.db = db;
  }

  // ---- Fiscales ----

  async crear({ nombre, dni, telefono }) {
    return this.db.unaFila(
      `INSERT INTO elecciones.fiscales (nombre, dni, telefono) VALUES ($1, $2, $3)
       RETURNING id, nombre, dni, telefono, created_at`,
      [nombre, dni ?? null, telefono ?? null],
    );
  }

  async porId(id) {
    return this.db.unaFila(
      'SELECT id, nombre, dni, telefono, created_at FROM elecciones.fiscales WHERE id = $1',
      [id],
    );
  }

  async listar({ page, limit }) {
    const offset = (page - 1) * limit;
    const [registros, { total }] = await Promise.all([
      this.db.filas(
        `SELECT id, nombre, dni, telefono, created_at
         FROM elecciones.fiscales
         ORDER BY nombre
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.db.unaFila('SELECT COUNT(*)::int AS total FROM elecciones.fiscales'),
    ]);
    return { registros, total, page, limit };
  }

  async actualizar(id, { nombre, dni, telefono }) {
    return this.db.unaFila(
      `UPDATE elecciones.fiscales SET nombre = $2, dni = $3, telefono = $4
       WHERE id = $1
       RETURNING id, nombre, dni, telefono, created_at`,
      [id, nombre, dni ?? null, telefono ?? null],
    );
  }

  async eliminar(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.fiscales WHERE id = $1', [id]);
    return rowCount > 0;
  }

  // ---- Mesas (lectura directa; mismo precedente que comicio leyendo elecciones.listas) ----

  async mesa(mesaId) {
    return this.db.unaFila(
      'SELECT id, comicio_id, numero FROM elecciones.mesas WHERE id = $1',
      [mesaId],
    );
  }

  async mesasDeComicio(comicioId) {
    return this.db.filas(
      'SELECT id, numero FROM elecciones.mesas WHERE comicio_id = $1 ORDER BY numero',
      [comicioId],
    );
  }

  // ---- Solapamiento ----

  /** Asignaciones de la MISMA mesa cuyo horario se cruza con [desde, hasta]. */
  async solapaConMesa(mesaId, desde, hasta, excluirId = null) {
    return this.db.filas(
      `SELECT fa.id, f.nombre AS fiscal_nombre, fa.desde, fa.hasta
       FROM elecciones.fiscal_asignaciones fa
       JOIN elecciones.fiscales f ON f.id = fa.fiscal_id
       WHERE fa.mesa_id = $1
         AND ($2::integer IS NULL OR fa.id != $2)
         AND fa.desde < $4 AND fa.hasta > $3`,
      [mesaId, excluirId, desde, hasta],
    );
  }

  /** Asignaciones del MISMO fiscal (en cualquier mesa) cuyo horario se cruza con [desde, hasta]. */
  async solapaConFiscal(fiscalId, desde, hasta, excluirId = null) {
    return this.db.filas(
      `SELECT fa.id, m.numero AS mesa_numero, fa.desde, fa.hasta
       FROM elecciones.fiscal_asignaciones fa
       JOIN elecciones.mesas m ON m.id = fa.mesa_id
       WHERE fa.fiscal_id = $1
         AND ($2::integer IS NULL OR fa.id != $2)
         AND fa.desde < $4 AND fa.hasta > $3`,
      [fiscalId, excluirId, desde, hasta],
    );
  }

  // ---- Asignaciones ----

  async crearAsignacion({ mesaId, fiscalId, desde, hasta }) {
    return this.db.unaFila(
      `INSERT INTO elecciones.fiscal_asignaciones (mesa_id, fiscal_id, desde, hasta)
       VALUES ($1, $2, $3, $4)
       RETURNING id, mesa_id, fiscal_id, desde, hasta`,
      [mesaId, fiscalId, desde, hasta],
    );
  }

  async asignacionPorId(id) {
    return this.db.unaFila(
      'SELECT id, mesa_id, fiscal_id, desde, hasta FROM elecciones.fiscal_asignaciones WHERE id = $1',
      [id],
    );
  }

  async asignacionesDeMesa(mesaId) {
    return this.db.filas(
      `SELECT fa.id, fa.mesa_id, fa.fiscal_id, fa.desde, fa.hasta, f.nombre AS fiscal_nombre
       FROM elecciones.fiscal_asignaciones fa
       JOIN elecciones.fiscales f ON f.id = fa.fiscal_id
       WHERE fa.mesa_id = $1
       ORDER BY fa.desde`,
      [mesaId],
    );
  }

  async actualizarAsignacion(id, { fiscalId, desde, hasta }) {
    return this.db.unaFila(
      `UPDATE elecciones.fiscal_asignaciones SET fiscal_id = $2, desde = $3, hasta = $4
       WHERE id = $1
       RETURNING id, mesa_id, fiscal_id, desde, hasta`,
      [id, fiscalId, desde, hasta],
    );
  }

  async eliminarAsignacion(id) {
    const { rowCount } = await this.db.query('DELETE FROM elecciones.fiscal_asignaciones WHERE id = $1', [id]);
    return rowCount > 0;
  }

  // ---- Agenda ----

  /** Por cada mesa del comicio, el fiscal presente a `hora` (o null). */
  async agendaDeComicio(comicioId, hora) {
    return this.db.filas(
      `SELECT m.id AS mesa_id, m.numero AS mesa_numero, f.id AS fiscal_id, f.nombre AS fiscal_nombre
       FROM elecciones.mesas m
       LEFT JOIN elecciones.fiscal_asignaciones fa
         ON fa.mesa_id = m.id AND fa.desde <= $2 AND fa.hasta > $2
       LEFT JOIN elecciones.fiscales f ON f.id = fa.fiscal_id
       WHERE m.comicio_id = $1
       ORDER BY m.numero`,
      [comicioId, hora],
    );
  }
}

module.exports = { FiscalesRepository };
