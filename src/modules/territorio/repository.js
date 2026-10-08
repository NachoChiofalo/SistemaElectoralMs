/**
 * SQL del mapa (018). Lecturas agregadas: ninguna consulta es por manzana en un bucle, y los cortes por
 * opcion, sexo y edad reutilizan los fragmentos del padron para decir exactamente lo mismo que Resultados.
 *
 * Las escrituras grandes (capas, ubicaciones) van por lotes con jsonb_to_recordset: una sentencia por lote,
 * no una por fila.
 */

const { agregadosVoto, porOpcion, EDAD_VIGENTE, RANGO_ETARIO, ORDEN_RANGO_ETARIO } = require('../padron/repository');

const TAMANO_LOTE = 1000;

/** Partes de una lista en trozos de `n`. */
function enLotes(lista, n = TAMANO_LOTE) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += n) lotes.push(lista.slice(i, i + n));
  return lotes;
}

/**
 * Filtro de zona: una manzana (por su id) o un sector (sus manzanas). Devuelve el JOIN y el WHERE que
 * acotan `padron.votantes v` a los votantes ubicados en esa zona. El id siempre viaja como parametro.
 */
function filtroZona(tipo, posicion) {
  if (tipo === 'manzana') {
    return { join: 'JOIN territorio.ubicaciones u ON u.dni = v.dni', where: `u.manzana_id = $${posicion}` };
  }
  return {
    join: 'JOIN territorio.ubicaciones u ON u.dni = v.dni JOIN territorio.manzanas m ON m.id = u.manzana_id',
    where: `m.sector_id = $${posicion}`,
  };
}

class TerritorioRepository {
  constructor(db) {
    this.db = db;
  }

  // ------------------------------------------------------------ configuracion

  configuracion() {
    return this.db.unaFila(
      'SELECT localidad, departamento, umbral_privacidad, etiqueta_barrio, fuente, cargado_en FROM territorio.configuracion WHERE id = 1',
    );
  }

  // ------------------------------------------------------------ capas

  /**
   * Reemplaza las tres capas en una transaccion (`cliente` es el de db.transaccion). Las ubicaciones se
   * vacian: quien carga llama a reubicar() enseguida. Los ids de manzana son los de la fuente y se
   * conservan entre cargas.
   */
  async reemplazarCapas(cliente, { tramos, manzanas, sectores, asignacion, configuracion }) {
    await cliente.query('DELETE FROM territorio.ubicaciones');
    await cliente.query('DELETE FROM territorio.calles_tramos');
    await cliente.query('DELETE FROM territorio.manzanas');
    await cliente.query('DELETE FROM territorio.sectores');

    for (const lote of enLotes(sectores)) {
      await cliente.query(
        `INSERT INTO territorio.sectores (codigo, nombre, tipo, anillos, poblacion_2022, viviendas_2022)
         SELECT codigo, nombre, 'radio_censal', anillos, poblacion, viviendas
         FROM jsonb_to_recordset($1::jsonb) AS x(codigo text, nombre text, anillos jsonb, poblacion int, viviendas int)`,
        [JSON.stringify(lote)],
      );
    }

    const conSector = manzanas.map((m) => ({ id: m.id, anillos: m.anillos, sector: asignacion.get(m.id) ?? null }));
    for (const lote of enLotes(conSector)) {
      await cliente.query(
        `INSERT INTO territorio.manzanas (id, anillos, sector_id)
         SELECT x.id, x.anillos, s.id
         FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, anillos jsonb, sector text)
         LEFT JOIN territorio.sectores s ON s.codigo = x.sector`,
        [JSON.stringify(lote)],
      );
    }

    for (const lote of enLotes(tramos)) {
      await cliente.query(
        `INSERT INTO territorio.calles_tramos (nombre, aii, afi, aid, afd, camino)
         SELECT nombre, aii, afi, aid, afd, camino
         FROM jsonb_to_recordset($1::jsonb) AS x(nombre text, aii int, afi int, aid int, afd int, camino jsonb)`,
        [JSON.stringify(lote)],
      );
    }

    await cliente.query(
      `UPDATE territorio.configuracion
       SET localidad = $1, departamento = $2, fuente = $3, cargado_en = NOW()
       WHERE id = 1`,
      [configuracion.localidad, configuracion.departamento || null, configuracion.fuente],
    );
  }

