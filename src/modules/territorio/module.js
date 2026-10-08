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
const express = require('express');

module.exports = {
  name: 'territorio',
  basePath: '/api/territorio',
  migrations: path.join(__dirname, 'migrations'),
  requiresAuth: true,
  permissions: ['territorio.view'],

  register() {
    return { router: express.Router(), provides: {} };
  },
};
