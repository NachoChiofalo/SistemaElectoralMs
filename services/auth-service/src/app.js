const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const Database = require('./database/Database');
const errorMiddleware = require('./middleware/errorMiddleware');

class AuthApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || process.env.AUTH_PORT || 3002;
    this.database = new Database();
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  initializeMiddleware() {
    // Seguridad
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors({
      origin: [
        'http://localhost:3000',
        'http://localhost:8080',
        process.env.FRONTEND_URL,
        process.env.RENDER_EXTERNAL_URL
      ].filter(Boolean),
      credentials: true
    }));

    // Logging
    this.app.use(morgan('combined'));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        service: 'auth-service',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
  }

  initializeRoutes() {
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/users', userRoutes);
  }

  initializeErrorHandling() {
    // 404 handler (must be before error middleware)
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Endpoint no encontrado',
        path: req.originalUrl
      });
    });

    this.app.use(errorMiddleware);
  }

  async start() {
    try {
      // Inicializar base de datos
      await this.database.initialize();
      console.log('✅ Conexión a base de datos establecida');

      // Inicializar usuarios por defecto
      await this.initializeDefaultUsers();

      this.app.listen(this.port, () => {
        console.log(`🔐 Auth Service ejecutándose en puerto ${this.port}`);
        console.log(`📊 Health check: http://localhost:${this.port}/health`);
      });
    } catch (error) {
      console.error('❌ Error al inicializar Auth Service:', error);
      process.exit(1);
    }
  }

  async initializeDefaultUsers() {
    const AuthService = require('./services/AuthService');
    const authService = new AuthService(this.database);
    
    try {
      await authService.initializeDefaultUsers();
      console.log('✅ Usuarios por defecto inicializados');
    } catch (error) {
      console.error('⚠️ Error inicializando usuarios por defecto:', error);
    }
  }
}

// Inicializar aplicación
const authApp = new AuthApp();
authApp.start();

module.exports = AuthApp;