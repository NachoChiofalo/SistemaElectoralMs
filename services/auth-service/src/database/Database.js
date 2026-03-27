const { Pool } = require('pg');

class Database {
  constructor() {
    const poolConfig = this.buildPoolConfig();

    this.pool = new Pool({
      ...poolConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Manejar errores de conexión
    this.pool.on('error', (err) => {
      console.error('Error inesperado en pool de conexiones:', err);
    });
  }

  buildPoolConfig() {
    if (!process.env.DATABASE_URL) {
      return {
        host: process.env.DB_HOST || 'postgres',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'sistema_electoral',
        user: process.env.DB_USER || 'electoral_user',
        password: process.env.DB_PASSWORD || 'electoral_password',
      };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(process.env.DATABASE_URL);
    } catch (error) {
      return {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      };
    }

    const host = (parsedUrl.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const sslMode = (process.env.PGSSLMODE || parsedUrl.searchParams.get('sslmode') || '').toLowerCase();
    const shouldUseSsl = !isLocal && sslMode !== 'disable';
    const rejectUnauthorized = sslMode === 'verify-full';

    parsedUrl.searchParams.delete('sslmode');

    return {
      connectionString: parsedUrl.toString(),
      ssl: shouldUseSsl ? { rejectUnauthorized } : false,
    };
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