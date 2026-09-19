/**
 * Acceso a datos del padron.
 *
 * Reune el SQL que estaba repartido entre Database.js (541 lineas, con su propio Pool),
 * DetalleVotanteService y el propio controlador.
 */

// Campos por los que se puede ordenar. Es una lista blanca: el nombre de columna se
// interpola en el SQL, asi que no puede venir del cliente sin validar.
const CAMPOS_ORDEN = {
  dni: 'v.dni',
  apellido: 'v.apellido',
  nombre: 'v.nombre',
  edad: 'v.edad',
  circuito: 'v.circuito',
  sexo: 'v.sexo',
};

const COLUMNAS_EXPORT = `
  v.dni, v.apellido, v.nombre, v.anio_nac, v.domicilio,
  v.tipo_ejemplar, v.circuito, v.sexo, v.edad,
  r.opcion_politica, r.observacion, r.fecha_relevamiento,
  r.fecha_modificacion, r.es_nuevo_votante, r.esta_fallecido,
  r.es_empleado_municipal, r.recibe_ayuda_social,
  r.observaciones_detalle, r.fecha_detalle, r.telefono
`;

/** Bloque de agregados de voto, identico en las cuatro consultas de resultados. */
const AGREGADOS_VOTO = `
  COUNT(*)                                              AS total_votantes,
  COUNT(r.dni)                                          AS total_relevados,
  ROUND(COUNT(r.dni) * 100.0 / NULLIF(COUNT(*), 0), 2)  AS porcentaje_participacion,
  COUNT(*) FILTER (WHERE r.opcion_politica = 'PJ')       AS votos_pj,
  COUNT(*) FILTER (WHERE r.opcion_politica = 'UCR')      AS votos_ucr,
  COUNT(*) FILTER (WHERE r.opcion_politica = 'Indeciso') AS votos_indeciso,
  ROUND(COUNT(*) FILTER (WHERE r.opcion_politica = 'PJ')       * 100.0 / NULLIF(COUNT(r.dni), 0), 2) AS porcentaje_pj,
  ROUND(COUNT(*) FILTER (WHERE r.opcion_politica = 'UCR')      * 100.0 / NULLIF(COUNT(r.dni), 0), 2) AS porcentaje_ucr,
  ROUND(COUNT(*) FILTER (WHERE r.opcion_politica = 'Indeciso') * 100.0 / NULLIF(COUNT(r.dni), 0), 2) AS porcentaje_indeciso
`;

class PadronRepository {
  constructor(db) {
    this.db = db;
  }

  // ------------------------------------------------------------- votantes

