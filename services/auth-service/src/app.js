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

    // Endpoint temporal para inicializar la base de datos manualmente
    this.app.get('/init-db', async (req, res) => {
      try {
        console.log('Iniciando inicializacion manual de la base de datos...');
        await this.initializeDefaultUsers();

        // Verificar que todo se creo correctamente
        const tables = await this.database.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        );
        const users = await this.database.query(
          'SELECT u.username, u.nombre_completo, r.nombre as rol FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id'
        );
        const rolesCount = await this.database.query('SELECT COUNT(*) as total FROM roles');
        const permisosCount = await this.database.query('SELECT COUNT(*) as total FROM permisos');

        res.json({
          success: true,
          message: 'Base de datos inicializada correctamente',
          tablas: tables.rows.map(r => r.tablename),
          usuarios: users.rows,
          roles: parseInt(rolesCount.rows[0].total),
          permisos: parseInt(permisosCount.rows[0].total)
        });
        console.log('Base de datos inicializada manualmente con exito');
      } catch (error) {
        console.error('Error en inicializacion manual:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
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

    const maxRetries = 3;
    for (let i = 1; i <= maxRetries; i++) {
      try {
        await authService.initializeDefaultUsers();
        console.log('✅ Usuarios por defecto inicializados');
        return;
      } catch (error) {
        console.error(`⚠️ Intento ${i}/${maxRetries} - Error inicializando usuarios por defecto:`, error.message);
        if (i < maxRetries) {
          console.log('Reintentando en 3 segundos...');
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
    console.error('⚠️ No se pudieron inicializar los usuarios. Usa GET /init-db para inicializar manualmente.');
  }
}

// Inicializar aplicación
const authApp = new AuthApp();
authApp.start();

module.exports = AuthApp;