  /** Las capas tal como las necesita el indice de ubicacion. */
  async capas(cliente = this.db) {
    const [tramos, manzanas] = await Promise.all([
      cliente.query('SELECT nombre, aii, afi, aid, afd, camino FROM territorio.calles_tramos ORDER BY id'),
      cliente.query('SELECT id, anillos FROM territorio.manzanas ORDER BY id'),
    ]);
    return {
      tramos: tramos.rows,
      manzanas: manzanas.rows.map((m) => ({ id: Number(m.id), anillos: m.anillos })),
    };
  }

  /** Geometria para dibujar: barrios y manzanas. */
  async geometria() {
    const [sectores, manzanas] = await Promise.all([
      this.db.filas('SELECT id, codigo, nombre, anillos, poblacion_2022, viviendas_2022 FROM territorio.sectores ORDER BY codigo'),
      this.db.filas('SELECT id, sector_id, anillos FROM territorio.manzanas ORDER BY id'),
    ]);
    return { sectores, manzanas };
  }

  // ------------------------------------------------------------ ubicaciones

  /** Solo lo que hace falta para ubicar: el DNI y el texto del domicilio. */
  domicilios(cliente = this.db) {
    return cliente.query('SELECT dni, domicilio FROM padron.votantes ORDER BY dni').then((r) => r.rows);
  }

  /** Guarda las ubicaciones por lotes, pisando la anterior de cada DNI. */
  async guardarUbicaciones(cliente, filas) {
    for (const lote of enLotes(filas)) {
      await cliente.query(
        `INSERT INTO territorio.ubicaciones
           (dni, estado, detalle, manzana_id, lat, lon, calle, numero, aproximada, estimado, calculado_en)
         SELECT dni, estado, detalle, manzana_id, lat, lon, calle, numero,
                COALESCE(aproximada, FALSE), COALESCE(estimado, FALSE), NOW()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           dni text, estado text, detalle text, manzana_id bigint, lat float8, lon float8,
           calle text, numero int, aproximada boolean, estimado boolean)
         ON CONFLICT (dni) DO UPDATE SET
           estado = EXCLUDED.estado, detalle = EXCLUDED.detalle, manzana_id = EXCLUDED.manzana_id,
           lat = EXCLUDED.lat, lon = EXCLUDED.lon, calle = EXCLUDED.calle, numero = EXCLUDED.numero,
           aproximada = EXCLUDED.aproximada, estimado = EXCLUDED.estimado, calculado_en = EXCLUDED.calculado_en`,
        [JSON.stringify(lote)],
      );
    }
  }

  /** Cuantos votantes hay en cada estado. "sin_calcular" = votante sin fila de ubicacion. */
  resumenUbicacion() {
    return this.db.filas(
      `SELECT COALESCE(u.estado, 'sin_calcular') AS estado, COUNT(*)::int AS votantes
       FROM padron.votantes v
       LEFT JOIN territorio.ubicaciones u ON u.dni = v.dni
       GROUP BY 1`,
    );
  }

  /** Los pendientes agrupados por motivo y detalle, de mas a menos frecuente. */
  pendientes() {
    return this.db.filas(
      `SELECT estado, detalle, COUNT(*)::int AS votantes
       FROM territorio.ubicaciones
       WHERE estado <> 'ok'
       GROUP BY estado, detalle
       ORDER BY votantes DESC, estado, detalle`,
    );
  }

  // ------------------------------------------------------------ estadisticas

  /**
   * Todas las manzanas en UNA consulta: votantes, relevados y votos por opcion. Los barrios se suman en el
   * servicio a partir de esto, sin otra consulta.
   */
  estadisticasPorManzana(codigos) {
    return this.db.filas(
      `SELECT u.manzana_id AS manzana, ${agregadosVoto(codigos, 1)}
       FROM padron.votantes v
       JOIN territorio.ubicaciones u ON u.dni = v.dni AND u.manzana_id IS NOT NULL
       LEFT JOIN padron.relevamientos r ON r.dni = v.dni
       GROUP BY u.manzana_id`,
      codigos,
    );
  }

  /** A que barrio pertenece cada manzana (para sumar las estadisticas por barrio sin otra consulta). */
  manzanasSectores() {
    return this.db.filas('SELECT id, sector_id FROM territorio.manzanas');
  }

