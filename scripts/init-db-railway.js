const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Configuración de conexión usando variables de Railway
const connectionString = 'postgresql://postgres:UwdLtBzpbpHgVpGyzjJedykMaervFHcS@maglev.proxy.rlwy.net:54198/railway';

const client = new Client({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initializeDatabase() {
    try {
        await client.connect();
        console.log('Conectado a PostgreSQL en Railway');

        // Leer y ejecutar init-db.sql
        const initScript = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');
        await client.query(initScript);
        console.log('✅ Script init-db.sql ejecutado');

        // Leer y ejecutar init-roles-completo.sql
        const rolesScript = fs.readFileSync(path.join(__dirname, 'init-roles-completo.sql'), 'utf8');
        await client.query(rolesScript);
        console.log('✅ Script init-roles-completo.sql ejecutado');

        // Leer y ejecutar extend-db-detalle-votante.sql
        const extendScript = fs.readFileSync(path.join(__dirname, 'extend-db-detalle-votante.sql'), 'utf8');
        await client.query(extendScript);
        console.log('✅ Script extend-db-detalle-votante.sql ejecutado');

        // Leer y ejecutar crear-usuarios-ejemplo.sql
        const usersScript = fs.readFileSync(path.join(__dirname, 'crear-usuarios-ejemplo.sql'), 'utf8');
        await client.query(usersScript);
        console.log('✅ Script crear-usuarios-ejemplo.sql ejecutado');

        console.log('🎉 Base de datos inicializada correctamente');

    } catch (error) {
        console.error('❌ Error inicializando la base de datos:', error);
        console.error('Detalles:', error.message);
    } finally {
        await client.end();
    }
}

// Ejecutar la inicialización
initializeDatabase();