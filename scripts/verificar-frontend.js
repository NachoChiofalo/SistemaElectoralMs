#!/usr/bin/env node
'use strict';

/**
 * Verificación visual y de accesibilidad del frontend (docs/DESIGN.md, plan de mejora).
 *
 * Recorre las pantallas en claro/oscuro y móvil/escritorio, guarda capturas y corre
 * axe-core. Solo navega y lee: no escribe datos.
 *
 * IMPORTANTE: no hay base de staging, así que contra un servidor local apuntando a
 * Supabase esto es PRODUCCIÓN. El login cierra la sesión anterior de la misma cuenta
 * (sesión única) y las capturas del padrón pueden mostrar datos reales de personas.
 * Por eso: usá una cuenta de prueba propia, y `verificacion/` está en .gitignore.
 *
 * Uso:
 *   VERIFICAR_USUARIO=... VERIFICAR_CLAVE=... node scripts/verificar-frontend.js [etiqueta]
 *   opciones: --solo=dashboard,mapa   --sin-capturas   --url=http://localhost:8080
 * La etiqueta (por defecto "antes") nombra la carpeta: verificacion/<etiqueta>/
 */

const fs = require('node:fs');
const path = require('node:path');

const PANTALLAS = [
  { id: 'login', ruta: '/index.html', publica: true },
  { id: 'padron', ruta: '/index.html' },
  { id: 'dashboard', ruta: '/dashboard.html' },
  { id: 'resultados', ruta: '/resultados.html' },
  { id: 'mapa', ruta: '/mapa.html' },
  { id: 'listas', ruta: '/listas.html' },
  { id: 'comicio', ruta: '/comicio.html' },
  { id: 'usuarios', ruta: '/usuarios.html' },
  { id: 'auditoria', ruta: '/auditoria.html' },
  { id: 'configuracion', ruta: '/configuracion.html' },
];

const TEMAS = ['light', 'dark'];
const VIEWPORTS = [
  { id: 'movil', width: 390, height: 844 },
  { id: 'escritorio', width: 1280, height: 800 },
];

function argumentos() {
  const opciones = { url: 'http://localhost:8080', solo: null, capturas: true, etiqueta: 'antes' };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--url=')) opciones.url = arg.slice(6).replace(/\/$/, '');
    else if (arg.startsWith('--solo=')) opciones.solo = arg.slice(7).split(',');
    else if (arg === '--sin-capturas') opciones.capturas = false;
    else if (!arg.startsWith('--')) opciones.etiqueta = arg;
  }
  return opciones;
}

async function iniciarSesion(base, usuario, clave) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: clave }),
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok || !cuerpo?.success) {
    throw new Error(`Login falló (${res.status}): ${cuerpo?.message || 'sin detalle'}`);
  }
  return cuerpo.data; // { accessToken, user }
}

/**
 * Alto del documento de una pantalla. Se captura con un viewport de ese alto en vez de
 * usar fullPage: en Chromium headless, fullPage redimensiona la ventana después de
 * cargar y la pantalla del padrón salía con el contenido sin pintar. Se mide una vez
 * por pantalla y ancho (no depende del tema) y se acota para no generar imágenes enormes.
 */
const altos = new Map();
async function altoDe(navegador, base, sesion, pantalla, vp) {
  const clave = `${pantalla.id}__${vp.id}`;
  if (altos.has(clave)) return altos.get(clave);
  const contexto = await navegador.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' });
  await contexto.addInitScript(({ s, publica }) => {
    try {
      if (!publica) {
        localStorage.setItem('authToken', s.accessToken);
        localStorage.setItem('userData', JSON.stringify(s.user));
      }
    } catch { /* sin storage */ }
  }, { s: sesion, publica: !!pantalla.publica });
  const pagina = await contexto.newPage();
  let alto = vp.height;
  try {
    await pagina.goto(base + pantalla.ruta, { waitUntil: 'networkidle' });
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.waitForTimeout(1500);
    alto = await pagina.evaluate(() => document.documentElement.scrollHeight);
  } catch { /* se usa el alto base */ }
  await contexto.close();
  const final = Math.min(Math.max(vp.height, alto), 8000);
  altos.set(clave, final);
  return final;
}

