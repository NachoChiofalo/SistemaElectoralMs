/**
 * Componente de Resultados Electorales.
 *
 * Secciones apiladas, ordenadas por la pregunta que responden: cuanto se relevo, como
 * se reparte, donde falta, a quien se relevo y que condiciones tiene. Antes eran cuatro
 * pestañas, y esconder cuatro respuestas cortas detras de solapas obliga a recordar en
 * cual estaba cada una.
 */

/**
 * Colores de los graficos, como tokens del design system y no como hex.
 *
 * microchart aplica `fill` por `style`, asi que un `var(--ds-party-pj)` resuelve igual
 * que un `#1e3a8a`. La diferencia es que el color pasa a estar definido en un solo
 * lugar: si cambia la identidad —o si el usuario esta en modo oscuro— los graficos
 * acompañan sin tocar este archivo. Antes el mismo `#1e3a8a` estaba escrito cinco veces.
 */
const COLORES = {
    // Las condiciones no son fuerzas politicas: se distinguen por rol semantico. El color de
    // cada opcion politica lo da window.opcionesPoliticas (021), no este archivo.
    condiciones: [
        'var(--ds-primary-500)',
        'var(--ds-warning-500)',
        'var(--ds-success-500)',
        'var(--ds-danger-500)',
    ],
};

/**
 * Porcentaje con la coma decimal de es-AR ("33,3"). `toFixed` devolvía "33.3", que en una
 * interfaz en español es inconsistente con formatNumber() y se lee mal en una planilla.
 */
function formatPct(valor, decimales = 1) {
    const n = Number(valor);
    return new Intl.NumberFormat('es-AR', {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales
    }).format(Number.isFinite(n) ? n : 0);
}

class ResultadosComponent {
    constructor() {
        this.container = null;
        this.datos = {
            general: null,
            porSexo: null,
            porRangoEtario: null,
            condiciones: null
        };
        this.graficos = {};
        this.ultimaActualizacion = null;
    }

    async init(containerId = 'resultados-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error('Contenedor ' + containerId + ' no encontrado');
        }

        if (typeof Chart === 'undefined') {
            this.mostrarError('El módulo de gráficos (microchart.js) no está disponible.');
            return false;
        }

        const apiDisponible = await window.apiService.verificarEstado();
        if (!apiDisponible) {
            this.mostrarError('No se puede conectar con el servicio del padrón.');
            return false;
        }

