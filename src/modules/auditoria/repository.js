/**
 * Acceso a datos de padron.auditoria.
 *
 * Reemplaza al modelo AuditoriaLog, que creaba su propio Pool en el constructor y
 * verificaba/creaba la tabla en cada insercion (ensureTable). El esquema ahora es una
 * migracion y la conexion es la compartida.
 */

class AuditoriaRepository {
  constructor(db) {
    this.db = db;
  }

  async insertar(registro) {
    const {
      usuario_id, usuario_nombre, usuario_username, operacion, entidad,
      entidad_id, datos_anteriores, datos_nuevos, detalles, ip_address,
    } = registro;

    // Sin RETURNING *: nadie usa la fila insertada y traerla cuesta ancho de banda
    // en cada operacion auditada.
    await this.db.query(
      `INSERT INTO padron.auditoria
         (usuario_id, usuario_nombre, usuario_username, operacion, entidad,
          entidad_id, datos_anteriores, datos_nuevos, detalles, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        usuario_id != null ? String(usuario_id) : null,
        usuario_nombre || null,
        usuario_username || null,
        operacion,
        entidad,
        entidad_id != null ? String(entidad_id) : null,
        datos_anteriores ? JSON.stringify(datos_anteriores) : null,
        datos_nuevos ? JSON.stringify(datos_nuevos) : null,
        detalles || null,
        ip_address || null,
      ],
    );
  }

  /** Construye el WHERE compartido por el listado y las estadisticas. */
  static filtros({ usuario_id, operacion, entidad, fecha_desde, fecha_hasta }) {
    const condiciones = [];
    const params = [];

    const agregar = (sql, valor) => {
      if (valor === undefined || valor === null || valor === '') return;
      params.push(valor);
      condiciones.push(sql.replace('$?', `$${params.length}`));
    };

    agregar('usuario_id = $?', usuario_id);
    agregar('operacion = $?', operacion);
    agregar('entidad = $?', entidad);
    agregar('created_at >= $?', fecha_desde);
    agregar('created_at <= $?', fecha_hasta);

    return {
      where: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '',
      params,
    };
  }

  async listar(opciones) {
    const { page = 1, limit = 25 } = opciones;
    const { where, params } = AuditoriaRepository.filtros(opciones);
    const offset = (page - 1) * limit;

    // Una sola ida a la base: la ventana y el total juntos. Antes eran dos consultas
    // que recorrian la tabla dos veces con el mismo filtro.
    const filas = await this.db.filas(
      `SELECT *, COUNT(*) OVER() AS total_filtrado
       FROM padron.auditoria
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const total = filas.length > 0 ? Number(filas[0].total_filtrado) : await this.contar(where, params);
    const registros = filas.map(({ total_filtrado, ...fila }) => fila);

    return { registros, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async contar(where, params) {
    const fila = await this.db.unaFila(`SELECT COUNT(*)::int AS total FROM padron.auditoria ${where}`, params);
    return fila.total;
  }

  async estadisticas(opciones = {}) {
    const { where, params } = AuditoriaRepository.filtros(opciones);

    const [porUsuario, porTipo, porDia, total] = await Promise.all([
      this.db.filas(
        `SELECT usuario_id, usuario_nombre, usuario_username, COUNT(*) AS total_operaciones
         FROM padron.auditoria ${where}
         GROUP BY usuario_id, usuario_nombre, usuario_username
         ORDER BY total_operaciones DESC`,
        params,
      ),
      this.db.filas(
        `SELECT operacion, COUNT(*) AS total
         FROM padron.auditoria ${where}
         GROUP BY operacion ORDER BY total DESC`,
        params,
      ),
      this.db.filas(
        `SELECT DATE(created_at) AS fecha, COUNT(*) AS total
         FROM padron.auditoria ${where}
         GROUP BY DATE(created_at) ORDER BY fecha DESC LIMIT 30`,
        params,
      ),
      this.db.unaFila(`SELECT COUNT(*)::int AS total FROM padron.auditoria ${where}`, params),
    ]);

    return {
      totalOperaciones: total.total,
      porUsuario,
      porTipo,
      porDia,
    };
  }

  async porId(id) {
    return this.db.unaFila('SELECT * FROM padron.auditoria WHERE id = $1', [id]);
  }
}

module.exports = AuditoriaRepository;
