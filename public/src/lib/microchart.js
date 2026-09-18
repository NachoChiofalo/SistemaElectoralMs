/**
 * microchart — el subconjunto de Chart.js que este sistema usa, en SVG.
 *
 * `resultados.html` bajaba 205 KB de Chart.js desde jsDelivr para dibujar dos tipos de
 * grafico: tres doughnut y tres bar. El resto del paquete —lineas, radar, burbujas,
 * escalas logaritmicas, animaciones, el motor de canvas— viajaba en cada visita sin
 * que nada lo llamara.
 *
 * Expone `window.Chart` con la misma firma, asi que los seis puntos de llamada de
 * ResultadosComponent quedaron sin tocar. Lo soportado es exactamente lo que el
 * componente pide:
 *
 *   type          'doughnut' | 'bar'
 *   options       responsive, maintainAspectRatio, indexAxis: 'y',
 *                 scales.{x,y}.beginAtZero, plugins.legend.{display,position},
 *                 plugins.tooltip.callbacks.label
 *   instancia     .destroy()
 *
 * Una opcion que no este en esa lista se ignora en silencio, igual que haria Chart.js
 * con una clave desconocida. Si mas adelante hace falta un tipo nuevo, se agrega acá:
 * el punto de esto no es reimplementar Chart.js, es no pagarlo entero.
 *
 * Se dibuja en SVG y no en canvas a proposito. El texto queda seleccionable y legible
 * para un lector de pantalla, el grafico se reescala sin redibujarse ni verse borroso
 * en pantallas HiDPI, y no hay que multiplicar por devicePixelRatio a mano.
 */
