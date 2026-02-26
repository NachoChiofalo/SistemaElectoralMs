const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'postgres',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'electoral_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Manejar errores de conexión
    this.pool.on('error', (err) => {
      console.error('Error inesperado en pool de conexiones:', err);
    });
  }

  /**
   * Inicializar conexión a la base de datos
   */
  async initialize() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      console.log('✅ Base de datos conectada exitosamente');
    } catch (error) {
      console.error('❌ Error conectando a la base de datos:', error);
      throw error;
    }
  }

  /**
   * Obtener conexión del pool
   */
  async getConnection() {
    try {
      return await this.pool.connect();
    } catch (error) {
      console.error('❌ Error obteniendo conexión de la base de datos:', error);
      throw error;
    }
  }

  /**
   * Ejecutar query con manejo de errores
   */
  async query(text, params) {
    const client = await this.getConnection();
    try {
      const result = await client.query(text, params);
      return result;
    } catch (error) {
      console.error('❌ Error ejecutando query:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cerrar todas las conexiones
   */
  async close() {
    try {
      await this.pool.end();
      console.log('✅ Pool de conexiones cerrado');
    } catch (error) {
      console.error('❌ Error cerrando pool de conexiones:', error);
      throw error;
    }
  }
}

module.exports = Database;