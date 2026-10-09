#!/usr/bin/env node
'use strict';

/**
 * Datos SINTÉTICOS de comicio para verificar el frontend (scripts/verificar-frontend.js):
 * fuerzas, un comicio, mesas con rango de padrón, fiscales y una franja. Nombres ficticios.
 *
 * Complementa a scripts/datos-prueba-frontend.sql (que carga el padrón). Va por la API y no
 * por SQL porque comicio, mesas y fiscales tienen restricciones entre tablas (FK, solapamiento
 * de franjas) que ya valida el servicio.
 *
 * SOLO contra una base descartable: se niega a correr si la URL no es localhost.
 *
 *   VERIFICAR_USUARIO=... VERIFICAR_CLAVE=... node scripts/datos-prueba-comicio.js [--url=http://localhost:8091]
 */

const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:8091').slice(6).replace(/\/$/, '');

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
  console.error(`Me niego a sembrar datos de prueba en ${url}: solo localhost.`);
  process.exit(2);
}

async function main() {
  const usuario = process.env.VERIFICAR_USUARIO;
  const clave = process.env.VERIFICAR_CLAVE;
  if (!usuario || !clave) {
    console.error('Faltan VERIFICAR_USUARIO y VERIFICAR_CLAVE.');
    process.exit(2);
  }

  const login = await (await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: clave }),
  })).json();
  const token = login?.data?.accessToken;
  if (!token) throw new Error('Login falló');

  const api = async (metodo, ruta, cuerpo) => {
    const res = await fetch(url + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${metodo} ${ruta}: ${res.status} ${json.message || ''}`);
    return json.data;
  };

  const existentes = await api('GET', '/api/comicio?limite=100');
  if (existentes.some((c) => c.nombre === 'Elecciones municipales de prueba')) {
    console.log('Ya existe el comicio de prueba: no se vuelve a sembrar.');
    return;
  }

  const fuerzas = [];
  for (const [nombre, sigla, color] of [['Alianza del Norte', 'AN', 1], ['Unidad Ciudadana del Sur', 'UCS', 3], ['Frente Vecinal', 'FV', 5]]) {
    fuerzas.push(await api('POST', '/api/comicio/fuerzas', { nombre, sigla, color }));
  }

  const comicio = await api('POST', '/api/comicio', {
    nombre: 'Elecciones municipales de prueba',
    tipoEleccion: 'municipal',
    fuerzaIds: fuerzas.slice(0, 2).map((f) => f.id),
  });

  const mesas = [];
  mesas.push(await api('POST', `/api/comicio/${comicio.id}/mesas`, { numero: 1, desdeDni: '90000003', hastaDni: '90000018' }));
  mesas.push(await api('POST', `/api/comicio/${comicio.id}/mesas`, { numero: 2 }));
  mesas.push(await api('POST', `/api/comicio/${comicio.id}/mesas`, { numero: 3 }));

  await api('PUT', `/api/comicio/${comicio.id}/mesas/${mesas[0].id}/votos`, {
    blancos: 2, nulos: 1,
    porFuerza: [{ fuerzaId: fuerzas[0].id, cantidad: 7 }, { fuerzaId: fuerzas[1].id, cantidad: 5 }],
  });

  const fiscales = [];
  for (const [nombre, dni, telefono] of [['Marta Quiroga', '90100001', '3442-555001'], ['Julián Benítez', '90100002', null], ['Lucía Sosa', null, '3442-555003']]) {
    fiscales.push(await api('POST', '/api/fiscales', { nombre, dni, telefono }));
  }

  await api('POST', `/api/fiscales/mesas/${mesas[0].id}/asignaciones`, { fiscalId: fiscales[0].id, desde: '08:00', hasta: '13:00' });
  await api('POST', `/api/fiscales/mesas/${mesas[0].id}/asignaciones`, { fiscalId: fiscales[1].id, desde: '13:00', hasta: '18:00' });

  console.log(`Sembrado: ${fuerzas.length} fuerzas, 1 comicio, ${mesas.length} mesas, ${fiscales.length} fiscales, 2 franjas.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