  sectores() {
    return this.db.filas('SELECT id, codigo, nombre FROM territorio.sectores ORDER BY codigo');
  }

  cargadoEn() {
    return this.db.unaFila('SELECT cargado_en FROM territorio.configuracion WHERE id = 1');
  }

  manzana(id) {
    return this.db.unaFila('SELECT id, sector_id FROM territorio.manzanas WHERE id = $1', [id]);
  }

  sector(id) {
    return this.db.unaFila('SELECT id, codigo, nombre, poblacion_2022, viviendas_2022 FROM territorio.sectores WHERE id = $1', [id]);
  }

  /**
   * Toda la informacion de una zona (manzana o sector) en cuatro consultas en paralelo, cada una agrupada:
   * el total con su desglose, el corte por sexo, el corte por edad y las condiciones especiales.
   */
  async detalleZona(tipo, id, codigos) {
    const n = codigos.length;
    const { join, where } = filtroZona(tipo, n + 1);
    const params = [...codigos, id];
    const cruce = (condicion) => porOpcion(codigos, 1, (f) => `COUNT(*) FILTER (WHERE r.${condicion} AND ${f})`);

    const [total, porSexo, porEdad, condiciones] = await Promise.all([
      this.db.unaFila(
        `SELECT ${agregadosVoto(codigos, 1)}
         FROM padron.votantes v ${join}
         LEFT JOIN padron.relevamientos r ON r.dni = v.dni
         WHERE ${where}`,
        params,
      ),
      this.db.filas(
        `SELECT v.sexo, ${agregadosVoto(codigos, 1)}
         FROM padron.votantes v ${join}
         LEFT JOIN padron.relevamientos r ON r.dni = v.dni
         WHERE ${where}
         GROUP BY v.sexo ORDER BY v.sexo`,
        params,
      ),
      this.db.filas(
        `SELECT rango_etario, ${agregadosVoto(codigos, 1)}
         FROM (
           SELECT v.*, ${RANGO_ETARIO} AS rango_etario
           FROM (SELECT vv.*, ${EDAD_VIGENTE} AS edad_vigente FROM padron.votantes vv) v
         ) v ${join}
         LEFT JOIN padron.relevamientos r ON r.dni = v.dni
         WHERE ${where}
         GROUP BY rango_etario ORDER BY ${ORDEN_RANGO_ETARIO}`,
        params,
      ),
      this.db.unaFila(
        `SELECT
           COUNT(*) FILTER (WHERE r.es_empleado_municipal) AS empleados_municipales,
           COUNT(*) FILTER (WHERE r.recibe_ayuda_social)   AS ayuda_social,
           COUNT(*) FILTER (WHERE r.es_nuevo_votante)      AS nuevos_votantes,
           COUNT(*) FILTER (WHERE r.esta_fallecido)        AS fallecidos,
           ${cruce('es_empleado_municipal')} AS empleados_municipales_por_opcion,
           ${cruce('recibe_ayuda_social')}   AS ayuda_social_por_opcion,
           ${cruce('es_nuevo_votante')}      AS nuevos_votantes_por_opcion,
           ${cruce('esta_fallecido')}        AS fallecidos_por_opcion
         FROM padron.votantes v ${join}
         LEFT JOIN padron.relevamientos r ON r.dni = v.dni
         WHERE ${where}`,
        params,
      ),
    ]);
    return { total, porSexo, porEdad, condiciones };
  }

  /**
   * Los votantes de una manzana para el casa por casa, ordenados por calle y numero (como se camina). SIN la
   * opcion politica: se ve en la ficha del padron (decision de la spec).
   */
  votantesDeManzana(id, limite, desde) {
    return this.db.filas(
      `SELECT v.dni, v.apellido, v.nombre, v.domicilio, v.edad, u.calle, u.numero,
              (r.dni IS NOT NULL) AS relevado, r.fecha_modificacion,
              COUNT(*) OVER () AS total
       FROM territorio.ubicaciones u
       JOIN padron.votantes v ON v.dni = u.dni
       LEFT JOIN padron.relevamientos r ON r.dni = u.dni
       WHERE u.manzana_id = $1
       ORDER BY u.calle, u.numero, v.apellido, v.nombre, v.dni
       LIMIT $2 OFFSET $3`,
      [id, limite, desde],
    );
  }
}

module.exports = { TerritorioRepository, enLotes };
