/**
 * Exportacion del padron y los relevamientos a CSV.
 *
 * La version anterior traia TODAS las filas a un array, construia el CSV completo como
 * un string en memoria y recien despues lo mandaba. Para el padron entero eso son dos
 * copias completas del dataset en el heap antes de escribir el primer byte.
 *
 * Aca las filas se leen por lotes con paginacion keyset y se escriben a la respuesta a
 * medida que llegan. La memoria queda acotada al tamano del lote, y el navegador
 * empieza a recibir el archivo enseguida.
 */

const TAMANO_LOTE = 2000;

const ENCABEZADOS = [
  'DNI', 'Apellido', 'Nombre', 'Anio Nacimiento', 'Domicilio',
  'Tipo Ejemplar', 'Circuito', 'Sexo', 'Edad',
  'Opcion Politica', 'Observacion', 'Fecha Relevamiento',
  'Fecha Modificacion', 'Es Nuevo Votante', 'Esta Fallecido',
  'Es Empleado Municipal', 'Recibe Ayuda Social',
  'Observaciones Detalle', 'Fecha Detalle', 'Telefono',
];

function escapar(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/[",\n\r]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function fecha(valor) {
  return valor ? new Date(valor).toISOString() : '';
}

function siNo(valor) {
  return valor ? 'Si' : 'No';
}

function aLinea(fila) {
  return [
    fila.dni, fila.apellido, fila.nombre, fila.anio_nac, fila.domicilio,
    fila.tipo_ejemplar, fila.circuito, fila.sexo, fila.edad,
    fila.opcion_politica, fila.observacion, fecha(fila.fecha_relevamiento),
    fecha(fila.fecha_modificacion), siNo(fila.es_nuevo_votante), siNo(fila.esta_fallecido),
    siNo(fila.es_empleado_municipal), siNo(fila.recibe_ayuda_social),
    fila.observaciones_detalle, fecha(fila.fecha_detalle), fila.telefono,
  ].map(escapar).join(',');
}

/**
 * Escribe el CSV en la respuesta.
 *
 * @param {boolean} soloRelevados  true exporta solo votantes con relevamiento.
 * @returns {Promise<number>} cantidad de filas escritas.
 */
async function exportar(db, res, soloRelevados) {
  const join = soloRelevados ? 'INNER JOIN' : 'LEFT JOIN';

  // El BOM es lo que hace que Excel en Windows abra el archivo en UTF-8 y muestre
  // bien los apellidos con acentos.
  res.write('﻿');
  res.write(`${ENCABEZADOS.join(',')}\n`);

  let escritas = 0;
  // Cursor keyset: (apellido, nombre, dni) es unico porque dni es la clave primaria.
  // Con OFFSET, la ultima pagina obligaria a Postgres a recorrer toda la tabla.
  let cursor = null;

  for (;;) {
    const condicion = cursor
      ? 'WHERE (v.apellido, v.nombre, v.dni) > ($1, $2, $3)'
      : '';
    const params = cursor ? [cursor.apellido, cursor.nombre, cursor.dni] : [];

    const filas = await db.filas(
      `SELECT v.dni, v.apellido, v.nombre, v.anio_nac, v.domicilio,
              v.tipo_ejemplar, v.circuito, v.sexo, v.edad,
              r.opcion_politica, r.observacion, r.fecha_relevamiento,
              r.fecha_modificacion, r.es_nuevo_votante, r.esta_fallecido,
              r.es_empleado_municipal, r.recibe_ayuda_social,
              r.observaciones_detalle, r.fecha_detalle, r.telefono
       FROM padron.votantes v
       ${join} padron.relevamientos r ON v.dni = r.dni
       ${condicion}
       ORDER BY v.apellido, v.nombre, v.dni
       LIMIT ${TAMANO_LOTE}`,
      params,
    );

    if (filas.length === 0) break;

    const lote = filas.map(aLinea).join('\n');

    // Si el socket esta lleno, esperar a que se vacie antes de leer el proximo lote.
    if (!res.write(`${lote}\n`)) {
      await new Promise((resolve) => res.once('drain', resolve));
    }

    escritas += filas.length;
    const ultima = filas[filas.length - 1];
    cursor = { apellido: ultima.apellido, nombre: ultima.nombre, dni: ultima.dni };

    if (filas.length < TAMANO_LOTE) break;
  }

  res.end();
  return escritas;
}

module.exports = { exportar, ENCABEZADOS, escapar, aLinea };
