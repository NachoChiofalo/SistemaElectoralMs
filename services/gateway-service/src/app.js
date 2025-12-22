const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();

const { authMiddleware } = require('./middleware/authMiddleware');
const errorMiddleware = require('./middleware/errorMiddleware');
const { requirePermission, requireAnyPermission } = require('./middleware/permissionMiddleware');

class GatewayApp {
  constructor() {
    this.app = express();
    this.port = process.env.GATEWAY_PORT || 8080;
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  initializeMiddleware() {
    // Seguridad
    this.app.use(helmet());
    
    // Compresión
    this.app.use(compression());

    // CORS primero para asegurar headers en cualquier respuesta
    this.app.use(cors({
      origin: [
        'http://localhost:3000',
        'http://localhost:8080',
        process.env.FRONTEND_URL
      ].filter(Boolean),
      credentials: true
    }));

    // Rate limiting más amplio para evitar 429 en UI
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutos
      max: 1000, // ampliar límite para evitar bloqueos en lotes de requests
      message: {
        success: false,
        message: 'Demasiadas solicitudes, intente más tarde'
      }
    });
    this.app.use('/api/', limiter);

    // Logging
    this.app.use(morgan('combined'));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          auth: process.env.AUTH_SERVICE_URL,
          padron: process.env.PADRON_SERVICE_URL,
          webAdmin: process.env.WEB_ADMIN_URL
        }
      });
    });
  }

  initializeRoutes() {
    // Rutas públicas - Auth Service
    this.app.use('/api/auth', createProxyMiddleware({
      target: process.env.AUTH_SERVICE_URL || 'http://localhost:3002',
      changeOrigin: true,
      pathRewrite: {
        '^/api/auth': '/api/auth'
      },
      onError: (err, req, res) => {
        console.error('Error en proxy auth:', err);
        res.status(503).json({
          success: false,
          message: 'Servicio de autenticación no disponible'
        });
      }
    }));

    // Rutas protegidas - Padrón Service (con autenticación básica)
    this.app.use('/api/padron', 
      authMiddleware,
      createProxyMiddleware({
        target: process.env.PADRON_SERVICE_URL || 'http://padron-service:3001',
        changeOrigin: true,
        logLevel: 'debug',
        onProxyReq: (proxyReq, req, res) => {
          console.log('🔄 Proxy request:', req.method, req.url);
        },
        onProxyRes: (proxyRes, req, res) => {
          console.log('📤 Proxy response:', proxyRes.statusCode, req.url);
        }
      })
    );

    // Rutas protegidas - Users (Auth Service)
    this.app.use('/api/users',
      authMiddleware, // Middleware de autenticación
      createProxyMiddleware({
        target: process.env.AUTH_SERVICE_URL || 'http://localhost:3002',
        changeOrigin: true,
        pathRewrite: {
          '^/api/users': '/api/users'
        },
        onError: (err, req, res) => {
          console.error('Error en proxy users:', err);
          res.status(503).json({
            success: false,
            message: 'Servicio de usuarios no disponible'
          });
        }
      })
    );

    // Body parsing para rutas que NO son manejadas por proxy
    this.app.use((req, res, next) => {
      express.json({ limit: '10mb' })(req, res, (err) => {
        if (err) return next(err);
        express.urlencoded({ extended: true })(req, res, next);
      });
    });

    // Servir archivos estáticos de la web admin (DEBE IR AL FINAL para no interceptar rutas API)
    this.app.use('/', 
      // Solo aplicar auth middleware a rutas que no sean estáticas
      (req, res, next) => {
        if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
          return next();
        }
        return authMiddleware(req, res, next);
      },
      createProxyMiddleware({
        target: process.env.WEB_ADMIN_URL || 'http://localhost:3000',
        changeOrigin: true,
        onError: (err, req, res) => {
          console.error('Error en proxy web admin:', err);
          res.status(503).json({
            success: false,
            message: 'Aplicación web no disponible'
          });
        }
      })
    );
  }

  initializeErrorHandling() {
    this.app.use(errorMiddleware);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado',
        path: req.originalUrl
      });
    });
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🌐 API Gateway ejecutándose en puerto ${this.port}`);
      console.log(`📊 Health check: http://localhost:${this.port}/health`);
      console.log(`🔐 Auth Service: ${process.env.AUTH_SERVICE_URL || 'http://localhost:3002'}`);
      console.log(`📋 Padron Service: ${process.env.PADRON_SERVICE_URL || 'http://localhost:3001'}`);
      console.log(`💻 Web Admin: ${process.env.WEB_ADMIN_URL || 'http://localhost:3000'}`);
    });
  }
}

// Inicializar aplicación
const gatewayApp = new GatewayApp();
gatewayApp.start();

module.exports = GatewayApp;