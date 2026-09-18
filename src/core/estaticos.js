/**
 * Servido de `public/`: precomprimidos y politica de cache.
 *
 * Dos cosas que en un VPS chico se notan.
 *
 * Una: `compression()` comprime en el momento, y para un estatico eso es trabajo
 * repetido — los mismos 43 KB de padron-styles.css gzipeados de nuevo en cada visita,
 * CPU que se le resta a atender requests. `scripts/build-assets.js` deja un `.br` y un
 * `.gz` al lado de cada archivo, y aca se entregan tal cual.
 *
 * Dos: sin versionar, cada visita repetida revalidaba archivo por archivo. Dieciseis
 * pedidos condicionales para recibir dieciseis 304: poco ancho de banda, pero dieciseis
 * viajes de ida y vuelta y dieciseis requests que el proceso tiene que atender. Ahora
 * el HTML referencia `archivo.css?v=<hash>`, eso se cachea un año como `immutable` y la
 * visita repetida no pide nada. El HTML sigue con `no-cache`, que es lo que hace que un
 * `?v=` nuevo se vea en el momento.
 *
 * El modo de falla que importa es servir un `.br` viejo junto a una fuente editada: el
 * navegador recibiria contenido que no se corresponde con el archivo. Por eso el indice
 * se arma comparando fechas y descarta todo comprimido que no sea mas nuevo que su
 * fuente. Olvidarse de correr el build degrada a comprimir en vivo, nunca a servir algo
 * desactualizado.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const UN_AÑO_EN_SEGUNDOS = 31536000;

// Solo estos tipos se precomprimen, asi que solo estos se buscan. El Content-Type sale
// de esta tabla porque la ruta que termina sirviendo el archivo es la del `.br`, y de
// su extension no se puede deducir el tipo real.
const TIPOS = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
};

/**
 * Releva que archivos tienen un comprimido utilizable.
 *
 * Se arma una sola vez al arrancar: en produccion `public/` no cambia mientras el
 * proceso vive, asi que resolverlo por request seria un `stat` al pedo en cada uno.
 *
 * @returns {Map<string, {br: boolean, gz: boolean, tipo: string}>} indexado por la ruta
 *   URL del archivo original, con barras normales.
 */
function construirIndice(dir, logger) {
  const indice = new Map();
  const desactualizados = [];

  const recorrer = (actual) => {
    for (const entrada of fs.readdirSync(actual, { withFileTypes: true })) {
      const completo = path.join(actual, entrada.name);

      if (entrada.isDirectory()) {
        recorrer(completo);
        continue;
      }

      const tipo = TIPOS[path.extname(entrada.name)];
      if (!tipo) continue;

      const modificado = fs.statSync(completo).mtimeMs;
      const fresco = (extension) => {
        const comprimido = `${completo}.${extension}`;
        if (!fs.existsSync(comprimido)) return false;

        // Igual o mas nuevo que la fuente. Si alguien edito el CSS y no corrio el
        // build, el comprimido queda atras y se descarta.
        if (fs.statSync(comprimido).mtimeMs + 1000 < modificado) {
          desactualizados.push(path.relative(dir, comprimido));
          return false;
        }
        return true;
      };

      const url = '/' + path.relative(dir, completo).split(path.sep).join('/');
      indice.set(url, { br: fresco('br'), gz: fresco('gz'), tipo });
    }
  };

  recorrer(dir);

  if (desactualizados.length > 0) {
    logger.warn(
      `Hay ${desactualizados.length} archivos precomprimidos mas viejos que su fuente; ` +
      `se sirven sin usar. Corre npm run build:assets. Ejemplos: ${desactualizados.slice(0, 3).join(', ')}`
    );
  }

  return indice;
}

/** La primera codificacion que el cliente acepta y de la que tenemos una version fresca. */
function negociar(aceptadas, disponibles) {
  const cabecera = (aceptadas || '').toLowerCase();
  if (disponibles.br && cabecera.includes('br')) return 'br';
  if (disponibles.gz && cabecera.includes('gzip')) return 'gzip';
  return null;
}

/**
 * Monta `public/` sobre la app.
 *
 * @param {object} opciones
 * @param {string} opciones.dir         Raiz de los estaticos.
 * @param {object} opciones.config      Config de la app; se usa `esProduccion` y el TTL.
 * @param {object} opciones.logger      Para avisar de precomprimidos viejos.
 */
function montarEstaticos(app, { dir, config, logger }) {
  // En desarrollo los archivos cambian todo el tiempo y el indice quedaria viejo al
  // primer guardado, asi que no se usan precomprimidos: se sirve el original y
  // `compression()` se encarga.
  const indice = config.esProduccion ? construirIndice(dir, logger) : new Map();

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // Se lee antes de tocar req.url: `req.query` se recalcula a partir de el, y mas
    // abajo se reescribe para apuntar al comprimido.
    res.locals.inmutable = Boolean(req.query.v);

    const url = req.path;
    const disponibles = indice.get(url);
    if (!disponibles) return next();

    const codificacion = negociar(req.headers['accept-encoding'], disponibles);
    if (!codificacion) return next();

    res.setHeader('Content-Encoding', codificacion);
    res.setHeader('Content-Type', disponibles.tipo);
    res.setHeader('Vary', 'Accept-Encoding');

    // Reescribir la URL deja que express.static haga el resto —ETag, Last-Modified,
    // 304, rangos— sobre el archivo comprimido. El Content-Type ya esta puesto, y
    // `send` no lo pisa si lo encuentra definido.
    req.url = `${url}.${codificacion === 'br' ? 'br' : 'gz'}`;
    next();
  });

  app.use(express.static(dir, {
    etag: true,
    lastModified: true,
    // El Cache-Control lo decide `cabeceras`: la opcion maxAge lo escribiria antes y
    // sin distinguir entre un asset versionado y uno que no lo esta.
    maxAge: 0,
    setHeaders: cabeceras(config),
  }));
}

/**
 * Politica de cache, en un solo lugar.
 *
 * - HTML: `no-cache`. Se revalida siempre; si se cacheara, un deploy no llegaria.
 * - Con `?v=`: un año e `immutable`. La URL identifica al contenido, asi que no hay
 *   nada que revalidar nunca.
 * - Sin `?v=`: el TTL corto de siempre, que es lo unico seguro cuando la URL no dice
 *   de que version se trata.
 */
function cabeceras(config) {
  return (res, ruta) => {
    if (ruta.replace(/\.(br|gz)$/, '').endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }

    if (res.locals.inmutable) {
      res.setHeader('Cache-Control', `public, max-age=${UN_AÑO_EN_SEGUNDOS}, immutable`);
      return;
    }

    const segundos = Math.round((config.esProduccion ? config.http.cacheEstaticosMs : 0) / 1000);
    res.setHeader('Cache-Control', `public, max-age=${segundos}`);
  };
}

module.exports = { montarEstaticos, construirIndice, negociar, cabeceras };
