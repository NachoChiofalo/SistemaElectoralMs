const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
require('dotenv').config();

const { authMiddleware } = require('./middleware/authMiddleware');
const errorMiddleware = require('./middleware/errorMiddleware');
const { requirePermission, requireAnyPermission } = require('./middleware/permissionMiddleware');

class GatewayApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || process.env.GATEWAY_PORT || 8080;
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  initializeMiddleware() {
    // Seguridad - configurar helmet para permitir inline scripts/styles del frontend
    this.app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }));
    
    // Compresión
    this.app.use(compression());

    // CORS primero para asegurar headers en cualquier respuesta
    this.app.use(cors({
      origin: [
        'http://localhost:3000',
        'http://localhost:8080',
        process.env.FRONTEND_URL,
        process.env.PUBLIC_EXTERNAL_URL,
        process.env.RENDER_EXTERNAL_URL
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
          padron: process.env.PADRON_SERVICE_URL
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
          // Forward user identity to downstream services
          if (req.user) {
            proxyReq.setHeader('X-User-Id', String(req.user.id || ''));
            proxyReq.setHeader('X-User-Username', req.user.username || '');
            proxyReq.setHeader('X-User-Nombre', encodeURIComponent(req.user.nombre_completo || ''));
            proxyReq.setHeader('X-User-Rol', req.user.rol || '');
          }
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

    // Servir archivos estáticos del web-admin (embebidos en el contenedor)
    // En produccion: los archivos estan en /app/public/
    // En desarrollo local: se puede usar WEB_ADMIN_URL como proxy alternativo
    const publicDir = path.join(__dirname, '..', 'public');
    if (process.env.WEB_ADMIN_URL) {
      this.app.use('/',
        createProxyMiddleware({
          target: process.env.WEB_ADMIN_URL,
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
    } else {
      this.app.use(express.static(publicDir));
      // Fallback: servir index.html para rutas no-API
      this.app.get('*', (req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
      });
    }
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
      console.log(`💻 Web Admin: ${process.env.WEB_ADMIN_URL ? 'proxy -> ' + process.env.WEB_ADMIN_URL : 'static files'}`);
    });
  }
}

// Inicializar aplicación
const gatewayApp = new GatewayApp();
gatewayApp.start();

module.exports = GatewayApp;