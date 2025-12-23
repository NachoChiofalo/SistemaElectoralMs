const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
require('dotenv').config();

class SimpleGatewayApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || process.env.GATEWAY_PORT || 8080;
    
    this.initializeMiddleware();
    this.initializeRoutes();
  }

  initializeMiddleware() {
    // Seguridad básica
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors({
      origin: '*',
      credentials: true
    }));

    // Logging
    this.app.use(morgan('combined'));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
  }

  initializeRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        port: this.port,
        env: process.env.NODE_ENV || 'development'
      });
    });

    // Ruta principal
    this.app.get('/', (req, res) => {
      res.json({ 
        message: '🗳️ Sistema Electoral API Gateway',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        services: {
          auth: process.env.AUTH_SERVICE_URL || 'not configured',
          padron: process.env.PADRON_SERVICE_URL || 'not configured'
        }
      });
    });

    // API routes placeholder
    this.app.get('/api/status', (req, res) => {
      res.json({
        gateway: 'ok',
        message: 'Gateway funcionando correctamente',
        timestamp: new Date().toISOString()
      });
    });

    // Catch all
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        message: 'Gateway is running but route not implemented yet'
      });
    });
  }

  start() {
    const server = this.app.listen(this.port, '0.0.0.0', () => {
      console.log(`🌐 Simple Gateway running on port ${this.port}`);
      console.log(`📊 Health check: http://localhost:${this.port}/health`);
      console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
      });
    });
  }
}

// Inicializar aplicación
const app = new SimpleGatewayApp();
app.start();

module.exports = SimpleGatewayApp;