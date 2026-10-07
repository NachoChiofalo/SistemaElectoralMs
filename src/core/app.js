/**
 * Factory de la aplicacion Express.
 *
 * Concentra todo lo que antes hacia el gateway-service —seguridad, CORS, compresion,
 * rate limit, archivos estaticos— y le suma el registro de modulos. Lo unico que hacia
 * el gateway y aca no existe es el proxy HTTP: ya no hay a donde proxear.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { config } = require('./config');
const db = require('./db');
const { logger, middlewareAcceso } = require('./logger');
const sesiones = require('./security/sessions');
const { requireAuth } = require('./security/authorize');
const { manejadorErrores, manejadorNoEncontrado } = require('./errors');
const { montarEstaticos } = require('./estaticos');

const DIR_PUBLICO = path.join(__dirname, '..', '..', 'public');

/**
 * Monta los modulos sobre la app.
 *
 * Cada modulo se registra en orden y puede consumir los servicios que expusieron los
 * anteriores a traves de `services`. No hay resolucion automatica de dependencias a
 * proposito: el orden de modules/index.js es la unica fuente de verdad, y se lee.
 */
function registrarModulos(app, modulos) {
  const services = {};
  const montados = [];

  for (const modulo of modulos) {
    if (typeof modulo.register !== 'function') {
      throw new Error(`El modulo "${modulo.name}" no exporta register()`);
    }

    const { router, provides } = modulo.register({
      db,
      config,
      services,
      logger: logger.hijo({ modulo: modulo.name }),
    });

    if (!router) throw new Error(`El modulo "${modulo.name}" no devolvio un router`);

    // requiresAuth se aplica una vez, sobre todo el router: un endpoint nuevo del
    // modulo nace protegido en lugar de nacer abierto por olvido.
    if (modulo.requiresAuth) app.use(modulo.basePath, requireAuth, router);
    else app.use(modulo.basePath, router);

    Object.assign(services, provides || {});
    montados.push({ nombre: modulo.name, basePath: modulo.basePath, protegido: !!modulo.requiresAuth });
  }

  return { services, montados };
}

function crearApp(modulos) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxy);

  app.use(helmet({
    // Lo que corta: desde que `public/` no depende de ningun CDN, `default-src 'self'`
    // es cumplible, y con eso un `<script src="...">` o un `<link>` inyectado hacia
    // afuera no carga. Sumado a `object-src 'none'`, `base-uri` y `frame-ancestors`,
    // cierra la inyeccion de recursos externos, el secuestro de rutas relativas via
    // <base> y el clickjacking.
    //
    // `script-src` ya no lleva `'unsafe-inline'` (ver 002 en docs/BACKLOG.md): no
    // queda ni un `<script>` sin `src` ni un `onclick=`/`onchange=`/`onsubmit=` en
    // `public/` — todo pasa por delegacion de eventos con `data-action`. Esto es lo
    // que hace que la CSP frene XSS inline de verdad, y no solo reduzca superficie.
    //
    // `style-src` si sigue con `'unsafe-inline'`: los estilos no ejecutan JavaScript,
    // es una superficie de ataque bastante mas baja, y el frontend usa `style=""` con
    // variables del design system para valores dinamicos (colores de partido, barras
    // de grafico) en varios lugares. Sacarlo es un trabajo aparte.
    //
    // `img-src data:` no es opcional: los iconos son mascaras CSS con el SVG embebido
    // en un data URI, y el navegador los pide bajo img-src. Sin eso no se ve ninguno.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    // COEP desactivada a proposito (BE-035): exigirla obliga a que todo recurso cross-origin
    // declare CORP, y este frontend no carga ninguno (default-src 'self'). No aporta nada
    // aca y puede romper una descarga si algun dia se suma un recurso de otro origen.
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(cors({ origin: config.http.origenesCors, credentials: true }));
  app.use(middlewareAcceso);

  // El parseo de body ahora es global: sin proxy, ningun router necesita el stream
  // crudo salvo la subida de CSV, que multer intercepta antes.
  // Las rutas de auth reciben dos strings: no necesitan el limite de 10 MB que justifica
  // la importacion de CSV, y este parser corre antes de autenticar a nadie (BE-036). El
  // primer parser que ve el body gana, asi que va antes del global.
  app.use('/api/auth', express.json({ limit: '16kb' }));
  app.use(express.json({ limit: config.http.limiteBody }));
  app.use(express.urlencoded({ extended: true, limit: config.http.limiteBody }));

  // Health check: fuera del rate limit y sin autenticacion, lo consulta el orquestador.
  app.get('/health', async (req, res) => {
    let base = { conectada: false };
    try {
      base = { conectada: true, latenciaMs: await db.verificar(), pool: db.estado() };
    } catch (error) {
      base.error = error.message;
    }

    res.status(base.conectada ? 200 : 503).json({
      status: base.conectada ? 'OK' : 'DEGRADED',
      service: 'sistema-electoral',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: base,
      sesiones: sesiones.estado(),
      memoria: { rssMb: Math.round(process.memoryUsage().rss / 1048576) },
    });
  });

  if (config.http.rateLimit.activo) {
    app.use('/api/', rateLimit({
      windowMs: config.http.rateLimit.ventanaMs,
      max: config.http.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      // Con trust proxy configurado, req.ip ya es la IP real del cliente. El keyGenerator
      // manual que tenia el gateway era justamente lo que lo rompia detras de Render.
      message: { success: false, message: 'Demasiadas solicitudes, intente mas tarde' },
    }));
  }

  const { services, montados } = registrarModulos(app, modulos);

  // ---- frontend estatico -------------------------------------------------
  // El mismo proceso sirve el web-admin. Antes era un contenedor aparte corriendo
  // `serve`, con su propio runtime de Node para entregar archivos que no cambian.
  if (fs.existsSync(DIR_PUBLICO)) {
    montarEstaticos(app, { dir: DIR_PUBLICO, config, logger });

    // Fallback del cliente: cualquier ruta que no sea /api ni un archivo devuelve el
    // index. Se excluye /api explicitamente para que un endpoint mal escrito devuelva
    // 404 JSON y no una pagina HTML.
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      return res.sendFile(path.join(DIR_PUBLICO, 'index.html'));
    });
  } else {
    logger.warn(`No se encontro ${DIR_PUBLICO}: la API funciona, el frontend no se sirve`);
  }

  app.use(manejadorNoEncontrado);
  app.use(manejadorErrores);

  return { app, services, montados };
}

module.exports = { crearApp, DIR_PUBLICO };
