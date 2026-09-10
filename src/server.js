/**
 * Arranque del proceso.
 *
 * Un solo proceso Node sirve la API completa y el frontend. Antes eran cuatro:
 * gateway, auth, padron y un `serve` estatico para el web-admin.
 */

const { config, validar } = require('./core/config');
const { logger } = require('./core/logger');
const db = require('./core/db');
const sesiones = require('./core/security/sessions');
const { contarPendientes } = require('./core/migrations');
const { crearApp } = require('./core/app');
const modulos = require('./modules');

async function arrancar() {
  const { errores, avisos } = validar();
  avisos.forEach((aviso) => logger.warn(`Configuracion: ${aviso}`));

  if (errores.length > 0) {
    errores.forEach((error) => logger.error(`Configuracion: ${error}`));
    throw new Error('Configuracion invalida');
  }

  logger.info(`Conectando a ${db.descripcion}`);
  const latencia = await db.verificar();
  logger.info(`Base de datos conectada (${latencia} ms, pool max ${config.db.max})`);

  // Las migraciones ya no corren en el arranque: son un paso explicito del deploy
  // (npm run migrate). Arrancar con el esquema desactualizado es un error de operacion,
  // no algo que la aplicacion deba arreglar sola.
  const pendientes = await contarPendientes(modulos);
  if (pendientes > 0) {
    throw new Error(`Hay ${pendientes} migracion(es) sin aplicar. Ejecuta: npm run migrate`);
  }

  const { app, montados } = crearApp(modulos);

  for (const modulo of modulos) {
    if (typeof modulo.onStart === 'function') {
      await modulo.onStart({ db, config, logger: logger.hijo({ modulo: modulo.name }) });
    }
  }

  const servidor = app.listen(config.puerto, () => {
    logger.info(`Sistema Electoral escuchando en el puerto ${config.puerto}`, { entorno: config.entorno });
    montados.forEach((m) => logger.info(`  modulo ${m.nombre} -> ${m.basePath}${m.protegido ? ' (protegido)' : ''}`));
  });

  // Un keep-alive mayor que el del proxy evita las carreras de conexion que producen
  // 502 esporadicos detras de un load balancer.
  servidor.keepAliveTimeout = 65_000;
  servidor.headersTimeout = 66_000;

  return { servidor, app };
}

/**
 * Apagado ordenado: deja de aceptar conexiones, termina las en curso, persiste la
 * actividad de sesion pendiente y cierra el pool.
 */
function configurarApagado(servidor) {
  let apagando = false;

  const apagar = async (senal) => {
    if (apagando) return;
    apagando = true;
    logger.info(`${senal} recibida, cerrando`);

    const plazo = setTimeout(() => {
      logger.error('El cierre ordenado tardo demasiado, forzando salida');
      process.exit(1);
    }, 15_000);
    plazo.unref();

    try {
      await new Promise((resolve) => servidor.close(resolve));

      for (const modulo of modulos) {
        if (typeof modulo.onStop === 'function') {
          await modulo.onStop().catch((error) => logger.warn(`onStop de ${modulo.name} fallo`, error));
        }
      }

      await sesiones.vaciarActividad();
      await db.cerrar();
      logger.info('Cierre completo');
      process.exit(0);
    } catch (error) {
      logger.error('Error durante el cierre', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));

  // Con un solo proceso, un error no capturado tumba todo el sistema. Se registra y se
  // sale limpio para que el orquestador reinicie: seguir corriendo con estado
  // indeterminado es peor que reiniciar.
  process.on('uncaughtException', (error) => {
    logger.error('Excepcion no capturada', error);
    apagar('uncaughtException');
  });
  process.on('unhandledRejection', (motivo) => {
    logger.error('Promesa rechazada sin manejar', motivo instanceof Error ? motivo : new Error(String(motivo)));
  });
}

arrancar()
  .then(({ servidor }) => configurarApagado(servidor))
  .catch((error) => {
    logger.error('No se pudo arrancar', error);
    process.exit(1);
  });