        this.crearInterfaz();
        await this.cargarDatos();
        return true;
    }

    crearInterfaz() {
        this.container.innerHTML = `
            <div class="resultados-header">
                <div class="resultados-title">
                    <h1><i class="fas fa-chart-bar" aria-hidden="true"></i> Resultados</h1>
                    <p class="resultados-subtitle">Panel de análisis del relevamiento electoral</p>
                    <p class="resultados-update-time" id="ultima-actualizacion"></p>
                </div>
                <div class="resultados-actions">
                    <button id="btn-actualizar-resultados" class="btn btn-primary">
                        <i class="fas fa-sync"></i> Actualizar
                    </button>
                    <div class="export-dropdown">
                        <button id="btn-exportar-toggle" type="button" class="btn btn-secondary" aria-expanded="false" aria-controls="export-menu">
                            <i class="fas fa-file-export" aria-hidden="true"></i> Exportar <i class="fas fa-caret-down" aria-hidden="true"></i>
                        </button>
                        <div class="export-menu" id="export-menu">
                            <button id="btn-exportar-json" type="button" class="export-option">
                                <i class="fas fa-file-code"></i> Exportar JSON
                            </button>
                            <button id="btn-exportar-csv" type="button" class="export-option">
                                <i class="fas fa-file-csv"></i> Exportar CSV
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="resultados-loading">${estados.cargando('Cargando resultados…')}</div>

            <div id="resultados-content" class="resultados-content" hidden>
                <!-- Estadisticas Generales Cards -->
                <section class="estadisticas-generales">
                    <div class="stats-grid" id="stats-generales"></div>
                </section>

                <!-- Condiciones Especiales Cards -->
                <section class="estadisticas-condiciones">
                    <h2><i class="fas fa-clipboard-list"></i> Datos del Relevamiento</h2>
                    <div class="stats-grid condiciones-grid" id="stats-condiciones"></div>
                </section>

                <!-- Tabs de navegacion -->
                <!-- Secciones apiladas, en el orden en que se hacen las preguntas.
                     Antes eran cuatro pestañas: esconder cuatro respuestas cortas
                     detrás de solapas obliga a recordar en cuál estaba cada una, y a
                     hacer un clic para comparar dos cortes que entran juntos en
                     pantalla. Apiladas se recorren con scroll y se comparan de un
                     vistazo. -->

                <!-- 1. Fuerzas: el reparto, que es la pregunta principal -->
                <section class="bloque">
                    <h2 class="bloque-titulo">Distribución de preferencia política</h2>
                    <div class="bloque-grid">
                        <div class="chart-card">
                            <div class="chart-container chart-medium">
                                <canvas id="chart-principal"></canvas>
                            </div>
                        </div>
                        <div class="chart-card">
                            <div id="comparador-barras"></div>
                            <div class="resumen-tabla" id="resumen-general"></div>
                        </div>
                    </div>
                </section>

                <!-- 2. Dónde falta: el corte territorial. Estaba en la API
                     (/api/padron/resultados/por-circuito) y no se mostraba en ninguna
                     pantalla, siendo el único que dice adónde ir a relevar. -->
                <section class="bloque" id="bloque-circuito">
                    <h2 class="bloque-titulo">Por circuito</h2>
                    <p class="bloque-ayuda">Dónde se relevó y dónde falta.</p>
                    <div class="tabla-container" id="stats-circuito" role="region" aria-label="Resultados por circuito" tabindex="0"></div>
                </section>

                <!-- Apellidos repetidos (019): se carga a pedido, no con la pantalla. -->
                <section class="bloque" id="bloque-familias">
                    <h2 class="bloque-titulo">Apellidos repetidos</h2>
                    <p class="bloque-ayuda">Apellidos que comparten varios votantes: sirve para relevar a más
                        de una persona por visita. Un apellido común (Gómez, Pérez) no implica parentesco.</p>
                    <button type="button" class="btn btn-secondary" id="btn-cargar-familias">
                        <i class="fas fa-users"></i> Ver apellidos repetidos
                    </button>
                    <div class="tabla-container" id="stats-familias" role="region" aria-label="Apellidos repetidos" tabindex="0"></div>
                </section>

                <!-- 3. Quién: los cortes demográficos, juntos porque se comparan -->
                <section class="bloque">
                    <h2 class="bloque-titulo">Por sexo y edad</h2>
                    <div class="bloque-grid">
                        <div class="chart-card">
                            <h3>Sexo</h3>
                            <div class="chart-container chart-medium">
                                <canvas id="chart-sexo"></canvas>
                            </div>
                            <div class="tabla-container" id="stats-sexo" role="region" aria-label="Resultados por sexo" tabindex="0"></div>
                        </div>
                        <div class="chart-card">
                            <h3>Rango etario</h3>
                            <div class="chart-container chart-medium">
                                <canvas id="chart-edad"></canvas>
                            </div>
                            <div class="tabla-container" id="stats-edad" role="region" aria-label="Resultados por rango etario" tabindex="0"></div>
                        </div>
                    </div>
                </section>

                <!-- 4. Condiciones: lo más específico va último -->
                <section class="bloque">
                    <h2 class="bloque-titulo">Condiciones especiales</h2>
                    <div class="bloque-grid">
                        <div class="chart-card">
                            <h3>Vista general</h3>
                            <div class="chart-container chart-medium">
                                <canvas id="chart-condiciones-general"></canvas>
                            </div>
                        </div>
                        <div class="chart-card">
                            <h3>Empleados municipales por opción</h3>
                            <div class="chart-container chart-small">
                                <canvas id="chart-empleados-politica"></canvas>
                            </div>
                        </div>
                        <div class="chart-card">
                            <h3>Ayuda social por opción</h3>
                            <div class="chart-container chart-small">
                                <canvas id="chart-ayuda-politica"></canvas>
                            </div>
                        </div>
                        <div class="chart-card full-width">
                            <h3>Detalle</h3>
                            <div class="tabla-container" id="stats-condiciones-tabla" role="region" aria-label="Detalle de condiciones especiales" tabindex="0"></div>
                        </div>
                    </div>
                </section>
            </div>

            <div id="resultados-error" hidden></div>
        `;

        this.inicializarEventos();
    }

    inicializarEventos() {
        document.getElementById('btn-cargar-familias')?.addEventListener('click', () => this.cargarFamilias());
        const btnActualizar = document.getElementById('btn-actualizar-resultados');
        const btnExportarToggle = document.getElementById('btn-exportar-toggle');
        const btnExportarJson = document.getElementById('btn-exportar-json');
        const btnExportarCsv = document.getElementById('btn-exportar-csv');

        if (btnActualizar) {
            btnActualizar.addEventListener('click', () => this.actualizarResultados());
        }

        const menu = document.getElementById('export-menu');
        const cerrarMenu = ({ devolverFoco = false } = {}) => {
            if (!menu || !menu.classList.contains('show')) return;
            menu.classList.remove('show');
            if (btnExportarToggle) {
                btnExportarToggle.setAttribute('aria-expanded', 'false');
                if (devolverFoco) btnExportarToggle.focus();
            }
        };

        if (btnExportarToggle && menu) {
            btnExportarToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const abierto = menu.classList.toggle('show');
                btnExportarToggle.setAttribute('aria-expanded', String(abierto));
                if (abierto) menu.querySelector('.export-option')?.focus();
            });
            // Escape cierra y devuelve el foco al botón que lo abrió.
            menu.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); cerrarMenu({ devolverFoco: true }); }
            });
        }

        if (btnExportarJson) {
            btnExportarJson.addEventListener('click', () => {
                this.exportarJSON();
                cerrarMenu({ devolverFoco: true });
            });
        }

        if (btnExportarCsv) {
            btnExportarCsv.addEventListener('click', () => {
                this.exportarCSV();
                cerrarMenu({ devolverFoco: true });
            });
        }

        // Cerrar dropdown al hacer click fuera. Se guarda la referencia para no acumular
        // un listener nuevo en `document` por cada reinicializacion (FE-016).
        if (this.cerrarMenuExportar) document.removeEventListener('click', this.cerrarMenuExportar);
        this.cerrarMenuExportar = () => cerrarMenu();
        document.addEventListener('click', this.cerrarMenuExportar);

    }

    /**
     * Dibuja todos los graficos.
     *
     * Antes se dibujaban de a uno, al abrir cada pestaña, porque un canvas oculto
     * mide cero y Chart.js lo renderizaba mal. Con las secciones apiladas ya no hay
     * nada oculto, asi que se dibujan juntos y desaparece el  que hacia
     * falta para esperar a que el panel se mostrara.
     */
    renderizarGraficos() {
        this.crearGraficoPrincipal();
        this.crearGraficoPorSexo();
        this.crearGraficoPorEdad();
        this.crearGraficosCondiciones();
    }

    async cargarDatos() {
        this.mostrarCarga(true);

        try {
            await window.opcionesPoliticas.cargar();

            // El corte por circuito se pide junto al resto: son cinco consultas que el
            // backend ya cachea 60 s, y pedirlas en paralelo cuesta lo mismo que cuatro.
            const [general, porSexo, porRangoEtario, condiciones, porCircuito] = await Promise.all([
                window.apiService.obtenerEstadisticasAvanzadas(),
                window.apiService.obtenerEstadisticasPorSexo(),
                window.apiService.obtenerEstadisticasPorRangoEtario(),
                window.apiService.obtenerEstadisticasCondicionesDetalladas(),
                window.apiService.obtenerEstadisticasPorCircuito(),
            ]);

            this.datos.general = general.data;
            this.datos.porSexo = porSexo.data;
            this.datos.porRangoEtario = porRangoEtario.data;
            this.datos.condiciones = condiciones.data;
            this.datos.porCircuito = Array.isArray(porCircuito?.data) ? porCircuito.data : [];

            this.ultimaActualizacion = new Date();
            this.mostrarResultados();
        } catch (error) {
            console.error('Error cargando datos:', error);
            this.mostrarError('No se pudieron cargar los resultados. Revisá tu conexión y volvé a intentar.');
        } finally {
            this.mostrarCarga(false);
        }
    }

    mostrarResultados() {
        this.mostrarHoraActualizacion();
        this.mostrarEstadisticasGenerales();
        this.mostrarEstadisticasCondiciones();
        this.mostrarComparadorBarras();
        this.mostrarResumenGeneral();
        this.mostrarTablaCircuito();
        this.mostrarTablaSexo();
        this.mostrarTablaEdad();
        this.mostrarTablaCondiciones();
        this.renderizarGraficos();

        document.getElementById('resultados-content').hidden = false;
    }

    mostrarHoraActualizacion() {
        const el = document.getElementById('ultima-actualizacion');
        if (el && this.ultimaActualizacion) {
            const hora = this.ultimaActualizacion.toLocaleTimeString('es-AR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            el.textContent = 'Última actualización: ' + hora;
        }
    }

    mostrarEstadisticasGenerales() {
        const data = this.datos.general;
        const container = document.getElementById('stats-generales');

        // Una tarjeta por opcion politica de la instancia (021). La etiqueta la escribe el
        // cliente: se escapa.
        const tarjetasOpciones = this.opciones.map(opcion => `
            <div class="stat-card opcion ${window.opcionesPoliticas.clase(opcion)}">
                <div class="stat-icon"><i class="fas ${opcion.esNeutra ? 'fa-question-circle' : 'fa-flag'}"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(this.votosDe(data, opcion.codigo))}</div>
                    <div class="stat-label">${escaparHtml(opcion.etiqueta)}</div>
                    <div class="stat-percentage">${this.pctTexto(data, opcion.codigo)}%</div>
                </div>
            </div>`).join('');

        container.innerHTML = `
            <div class="stat-card total">
                <div class="stat-icon"><i class="fas fa-users"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.total_votantes)}</div>
                    <div class="stat-label">Total Votantes</div>
                </div>
            </div>
            <div class="stat-card relevados">
                <div class="stat-icon"><i class="fas fa-poll"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.total_relevados)}</div>
                    <div class="stat-label">Relevados</div>
                    <div class="stat-percentage">${formatPct(data.porcentaje_participacion, 2)}%</div>
                </div>
            </div>${tarjetasOpciones}
        `;
    }

    mostrarEstadisticasCondiciones() {
        const data = this.datos.condiciones;
        const container = document.getElementById('stats-condiciones');
        if (!data) return;

        // El denominador sale de `general`, no de `condiciones`: el endpoint
        // condiciones-detalladas no devuelve `total_relevados`, asi que aca
        // `parseInt(undefined) || 1` daba 1 y cada porcentaje quedaba multiplicado por
        // cien — "340 empleados municipales" se mostraba como "34000.0% del
        // relevamiento". El `|| 1` estaba para evitar una division por cero, y lo que
        // hacia era tapar el dato faltante con un numero absurdo en vez de omitirlo.
        const totalRelevados = parseInt(this.datos.general?.total_relevados) || 0;
        const porcentaje = valor => (totalRelevados > 0
            ? formatPct((valor / totalRelevados) * 100) + '% del relevamiento'
            : '');
        const empleados = parseInt(data.total_empleados_municipales) || 0;
        const ayuda = parseInt(data.total_ayuda_social) || 0;
        const nuevos = parseInt(data.total_nuevos_votantes) || 0;
        const fallecidos = parseInt(data.total_fallecidos) || 0;

        container.innerHTML = `
            <div class="stat-card condicion empleados">
                <div class="stat-icon"><i class="fas fa-building"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(empleados)}</div>
                    <div class="stat-label">Empleados Municipales</div>
                    <div class="stat-percentage">${porcentaje(empleados)}</div>
                </div>
            </div>
            <div class="stat-card condicion ayuda">
                <div class="stat-icon"><i class="fas fa-hand-holding-heart"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(ayuda)}</div>
                    <div class="stat-label">Ayuda Social</div>
                    <div class="stat-percentage">${porcentaje(ayuda)}</div>
                </div>
            </div>
            <div class="stat-card condicion nuevos">
                <div class="stat-icon"><i class="fas fa-user-plus"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(nuevos)}</div>
                    <div class="stat-label">Nuevos Votantes</div>
                    <div class="stat-percentage">${porcentaje(nuevos)}</div>
                </div>
            </div>
            <div class="stat-card condicion fallecidos">
                <div class="stat-icon"><i class="fas fa-cross"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(fallecidos)}</div>
                    <div class="stat-label">Fallecidos</div>
                    <div class="stat-percentage">${porcentaje(fallecidos)}</div>
                </div>
            </div>
        `;
    }

    // ==================== COMPARADOR DE BARRAS ====================

    mostrarComparadorBarras() {
        const data = this.datos.general;
        const container = document.getElementById('comparador-barras');
        const totalRelevados = parseInt(data.total_relevados) || 0;

        // Sin relevamientos no hay con que comparar: antes el `|| 1` mostraba "PJ lidera con
        // 0.0%" como si fuera un resultado (FE-019).
        if (totalRelevados === 0) {
            container.innerHTML = '<div class="no-data"><i class="fas fa-info-circle"></i> Todavía no hay votantes relevados para comparar</div>';
            return;
        }

        const valores = this.opciones.map(opcion => ({
            opcion,
            nombre: opcion.etiqueta,
            pct: Number((this.votosDe(data, opcion.codigo) / totalRelevados * 100).toFixed(1)),
        }));

        const barras = valores.map(({ opcion, nombre, pct }) => `
                <div class="barra-item">
                    <div class="barra-label">
                        <span class="barra-nombre">${escaparHtml(nombre)}</span>
                        <span class="barra-valor">${this.formatNumber(this.votosDe(data, opcion.codigo))} (${formatPct(pct)}%)</span>
                    </div>
                    <div class="barra-track">
                        <div class="barra-fill opcion ${window.opcionesPoliticas.clase(opcion)}" style="width: ${pct}%"></div>
                    </div>
                </div>`).join('');

        // Determinar lider. Con una sola opcion no hay contra quien compararlo.
        const orden = [...valores].sort((a, b) => b.pct - a.pct);
        const resumen = orden.length < 2 ? '' : `
                <div class="comparador-resumen">
                    <i class="fas fa-trophy"></i>
                    <strong>${escaparHtml(orden[0].nombre)}</strong> lidera con ${formatPct(orden[0].pct)}%
                    (${formatPct(orden[0].pct - orden[1].pct)} puntos de ventaja sobre ${escaparHtml(orden[1].nombre)})
                </div>`;

        container.innerHTML = `
            <div class="comparador">${barras}${resumen}
            </div>
        `;
    }

    mostrarResumenGeneral() {
        const data = this.datos.general;
        const container = document.getElementById('resumen-general');
        const noRelevados = parseInt(data.total_votantes) - parseInt(data.total_relevados);

        const filasOpciones = this.opciones.map(opcion => `
                    <tr class="fila-opcion ${window.opcionesPoliticas.clase(opcion)}">
                        <td>${escaparHtml(opcion.etiqueta)}</td>
                        <td>${this.formatNumber(this.votosDe(data, opcion.codigo))}</td>
                        <td>${this.pctTexto(data, opcion.codigo)}%</td>
                    </tr>`).join('');

        container.innerHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Concepto</th>
                        <th>Cantidad</th>
                        <th>Porcentaje</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Total Votantes</td>
                        <td>${this.formatNumber(data.total_votantes)}</td>
                        <td>100%</td>
                    </tr>
                    <tr>
                        <td>Relevados</td>
                        <td>${this.formatNumber(data.total_relevados)}</td>
                        <td>${formatPct(data.porcentaje_participacion, 2)}%</td>
                    </tr>
                    <tr>
                        <td>Sin Relevar</td>
                        <td>${this.formatNumber(noRelevados)}</td>
                        <td>${formatPct(100 - (parseFloat(data.porcentaje_participacion) || 0), 2)}%</td>
                    </tr>${filasOpciones}
                </tbody>
            </table>
        `;
    }

    // ==================== GRAFICOS ====================

    crearGraficoPrincipal() {
        const canvas = document.getElementById('chart-principal');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.datos.general;

        if (this.graficos.principal) this.graficos.principal.destroy();

        this.graficos.principal = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: this.opciones.map(o => o.etiqueta),
                datasets: [{
                    data: this.opciones.map(o => this.votosDe(data, o.codigo)),
                    backgroundColor: this.coloresOpciones(),
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { title: { display: false, text: 'Distribución de preferencia política' },
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, font: { size: 14 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = formatPct((value / total) * 100);
                                return context.label + ': ' + value + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    /** Un dataset por opcion politica, con la cantidad de cada fila (sexo, rango etario...). */
    datasetsPorOpcion(filas) {
        return this.opciones.map(opcion => ({
            label: opcion.etiqueta,
            data: filas.map(f => this.votosDe(f, opcion.codigo)),
            backgroundColor: window.opcionesPoliticas.color(opcion),
        }));
    }

    crearGraficoPorSexo() {
        const canvas = document.getElementById('chart-sexo');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.datos.porSexo;

        if (this.graficos.sexo) this.graficos.sexo.destroy();

        const labels = data.map(item => item.sexo === 'M' ? 'Masculino' : 'Femenino');

        this.graficos.sexo = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: this.datasetsPorOpcion(data)
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { title: { display: false, text: 'Preferencia política por sexo' }, legend: { position: 'bottom' } }
            }
        });
    }

    crearGraficoPorEdad() {
        const canvas = document.getElementById('chart-edad');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.datos.porRangoEtario;

        if (this.graficos.edad) this.graficos.edad.destroy();

        this.graficos.edad = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(i => i.rango_etario),
                datasets: this.datasetsPorOpcion(data)
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { title: { display: false, text: 'Preferencia política por rango etario' }, legend: { position: 'bottom' } }
            }
        });
    }

    crearGraficosCondiciones() {
        this.crearGraficoCondicionesGeneral();
        this.crearGraficoEmpleadosPolitica();
        this.crearGraficoAyudaPolitica();
    }

    crearGraficoCondicionesGeneral() {
        const canvas = document.getElementById('chart-condiciones-general');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.datos.condiciones;

        if (this.graficos.condicionesGeneral) this.graficos.condicionesGeneral.destroy();

        this.graficos.condicionesGeneral = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Empleados Municipales', 'Ayuda Social', 'Nuevos Votantes', 'Fallecidos'],
                datasets: [{
                    label: 'Cantidad',
                    data: [
                        parseInt(data.total_empleados_municipales) || 0,
                        parseInt(data.total_ayuda_social) || 0,
                        parseInt(data.total_nuevos_votantes) || 0,
                        parseInt(data.total_fallecidos) || 0
                    ],
                    backgroundColor: COLORES.condiciones
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: { x: { beginAtZero: true } },
                plugins: { title: { display: false, text: 'Condiciones especiales, vista general' }, legend: { display: false } }
            }
        });
    }

    /**
     * Muestra "Sin datos" junto al canvas en vez de reemplazarlo. Antes se pisaba
     * `parentElement.innerHTML`, el canvas desaparecia del DOM y el grafico no volvia
     * nunca mas, aunque un refresco posterior si trajera datos (FE-011).
     *
     * @returns {boolean} true si no hay datos y el grafico no debe dibujarse.
     */
    alternarSinDatos(canvas, vacio) {
        let aviso = canvas.parentElement.querySelector('.no-data');
        if (vacio && !aviso) {
            aviso = document.createElement('div');
            aviso.className = 'no-data';
            aviso.innerHTML = '<i class="fas fa-info-circle"></i> Sin datos disponibles';
            canvas.parentElement.appendChild(aviso);
        }
        if (aviso) aviso.style.display = vacio ? '' : 'none';
        canvas.style.display = vacio ? 'none' : '';
        return vacio;
    }

    /**
     * Torta de una condicion especial repartida por opcion politica. `clave` es el campo del
     * endpoint de condiciones (empleados_por_opcion, ayuda_social_por_opcion).
     */
    crearGraficoCondicionPorOpcion(idCanvas, nombreGrafico, clave) {
        const canvas = document.getElementById(idCanvas);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const porOpcion = this.datos.condiciones?.[clave] || {};

        if (this.graficos[nombreGrafico]) this.graficos[nombreGrafico].destroy();

        const valores = this.opciones.map(o => parseInt(porOpcion[o.codigo]) || 0);

        if (this.alternarSinDatos(canvas, valores.every(v => v === 0))) return;

        this.graficos[nombreGrafico] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: this.opciones.map(o => o.etiqueta),
                datasets: [{
                    data: valores,
                    backgroundColor: this.coloresOpciones(),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { title: { display: false, text: 'Preferencia política dentro de la condición especial' },
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = formatPct((value / total) * 100);
                                return context.label + ': ' + value + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    crearGraficoEmpleadosPolitica() {
        this.crearGraficoCondicionPorOpcion('chart-empleados-politica', 'empleadosPolitica', 'empleados_por_opcion');
    }

    crearGraficoAyudaPolitica() {
        this.crearGraficoCondicionPorOpcion('chart-ayuda-politica', 'ayudaPolitica', 'ayuda_social_por_opcion');
    }

    // ==================== TABLAS ====================

    /**
     * Avance por circuito, de menos a mas relevado.
     *
     * Es tabla y no grafico porque la pregunta que responde —cuantos faltan en tal
     * circuito— es una cantidad exacta, no una proporcion, y una barra obliga a estimar
     * a ojo lo que el numero dice directo.
     */
    /** Pide los apellidos repetidos recien cuando se aprieta el boton (019). */
    async cargarFamilias() {
        const boton = document.getElementById('btn-cargar-familias');
        const contenedor = document.getElementById('stats-familias');
        if (!contenedor) return;

        boton.disabled = true;
        try {
            const respuesta = await window.apiService.obtenerEstadisticasPorFamilia();
            const { familias, resumen } = respuesta?.data || { familias: [], resumen: {} };

            if (!familias.length) {
                contenedor.innerHTML = '<div class="no-data">No hay apellidos repetidos.</div>';
                return;
            }

            contenedor.innerHTML =
                `<p class="bloque-ayuda">${this.formatNumber(resumen.apellidos)} apellidos se repiten, ` +
                `con ${this.formatNumber(resumen.personas)} personas en total. Se muestran los ${familias.length} más numerosos.</p>` +
                '<table class="tabla-datos"><thead><tr>' +
                '<th>Apellido</th><th>Integrantes</th><th>Relevados</th>' + this.encabezadosOpciones() +
                '</tr></thead><tbody>' +
                familias.map(f =>
                    '<tr>' +
                    '<td>' + escaparHtml(f.apellido) + '</td>' +
                    '<td>' + this.formatNumber(f.total_votantes) + '</td>' +
                    '<td>' + this.formatNumber(f.total_relevados) + '</td>' +
                    this.celdasOpciones(f, false) +
                    '</tr>'
                ).join('') +
                '</tbody></table>';
        } catch (error) {
            contenedor.innerHTML = '<div class="no-data">' + escaparHtml('No se pudo cargar: ' + error.message) + '</div>';
        } finally {
            boton.disabled = false;
        }
    }

    mostrarTablaCircuito() {
        const contenedor = document.getElementById('stats-circuito');
        const bloque = document.getElementById('bloque-circuito');
        const filas = this.datos.porCircuito || [];

        // Con un solo circuito el corte no compara nada: la seccion se oculta entera en
        // lugar de mostrar una fila que repite el total general.
        if (!bloque) return;
        if (filas.length < 2) { bloque.style.display = 'none'; return; }
        bloque.style.display = '';

        const conAvance = filas.map(f => {
            const total = Number(f.total_votantes) || 0;
            const relevados = Number(f.total_relevados) || 0;
            return { ...f, total, relevados, pct: total > 0 ? Math.round((relevados / total) * 100) : 0 };
        }).sort((a, b) => a.pct - b.pct);

        contenedor.innerHTML = '<table class="tabla-datos"><thead><tr>' +
            '<th>Circuito</th><th>Padron</th><th>Relevados</th><th>Avance</th>' +
            this.encabezadosOpciones() +
            '</tr></thead><tbody>' +
            conAvance.map(c =>
                '<tr>' +
                '<td>' + escaparHtml(c.circuito) + '</td>' +
                '<td>' + this.formatNumber(c.total) + '</td>' +
                '<td>' + this.formatNumber(c.relevados) + '</td>' +
                '<td>' + c.pct + '%</td>' +
                this.celdasOpciones(c, false) +
                '</tr>'
            ).join('') +
            '</tbody></table>';
    }

    mostrarTablaSexo() {
        const container = document.getElementById('stats-sexo');
        const data = this.datos.porSexo;

        // La opcion que lidera entre los relevados (sin contar la neutra): es la que interesa
        // comparar entre sexos. Antes era siempre "PJ"; ahora la define la instancia (021).
        const lider = this.opcionLider();

        // Calcular indicadores de tendencia
        // Se busca cada sexo por su campo: asumir que el array viene [M, F] rompia la
        // tendencia si el servidor devolvia otro orden o solo uno de los dos (FE-042).
        const pctDe = (sexo) => lider
            ? parseFloat(data.find(i => i.sexo === sexo)?.porcentajes?.[lider.codigo])
            : NaN;
        const pctM = pctDe('M');
        const pctF = pctDe('F');
        const tendencia = Number.isFinite(pctM) && Number.isFinite(pctF) ? (pctM > pctF ? 'M' : 'F') : null;

        const tabla = data.map(item => {
            return '<tr>' +
                '<td>' + (item.sexo === 'M' ? 'Masculino' : 'Femenino') + '</td>' +
                '<td>' + this.formatNumber(item.total_votantes) + '</td>' +
                '<td>' + this.formatNumber(item.total_relevados) + '</td>' +
                this.celdasOpciones(item, true) +
                '</tr>';
        }).join('');

        let tendenciaHTML = '';
        if (tendencia !== null) {
            tendenciaHTML = '<div class="tendencia-info">' +
                '<i class="fas fa-chart-line"></i> ' +
                '<strong>' + escaparHtml(lider.etiqueta) + '</strong> tiene mayor porcentaje en el sexo <strong>' + (tendencia === 'M' ? 'Masculino' : 'Femenino') + '</strong>' +
                '</div>';
        }

        container.innerHTML = tendenciaHTML +
            '<table class="stats-table">' +
            '<thead><tr>' +
            '<th>Sexo</th><th>Votantes</th><th>Relevados</th>' + this.encabezadosOpciones() +
            '</tr></thead>' +
            '<tbody>' + tabla + '</tbody></table>';
    }

    mostrarTablaEdad() {
        const container = document.getElementById('stats-edad');
        const data = this.datos.porRangoEtario;

        // Buscar rango con mayor participacion
        let maxPart = { rango: '', pct: 0 };
        data.forEach(item => {
            const pct = parseFloat(item.porcentaje_participacion) || 0;
            if (pct > maxPart.pct) {
                maxPart = { rango: item.rango_etario, pct: pct };
            }
        });

        const tabla = data.map(item => {
            return '<tr>' +
                '<td>' + item.rango_etario + '</td>' +
                '<td>' + this.formatNumber(item.total_votantes) + '</td>' +
                '<td>' + this.formatNumber(item.total_relevados) + '</td>' +
                this.celdasOpciones(item, true) +
                '<td>' + formatPct(item.porcentaje_participacion || 0, 2) + '%</td>' +
                '</tr>';
        }).join('');

        let tendenciaHTML = '';
        if (maxPart.rango) {
            tendenciaHTML = '<div class="tendencia-info">' +
                '<i class="fas fa-arrow-up"></i> ' +
                'Mayor participacion en el rango <strong>' + maxPart.rango + '</strong> (' + maxPart.pct + '%)' +
                '</div>';
        }

        container.innerHTML = tendenciaHTML +
            '<table class="stats-table">' +
            '<thead><tr>' +
            '<th>Rango</th><th>Votantes</th><th>Relevados</th>' + this.encabezadosOpciones() + '<th>Participacion</th>' +
            '</tr></thead>' +
            '<tbody>' + tabla + '</tbody></table>';
    }

    /** Las cuatro condiciones especiales, cada una con su reparto por opcion politica. */
    filasCondiciones() {
        const data = this.datos.condiciones;
        const entero = (v) => parseInt(v) || 0;
        const por = (clave) => this.opciones.map(o => entero(data[clave]?.[o.codigo]));

        return [
            {
                nombre: 'Empleados Municipales',
                total: entero(data.total_empleados_municipales),
                porOpcion: por('empleados_por_opcion'),
                masc: entero(data.empleados_masculino),
                fem: entero(data.empleados_femenino)
            },
            {
                nombre: 'Ayuda Social',
                total: entero(data.total_ayuda_social),
                porOpcion: por('ayuda_social_por_opcion'),
                masc: entero(data.ayuda_social_masculino),
                fem: entero(data.ayuda_social_femenino)
            },
            {
                nombre: 'Nuevos Votantes',
                total: entero(data.total_nuevos_votantes),
                porOpcion: por('nuevos_por_opcion'),
                masc: '-',
                fem: '-'
            },
            {
                nombre: 'Fallecidos',
                total: entero(data.total_fallecidos),
                porOpcion: por('fallecidos_por_opcion'),
                masc: '-',
                fem: '-'
            }
        ];
    }

    mostrarTablaCondiciones() {
        const container = document.getElementById('stats-condiciones-tabla');
        if (!this.datos.condiciones) return;

        const opciones = this.opciones;
        const tablaHTML = this.filasCondiciones().map(f => {
            // La opcion con mas casos en esta condicion (la neutra tambien cuenta, como antes).
            let mayor = 0;
            f.porOpcion.forEach((v, i) => { if (v > f.porOpcion[mayor]) mayor = i; });

            return '<tr>' +
                '<td><strong>' + f.nombre + '</strong></td>' +
                '<td>' + this.formatNumber(f.total) + '</td>' +
                f.porOpcion.map(v => '<td>' + this.formatNumber(v) + '</td>').join('') +
                '<td>' + (typeof f.masc === 'number' ? this.formatNumber(f.masc) : f.masc) + '</td>' +
                '<td>' + (typeof f.fem === 'number' ? this.formatNumber(f.fem) : f.fem) + '</td>' +
                '<td><span class="badge-tendencia">' + (f.total > 0 && opciones[mayor] ? escaparHtml(opciones[mayor].etiqueta) : '-') + '</span></td>' +
                '</tr>';
        }).join('');

        container.innerHTML =
            '<table class="stats-table">' +
            '<thead><tr>' +
            '<th>Condicion</th><th>Total</th>' + this.encabezadosOpciones() + '<th>Masc.</th><th>Fem.</th><th>Mayor Tendencia</th>' +
            '</tr></thead>' +
            '<tbody>' + tablaHTML + '</tbody></table>';
    }

    // ==================== OPCIONES POLITICAS (021) ====================

    /** Las opciones de la instancia, en el orden configurado. */
    get opciones() {
        return window.opcionesPoliticas.lista();
    }

    /** Cantidad de una opcion en una fila de resultados (`votos` es { codigo: n }). */
    votosDe(fila, codigo) {
        return Number(fila?.votos?.[codigo]) || 0;
    }

    /** Porcentaje sobre los relevados, con dos decimales como lo calcula el servidor. */
    pctTexto(fila, codigo) {
        const v = fila?.porcentajes?.[codigo];
        return v === null || v === undefined ? '0' : formatPct(v, 2);
    }

    /** Un <th> por opcion. La etiqueta es del cliente: se escapa. */
    encabezadosOpciones() {
        return this.opciones.map(o => '<th>' + escaparHtml(o.etiqueta) + '</th>').join('');
    }

    /** Una <td> por opcion: la cantidad y, si se pide, el porcentaje entre parentesis. */
    celdasOpciones(fila, conPorcentaje) {
        return this.opciones.map(o =>
            '<td>' + this.formatNumber(this.votosDe(fila, o.codigo)) +
            (conPorcentaje ? ' <small>(' + this.pctTexto(fila, o.codigo) + '%)</small>' : '') +
            '</td>'
        ).join('');
    }

    coloresOpciones() {
        return this.opciones.map(o => window.opcionesPoliticas.color(o));
    }

    /** La opcion no neutra con mas votos en el total general, o null si no hay ninguna. */
    opcionLider() {
        const candidatas = this.opciones.filter(o => !o.esNeutra);
        if (!candidatas.length) return null;
        return candidatas.reduce((a, b) =>
            this.votosDe(this.datos.general, b.codigo) > this.votosDe(this.datos.general, a.codigo) ? b : a);
    }

    /** Escapa un valor para una celda CSV (comas, comillas y saltos de linea). */
    csv(valor) {
        const texto = String(valor ?? '');
        return /[",\n]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
    }

    // ==================== ACCIONES ====================

    async actualizarResultados() {
        const btn = document.getElementById('btn-actualizar-resultados');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
        }

        await this.cargarDatos();

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync"></i> Actualizar';
        }

        this.mostrarNotificacion('Resultados actualizados', 'success');
    }

    exportarJSON() {
        try {
            const datosExportacion = {
                fecha_generacion: new Date().toISOString(),
                estadisticas_generales: this.datos.general,
                por_sexo: this.datos.porSexo,
                por_rango_etario: this.datos.porRangoEtario,
                condiciones_especiales: this.datos.condiciones
            };

            const blob = new Blob([JSON.stringify(datosExportacion, null, 2)], {
                type: 'application/json'
            });

            this.descargarBlob(blob, 'estadisticas_' + new Date().toISOString().split('T')[0] + '.json');
            this.mostrarNotificacion('JSON exportado exitosamente', 'success');
        } catch (error) {
            this.mostrarNotificacion('No se pudo exportar el JSON: ' + error.message, 'error');
        }
    }

    exportarCSV() {
        try {
            const data = this.datos.general;
            const opciones = this.opciones;
            const cabeceraOpciones = opciones.map(o => this.csv(o.etiqueta)).join(',');
            const fila = (valores) => valores.map(v => this.csv(v)).join(',') + '\n';

            let csv = 'Concepto,Cantidad,Porcentaje\n';
            csv += 'Total Votantes,' + data.total_votantes + ',100%\n';
            csv += 'Total Relevados,' + data.total_relevados + ',' + data.porcentaje_participacion + '%\n';
            opciones.forEach(o => {
                csv += this.csv(o.etiqueta) + ',' + this.votosDe(data, o.codigo) + ',' + this.pctTexto(data, o.codigo) + '%\n';
            });

            csv += '\nEstadisticas por Sexo\n';
            csv += 'Sexo,Votantes,Relevados,' + cabeceraOpciones + ',Participacion\n';
            this.datos.porSexo.forEach(item => {
                csv += fila([
                    item.sexo === 'M' ? 'Masculino' : 'Femenino',
                    item.total_votantes, item.total_relevados,
                    ...opciones.map(o => this.votosDe(item, o.codigo)),
                    item.porcentaje_participacion + '%',
                ]);
            });

            csv += '\nEstadisticas por Rango Etario\n';
            csv += 'Rango,Votantes,Relevados,' + cabeceraOpciones + ',Participacion\n';
            this.datos.porRangoEtario.forEach(item => {
                csv += fila([
                    item.rango_etario,
                    item.total_votantes, item.total_relevados,
                    ...opciones.map(o => this.votosDe(item, o.codigo)),
                    item.porcentaje_participacion + '%',
                ]);
            });

            if (this.datos.condiciones) {
                csv += '\nCondiciones Especiales\n';
                csv += 'Condicion,Total,' + cabeceraOpciones + '\n';
                this.filasCondiciones().forEach(f => {
                    csv += fila([f.nombre, f.total, ...f.porOpcion]);
                });
            }

            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            this.descargarBlob(blob, 'estadisticas_' + new Date().toISOString().split('T')[0] + '.csv');
            this.mostrarNotificacion('CSV exportado exitosamente', 'success');
        } catch (error) {
            this.mostrarNotificacion('No se pudo exportar el CSV: ' + error.message, 'error');
        }
    }

    descargarBlob(blob, nombre) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ==================== UTILIDADES ====================

    formatNumber(num) {
        return new Intl.NumberFormat('es-AR').format(num || 0);
    }

    mostrarCarga(mostrar) {
        const loading = document.getElementById('resultados-loading');
        const content = document.getElementById('resultados-content');

        if (mostrar) {
            if (loading) loading.hidden = false;
            if (content) content.hidden = true;
        } else if (loading) {
            loading.hidden = true;
        }
    }

    /**
     * Estado de error de la pantalla, con salida (reintentar).
     *
     * Antes init() lo llamaba ANTES de crear la interfaz: #resultados-error todavía no
     * existía, el `if (errorContainer)` lo saltaba en silencio y la persona veía la
     * página en blanco, sin saber si se estaba cargando o si algo se había roto. Sin
     * ese contenedor, el error ocupa el lugar de la pantalla entera.
     */
    mostrarError(mensaje) {
        const html = estados.error({ texto: mensaje, reintentar: 'reintentar' });
        const errorContainer = document.getElementById('resultados-error');
        if (!errorContainer) {
            this.container.innerHTML = html;
            return;
        }
        errorContainer.innerHTML = html;
        errorContainer.hidden = false;
        const loading = document.getElementById('resultados-loading');
        const content = document.getElementById('resultados-content');
        if (loading) loading.hidden = true;
        if (content) content.hidden = true;
    }

    /** Aviso transitorio: lib/avisos.js (el mensaje entra como texto, no como HTML). */
    mostrarNotificacion(mensaje, tipo) {
        window.avisos.mostrar(mensaje, tipo || 'info');
    }
}

// Instancia global
window.resultadosComponent = new ResultadosComponent();
