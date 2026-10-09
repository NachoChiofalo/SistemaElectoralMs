#!/usr/bin/env node
'use strict';

/**
 * Verifica el mapa (018) en un navegador real: teclado (un solo tope de tabulación, flechas),
 * pestañas del panel, vista de lista, diálogo de recalcular y axe. Las capas del mapa se
 * INTERCEPTAN con geometría sintética: la base de prueba no las trae y ninguna ruta del
 * territorio se toca de verdad (nada de escribir ni de salir a Estadística).
 *
 * Mismas reglas que scripts/verificar-frontend.js: NO contra producción.
 *   VERIFICAR_USUARIO=... VERIFICAR_CLAVE=... node scripts/verificar-mapa.js [--url=http://localhost:8091]
 */
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default || require('@axe-core/playwright');

const cuadra = (x, y) => [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]];
const manzanas = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) manzanas.push({ id: i * 3 + j + 1, anillos: cuadra(-60 + i * 0.0012, -33 + j * 0.0012) });
const barrios = [{ id: 1, nombre: 'Radio 1', anillos: [[[-60.0005, -33.0005], [-60.003, -33.0005], [-60.003, -32.996], [-60.0005, -32.996], [-60.0005, -33.0005]]] }, { id: 2, nombre: 'Radio 2', anillos: [[[-59.995, -33.0005], [-59.9965, -33.0005], [-59.9965, -32.996], [-59.995, -32.996], [-59.995, -33.0005]]] }];
const stats = {
  configuracion: { localidad: 'Prueba', etiquetaBarrio: 'Radio censal', umbral: 10 },
  resumen: { total: 400, ubicados: 380, sinUbicar: 10, sinCalcular: 10 },
  manzanas: manzanas.map((m) => ({ id: m.id, votantes: 30, avance: (m.id * 8) % 100, lider: null, desglose_oculto: true })),
  barrios: barrios.map((b) => ({ id: b.id, votantes: 200, avance: 60, lider: null, desglose_oculto: true })),
};
const votos = { PJ: 2, UCR: 14, Indeciso: 19 };
const porcentajes = { PJ: 5.71, UCR: 40, Indeciso: 54.29 };
const corte = (clave, valor, extra) => ({ [clave]: valor, votantes: 23, relevados: 15, desglose_oculto: false, votos, ...extra });
const completo = (extra) => ({
  votantes: 49, relevados: 35, avance: 71.4, desglose_oculto: false, votos, porcentajes,
  porSexo: [corte('sexo', 'F'), corte('sexo', 'M')],
  porEdad: [corte('rango_etario', '18-30'), corte('rango_etario', '31-45'), corte('rango_etario', '46-60'), corte('rango_etario', '60+')],
  condiciones: Object.fromEntries(['empleados_municipales', 'ayuda_social', 'nuevos_votantes', 'fallecidos'].map((k) => [k, { total: 3, desglose_oculto: false, por_opcion: votos }])),
  ...extra,
});
const zona = (tipo, id) => ({
  tipo, id, nombre: tipo === 'barrio' ? 'Radio ' + id : undefined, umbral: 10, etiquetaBarrio: 'Radio censal',
  ...completo(),
  barrio: tipo === 'manzana' ? { tipo: 'barrio', id: 1, nombre: 'Radio 1', ...completo({ votantes: 200, relevados: 120, avance: 60 }) } : undefined,
});

