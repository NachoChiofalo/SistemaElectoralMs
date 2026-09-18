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
    politica: ['var(--ds-party-pj)', 'var(--ds-party-ucr)', 'var(--ds-party-indeciso)'],
    pj: 'var(--ds-party-pj)',
    ucr: 'var(--ds-party-ucr)',
    indeciso: 'var(--ds-party-indeciso)',
    // Las condiciones no son fuerzas politicas: se distinguen por rol semantico.
    condiciones: [
        'var(--ds-primary-500)',
        'var(--ds-warning-500)',
        'var(--ds-success-500)',
        'var(--ds-danger-500)',
    ],
};

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
            this.mostrarError('Chart.js no esta disponible. Verifique que este incluido en el HTML.');
            return false;
        }

        const apiDisponible = await window.apiService.verificarEstado();
        if (!apiDisponible) {
            this.mostrarError('No se puede conectar con el servicio de padron.');
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
                    <h2><i class="fas fa-chart-bar"></i> Estadisticas y Reportes</h2>
                    <p class="resultados-subtitle">Panel de analisis del relevamiento electoral</p>
                    <p class="resultados-update-time" id="ultima-actualizacion"></p>
                </div>
                <div class="resultados-actions">
                    <button id="btn-actualizar-resultados" class="btn btn-primary">
                        <i class="fas fa-sync"></i> Actualizar
                    </button>
                    <div class="export-dropdown">
                        <button id="btn-exportar-toggle" class="btn btn-secondary">
                            <i class="fas fa-file-export"></i> Exportar <i class="fas fa-caret-down"></i>
                        </button>
                        <div class="export-menu" id="export-menu">
                            <button id="btn-exportar-json" class="export-option">
                                <i class="fas fa-file-code"></i> Exportar JSON
                            </button>
                            <button id="btn-exportar-csv" class="export-option">
                                <i class="fas fa-file-csv"></i> Exportar CSV
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="resultados-loading" class="loading-container">
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Cargando resultados...</p>
                </div>
            </div>

            <div id="resultados-content" class="resultados-content" style="display: none;">
                <!-- Estadisticas Generales Cards -->
                <section class="estadisticas-generales">
                    <div class="stats-grid" id="stats-generales"></div>
                </section>

                <!-- Condiciones Especiales Cards -->
                <section class="estadisticas-condiciones">
                    <h3><i class="fas fa-clipboard-list"></i> Datos del Relevamiento</h3>
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
                    <h3 class="bloque-titulo">Distribución de preferencia política</h3>
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
                    <h3 class="bloque-titulo">Por circuito</h3>
                    <p class="bloque-ayuda">Dónde se relevó y dónde falta.</p>
                    <div class="tabla-container" id="stats-circuito"></div>
                </section>

                <!-- 3. Quién: los cortes demográficos, juntos porque se comparan -->
                <section class="bloque">
                    <h3 class="bloque-titulo">Por sexo y edad</h3>
                    <div class="bloque-grid">
                        <div class="chart-card">
                            <h4>Sexo</h4>
                            <div class="chart-container chart-medium">
                                <canvas id="chart-sexo"></canvas>
                            </div>
                            <div class="tabla-container" id="stats-sexo"></div>
                        </div>
                        <div class="chart-card">
                            <h4>Rango etario</h4>
                            <div class="chart-container chart-medium">
                                <canvas id="chart-edad"></canvas>
                            </div>
                            <div class="tabla-container" id="stats-edad"></div>
                        </div>
                    </div>
                </section>

                <!-- 4. Condiciones: lo más específico va último -->
                <section class="bloque">
                    <h3 class="bloque-titulo">Condiciones especiales</h3>
                    <div class="bloque-grid">
                        <div class="chart-card">
                            <h4>Vista general</h4>
                            <div class="chart-container chart-medium">
                                <canvas id="chart-condiciones-general"></canvas>
                            </div>
                        </div>
                        <div class="chart-card">
                            <h4>Empleados municipales por opción</h4>
                            <div class="chart-container chart-small">
                                <canvas id="chart-empleados-politica"></canvas>
                            </div>
                        </div>
                        <div class="chart-card">
                            <h4>Ayuda social por opción</h4>
                            <div class="chart-container chart-small">
                                <canvas id="chart-ayuda-politica"></canvas>
                            </div>
                        </div>
                        <div class="chart-card full-width">
                            <h4>Detalle</h4>
                            <div class="tabla-container" id="stats-condiciones-tabla"></div>
                        </div>
                    </div>
                </section>
            </div>

            <div id="resultados-error" class="error-container" style="display: none;"></div>
        `;

        this.inicializarEventos();
    }

    inicializarEventos() {
        const btnActualizar = document.getElementById('btn-actualizar-resultados');
        const btnExportarToggle = document.getElementById('btn-exportar-toggle');
        const btnExportarJson = document.getElementById('btn-exportar-json');
        const btnExportarCsv = document.getElementById('btn-exportar-csv');

        if (btnActualizar) {
            btnActualizar.addEventListener('click', () => this.actualizarResultados());
        }

        if (btnExportarToggle) {
            btnExportarToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = document.getElementById('export-menu');
                menu.classList.toggle('show');
            });
        }

        if (btnExportarJson) {
            btnExportarJson.addEventListener('click', () => {
                this.exportarJSON();
                document.getElementById('export-menu').classList.remove('show');
            });
        }

        if (btnExportarCsv) {
            btnExportarCsv.addEventListener('click', () => {
                this.exportarCSV();
                document.getElementById('export-menu').classList.remove('show');
            });
        }

        // Cerrar dropdown al hacer click fuera
        document.addEventListener('click', () => {
            const menu = document.getElementById('export-menu');
            if (menu) menu.classList.remove('show');
        });

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
            // El corte por circuito se pide junto al resto: son cinco consultas que el
            // backend ya cachea 60 s, y pedirlas en paralelo cuesta lo mismo que cuatro.
            const [general, porSexo, porRangoEtario, condiciones, porCircuito] = await Promise.all([
                window.apiService.obtenerEstadisticasAvanzadas(),
                window.apiService.obtenerEstadisticasPorSexo(),
                window.apiService.obtenerEstadisticasPorRangoEtario(),
                window.apiService.obtenerEstadisticasCondicionesDetalladas(),
                window.apiService.request('/api/padron/resultados/por-circuito'),
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
            this.mostrarError('Error cargando datos: ' + error.message);
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

        document.getElementById('resultados-content').style.display = 'block';
    }

    mostrarHoraActualizacion() {
        const el = document.getElementById('ultima-actualizacion');
        if (el && this.ultimaActualizacion) {
            const hora = this.ultimaActualizacion.toLocaleTimeString('es-AR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            el.textContent = 'Ultima actualizacion: ' + hora;
        }
    }

    mostrarEstadisticasGenerales() {
        const data = this.datos.general;
        const container = document.getElementById('stats-generales');

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
                    <div class="stat-percentage">${data.porcentaje_participacion}%</div>
                </div>
            </div>
            <div class="stat-card pj">
                <div class="stat-icon"><i class="fas fa-flag"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.votos_pj)}</div>
                    <div class="stat-label">PJ</div>
                    <div class="stat-percentage">${data.porcentaje_pj || 0}%</div>
                </div>
            </div>
            <div class="stat-card ucr">
                <div class="stat-icon"><i class="fas fa-flag"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.votos_ucr)}</div>
                    <div class="stat-label">UCR</div>
                    <div class="stat-percentage">${data.porcentaje_ucr || 0}%</div>
                </div>
            </div>
            <div class="stat-card indeciso">
                <div class="stat-icon"><i class="fas fa-question-circle"></i></div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.votos_indeciso)}</div>
                    <div class="stat-label">Indecisos</div>
                    <div class="stat-percentage">${data.porcentaje_indeciso || 0}%</div>
                </div>
            </div>
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
            ? ((valor / totalRelevados) * 100).toFixed(1) + '% del relevamiento'
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
        const totalRelevados = parseInt(data.total_relevados) || 1;
        const pjPct = ((parseInt(data.votos_pj) || 0) / totalRelevados * 100).toFixed(1);
        const ucrPct = ((parseInt(data.votos_ucr) || 0) / totalRelevados * 100).toFixed(1);
        const indPct = ((parseInt(data.votos_indeciso) || 0) / totalRelevados * 100).toFixed(1);

        // Determinar lider
        const valores = [
            { nombre: 'PJ', pct: parseFloat(pjPct) },
            { nombre: 'UCR', pct: parseFloat(ucrPct) },
            { nombre: 'Indecisos', pct: parseFloat(indPct) }
        ].sort((a, b) => b.pct - a.pct);

        const diferencia = (valores[0].pct - valores[1].pct).toFixed(1);

        container.innerHTML = `
            <div class="comparador">
                <div class="barra-item">
                    <div class="barra-label">
                        <span class="barra-nombre">PJ</span>
                        <span class="barra-valor">${this.formatNumber(data.votos_pj)} (${pjPct}%)</span>
                    </div>
                    <div class="barra-track">
                        <div class="barra-fill pj" style="width: ${pjPct}%"></div>
                    </div>
                </div>
                <div class="barra-item">
                    <div class="barra-label">
                        <span class="barra-nombre">UCR</span>
                        <span class="barra-valor">${this.formatNumber(data.votos_ucr)} (${ucrPct}%)</span>
                    </div>
                    <div class="barra-track">
                        <div class="barra-fill ucr" style="width: ${ucrPct}%"></div>
                    </div>
                </div>
                <div class="barra-item">
                    <div class="barra-label">
                        <span class="barra-nombre">Indecisos</span>
                        <span class="barra-valor">${this.formatNumber(data.votos_indeciso)} (${indPct}%)</span>
                    </div>
                    <div class="barra-track">
                        <div class="barra-fill indeciso" style="width: ${indPct}%"></div>
                    </div>
                </div>
                <div class="comparador-resumen">
                    <i class="fas fa-trophy"></i>
                    <strong>${valores[0].nombre}</strong> lidera con ${valores[0].pct}%
                    (${diferencia} puntos de ventaja sobre ${valores[1].nombre})
                </div>
            </div>
        `;
    }

    mostrarResumenGeneral() {
        const data = this.datos.general;
        const container = document.getElementById('resumen-general');
        const noRelevados = parseInt(data.total_votantes) - parseInt(data.total_relevados);

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
                        <td>${data.porcentaje_participacion}%</td>
                    </tr>
                    <tr>
                        <td>Sin Relevar</td>
                        <td>${this.formatNumber(noRelevados)}</td>
                        <td>${(100 - parseFloat(data.porcentaje_participacion)).toFixed(2)}%</td>
                    </tr>
                    <tr class="row-pj">
                        <td>PJ</td>
                        <td>${this.formatNumber(data.votos_pj)}</td>
                        <td>${data.porcentaje_pj || 0}%</td>
                    </tr>
                    <tr class="row-ucr">
                        <td>UCR</td>
                        <td>${this.formatNumber(data.votos_ucr)}</td>
                        <td>${data.porcentaje_ucr || 0}%</td>
                    </tr>
                    <tr class="row-indeciso">
                        <td>Indecisos</td>
                        <td>${this.formatNumber(data.votos_indeciso)}</td>
                        <td>${data.porcentaje_indeciso || 0}%</td>
                    </tr>
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
                labels: ['PJ', 'UCR', 'Indecisos'],
                datasets: [{
                    data: [data.votos_pj, data.votos_ucr, data.votos_indeciso],
                    backgroundColor: COLORES.politica,
                    borderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, font: { size: 14 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((value / total) * 100).toFixed(1);
                                return context.label + ': ' + value + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
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
                datasets: [
                    { label: 'PJ', data: data.map(i => i.votos_pj || 0), backgroundColor: COLORES.pj },
                    { label: 'UCR', data: data.map(i => i.votos_ucr || 0), backgroundColor: COLORES.ucr },
                    { label: 'Indecisos', data: data.map(i => i.votos_indeciso || 0), backgroundColor: COLORES.indeciso }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { position: 'bottom' } }
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
                datasets: [
                    { label: 'PJ', data: data.map(i => i.votos_pj || 0), backgroundColor: COLORES.pj },
                    { label: 'UCR', data: data.map(i => i.votos_ucr || 0), backgroundColor: COLORES.ucr },
                    { label: 'Indecisos', data: data.map(i => i.votos_indeciso || 0), backgroundColor: COLORES.indeciso }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: { legend: { position: 'bottom' } }
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
                plugins: { legend: { display: false } }
            }
        });
    }

    crearGraficoEmpleadosPolitica() {
        const canvas = document.getElementById('chart-empleados-politica');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.datos.condiciones;

        if (this.graficos.empleadosPolitica) this.graficos.empleadosPolitica.destroy();

        const pj = parseInt(data.empleados_pj) || 0;
        const ucr = parseInt(data.empleados_ucr) || 0;
        const ind = parseInt(data.empleados_indeciso) || 0;

        if (pj + ucr + ind === 0) {
            canvas.parentElement.innerHTML = '<div class="no-data"><i class="fas fa-info-circle"></i> Sin datos disponibles</div>';
            return;
        }

        this.graficos.empleadosPolitica = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['PJ', 'UCR', 'Indecisos'],
                datasets: [{
                    data: [pj, ucr, ind],
                    backgroundColor: COLORES.politica,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((value / total) * 100).toFixed(1);
                                return context.label + ': ' + value + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    crearGraficoAyudaPolitica() {
        const canvas = document.getElementById('chart-ayuda-politica');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const data = this.datos.condiciones;

        if (this.graficos.ayudaPolitica) this.graficos.ayudaPolitica.destroy();

        const pj = parseInt(data.ayuda_social_pj) || 0;
        const ucr = parseInt(data.ayuda_social_ucr) || 0;
        const ind = parseInt(data.ayuda_social_indeciso) || 0;

        if (pj + ucr + ind === 0) {
            canvas.parentElement.innerHTML = '<div class="no-data"><i class="fas fa-info-circle"></i> Sin datos disponibles</div>';
            return;
        }

        this.graficos.ayudaPolitica = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['PJ', 'UCR', 'Indecisos'],
                datasets: [{
                    data: [pj, ucr, ind],
                    backgroundColor: COLORES.politica,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((value / total) * 100).toFixed(1);
                                return context.label + ': ' + value + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    // ==================== TABLAS ====================

    /**
     * Avance por circuito, de menos a mas relevado.
     *
     * Es tabla y no grafico porque la pregunta que responde —cuantos faltan en tal
     * circuito— es una cantidad exacta, no una proporcion, y una barra obliga a estimar
     * a ojo lo que el numero dice directo.
     */
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
            '<th>PJ</th><th>UCR</th><th>Indecisos</th>' +
            '</tr></thead><tbody>' +
            conAvance.map(c =>
                '<tr>' +
                '<td>' + c.circuito + '</td>' +
                '<td>' + this.formatNumber(c.total) + '</td>' +
                '<td>' + this.formatNumber(c.relevados) + '</td>' +
                '<td>' + c.pct + '%</td>' +
                '<td>' + this.formatNumber(c.votos_pj) + '</td>' +
                '<td>' + this.formatNumber(c.votos_ucr) + '</td>' +
                '<td>' + this.formatNumber(c.votos_indeciso) + '</td>' +
                '</tr>'
            ).join('') +
            '</tbody></table>';
    }

    mostrarTablaSexo() {
        const container = document.getElementById('stats-sexo');
        const data = this.datos.porSexo;

        // Calcular indicadores de tendencia
        const pjPcts = data.map(i => parseFloat(i.porcentaje_pj) || 0);
        const tendenciaPJ = pjPcts.length >= 2 ? (pjPcts[0] > pjPcts[1] ? 'M' : 'F') : null;

        const tabla = data.map(item => {
            return '<tr>' +
                '<td>' + (item.sexo === 'M' ? 'Masculino' : 'Femenino') + '</td>' +
                '<td>' + this.formatNumber(item.total_votantes) + '</td>' +
                '<td>' + this.formatNumber(item.total_relevados) + '</td>' +
                '<td>' + this.formatNumber(item.votos_pj) + ' <small>(' + (item.porcentaje_pj || 0) + '%)</small></td>' +
                '<td>' + this.formatNumber(item.votos_ucr) + ' <small>(' + (item.porcentaje_ucr || 0) + '%)</small></td>' +
                '<td>' + this.formatNumber(item.votos_indeciso) + ' <small>(' + (item.porcentaje_indeciso || 0) + '%)</small></td>' +
                '</tr>';
        }).join('');

        let tendenciaHTML = '';
        if (tendenciaPJ !== null) {
            tendenciaHTML = '<div class="tendencia-info">' +
                '<i class="fas fa-chart-line"></i> ' +
                '<strong>PJ</strong> tiene mayor porcentaje en el sexo <strong>' + (tendenciaPJ === 'M' ? 'Masculino' : 'Femenino') + '</strong>' +
                '</div>';
        }

        container.innerHTML = tendenciaHTML +
            '<table class="stats-table">' +
            '<thead><tr>' +
            '<th>Sexo</th><th>Votantes</th><th>Relevados</th><th>PJ</th><th>UCR</th><th>Indecisos</th>' +
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
                '<td>' + this.formatNumber(item.votos_pj) + ' <small>(' + (item.porcentaje_pj || 0) + '%)</small></td>' +
                '<td>' + this.formatNumber(item.votos_ucr) + ' <small>(' + (item.porcentaje_ucr || 0) + '%)</small></td>' +
                '<td>' + this.formatNumber(item.votos_indeciso) + ' <small>(' + (item.porcentaje_indeciso || 0) + '%)</small></td>' +
                '<td>' + (item.porcentaje_participacion || 0) + '%</td>' +
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
            '<th>Rango</th><th>Votantes</th><th>Relevados</th><th>PJ</th><th>UCR</th><th>Indecisos</th><th>Participacion</th>' +
            '</tr></thead>' +
            '<tbody>' + tabla + '</tbody></table>';
    }

    mostrarTablaCondiciones() {
        const container = document.getElementById('stats-condiciones-tabla');
        const data = this.datos.condiciones;
        if (!data) return;

        const filas = [
            {
                nombre: 'Empleados Municipales',
                total: parseInt(data.total_empleados_municipales) || 0,
                pj: parseInt(data.empleados_pj) || 0,
                ucr: parseInt(data.empleados_ucr) || 0,
                indeciso: parseInt(data.empleados_indeciso) || 0,
                masc: parseInt(data.empleados_masculino) || 0,
                fem: parseInt(data.empleados_femenino) || 0
            },
            {
                nombre: 'Ayuda Social',
                total: parseInt(data.total_ayuda_social) || 0,
                pj: parseInt(data.ayuda_social_pj) || 0,
                ucr: parseInt(data.ayuda_social_ucr) || 0,
                indeciso: parseInt(data.ayuda_social_indeciso) || 0,
                masc: parseInt(data.ayuda_social_masculino) || 0,
                fem: parseInt(data.ayuda_social_femenino) || 0
            },
            {
                nombre: 'Nuevos Votantes',
                total: parseInt(data.total_nuevos_votantes) || 0,
                pj: parseInt(data.nuevos_pj) || 0,
                ucr: parseInt(data.nuevos_ucr) || 0,
                indeciso: parseInt(data.nuevos_indeciso) || 0,
                masc: '-',
                fem: '-'
            },
            {
                nombre: 'Fallecidos',
                total: parseInt(data.total_fallecidos) || 0,
                pj: parseInt(data.fallecidos_pj) || 0,
                ucr: parseInt(data.fallecidos_ucr) || 0,
                indeciso: parseInt(data.fallecidos_indeciso) || 0,
                masc: '-',
                fem: '-'
            }
        ];

        const tablaHTML = filas.map(f => {
            const mayorPartido = [
                { nombre: 'PJ', v: f.pj },
                { nombre: 'UCR', v: f.ucr },
                { nombre: 'Indeciso', v: f.indeciso }
            ].sort((a, b) => b.v - a.v)[0];

            return '<tr>' +
                '<td><strong>' + f.nombre + '</strong></td>' +
                '<td>' + this.formatNumber(f.total) + '</td>' +
                '<td>' + this.formatNumber(f.pj) + '</td>' +
                '<td>' + this.formatNumber(f.ucr) + '</td>' +
                '<td>' + this.formatNumber(f.indeciso) + '</td>' +
                '<td>' + (typeof f.masc === 'number' ? this.formatNumber(f.masc) : f.masc) + '</td>' +
                '<td>' + (typeof f.fem === 'number' ? this.formatNumber(f.fem) : f.fem) + '</td>' +
                '<td><span class="badge-tendencia">' + (f.total > 0 ? mayorPartido.nombre : '-') + '</span></td>' +
                '</tr>';
        }).join('');

        container.innerHTML =
            '<table class="stats-table">' +
            '<thead><tr>' +
            '<th>Condicion</th><th>Total</th><th>PJ</th><th>UCR</th><th>Indecisos</th><th>Masc.</th><th>Fem.</th><th>Mayor Tendencia</th>' +
            '</tr></thead>' +
            '<tbody>' + tablaHTML + '</tbody></table>';
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
            this.mostrarError('Error exportando JSON: ' + error.message);
        }
    }

    exportarCSV() {
        try {
            const data = this.datos.general;
            let csv = 'Concepto,Cantidad,Porcentaje\n';
            csv += 'Total Votantes,' + data.total_votantes + ',100%\n';
            csv += 'Total Relevados,' + data.total_relevados + ',' + data.porcentaje_participacion + '%\n';
            csv += 'PJ,' + data.votos_pj + ',' + (data.porcentaje_pj || 0) + '%\n';
            csv += 'UCR,' + data.votos_ucr + ',' + (data.porcentaje_ucr || 0) + '%\n';
            csv += 'Indecisos,' + data.votos_indeciso + ',' + (data.porcentaje_indeciso || 0) + '%\n';

            csv += '\nEstadisticas por Sexo\n';
            csv += 'Sexo,Votantes,Relevados,PJ,UCR,Indecisos,Participacion\n';
            this.datos.porSexo.forEach(item => {
                csv += (item.sexo === 'M' ? 'Masculino' : 'Femenino') + ',' +
                    item.total_votantes + ',' + item.total_relevados + ',' +
                    item.votos_pj + ',' + item.votos_ucr + ',' + item.votos_indeciso + ',' +
                    item.porcentaje_participacion + '%\n';
            });

            csv += '\nEstadisticas por Rango Etario\n';
            csv += 'Rango,Votantes,Relevados,PJ,UCR,Indecisos,Participacion\n';
            this.datos.porRangoEtario.forEach(item => {
                csv += item.rango_etario + ',' +
                    item.total_votantes + ',' + item.total_relevados + ',' +
                    item.votos_pj + ',' + item.votos_ucr + ',' + item.votos_indeciso + ',' +
                    item.porcentaje_participacion + '%\n';
            });

            if (this.datos.condiciones) {
                const c = this.datos.condiciones;
                csv += '\nCondiciones Especiales\n';
                csv += 'Condicion,Total,PJ,UCR,Indecisos\n';
                csv += 'Empleados Municipales,' + (c.total_empleados_municipales || 0) + ',' + (c.empleados_pj || 0) + ',' + (c.empleados_ucr || 0) + ',' + (c.empleados_indeciso || 0) + '\n';
                csv += 'Ayuda Social,' + (c.total_ayuda_social || 0) + ',' + (c.ayuda_social_pj || 0) + ',' + (c.ayuda_social_ucr || 0) + ',' + (c.ayuda_social_indeciso || 0) + '\n';
                csv += 'Nuevos Votantes,' + (c.total_nuevos_votantes || 0) + ',' + (c.nuevos_pj || 0) + ',' + (c.nuevos_ucr || 0) + ',' + (c.nuevos_indeciso || 0) + '\n';
                csv += 'Fallecidos,' + (c.total_fallecidos || 0) + ',' + (c.fallecidos_pj || 0) + ',' + (c.fallecidos_ucr || 0) + ',' + (c.fallecidos_indeciso || 0) + '\n';
            }

            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            this.descargarBlob(blob, 'estadisticas_' + new Date().toISOString().split('T')[0] + '.csv');
            this.mostrarNotificacion('CSV exportado exitosamente', 'success');
        } catch (error) {
            this.mostrarError('Error exportando CSV: ' + error.message);
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
            if (loading) loading.style.display = 'flex';
            if (content) content.style.display = 'none';
        } else {
            if (loading) loading.style.display = 'none';
        }
    }

    mostrarError(mensaje) {
        const errorContainer = document.getElementById('resultados-error');
        if (errorContainer) {
            errorContainer.innerHTML = '<div class="error-message">' +
                '<i class="fas fa-exclamation-triangle"></i>' +
                '<h3>Error</h3>' +
                '<p>' + mensaje + '</p></div>';
            errorContainer.style.display = 'block';
        }
        const loading = document.getElementById('resultados-loading');
        const content = document.getElementById('resultados-content');
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'none';
    }

    mostrarNotificacion(mensaje, tipo) {
        tipo = tipo || 'info';
        const notificacion = document.createElement('div');
        notificacion.className = 'notification ' + tipo;
        var iconClass = tipo === 'success' ? 'check' : (tipo === 'error' ? 'times' : 'info');
        notificacion.innerHTML = '<i class="fas fa-' + iconClass + '-circle"></i> <span>' + mensaje + '</span>';

        document.body.appendChild(notificacion);

        setTimeout(function() {
            if (notificacion.parentNode) {
                notificacion.parentNode.removeChild(notificacion);
            }
        }, 3000);
    }
}

// Instancia global
window.resultadosComponent = new ResultadosComponent();
