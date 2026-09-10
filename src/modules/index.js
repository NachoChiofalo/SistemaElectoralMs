/**
 * Registro de modulos del sistema.
 *
 * Esta lista es la unica fuente de verdad sobre que compone la aplicacion. Agregar un
 * modulo nuevo es crear su carpeta y sumar una linea aca; el resto del arranque
 * —migraciones, permisos, montaje del router— lo resuelve core/app.js y core/server.js.
 *
 * El ORDEN importa: un modulo solo puede consumir servicios (`services`) de los que
 * estan antes en la lista. Se mantiene explicito a proposito, en lugar de resolver
 * dependencias automaticamente, para que la relacion entre modulos se lea de un vistazo.
 *
 * Ver docs/AGREGAR-MODULO.md para la plantilla completa.
 */

module.exports = [
  // Los modulos se van agregando aca a medida que se migran.
];