(async () => {
  const base = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:8080').slice(6).replace(/\/$/, '');
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.VERIFICAR_USUARIO, password: process.env.VERIFICAR_CLAVE }) });
  const s = (await r.json()).data;
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await c.addInitScript((s) => { localStorage.setItem('authToken', s.accessToken); localStorage.setItem('userData', JSON.stringify(s.user)); localStorage.setItem('sistema-electoral:tema', 'dark'); }, s);
  await c.route('**/api/territorio/geometria', (rt) => rt.fulfill({ json: { success: true, data: { manzanas, barrios } } }));
  await c.route('**/api/territorio/estadisticas', (rt) => rt.fulfill({ json: { success: true, data: stats } }));
  await c.route(/\/api\/territorio\/zonas\/(\w+)\/(\d+)/, (rt) => { const m = rt.request().url().match(/zonas\/(\w+)\/(\d+)/); rt.fulfill({ json: { success: true, data: zona(m[1], Number(m[2])) } }); });
  await c.route(/\/api\/territorio\/manzanas\/\d+\/votantes/, (rt) => rt.fulfill({ json: { success: true, data: { votantes: [{ apellido: 'Perez', nombre: 'Ana', domicilio: 'Calle 1 100' }], paginacion: { pagina: 1, paginas: 1, total: 1 } } } }));
  const p = await c.newPage();
  const ok = [];
  const chequear = (n, v, d = '') => { ok.push(v); console.log(v ? 'ok  ' : 'FALLA', n, v ? '' : d); };
  await p.goto(base + '/mapa.html', { waitUntil: 'networkidle' });
  await p.waitForSelector('svg.mapa-svg');
  const tope = await p.locator('svg.mapa-svg [data-interactiva][tabindex="0"]').count();
  chequear('un solo tope de tabulación en el mapa', tope === 1, String(tope));
  await p.locator('svg.mapa-svg [data-interactiva][tabindex="0"]').focus();
  await p.keyboard.press('ArrowRight');
  chequear('la flecha mueve el foco a la zona siguiente', await p.evaluate(() => document.activeElement.dataset.id === '2'), await p.evaluate(() => document.activeElement.dataset.id));
  await p.keyboard.press('Enter');
  await p.waitForSelector('[role="tab"]');
  // Regresión: el relleno de los encabezados del shell ensanchó estas tablas y el panel recortaba columnas.
  const desborde = await p.evaluate(() => {
    const panel = document.getElementById('mapa-panel');
    return {
      panel: panel.scrollWidth - panel.clientWidth,
      tablas: [...panel.querySelectorAll('.panel-corte')].map((d) => d.scrollWidth - d.clientWidth).filter((x) => x > 1),
    };
  });
  chequear('el panel de la zona no recorta columnas ni desplaza en horizontal', desborde.panel <= 1 && desborde.tablas.length === 0, JSON.stringify(desborde));
  chequear('se ve la última columna (Indeciso) de cada tabla',
    await p.evaluate(() => [...document.querySelectorAll('#mapa-panel .panel-tabla thead tr')].every((tr) => {
      const th = tr.lastElementChild.getBoundingClientRect(); const pa = document.getElementById('mapa-panel').getBoundingClientRect();
      return th.right <= pa.right + 1;
    })));
  chequear('las pestañas tienen tabpanel enlazado', await p.evaluate(() => { const t = document.querySelector('[role="tab"][aria-selected="true"]'); const pan = document.getElementById(t.getAttribute('aria-controls')); return pan && pan.getAttribute('role') === 'tabpanel' && pan.getAttribute('aria-labelledby') === t.id; }));
  await p.locator('[role="tab"][aria-selected="true"]').focus();
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(300);
  chequear('la flecha cambia de pestaña y deja el foco en la pestaña activa', await p.evaluate(() => document.activeElement.id === 'mapa-tab-votantes' && document.activeElement.getAttribute('aria-selected') === 'true'), await p.evaluate(() => document.activeElement.id));
  await p.locator('#btn-vista').click();
  chequear('la vista de lista muestra una tabla con un botón por zona', await p.locator('.mapa-lista table tbody tr').count() === 12);
  chequear('el botón de vista expone su estado', await p.locator('#btn-vista[aria-pressed="true"]').count() === 1);
  await p.locator('.mapa-lista button').first().click();
  await p.waitForSelector('#mapa-panel h2');
  chequear('elegir desde la lista abre el panel', await p.locator('#mapa-panel h2').count() === 1);
  await p.locator('#btn-recalcular').click();
  chequear('recalcular abre un diálogo nativo', await p.locator('dialog[open].dialogo').count() === 1);
  await p.keyboard.press('Escape');
  chequear('Escape lo cierra', await p.locator('dialog[open]').count() === 0);
  await p.locator('#btn-vista').click();
  const axe = await new AxeBuilder({ page: p }).analyze();
  const graves = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  chequear('axe sin serious/critical con el mapa dibujado', graves.length === 0, graves.map((v) => v.id + ' ' + v.nodes[0].target).join('; '));
  await p.screenshot({ path: (process.env.TEMP || '.') + '/mapa-verificacion.png' });
  await b.close();
  console.log(`${ok.filter(Boolean).length}/${ok.length} verificaciones correctas`);
  process.exit(ok.every(Boolean) ? 0 : 1);
})();
