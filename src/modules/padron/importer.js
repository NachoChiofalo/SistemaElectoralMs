/**
 * Importacion del padron desde CSV.
 *
 * El importador viejo hacia esto (PadronService.js:69):
 *
 *     .on('data', async (fila) => { await this.db.insertarVotante(fila); })
 *
 * Un handler async sobre un stream que no se pausa: el stream sigue emitiendo filas
 * sin esperar a que la insercion anterior termine. Con un padron de decenas de miles
 * de filas eso dispara miles de INSERT ... RETURNING * en paralelo, satura el pool y
 * hace crecer el heap sin techo. Ademas el contador de exitos se leia en el evento
 * 'end', que llega antes de que las inserciones hayan terminado, asi que el total
 * reportado no era el real.
 *
 * Aca el CSV se transforma en un stream de texto y se manda con COPY a una tabla
 * temporal, con backpressure real: si Postgres no da abasto, el archivo deja de
 * leerse. Despues un unico INSERT ... SELECT ... ON CONFLICT vuelca la temporal sobre
 * padron.votantes. La memoria se mantiene constante sin importar el tamano del archivo.
 */

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const csv = require('csv-parser');
const copyFrom = require('pg-copy-streams').from;
const { errores } = require('../../core/errors');

/** Columnas del CSV, en el orden en que las escribe la Junta Electoral. */
const COLUMNAS = ['dni', 'anio_nac', 'apellido', 'nombre', 'domicilio', 'tipo_ejemplar', 'circuito', 'sexo', 'edad'];

/**
 * Lee un campo aceptando tanto los encabezados del CSV oficial (DNI, ANO NAC, S)
 * como los nombres internos, que es lo que hacia el codigo viejo.
 */
function campo(fila, ...nombres) {
  for (const nombre of nombres) {
    const valor = fila[nombre];
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      return String(valor).trim();
    }
  }
  return null;
}

/** Escapa un valor para el formato TEXT de COPY. */
function escaparCopy(valor) {
  if (valor === null || valor === undefined || valor === '') return '\\N';
  return String(valor)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Convierte una fila del CSV en la linea TSV que espera COPY.
 * Devuelve null si la fila no es utilizable.
 */
function filaATsv(fila, anioActual) {
  const dni = campo(fila, 'DNI', 'dni');
  if (!dni) return null;

  // El encabezado real trae 'AÑO NAC'; segun como se haya guardado el archivo puede
  // llegar como 'ANO NAC' o con la ene mal codificada.
  const anioNac = campo(fila, 'AÑO NAC', 'ANO NAC', 'ANIO NAC', 'anio_nac', 'anioNac');
  const anio = Number.parseInt(anioNac, 10);
  if (!Number.isFinite(anio)) return null;

  const apellido = campo(fila, 'APELLIDO', 'apellido');
  const nombre = campo(fila, 'NOMBRE', 'nombre');
  if (!apellido || !nombre) return null;

  const sexo = campo(fila, 'S', 'SEXO', 'sexo');

  return [
    dni,
    anio,
    apellido,
    nombre,
    campo(fila, 'DOMICILIO', 'domicilio'),
    campo(fila, 'TIPO_EJEMPL', 'tipo_ejemplar', 'tipoEjempl'),
    campo(fila, 'CIRCUITO', 'circuito'),
    // La columna tiene CHECK (sexo IN ('M','F')): cualquier otra cosa entra como NULL
    // en vez de voltear el COPY entero.
    sexo === 'M' || sexo === 'F' ? sexo : null,
    anioActual - anio,
  ].map(escaparCopy).join('\t');
}

/**
 * Importa un CSV al padron.
 *
 * @returns {Promise<{leidas, descartadas, insertadas, actualizadas}>}
 */
async function importarCsv(db, rutaArchivo) {
  if (!fs.existsSync(rutaArchivo)) {
    throw errores.solicitudInvalida('El archivo a importar no existe');
  }

  const anioActual = new Date().getFullYear();
  let leidas = 0;
  let descartadas = 0;

  const aTsv = new Transform({
    objectMode: true,
    transform(fila, _codificacion, callback) {
      leidas += 1;
      const linea = filaATsv(fila, anioActual);
      if (linea === null) {
        descartadas += 1;
        return callback();
      }
      // callback() solo se llama cuando el destino acepto el dato: eso es el
      // backpressure que le faltaba a la version anterior.
      return callback(null, `${linea}\n`);
    },
  });

  const cliente = await db.conexion();

  try {
    await cliente.query('BEGIN');

    // La temporal muere con la transaccion; no deja rastro aunque el proceso falle.
    await cliente.query(`
      CREATE TEMP TABLE tmp_import_votantes (
        dni           VARCHAR(20),
        anio_nac      INTEGER,
        apellido      VARCHAR(100),
        nombre        VARCHAR(100),
        domicilio     TEXT,
        tipo_ejemplar VARCHAR(20),
        circuito      VARCHAR(50),
        sexo          CHAR(1),
        edad          INTEGER
      ) ON COMMIT DROP
    `);

    await pipeline(
      fs.createReadStream(rutaArchivo),
      csv(),
      aTsv,
      cliente.query(copyFrom(`COPY tmp_import_votantes (${COLUMNAS.join(', ')}) FROM STDIN`)),
    );

    // El CSV puede traer el mismo DNI dos veces; ON CONFLICT no tolera filas
    // duplicadas dentro del mismo comando, asi que se deduplica antes.
    const resultado = await cliente.query(`
      WITH unicos AS (
        SELECT DISTINCT ON (dni) *
        FROM tmp_import_votantes
        WHERE dni IS NOT NULL
        ORDER BY dni
      ),
      volcado AS (
        INSERT INTO padron.votantes
          (dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad)
        SELECT dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad
        FROM unicos
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
        RETURNING (xmax = 0) AS insertada
      )
      SELECT
        COUNT(*) FILTER (WHERE insertada)     ::int AS insertadas,
        COUNT(*) FILTER (WHERE NOT insertada) ::int AS actualizadas
      FROM volcado
    `);

    await cliente.query('COMMIT');

    const { insertadas, actualizadas } = resultado.rows[0];
    return { leidas, descartadas, insertadas, actualizadas };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

module.exports = { importarCsv, filaATsv, escaparCopy };