  /**
   * Pagina el padron con filtros. Devuelve la ventana y el total en UNA consulta,
   * con COUNT(*) OVER(): antes eran dos recorridos con el mismo WHERE.
   */
  async votantesPaginados(pagina, limite, filtros = {}) {
    const condiciones = [];
    const params = [];

    if (filtros.busqueda) {
      params.push(`%${filtros.busqueda.toLowerCase()}%`);
      condiciones.push(
        `(v.dni LIKE $${params.length} OR LOWER(v.nombre) LIKE $${params.length} OR LOWER(v.apellido) LIKE $${params.length})`,
      );
    }
    if (filtros.circuito) {
      params.push(filtros.circuito);
      condiciones.push(`v.circuito = $${params.length}`);
    }
    if (filtros.sexo) {
      params.push(filtros.sexo);
      condiciones.push(`v.sexo = $${params.length}`);
    }
    if (filtros.opcionPolitica) {
      params.push(filtros.opcionPolitica);
      condiciones.push(`r.opcion_politica = $${params.length}`);
    }
    if (filtros.sinRelevamiento) {
      condiciones.push('r.dni IS NULL');
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const campo = CAMPOS_ORDEN[filtros.ordenCampo] || 'v.apellido';
    const direccion = filtros.ordenDireccion === 'desc' ? 'DESC' : 'ASC';

    const offset = (pagina - 1) * limite;
    params.push(limite, offset);

    const filas = await this.db.filas(
      `SELECT
         v.*,
         r.dni AS relevamiento_dni,
         r.opcion_politica, r.fecha_relevamiento, r.observacion, r.telefono, r.version,
         r.es_nuevo_votante, r.esta_fallecido, r.es_empleado_municipal,
         r.recibe_ayuda_social, r.observaciones_detalle, r.fecha_detalle,
         COUNT(*) OVER() AS total_filtrado
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni
       ${where}
       ORDER BY ${campo} ${direccion}, v.nombre ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Con cero filas COUNT(*) OVER() no devuelve nada: el total es cero salvo que se
    // haya pedido una pagina mas alla del final, caso en que hace falta contar.
    let total = filas.length > 0 ? Number(filas[0].total_filtrado) : 0;
    if (filas.length === 0 && pagina > 1) {
      const fila = await this.db.unaFila(
        `SELECT COUNT(*)::int AS total
         FROM padron.votantes v
         LEFT JOIN padron.relevamientos r ON v.dni = r.dni
         ${where}`,
        params.slice(0, -2),
      );
      total = fila.total;
    }

    return {
      votantes: filas.map(({ total_filtrado, ...fila }) => fila),
      total,
      pagina,
      limite,
      totalPaginas: Math.ceil(total / limite),
    };
  }

  votantePorDni(dni) {
    return this.db.unaFila(
      `SELECT v.*, r.opcion_politica, r.fecha_relevamiento, r.observacion,
              r.fecha_modificacion, r.telefono, r.version,
              r.actualizado_por, r.actualizado_por_username
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni
       WHERE v.dni = $1`,
      [dni],
    );
  }

  async contarVotantes() {
    const { total } = await this.db.unaFila('SELECT COUNT(*)::int AS total FROM padron.votantes');
    return total;
  }

  insertarVotante(votante) {
    return this.db.unaFila(
      `INSERT INTO padron.votantes
         (dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (dni) DO UPDATE SET
         anio_nac      = EXCLUDED.anio_nac,
         apellido      = EXCLUDED.apellido,
         nombre        = EXCLUDED.nombre,
         domicilio     = EXCLUDED.domicilio,
         tipo_ejemplar = EXCLUDED.tipo_ejemplar,
         circuito      = EXCLUDED.circuito,
         sexo          = EXCLUDED.sexo,
         edad          = EXCLUDED.edad,
         updated_at    = CURRENT_TIMESTAMP
       RETURNING dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad`,
      [
        votante.dni, votante.anio_nac, votante.apellido, votante.nombre,
        votante.domicilio, votante.tipo_ejemplar, votante.circuito, votante.sexo, votante.edad,
      ],
    );
  }

  // -------------------------------------------------------- relevamientos

  /**
   * Escritura parcial: un campo que llega como NULL no se toca.
   *
   * Antes esto escribia siempre las tres columnas, y por eso quien cargaba un telefono
   * tenia que leer la fila entera para "preservar" la observacion y volver a mandarla.
   * Entre esa lectura y esta escritura, cualquier cosa que hubiera guardado otra persona
   * se perdia. Con dos personas sobre el mismo padron eso es perdida de datos silenciosa,
   * y con una sola ya fallaba: el panel mandaba telefono y observacion en paralelo, cada
   * uno con el valor viejo del otro.
   *
   * El COALESCE de la rama DO UPDATE va contra el **parametro**, no contra EXCLUDED:
   * EXCLUDED ya trae el default aplicado en VALUES, y usarlo volveria a escribir
   * 'Indeciso' o '' sobre lo que hubiera en la fila.
   *
   * NULL significa "no tocar"; cadena vacia significa "vaciar". Son dos cosas distintas
   * y el service es el que las traduce desde el cuerpo del request.
   */
  upsertRelevamiento(dni, {
    opcion_politica = null, observacion = null, telefono = null,
    actualizado_por = null, actualizado_por_username = null, version_esperada = null,
  }) {
    return this.db.unaFila(
      `INSERT INTO padron.relevamientos
         (dni, opcion_politica, observacion, telefono,
          actualizado_por, actualizado_por_username)
       VALUES ($1, COALESCE($2, 'Indeciso'), COALESCE($3, ''), COALESCE($4, ''), $5, $6)
       ON CONFLICT (dni) DO UPDATE SET
         opcion_politica          = COALESCE($2, padron.relevamientos.opcion_politica),
         observacion              = COALESCE($3, padron.relevamientos.observacion),
         telefono                 = COALESCE($4, padron.relevamientos.telefono),
         actualizado_por          = $5,
         actualizado_por_username = $6,
         fecha_modificacion       = CURRENT_TIMESTAMP,
         version                  = padron.relevamientos.version + 1
       WHERE padron.relevamientos.version = $7
         AND (
           COALESCE($2, padron.relevamientos.opcion_politica) IS DISTINCT FROM padron.relevamientos.opcion_politica
           OR COALESCE($3, padron.relevamientos.observacion)  IS DISTINCT FROM padron.relevamientos.observacion
           OR COALESCE($4, padron.relevamientos.telefono)     IS DISTINCT FROM padron.relevamientos.telefono
         )
       RETURNING *`,
      [
        dni, opcion_politica, observacion, telefono,
        actualizado_por, actualizado_por_username, version_esperada,
      ],
    );
  }

  /**
   * La fila de relevamiento sola, sin el JOIN con votantes.
   *
   * La necesita el service cuando el upsert no devuelve nada, para distinguir por que:
   * version vieja (409) o nada que cambiar (200). Tiene que ser una lectura nueva y no
   * la que se hizo antes de escribir — justamente lo que se esta averiguando es si
   * alguien escribio en el medio.
   */
  relevamientoCrudo(dni) {
    return this.db.unaFila('SELECT * FROM padron.relevamientos WHERE dni = $1', [dni]);
  }

  /**
   * DNIs cuya ficha cambio despues de un momento dado.
   *
   * fecha_modificacion y fecha_detalle se miran las dos porque las condiciones
   * especiales se guardan por otro endpoint y solo mueven la segunda: una ficha puede
   * cambiar sin que fecha_modificacion se entere.
   *
   * El limite existe para que la respuesta no crezca sin techo despues de una
   * importacion o de un dia entero sin recargar la pagina. Quien lo consume solo
   * necesita saber que filas marcar de la pagina que tiene en pantalla.
   */
  dnisModificadosDesde(desde, limite = 500) {
    return this.db.filas(
      `SELECT dni,
              GREATEST(fecha_modificacion, COALESCE(fecha_detalle, fecha_modificacion)) AS cambiado_en,
              actualizado_por_username
       FROM padron.relevamientos
       WHERE fecha_modificacion > $1 OR fecha_detalle > $1
       ORDER BY cambiado_en DESC
       LIMIT $2`,
      [desde, limite],
    );
  }

  existeVotante(dni) {
    return this.db.unaFila('SELECT 1 FROM padron.votantes WHERE dni = $1', [dni]);
  }

  /**
   * Guarda las condiciones especiales. Crea el relevamiento base si el votante todavia
   * no tiene uno: antes eran tres consultas (existe? crear; actualizar) y ahora es una.
   */
  /**
   * Las condiciones especiales **no tocan `version` ni la chequean**, a diferencia de
   * upsertRelevamiento. Es deliberado:
   *
   * - El panel guarda la ficha con dos requests seguidos contra esta misma fila. Si este
   *   moviera la version, el primero la dejaria en N+1 y el segundo —que salio con N—
   *   chocaria contra si mismo.
   * - La version cubre lo que se escribe a mano y duele perder: opcion politica,
   *   observacion y telefono. Cuatro casillas que se ven enteras en pantalla son otra
   *   cosa: quien las guarda esta mirando su estado actual, porque el panel relee la
   *   ficha al abrirse.
   *
   * Lo que si hace es dejar su firma y mover fecha_detalle, asi que un cambio de
   * condiciones se ve igual en la marca de fila cambiada.
   */
  guardarDetalle(dni, condiciones, autor = {}) {
    return this.db.unaFila(
      `INSERT INTO padron.relevamientos
         (dni, opcion_politica, observacion, es_nuevo_votante, esta_fallecido,
          es_empleado_municipal, recibe_ayuda_social, observaciones_detalle, fecha_detalle,
          actualizado_por, actualizado_por_username)
       VALUES ($1, 'Indeciso', '', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8)
       ON CONFLICT (dni) DO UPDATE SET
         es_nuevo_votante         = EXCLUDED.es_nuevo_votante,
         esta_fallecido           = EXCLUDED.esta_fallecido,
         es_empleado_municipal    = EXCLUDED.es_empleado_municipal,
         recibe_ayuda_social      = EXCLUDED.recibe_ayuda_social,
         observaciones_detalle    = EXCLUDED.observaciones_detalle,
         fecha_detalle            = CURRENT_TIMESTAMP,
         actualizado_por          = EXCLUDED.actualizado_por,
         actualizado_por_username = EXCLUDED.actualizado_por_username
       RETURNING *`,
      [
        dni,
        condiciones.esNuevoVotante,
        condiciones.estaFallecido,
        condiciones.esEmpleadoMunicipal,
        condiciones.recibeAyudaSocial,
        condiciones.observacionesDetalle,
        autor.actualizado_por ?? null,
        autor.actualizado_por_username ?? null,
      ],
    );
  }

  detallePorDni(dni) {
    return this.db.unaFila(
      `SELECT r.*, v.apellido, v.nombre
       FROM padron.relevamientos r
       JOIN padron.votantes v ON r.dni = v.dni
       WHERE r.dni = $1`,
      [dni],
    );
  }

  async limpiarDetalle(dni) {
    const { rowCount } = await this.db.query(
      `UPDATE padron.relevamientos SET
         es_nuevo_votante      = FALSE,
         esta_fallecido        = FALSE,
         es_empleado_municipal = FALSE,
         recibe_ayuda_social   = FALSE,
         observaciones_detalle = '',
         fecha_detalle         = CURRENT_TIMESTAMP
       WHERE dni = $1`,
      [dni],
    );
    return rowCount > 0;
  }

  votantesConCondicionesEspeciales(filtros = {}) {
    const condiciones = ['(r.es_nuevo_votante OR r.esta_fallecido OR r.es_empleado_municipal OR r.recibe_ayuda_social)'];
    const params = [];

    const porFlag = {
      esNuevoVotante: 'r.es_nuevo_votante',
      estaFallecido: 'r.esta_fallecido',
      esEmpleadoMunicipal: 'r.es_empleado_municipal',
      recibeAyudaSocial: 'r.recibe_ayuda_social',
    };

    for (const [clave, columna] of Object.entries(porFlag)) {
      if (filtros[clave] === undefined) continue;
      params.push(filtros[clave]);
      condiciones.push(`${columna} = $${params.length}`);
    }

    return this.db.filas(
      `SELECT v.dni, v.apellido, v.nombre, v.edad, v.sexo, v.circuito,
              r.es_nuevo_votante, r.esta_fallecido, r.es_empleado_municipal,
              r.recibe_ayuda_social, r.observaciones_detalle, r.fecha_detalle,
              r.opcion_politica, r.observacion
       FROM padron.votantes v
       JOIN padron.relevamientos r ON v.dni = r.dni
       WHERE ${condiciones.join(' AND ')}
       ORDER BY v.apellido, v.nombre`,
      params,
    );
  }

  estadisticasCondicionesEspeciales() {
    return this.db.unaFila('SELECT * FROM padron.estadisticas_condiciones_especiales');
  }

  // ----------------------------------------------------------- resultados

  estadisticasBasicas() {
    return this.db.unaFila(
      `SELECT
         COUNT(*)     AS total_votantes,
         COUNT(r.dni) AS total_relevados,
         COUNT(*) FILTER (WHERE r.opcion_politica = 'PJ')       AS votos_pj,
         COUNT(*) FILTER (WHERE r.opcion_politica = 'UCR')      AS votos_ucr,
         COUNT(*) FILTER (WHERE r.opcion_politica = 'Indeciso') AS votos_indeciso
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni`,
    );
  }

  estadisticasAvanzadas() {
    return this.db.unaFila(
      `SELECT ${AGREGADOS_VOTO}
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni`,
    );
  }

  estadisticasPorSexo() {
    return this.db.filas(
      `SELECT v.sexo, ${AGREGADOS_VOTO}
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni
       GROUP BY v.sexo
       ORDER BY v.sexo`,
    );
  }

  /**
   * Rangos etarios. El SQL original repetia el CASE completo cinco veces (una por
   * columna, una en el GROUP BY y tres en el ORDER BY); con una subconsulta se
   * escribe una sola vez y Postgres lo evalua una vez por fila.
   */
  estadisticasPorRangoEtario() {
    return this.db.filas(
      `SELECT rango_etario, ${AGREGADOS_VOTO}
       FROM (
         SELECT v.*,
                CASE
                  WHEN v.edad BETWEEN 18 AND 30 THEN '18-30'
                  WHEN v.edad BETWEEN 31 AND 45 THEN '31-45'
                  WHEN v.edad BETWEEN 46 AND 60 THEN '46-60'
                  WHEN v.edad > 60              THEN '60+'
                  ELSE 'Sin definir'
                END AS rango_etario
         FROM padron.votantes v
       ) v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni
       GROUP BY rango_etario
       ORDER BY CASE rango_etario
                  WHEN '18-30' THEN 1
                  WHEN '31-45' THEN 2
                  WHEN '46-60' THEN 3
                  WHEN '60+'   THEN 4
                  ELSE 5
                END`,
    );
  }

  estadisticasPorCircuito() {
    return this.db.filas(
      `SELECT v.circuito, ${AGREGADOS_VOTO}
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni
       GROUP BY v.circuito
       ORDER BY v.circuito`,
    );
  }

  estadisticasCondicionesDetalladas() {
    return this.db.unaFila(
      `SELECT
         COUNT(r.dni) AS total_relevados,
         COUNT(*) FILTER (WHERE r.es_empleado_municipal) AS total_empleados_municipales,
         COUNT(*) FILTER (WHERE r.recibe_ayuda_social)   AS total_ayuda_social,
         COUNT(*) FILTER (WHERE r.esta_fallecido)        AS total_fallecidos,
         COUNT(*) FILTER (WHERE r.es_nuevo_votante)      AS total_nuevos_votantes,

         COUNT(*) FILTER (WHERE r.es_empleado_municipal AND r.opcion_politica = 'PJ')       AS empleados_pj,
         COUNT(*) FILTER (WHERE r.es_empleado_municipal AND r.opcion_politica = 'UCR')      AS empleados_ucr,
         COUNT(*) FILTER (WHERE r.es_empleado_municipal AND r.opcion_politica = 'Indeciso') AS empleados_indeciso,

         COUNT(*) FILTER (WHERE r.recibe_ayuda_social AND r.opcion_politica = 'PJ')       AS ayuda_social_pj,
         COUNT(*) FILTER (WHERE r.recibe_ayuda_social AND r.opcion_politica = 'UCR')      AS ayuda_social_ucr,
         COUNT(*) FILTER (WHERE r.recibe_ayuda_social AND r.opcion_politica = 'Indeciso') AS ayuda_social_indeciso,

         COUNT(*) FILTER (WHERE r.es_nuevo_votante AND r.opcion_politica = 'PJ')       AS nuevos_pj,
         COUNT(*) FILTER (WHERE r.es_nuevo_votante AND r.opcion_politica = 'UCR')      AS nuevos_ucr,
         COUNT(*) FILTER (WHERE r.es_nuevo_votante AND r.opcion_politica = 'Indeciso') AS nuevos_indeciso,

         COUNT(*) FILTER (WHERE r.esta_fallecido AND r.opcion_politica = 'PJ')       AS fallecidos_pj,
         COUNT(*) FILTER (WHERE r.esta_fallecido AND r.opcion_politica = 'UCR')      AS fallecidos_ucr,
         COUNT(*) FILTER (WHERE r.esta_fallecido AND r.opcion_politica = 'Indeciso') AS fallecidos_indeciso,

         COUNT(*) FILTER (WHERE r.es_empleado_municipal AND v.sexo = 'M') AS empleados_masculino,
         COUNT(*) FILTER (WHERE r.es_empleado_municipal AND v.sexo = 'F') AS empleados_femenino,
         COUNT(*) FILTER (WHERE r.recibe_ayuda_social AND v.sexo = 'M')   AS ayuda_social_masculino,
         COUNT(*) FILTER (WHERE r.recibe_ayuda_social AND v.sexo = 'F')   AS ayuda_social_femenino
       FROM padron.votantes v
       LEFT JOIN padron.relevamientos r ON v.dni = r.dni`,
    );
  }

  circuitosDisponibles() {
    return this.db.filas(
      'SELECT DISTINCT circuito FROM padron.votantes WHERE circuito IS NOT NULL ORDER BY circuito',
    );
  }

  sexosDisponibles() {
    return this.db.filas(
      'SELECT DISTINCT sexo FROM padron.votantes WHERE sexo IS NOT NULL ORDER BY sexo',
    );
  }

  // ------------------------------------------------------------ exportar

  /**
   * Cursor sobre las filas a exportar. Devuelve un stream en lugar de un array para
   * que exportar el padron completo no cargue la tabla entera en memoria.
   */
  streamExportacion(soloRelevados) {
    const join = soloRelevados ? 'INNER JOIN' : 'LEFT JOIN';
    return `SELECT ${COLUMNAS_EXPORT}
            FROM padron.votantes v
            ${join} padron.relevamientos r ON v.dni = r.dni
            ORDER BY v.apellido ASC, v.nombre ASC`;
  }
}

module.exports = { PadronRepository, CAMPOS_ORDEN };