(function () {
  'use strict';

  // Solo se usa si un dataset no trae `backgroundColor`. Son tokens, no hex, para que
  // un grafico sin colores explicitos siga igual al design system.
  const PALETA_POR_DEFECTO = [
    'var(--ds-party-pj)',
    'var(--ds-party-ucr)',
    'var(--ds-party-indeciso)',
    'var(--ds-accent-500)',
    'var(--ds-info-500)',
  ];
  const NS = 'http://www.w3.org/2000/svg';

  const num = valor => {
    const n = typeof valor === 'number' ? valor : parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  };

  const formatear = valor => num(valor).toLocaleString('es-AR');

  // `fill` y `stroke` van por `style` y no como atributo de presentacion, porque asi
  // aceptan `var(--ds-party-pj)`: un atributo SVG no resuelve custom properties. Es lo
  // que hace que los graficos sigan al design system —y al modo oscuro— en vez de
  // llevar los colores clavados en el componente.
  const PROPIEDADES_DE_ESTILO = new Set(['fill', 'stroke']);

  function crear(tag, atributos) {
    const el = document.createElementNS(NS, tag);
    for (const [clave, valor] of Object.entries(atributos || {})) {
      if (valor === null || valor === undefined) continue;
      if (PROPIEDADES_DE_ESTILO.has(clave)) el.style.setProperty(clave, String(valor));
      else el.setAttribute(clave, String(valor));
    }
    return el;
  }

  /**
   * Elige un maximo y un paso "redondos" para el eje de valores.
   *
   * Sin esto las marcas caen en numeros como 3847 y el grafico se vuelve ilegible. Se
   * redondea el paso al 1, 2 o 5 mas cercano dentro de su orden de magnitud, que es lo
   * que hace que un eje se lea de un vistazo.
   */
  function escala(maximo, marcas) {
    if (!(maximo > 0)) return { maximo: 1, paso: 1 };

    const crudo = maximo / marcas;
    const magnitud = Math.pow(10, Math.floor(Math.log10(crudo)));
    const normalizado = crudo / magnitud;
    const paso = (normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10) * magnitud;

    return { maximo: Math.ceil(maximo / paso) * paso, paso };
  }

  /** Segmento de anillo entre dos angulos, en coordenadas de reloj (0 = 12 en punto). */
  function segmentoAnillo(cx, cy, radioExterno, radioInterno, desde, hasta) {
    const punto = (radio, angulo) => [
      cx + radio * Math.cos(angulo - Math.PI / 2),
      cy + radio * Math.sin(angulo - Math.PI / 2),
    ];

    const mayor = hasta - desde > Math.PI ? 1 : 0;
    const [x0, y0] = punto(radioExterno, desde);
    const [x1, y1] = punto(radioExterno, hasta);
    const [x2, y2] = punto(radioInterno, hasta);
    const [x3, y3] = punto(radioInterno, desde);

    return `M${x0} ${y0}A${radioExterno} ${radioExterno} 0 ${mayor} 1 ${x1} ${y1}` +
           `L${x2} ${y2}A${radioInterno} ${radioInterno} 0 ${mayor} 0 ${x3} ${y3}Z`;
  }

  class Chart {
    /**
     * @param {HTMLCanvasElement|CanvasRenderingContext2D} destino  El componente pasa
     *   el contexto 2D, como le pedia Chart.js. Se acepta cualquiera de los dos para
     *   no obligar a tocar los puntos de llamada.
     */
    constructor(destino, config) {
      this.canvas = destino && destino.canvas ? destino.canvas : destino;
      if (!this.canvas || !this.canvas.parentElement) {
        throw new Error('microchart: el destino no esta en el documento');
      }

      this.config = config || {};
      this.host = this.canvas.parentElement;

      // El <canvas> se queda en el DOM aunque no se dibuje: el componente lo vuelve a
      // buscar por id en cada actualizacion, y sacarlo romperia esa busqueda.
      this.canvas.style.display = 'none';

      this.raiz = document.createElement('div');
      this.raiz.className = 'microchart';
      this.host.appendChild(this.raiz);

      this.pista = document.createElement('div');
      this.pista.className = 'microchart-pista';
      this.pista.hidden = true;
      this.raiz.appendChild(this.pista);

      // Los graficos viven en pestañas: al construirse, la mayoria esta en un panel
      // con display:none y mide cero. Se dibuja cuando el observer avisa que hay
      // tamaño, que es tambien lo que resuelve el `responsive: true`.
      this.observer = new ResizeObserver(() => this.dibujar());
      this.observer.observe(this.raiz);
      this.dibujar();
    }

    destroy() {
      if (this.observer) this.observer.disconnect();
      if (this.raiz && this.raiz.parentElement) this.raiz.remove();
      if (this.canvas) this.canvas.style.display = '';
      this.observer = null;
      this.raiz = null;
    }

    // ---- infraestructura de dibujo ----------------------------------------

    dibujar() {
      if (!this.raiz) return;

      const ancho = this.raiz.clientWidth;
      const alto = this.raiz.clientHeight;
      if (ancho < 2 || alto < 2) return;

      if (this.svg) this.svg.remove();

      const leyenda = this.construirLeyenda();
      const altoLeyenda = leyenda ? leyenda.offsetHeight : 0;

      this.svg = crear('svg', {
        class: 'microchart-svg',
        viewBox: `0 0 ${ancho} ${Math.max(alto - altoLeyenda, 1)}`,
        width: ancho,
        height: Math.max(alto - altoLeyenda, 1),
        role: 'img',
      });
      this.raiz.insertBefore(this.svg, this.pista);

      const area = { ancho, alto: Math.max(alto - altoLeyenda, 1) };
      if (this.config.type === 'doughnut') this.dibujarAnillo(area);
      else this.dibujarBarras(area);
    }

    construirLeyenda() {
      if (this.leyenda) this.leyenda.remove();
      this.leyenda = null;

      const opciones = this.config.options?.plugins?.legend || {};
      if (opciones.display === false) return null;

      const entradas = this.entradasDeLeyenda();
      if (entradas.length === 0) return null;

      const lista = document.createElement('ul');
      lista.className = 'microchart-leyenda';

      for (const entrada of entradas) {
        const item = document.createElement('li');
        const muestra = document.createElement('span');
        muestra.className = 'microchart-muestra';
        // setProperty y no la asignacion directa: acepta `var(--ds-party-pj)` igual que
        // un hex, y asi la muestra de la leyenda no se desincroniza del arco que nombra.
        muestra.style.setProperty('background-color', entrada.color);
        item.appendChild(muestra);
        item.appendChild(document.createTextNode(entrada.texto));
        lista.appendChild(item);
      }

      // Se inserta antes de medir: offsetHeight necesita que ya este en el layout para
      // poder descontarle esa altura al area del grafico.
      this.raiz.insertBefore(lista, this.pista);
      this.leyenda = lista;
      return lista;
    }

    /**
     * Un doughnut tiene un dataset y muchas etiquetas; un bar agrupado tiene un dataset
     * por serie. La leyenda nombra lo que distingue los colores en cada caso.
     */
    entradasDeLeyenda() {
      const { labels = [], datasets = [] } = this.config.data || {};

      if (this.config.type === 'doughnut') {
        const colores = this.coloresDe(datasets[0], labels.length);
        return labels.map((texto, i) => ({ texto, color: colores[i] }));
      }

      if (datasets.length === 1 && !datasets[0].label) return [];

      return datasets.map((dataset, i) => ({
        texto: dataset.label || `Serie ${i + 1}`,
        color: this.coloresDe(dataset, 1)[0],
      }));
    }

    coloresDe(dataset, cantidad) {
      const fondo = dataset?.backgroundColor;
      if (Array.isArray(fondo)) {
        return Array.from({ length: cantidad }, (_, i) => fondo[i] || PALETA_POR_DEFECTO[i % PALETA_POR_DEFECTO.length]);
      }
      if (typeof fondo === 'string') return Array.from({ length: cantidad }, () => fondo);
      return Array.from({ length: cantidad }, (_, i) => PALETA_POR_DEFECTO[i % PALETA_POR_DEFECTO.length]);
    }

    /**
     * Texto de la pista flotante.
     *
     * Respeta `plugins.tooltip.callbacks.label` recibiendo el mismo objeto de contexto
     * que arma Chart.js —`parsed`, `label`, `dataset`— porque el componente lo usa para
     * agregarle el porcentaje a los doughnut.
     */
    textoDePista(etiqueta, valor, dataset) {
      const callback = this.config.options?.plugins?.tooltip?.callbacks?.label;

      if (typeof callback === 'function') {
        try {
          const texto = callback({ parsed: valor, label: etiqueta, dataset, raw: valor });
          if (texto) return String(texto);
        } catch {
          // Un callback roto degrada a la pista por defecto en vez de tumbar el grafico.
        }
      }

      return `${etiqueta}: ${formatear(valor)}`;
    }

    conPista(elemento, texto) {
      elemento.addEventListener('mouseenter', () => {
        this.pista.textContent = texto;
        this.pista.hidden = false;
      });
      elemento.addEventListener('mousemove', evento => {
        const caja = this.raiz.getBoundingClientRect();
        this.pista.style.left = `${evento.clientX - caja.left}px`;
        this.pista.style.top = `${evento.clientY - caja.top}px`;
      });
      elemento.addEventListener('mouseleave', () => { this.pista.hidden = true; });

      // La pista es decoracion: el dato ya viaja en el <title>, que es lo que lee un
      // lector de pantalla y lo que aparece sin mouse.
      elemento.appendChild(crear('title')).textContent = texto;
    }

    // ---- doughnut ---------------------------------------------------------

    dibujarAnillo({ ancho, alto }) {
      const { labels = [], datasets = [] } = this.config.data || {};
      const dataset = datasets[0];
      if (!dataset) return;

      const valores = (dataset.data || []).map(num);
      const total = valores.reduce((a, b) => a + b, 0);
      if (total <= 0) return this.dibujarSinDatos({ ancho, alto });

      const colores = this.coloresDe(dataset, valores.length);
      const cx = ancho / 2;
      const cy = alto / 2;
      const radioExterno = Math.max(Math.min(ancho, alto) / 2 - 8, 8);
      const radioInterno = radioExterno * 0.62;
      // El borde separa los arcos del fondo de la tarjeta, asi que sigue a la superficie
      // y no a un blanco fijo: en modo oscuro un blanco fijo dibujaria un anillo brillante.
      const borde = dataset.borderColor || 'var(--ds-bg-card)';
      const grosorBorde = num(dataset.borderWidth ?? 2);

      let desde = 0;
      valores.forEach((valor, i) => {
        if (valor <= 0) return;

        const hasta = desde + (valor / total) * Math.PI * 2;
        const esCompleto = hasta - desde >= Math.PI * 2 - 1e-6;

        // Un unico valor no nulo cubre la vuelta entera, y un arco SVG de 360 grados
        // degenera en un punto: ahi hace falta un circulo con el anillo como trazo.
        const forma = esCompleto
          ? crear('circle', {
              cx, cy,
              r: (radioExterno + radioInterno) / 2,
              fill: 'none',
              stroke: colores[i],
              'stroke-width': radioExterno - radioInterno,
            })
          : crear('path', {
              d: segmentoAnillo(cx, cy, radioExterno, radioInterno, desde, hasta),
              fill: colores[i],
              stroke: borde,
              'stroke-width': grosorBorde,
            });

        forma.setAttribute('class', 'microchart-arco');
        this.conPista(forma, this.textoDePista(labels[i] ?? '', valor, dataset));
        this.svg.appendChild(forma);

        desde = hasta;
      });

      const centro = crear('text', {
        x: cx, y: cy, class: 'microchart-total',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
      });
      centro.textContent = formatear(total);
      this.svg.appendChild(centro);
    }

    dibujarSinDatos({ ancho, alto }) {
      const texto = crear('text', {
        x: ancho / 2, y: alto / 2, class: 'microchart-vacio',
        'text-anchor': 'middle', 'dominant-baseline': 'central',
      });
      texto.textContent = 'Sin datos';
      this.svg.appendChild(texto);
    }

    // ---- bar --------------------------------------------------------------

    dibujarBarras({ ancho, alto }) {
      const horizontal = this.config.options?.indexAxis === 'y';
      const { labels = [], datasets = [] } = this.config.data || {};
      if (labels.length === 0 || datasets.length === 0) return;

      const series = datasets.map(dataset => ({
        dataset,
        etiqueta: dataset.label || '',
        valores: labels.map((_, i) => num((dataset.data || [])[i])),
        colores: this.coloresDe(dataset, labels.length),
      }));

      const maximo = Math.max(0, ...series.flatMap(s => s.valores));
      const { maximo: tope, paso } = escala(maximo, horizontal ? 4 : 5);
      const marcas = [];
      for (let v = 0; v <= tope + paso / 2; v += paso) marcas.push(v);

      // El eje de categorias necesita mas lugar cuando las etiquetas se escriben en
      // horizontal ("Empleados Municipales"); el de valores, solo lo que ocupa el
      // numero mas largo.
      const anchoNumero = 12 + formatear(tope).length * 7;
      const margen = horizontal
        ? { izq: Math.min(150, 12 + Math.max(...labels.map(l => String(l).length)) * 6.5), der: 16, arr: 10, aba: 26 }
        : { izq: anchoNumero, der: 12, arr: 12, aba: 30 };

      const trazado = {
        x: margen.izq,
        y: margen.arr,
        ancho: Math.max(ancho - margen.izq - margen.der, 1),
        alto: Math.max(alto - margen.arr - margen.aba, 1),
      };

      if (horizontal) this.dibujarBarrasHorizontales(trazado, labels, series, tope, marcas);
      else this.dibujarBarrasVerticales(trazado, labels, series, tope, marcas);
    }

    dibujarBarrasVerticales(trazado, labels, series, tope, marcas) {
      const escalaY = valor => trazado.y + trazado.alto - (valor / tope) * trazado.alto;

      for (const marca of marcas) {
        const y = escalaY(marca);
        this.svg.appendChild(crear('line', {
          x1: trazado.x, y1: y, x2: trazado.x + trazado.ancho, y2: y, class: 'microchart-guia',
        }));

        const texto = crear('text', {
          x: trazado.x - 8, y, class: 'microchart-marca',
          'text-anchor': 'end', 'dominant-baseline': 'central',
        });
        texto.textContent = formatear(marca);
        this.svg.appendChild(texto);
      }

      const anchoGrupo = trazado.ancho / labels.length;
      const anchoBarra = (anchoGrupo * 0.68) / series.length;

      labels.forEach((etiqueta, i) => {
        const centro = trazado.x + anchoGrupo * (i + 0.5);
        const desde = centro - (anchoBarra * series.length) / 2;

        series.forEach((serie, s) => {
          const valor = serie.valores[i];
          const y = escalaY(valor);
          const barra = crear('rect', {
            x: desde + anchoBarra * s,
            y,
            width: Math.max(anchoBarra - 2, 1),
            height: Math.max(trazado.y + trazado.alto - y, 0),
            fill: serie.colores[i],
            rx: 2,
            class: 'microchart-barra',
          });

          const nombre = serie.etiqueta ? `${serie.etiqueta} · ${etiqueta}` : etiqueta;
          this.conPista(barra, this.textoDePista(nombre, valor, serie.dataset));
          this.svg.appendChild(barra);
        });

        const texto = crear('text', {
          x: centro, y: trazado.y + trazado.alto + 18,
          class: 'microchart-categoria', 'text-anchor': 'middle',
        });
        texto.textContent = etiqueta;
        this.svg.appendChild(texto);
      });
    }

    dibujarBarrasHorizontales(trazado, labels, series, tope, marcas) {
      const escalaX = valor => trazado.x + (valor / tope) * trazado.ancho;

      for (const marca of marcas) {
        const x = escalaX(marca);
        this.svg.appendChild(crear('line', {
          x1: x, y1: trazado.y, x2: x, y2: trazado.y + trazado.alto, class: 'microchart-guia',
        }));

        const texto = crear('text', {
          x, y: trazado.y + trazado.alto + 18,
          class: 'microchart-marca', 'text-anchor': 'middle',
        });
        texto.textContent = formatear(marca);
        this.svg.appendChild(texto);
      }

      const altoGrupo = trazado.alto / labels.length;
      const altoBarra = (altoGrupo * 0.68) / series.length;

      labels.forEach((etiqueta, i) => {
        const centro = trazado.y + altoGrupo * (i + 0.5);
        const desde = centro - (altoBarra * series.length) / 2;

        series.forEach((serie, s) => {
          const valor = serie.valores[i];
          const barra = crear('rect', {
            x: trazado.x,
            y: desde + altoBarra * s,
            width: Math.max(escalaX(valor) - trazado.x, 0),
            height: Math.max(altoBarra - 2, 1),
            fill: serie.colores[i],
            rx: 2,
            class: 'microchart-barra',
          });

          const nombre = serie.etiqueta ? `${serie.etiqueta} · ${etiqueta}` : etiqueta;
          this.conPista(barra, this.textoDePista(nombre, valor, serie.dataset));
          this.svg.appendChild(barra);
        });

        const texto = crear('text', {
          x: trazado.x - 8, y: centro,
          class: 'microchart-categoria', 'text-anchor': 'end', 'dominant-baseline': 'central',
        });
        texto.textContent = etiqueta;
        this.svg.appendChild(texto);
      });
    }
  }

  window.Chart = Chart;
})();
