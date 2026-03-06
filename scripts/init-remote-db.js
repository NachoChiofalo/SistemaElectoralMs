const { Pool } = require('../services/auth-service/node_modules/pg');
const bcrypt = require('../services/auth-service/node_modules/bcryptjs');

const DATABASE_URL = 'postgresql://electoral_user:smeeeLByHNYA5ws2kGSQuTuGrVneon5k@dpg-d6kv9vngi27c738usgk0.oregon-postgres.render.com/sistema_electoral_lqsh';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
  max: 2,
});

async function tryConnect(retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      console.log(`Intento ${i}/${retries} de conexion...`);
      const client = await pool.connect();
      await client.query('SELECT 1');
      console.log('Conectado a la DB de Render');
      return client;
    } catch (e) {
      console.log(`  Fallo: ${e.message}`);
      console.log(`  Codigo: ${e.code}`);
      console.log(`  Stack: ${e.stack?.split('\n')[1]}`);
      if (i === retries) throw e;
      console.log('  Esperando 5 segundos antes de reintentar...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function run() {
  const client = await tryConnect();

  // 1. Crear tablas
  await client.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(50) UNIQUE NOT NULL,
      descripcion TEXT,
      activo BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('  Tabla roles creada');

  await client.query(`
    CREATE TABLE IF NOT EXISTS permisos (
      id SERIAL PRIMARY KEY,
      codigo VARCHAR(50) UNIQUE NOT NULL,
      nombre VARCHAR(100) NOT NULL,
      descripcion TEXT,
      modulo VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('  Tabla permisos creada');

  await client.query(`
    CREATE TABLE IF NOT EXISTS rol_permisos (
      id SERIAL PRIMARY KEY,
      rol_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
      permiso_id INTEGER REFERENCES permisos(id) ON DELETE CASCADE,
      UNIQUE(rol_id, permiso_id)
    );
  `);
  console.log('  Tabla rol_permisos creada');

  await client.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      nombre_completo VARCHAR(100) NOT NULL,
      email VARCHAR(100),
      rol_id INTEGER REFERENCES roles(id),
      activo BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('  Tabla usuarios creada');

  await client.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('  Tabla refresh_tokens creada');

  await client.query(`
    CREATE TABLE IF NOT EXISTS token_blacklist (
      id SERIAL PRIMARY KEY,
      token_jti VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('  Tabla token_blacklist creada');

  // 2. Insertar roles
  const roles = [
    ['administrador', 'Acceso completo al sistema electoral'],
    ['consultor', 'Acceso de solo lectura a estadisticas y resultados'],
    ['encargado_relevamiento', 'Acceso a gestion del padron electoral']
  ];
  for (const [nombre, desc] of roles) {
    await client.query(
      'INSERT INTO roles (nombre, descripcion) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING',
      [nombre, desc]
    );
  }
  console.log('  Roles insertados');

  // 3. Insertar permisos
  const permisos = [
    ['dashboard.view', 'Ver Dashboard', 'Acceso al panel principal', 'dashboard'],
    ['padron.view', 'Ver Padron', 'Consultar padron electoral', 'padron'],
    ['padron.edit', 'Editar Padron', 'Modificar datos del padron', 'padron'],
    ['padron.relevamiento', 'Relevamiento', 'Realizar relevamientos del padron', 'padron'],
    ['padron.export', 'Exportar Padron', 'Exportar datos del padron', 'padron'],
    ['resultados.view', 'Ver Resultados', 'Consultar estadisticas y resultados', 'resultados'],
    ['resultados.export', 'Exportar Resultados', 'Exportar reportes estadisticos', 'resultados'],
    ['fiscales.view', 'Ver Fiscales', 'Consultar fiscales de mesa', 'fiscales'],
    ['fiscales.edit', 'Gestionar Fiscales', 'Administrar fiscales de mesa', 'fiscales'],
    ['comicio.view', 'Ver Comicio', 'Consultar informacion de comicios', 'comicio'],
    ['comicio.edit', 'Gestionar Comicio', 'Administrar comicios', 'comicio'],
    ['admin.users', 'Gestionar Usuarios', 'Administrar usuarios del sistema', 'admin'],
    ['admin.roles', 'Gestionar Roles', 'Administrar roles y permisos', 'admin'],
    ['admin.config', 'Configuracion', 'Configuracion general del sistema', 'admin']
  ];
  for (const [codigo, nombre, desc, modulo] of permisos) {
    await client.query(
      'INSERT INTO permisos (codigo, nombre, descripcion, modulo) VALUES ($1, $2, $3, $4) ON CONFLICT (codigo) DO NOTHING',
      [codigo, nombre, desc, modulo]
    );
  }
  console.log('  Permisos insertados');

  // 4. Asignar permisos a roles
  await client.query(`
    INSERT INTO rol_permisos (rol_id, permiso_id)
    SELECT r.id, p.id FROM roles r, permisos p WHERE r.nombre = 'administrador'
    ON CONFLICT (rol_id, permiso_id) DO NOTHING
  `);
  await client.query(`
    INSERT INTO rol_permisos (rol_id, permiso_id)
    SELECT r.id, p.id FROM roles r, permisos p
    WHERE r.nombre = 'consultor' AND p.codigo IN ('dashboard.view', 'resultados.view', 'resultados.export')
    ON CONFLICT (rol_id, permiso_id) DO NOTHING
  `);
  await client.query(`
    INSERT INTO rol_permisos (rol_id, permiso_id)
    SELECT r.id, p.id FROM roles r, permisos p
    WHERE r.nombre = 'encargado_relevamiento' AND p.codigo IN ('dashboard.view', 'padron.view', 'padron.edit', 'padron.relevamiento', 'padron.export')
    ON CONFLICT (rol_id, permiso_id) DO NOTHING
  `);
  console.log('  Permisos asignados a roles');

  // 5. Crear usuario admin con password admin123
  const hash = await bcrypt.hash('admin123', 12);
  const adminRol = await client.query("SELECT id FROM roles WHERE nombre = 'administrador'");
  await client.query(
    'INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING',
    ['admin', hash, 'Administrador del Sistema', 'admin@electoral.gov.ar', adminRol.rows[0].id]
  );
  console.log('  Usuario admin creado');

  // 6. Verificar
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  console.log('\nTablas en la DB:', tables.rows.map(r => r.tablename).join(', '));

  const users = await client.query('SELECT u.username, u.nombre_completo, r.nombre as rol FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id');
  console.log('Usuarios:', JSON.stringify(users.rows, null, 2));

  const rolesCount = await client.query('SELECT COUNT(*) FROM roles');
  const permisosCount = await client.query('SELECT COUNT(*) FROM permisos');
  const rpCount = await client.query('SELECT COUNT(*) FROM rol_permisos');
  console.log(`\nResumen: ${rolesCount.rows[0].count} roles, ${permisosCount.rows[0].count} permisos, ${rpCount.rows[0].count} asignaciones`);

  client.release();
  await pool.end();
  console.log('\n=== LISTO - Base de datos inicializada correctamente ===');
  console.log('Podes loguearte con: admin / admin123');
}

run().catch(e => {
  console.error('ERROR:', e.message);
  pool.end();
  process.exit(1);
});
