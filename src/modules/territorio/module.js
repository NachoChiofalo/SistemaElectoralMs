/**
 * Modulo del mapa por manzana y barrio (018).
 *
 * Ubica a cada votante en una manzana a partir de su domicilio, en lote (al importar el padron o al
 * cargar las capas), y expone estadisticas por zona con un umbral de privacidad. Ninguna ruta hace
 * calculos geograficos en vivo ni consulta a un tercero.
 *
 * Se registra DESPUES de padron: consume su servicio (opciones politicas y el aviso de cambios). El
 * padron no sabe que este modulo existe.
 *
 * Solo para el administrador en la etapa 1 (permiso territorio.view, ver migrations/002).
 */

const path = require('path');
const { TerritorioRepository } = require('./repository');
const { TerritorioService } = require('./service');
const construirRutas = require('./routes');

module.exports = {
  name: 'territorio',
  basePath: '/api/territorio',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['territorio.view'],

  register({ db, services, logger, config }) {
    const servicio = new TerritorioService(new TerritorioRepository(db), {
      db,
      padron: services.padron,
      auditoria: services.auditoria,
      logger,
      ttlCacheMs: config.esProduccion ? 60_000 : 5_000,
    });

    // Cualquier cambio del padron deja viejas las estadisticas; una importacion, ademas, trae domicilios
    // nuevos que hay que ubicar. Corre fuera de la respuesta: la importacion no espera al mapa.
    services.padron.alCambiar((tipo) => {
      servicio.invalidarCache();
      if (tipo === 'importacion') servicio.reubicarEnSegundoPlano();
    });

    return { router: construirRutas(servicio), provides: { territorio: servicio } };
  },
};
