#!/usr/bin/env node
'use strict';

/**
 * Verifica en un navegador real el comportamiento de los componentes compartidos
 * (public/src/lib y la barra de navegación): lo que necesita DOM, foco y teclado y por
 * eso no se puede probar en Node. Complementa a test/componentes-lib.test.js.
 *
 * Mismas reglas que scripts/verificar-frontend.js: NO contra producción (el login cierra
 * la sesión de la cuenta y no hay staging). Usá la base descartable de docker.
 *
 *   VERIFICAR_USUARIO=... VERIFICAR_CLAVE=... node scripts/verificar-componentes.js [--url=http://localhost:8091]
 */

const url = (process.argv.find((a) => a.startsWith('--url=')) || '--url=http://localhost:8080').slice(6).replace(/\/$/, '');

const resultados = [];
function chequear(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${nombre}${!ok && detalle ? `  -> ${detalle}` : ''}`);
}

async function main() {
  const { chromium } = require('playwright');
  const usuario = process.env.VERIFICAR_USUARIO;
  const clave = process.env.VERIFICAR_CLAVE;
  if (!usuario || !clave) {
    console.error('Faltan VERIFICAR_USUARIO y VERIFICAR_CLAVE (cuenta de prueba).');
    process.exit(2);
  }

  const login = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usuario, password: clave }),
  });
  const sesion = (await login.json()).data;
  if (!sesion) throw new Error('Login falló');

  const navegador = await chromium.launch();

  async function pagina({ ancho = 1280, tema = 'light', ruta = '/dashboard.html' } = {}) {
    const ctx = await navegador.newContext({ viewport: { width: ancho, height: 800 }, colorScheme: tema, reducedMotion: 'reduce' });
    await ctx.addInitScript(({ s, t }) => {
      localStorage.setItem('authToken', s.accessToken);
      localStorage.setItem('userData', JSON.stringify(s.user));
      localStorage.setItem('sistema-electoral:tema', t);
    }, { s: sesion, t: tema });
    const p = await ctx.newPage();
    await p.goto(url + ruta, { waitUntil: 'networkidle' });
    await p.waitForSelector('.navbar-unified');
    await p.waitForTimeout(500);
    return { p, ctx };
  }

  // ------------------------------------------------------------ barra y skip-link
  {
    const { p, ctx } = await pagina();
    chequear('la barra tiene nombre accesible', await p.locator('nav.navbar-unified[aria-label="Principal"]').count() === 1);
    chequear('el destino actual lleva aria-current="page"', await p.locator('.nav-item[aria-current="page"]').count() === 1);
    chequear('los íconos decorativos están ocultos a lectores de pantalla',
      await p.locator('.navbar-unified i.fas:not([aria-hidden="true"])').count() === 0);

    chequear('los destinos van agrupados con nombre accesible', await p.locator('.nav-grupo[role="group"][aria-labelledby]').count() >= 2);
    await p.locator('#nav-colapsar').click();
    chequear('colapsar marca data-nav y aria-expanded=false',
      await p.evaluate(() => document.documentElement.dataset.nav === 'colapsada' && document.getElementById('nav-colapsar').getAttribute('aria-expanded') === 'false'));
    chequear('colapsada, cada destino conserva su nombre (title) y el contenido se corre al ancho de 68 px',
      await p.evaluate(() => !!document.querySelector('.nav-item').title && parseFloat(getComputedStyle(document.body).paddingLeft) === 68));
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('.navbar-unified');
    chequear('la preferencia de colapso sobrevive a recargar', await p.evaluate(() => document.documentElement.dataset.nav === 'colapsada'));
    await p.locator('#nav-colapsar').click();
    chequear('expandir devuelve el ancho de 240 px',
      await p.evaluate(() => parseFloat(getComputedStyle(document.body).paddingLeft) === 240));
    // Foco limpio para lo que sigue: el primer Tab tiene que partir del inicio de la página.
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('.navbar-unified');
    await p.waitForTimeout(300);

    await p.keyboard.press('Tab');
    const enfocado = await p.evaluate(() => document.activeElement.className);
    chequear('el primer Tab cae en el skip-link', enfocado.includes('skip-link'), enfocado);
    await p.waitForTimeout(400); // el skip-link entra con una transición
    const caja = await p.locator('.skip-link').boundingBox();
    chequear('el skip-link es visible al recibir foco', caja && caja.y >= 0 && caja.height > 0, JSON.stringify(caja));
    await p.keyboard.press('Enter');
    const destino = await p.evaluate(() => document.activeElement.id);
    chequear('Enter en el skip-link lleva el foco al contenido', destino === 'contenido', destino);
    await ctx.close();
  }

  // ------------------------------------------------------------ avisos
  {
    const { p, ctx } = await pagina();
    chequear('las regiones vivas existen antes del primer aviso',
      await p.locator('.avisos [role="status"]').count() === 1 && await p.locator('.avisos [role="alert"]').count() === 1);

    await p.evaluate(() => { avisos.exito('Guardado'); avisos.error('<b>Falló</b> la carga'); });
    chequear('un éxito va a la región status', await p.locator('.avisos [role="status"] .aviso--exito').count() === 1);
    chequear('un error va a la región alert', await p.locator('.avisos [role="alert"] .aviso--error').count() === 1);
    const texto = await p.locator('.aviso--error .aviso-texto').textContent();
    chequear('el mensaje entra como texto y no como HTML', texto === '<b>Falló</b> la carga' && await p.locator('.aviso--error b').count() === 0, texto);
    chequear('el botón de cerrar tiene nombre', await p.locator('.aviso button[aria-label="Cerrar aviso"]').count() === 2);
    await p.locator('.aviso--exito button').click();
    chequear('cerrar quita el aviso', await p.locator('.aviso--exito').count() === 0);

    await p.evaluate(() => { for (let i = 0; i < 7; i++) avisos.info('n' + i, { duracion: 0 }); });
    chequear('no se acumulan más de 4 avisos', await p.locator('.aviso').count() <= 4, String(await p.locator('.aviso').count()));
    await ctx.close();
  }

  // ------------------------------------------------------------ diálogo
  {
    const { p, ctx } = await pagina();
    await p.locator('#tema-btn').focus();
    await p.evaluate(() => { window.__r = dialogo.confirmar({ titulo: 'Borrar', mensaje: 'Se pierde para siempre', tono: 'peligro', confirmar: 'Borrar' }); });
    await p.waitForSelector('dialog[open]');

    chequear('es un <dialog> nativo con rol alertdialog', await p.locator('dialog[open][role="alertdialog"]').count() === 1);
    const nombre = await p.evaluate(() => {
      const d = document.querySelector('dialog[open]');
      return document.getElementById(d.getAttribute('aria-labelledby')).textContent;
    });
    chequear('está nombrado por su título (aria-labelledby)', nombre === 'Borrar', nombre);
    const foco = await p.evaluate(() => document.activeElement.textContent);
    chequear('en una acción destructiva el foco arranca en "Cancelar"', foco === 'Cancelar', foco);

    // Con un <dialog> modal el Tab puede pasar un instante por la interfaz del navegador
    // (activeElement = body) antes de volver al diálogo: es comportamiento nativo. Lo que no
    // puede pasar es que el foco llegue a un elemento del contenido de atrás.
    const fugas = [];
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press('Tab');
      const donde = await p.evaluate(() => {
        const a = document.activeElement;
        if (a === document.body || a.closest('dialog[open]')) return null;
        return a.tagName + '#' + a.id + '.' + a.className;
      });
      if (donde) fugas.push(donde);
    }
    chequear('el foco nunca llega al contenido de atrás (12 Tab)', fugas.length === 0, fugas.join(' | '));

    await p.keyboard.press('Escape');
    await p.waitForSelector('dialog[open]', { state: 'detached' });
    chequear('Escape cierra y confirmar() resuelve false', await p.evaluate(() => window.__r) === false);
    chequear('el foco vuelve al disparador', await p.evaluate(() => document.activeElement.id) === 'tema-btn');

    // Aceptar devuelve true
    await p.evaluate(() => { window.__r = dialogo.confirmar({ mensaje: '¿Seguro?' }); });
    await p.waitForSelector('dialog[open]');
    await p.locator('dialog[open] .btn-primary').click();
    chequear('aceptar resuelve true', await p.evaluate(() => window.__r) === true);

    // Cierre por la barra: "salir" abre el diálogo y Escape NO cierra la sesión
    await p.locator('#logout-btn').click();
    await p.waitForSelector('dialog[open]');
    const titulo = await p.locator('dialog[open] .dialogo-titulo').textContent();
    chequear('"salir" pide confirmación con el diálogo propio', titulo === 'Cerrar sesión', titulo);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    chequear('cancelar no cierra la sesión', new URL(p.url()).pathname.endsWith('dashboard.html'));
    await ctx.close();
  }

  // ------------------------------------------------------------ pestañas
  {
    const { p, ctx } = await pagina();
    // pestanas.js todavía no se carga en ninguna página (entra con las pantallas que lo usen).
    await p.addScriptTag({ url: url + '/src/lib/pestanas.js' });
    await p.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', `
        <div id="__t" class="pestanas" role="tablist" aria-label="Prueba">
          <button class="pestana" role="tab" id="t1" aria-controls="p1">Uno</button>
          <button class="pestana" role="tab" id="t2" aria-controls="p2">Dos</button>
          <button class="pestana" role="tab" id="t3" aria-controls="p3">Tres</button>
        </div>
        <div id="p1" role="tabpanel">1</div><div id="p2" role="tabpanel">2</div><div id="p3" role="tabpanel">3</div>`);
      window.__tabs = pestanas.iniciar(document.getElementById('__t'));
    });
    chequear('arranca con la primera pestaña seleccionada y las otras fuera del orden de tabulación',
      await p.evaluate(() => [...document.querySelectorAll('#__t [role=tab]')].map((t) => `${t.getAttribute('aria-selected')}/${t.tabIndex}`).join(',')) === 'true/0,false/-1,false/-1');
    chequear('solo el panel activo está visible', await p.evaluate(() => [...document.querySelectorAll('[role=tabpanel]')].map((x) => x.hidden).join(',')) === 'false,true,true');

    await p.locator('#t1').focus();
    await p.keyboard.press('ArrowRight');
    chequear('→ mueve y activa la siguiente', await p.evaluate(() => document.activeElement.id + ':' + document.activeElement.getAttribute('aria-selected')) === 't2:true');
    await p.keyboard.press('End');
    chequear('Fin salta a la última', await p.evaluate(() => document.activeElement.id) === 't3');
    await p.keyboard.press('ArrowRight');
    chequear('→ en la última vuelve a la primera', await p.evaluate(() => document.activeElement.id) === 't1');
    await p.keyboard.press('ArrowLeft');
    chequear('← en la primera va a la última', await p.evaluate(() => document.activeElement.id) === 't3');
    await ctx.close();
  }

  // ------------------------------------------------------------ cajón móvil
  {
    const { p, ctx } = await pagina({ ancho: 390 });
    await p.locator('#navbar-toggle').click();
    chequear('abrir el cajón marca aria-expanded y mueve el foco al primer destino',
      await p.evaluate(() => document.getElementById('navbar-toggle').getAttribute('aria-expanded') === 'true' && document.activeElement.classList.contains('nav-item')));
    await p.keyboard.press('Escape');
    chequear('Escape cierra el cajón y devuelve el foco al botón',
      await p.evaluate(() => document.getElementById('navbar-toggle').getAttribute('aria-expanded') === 'false' && document.activeElement.id === 'navbar-toggle'));
    await ctx.close();
  }

  // ------------------------------------------------------------ modal de sesión (modo oscuro)
  {
    const { p, ctx } = await pagina({ tema: 'dark' });
    await p.evaluate(() => window.authService.showSessionKickedMessage());
    await p.waitForSelector('dialog[open]');
    chequear('el aviso de sesión es un alertdialog', await p.locator('dialog[open][role="alertdialog"]').count() === 1);
    const colores = await p.evaluate(() => {
      const d = document.querySelector('dialog[open]');
      return { fondo: getComputedStyle(d).backgroundColor, pagina: getComputedStyle(document.body).backgroundColor };
    });
    chequear('en modo oscuro el aviso NO es blanco', colores.fondo !== 'rgb(255, 255, 255)', colores.fondo);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    chequear('Escape no cierra un aviso de sesión terminada', await p.locator('dialog[open]').count() === 1);
    await ctx.close();
  }

  // ------------------------------------------------------------ gráficos (microchart)
  {
    const { p, ctx } = await pagina({ ruta: '/resultados.html' });
    await p.waitForSelector('svg.microchart-svg');
    chequear('cada gráfico es un grupo con nombre que lleva sus datos',
      await p.evaluate(() => [...document.querySelectorAll('svg.microchart-svg')].every((g) => g.getAttribute('role') === 'group' && /\d/.test(g.getAttribute('aria-label') || ''))));
    chequear('cada gráfico tiene un solo tope de tabulación (roving)',
      await p.evaluate(() => [...document.querySelectorAll('svg.microchart-svg')].every((g) => g.querySelectorAll('[tabindex="0"]').length === 1)));
    chequear('las marcas del gráfico no tienen <title> (el dato va en aria-label)',
      await p.locator('svg.microchart-svg title').count() === 0);
    await p.locator('svg.microchart-svg [tabindex="0"]').first().focus();
    const antes = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
    await p.keyboard.press('ArrowRight');
    const despues = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
    chequear('la flecha mueve el foco a la marca siguiente', antes && despues && antes !== despues, `${antes} -> ${despues}`);
    chequear('con el foco en una marca aparece su pista', await p.locator('.microchart-pista:not([hidden])').count() >= 1);
    await ctx.close();
  }

  // ------------------------------------------------------------ calendario de fiscales
  {
    const { p, ctx } = await pagina({ ruta: '/comicio.html' });
    await p.locator('.btn-entrar').first().click();
    await p.waitForSelector('#comicio-detalle-view:not([hidden])');
    await p.locator('#tab-fiscales').click();
    await p.waitForSelector('#calendario-comicio .calendario-tabla');
    chequear('el dibujo del calendario se oculta a lectores de pantalla', await p.locator('#calendario-comicio .calendario-grid[aria-hidden="true"]').count() === 1);
    chequear('el calendario se ofrece como tabla accesible', await p.locator('#calendario-comicio details table.tabla caption').count() === 1);
    await p.locator('#calendario-comicio summary').click();
    chequear('la tabla del calendario lista a los fiscales con su horario',
      await p.evaluate(() => [...document.querySelectorAll('#calendario-comicio tbody tr')].some((tr) => /\d\d:\d\d/.test(tr.textContent))));
    await ctx.close();
  }

  // ------------------------------------------------------------ interruptor de tema del login
  {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(url + '/index.html', { waitUntil: 'networkidle' });
    await p.waitForSelector('#login-tema');
    const tema = () => p.evaluate(() => document.documentElement.dataset.theme || 'sistema');
    chequear('el login arranca en oscuro', await tema() === 'dark', await tema());
    chequear('el interruptor dice qué hará', /claro/i.test(await p.getAttribute('#login-tema', 'aria-label')));
    await p.locator('#login-tema').click();
    chequear('un clic pasa a claro', await tema() === 'light', await tema());
    chequear('el nombre accesible se actualiza', /oscuro/i.test(await p.getAttribute('#login-tema', 'aria-label')));
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('#login-tema');
    chequear('la elección sobrevive a recargar', await tema() === 'light', await tema());
    await p.keyboard.press('Tab'); // el primer Tab cae en el campo de usuario (autofoco) o más adelante: el interruptor se alcanza con teclado
    await p.locator('#login-tema').focus();
    await p.keyboard.press('Enter');
    chequear('se opera con teclado (Enter)', await tema() === 'dark', await tema());
    await ctx.close();
  }

  await navegador.close();

  const fallas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallas.length}/${resultados.length} verificaciones correctas`);
  process.exit(fallas.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
