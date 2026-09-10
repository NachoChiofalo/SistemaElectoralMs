#!/usr/bin/env node
/**
 * Alta de usuarios iniciales.
 *
 *   node scripts/seed-usuarios.js            crea el administrador si no hay ninguno
 *   node scripts/seed-usuarios.js --ejemplos crea ademas los usuarios de demostracion
 *
 * Antes esto corria en CADA arranque de auth-service: recreaba roles y permisos con
 * unas 40 consultas y daba de alta usuarios con contrasenas fijas en el codigo
 * (admin/admin123, consultor1/consultor123, encargado1/encargado123). Un servicio que
 * se reinicia no deberia poder recrear una cuenta con contrasena conocida.
 *
 * Los roles y permisos ahora son una migracion. Los usuarios son este script, que se
 * corre a mano una vez.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/core/db');
const { logger } = require('../src/core/logger');

const COSTO_BCRYPT = 12;

/** Contrasena aleatoria legible, para cuando no se provee una. */
function generarPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

async function crearSiFalta({ username, password, nombre, email, rol }) {
  const existente = await db.unaFila('SELECT id, rol_id FROM usuarios WHERE username = $1', [username]);
  const rolFila = await db.unaFila('SELECT id FROM roles WHERE nombre = $1', [rol]);

  if (!rolFila) {
    console.log(`  omitido ${username}: el rol '${rol}' no existe (corre npm run migrate primero)`);
    return null;
  }

  if (existente) {
    if (existente.rol_id === null) {
      await db.query('UPDATE usuarios SET rol_id = $1 WHERE id = $2', [rolFila.id, existente.id]);
      console.log(`  ${username}: ya existia sin rol, se le asigno '${rol}'`);
    } else {
      console.log(`  ${username}: ya existe, sin cambios`);
    }
    return null;
  }

  await db.query(
    `INSERT INTO usuarios (username, password_hash, nombre_completo, email, rol_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [username, await bcrypt.hash(password, COSTO_BCRYPT), nombre, email, rolFila.id],
  );

  console.log(`  ${username}: creado con rol '${rol}'`);
  return password;
}

async function main() {
  const conEjemplos = process.argv.includes('--ejemplos');

  const { total } = await db.unaFila('SELECT COUNT(*)::int AS total FROM usuarios');
  console.log(`Usuarios existentes: ${total}\n`);

  // La contrasena del administrador nunca queda fija en el codigo: sale del entorno o
  // se genera y se muestra una unica vez.
  const passwordAdmin = process.env.ADMIN_PASSWORD || generarPassword();
  const generada = !process.env.ADMIN_PASSWORD;

  const creada = await crearSiFalta({
    username: process.env.ADMIN_USERNAME || 'admin',
    password: passwordAdmin,
    nombre: 'Administrador del Sistema',
    email: process.env.ADMIN_EMAIL || 'admin@electoral.gov.ar',
    rol: 'administrador',
  });

  if (creada && generada) {
    console.log('\n  ------------------------------------------------------------');
    console.log(`  Contrasena generada: ${creada}`);
    console.log('  Guardala ahora: no se vuelve a mostrar y no queda en los logs.');
    console.log('  ------------------------------------------------------------');
  }

  if (conEjemplos) {
    console.log('\nUsuarios de ejemplo:');
    const ejemplos = [
      { username: 'consultor1', nombre: 'Ana Rodriguez', email: 'ana.rodriguez@electoral.gov.ar', rol: 'consultor' },
      { username: 'encargado1', nombre: 'Juan Perez', email: 'juan.perez@electoral.gov.ar', rol: 'encargado_relevamiento' },
    ];

    for (const ejemplo of ejemplos) {
      const password = generarPassword();
      const resultado = await crearSiFalta({ ...ejemplo, password });
      if (resultado) console.log(`     contrasena: ${resultado}`);
    }
  }

  console.log('');
}

main()
  .catch((error) => {
    logger.error('Fallo el alta de usuarios', error);
    process.exitCode = 1;
  })
  .finally(() => db.cerrar().catch(() => {}));