async function main() {
  const { chromium } = require('playwright');
  const { AxeBuilder } = require('@axe-core/playwright');

  const opciones = argumentos();
  const usuario = process.env.VERIFICAR_USUARIO;
  const clave = process.env.VERIFICAR_CLAVE;
  if (!usuario || !clave) {
    console.error('Faltan VERIFICAR_USUARIO y VERIFICAR_CLAVE (cuenta de prueba, no una personal).');
    process.exit(2);
  }

  const salida = path.join(__dirname, '..', 'verificacion', opciones.etiqueta);
  fs.mkdirSync(salida, { recursive: true });

  // Un solo login: la sesión es única, entrar varias veces se cierra a sí mismo.
  const sesion = await iniciarSesion(opciones.url, usuario, clave);
  const pantallas = PANTALLAS.filter((p) => !opciones.solo || opciones.solo.includes(p.id));

  const navegador = await chromium.launch();
  const resumen = [];

  try {
    for (const tema of TEMAS) {
      for (const vp of VIEWPORTS) {
        for (const pantalla of pantallas) {
          const contexto = await navegador.newContext({
            viewport: { width: vp.width, height: await altoDe(navegador, opciones.url, sesion, pantalla, vp) },
            colorScheme: tema,
            reducedMotion: 'reduce',
          });
          // Tema forzado por el mismo mecanismo que usa la app (tema.js).
          await contexto.addInitScript(
            ({ tema: t, sesion: s, publica }) => {
              try {
                localStorage.setItem('sistema-electoral:tema', t);
                if (!publica) {
                  localStorage.setItem('authToken', s.accessToken);
                  localStorage.setItem('userData', JSON.stringify(s.user));
                }
              } catch { /* sin storage: se verá el login */ }
            },
            { tema, sesion, publica: !!pantalla.publica }
          );

          const pagina = await contexto.newPage();
          const consola = [];
          pagina.on('console', (m) => {
            if (m.type() === 'error' || m.type() === 'warning') consola.push(`${m.type()}: ${m.text()}`);
          });
          pagina.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`));

          const etiqueta = `${pantalla.id}__${tema}__${vp.id}`;
          let violaciones = [];
          let error = null;
          try {
            await pagina.goto(opciones.url + pantalla.ruta, { waitUntil: 'networkidle' });
            // Las pantallas se dibujan con innerHTML tras varias llamadas a la API: esperar
            // fuentes y un margen, o la captura sale con el contenido a medio pintar.
            await pagina.evaluate(() => document.fonts.ready);
            await pagina.waitForTimeout(1500);
            if (opciones.capturas) {
              await pagina.screenshot({ path: path.join(salida, `${etiqueta}.png`) });
            }
            const axe = await new AxeBuilder({ page: pagina }).analyze();
            violaciones = axe.violations.map((v) => ({
              regla: v.id,
              impacto: v.impact,
              descripcion: v.help,
              nodos: v.nodes.length,
              ejemplo: v.nodes[0]?.target?.join(' '),
            }));
          } catch (e) {
            error = e.message;
          }
          resumen.push({ etiqueta, error, violaciones, consola });
          await contexto.close();
          process.stdout.write(`${error ? 'ERR ' : 'ok  '} ${etiqueta} (${violaciones.length} reglas axe)\n`);
        }
      }
    }
  } finally {
    await navegador.close();
  }

  fs.writeFileSync(path.join(salida, 'resumen.json'), JSON.stringify(resumen, null, 2));

  const graves = resumen.flatMap((r) =>
    r.violaciones.filter((v) => v.impacto === 'serious' || v.impacto === 'critical').map((v) => ({ ...v, en: r.etiqueta }))
  );
  console.log(`\nResumen en ${path.relative(process.cwd(), salida)}/resumen.json`);
  console.log(`Violaciones serious/critical: ${graves.length}`);
  process.exit(graves.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
