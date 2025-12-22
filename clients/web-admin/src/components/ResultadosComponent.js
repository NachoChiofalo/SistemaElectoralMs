/**
 * Componente de Resultados Electorales
 * Muestra gráficos y estadísticas detalladas de los relevamientos
 */
class ResultadosComponent {
    constructor() {
        this.container = null;
        this.datos = {
            general: null,
            porSexo: null,
            porRangoEtario: null,
            porCircuito: null
        };
        this.graficos = {};
    }

    /**
     * Inicializar el componente
     */
    async init(containerId = 'resultados-container') {
        console.log('📊 Inicializando componente de Resultados...');
        
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Contenedor ${containerId} no encontrado`);
        }

        // Verificar si Chart.js está disponible
        if (typeof Chart === 'undefined') {
            this.mostrarError('Chart.js no está disponible. Verifique que esté incluido en el HTML.');
            return false;
        }

        // Verificar conexión con API
        const apiDisponible = await window.apiService.verificarEstado();
        if (!apiDisponible) {
            this.mostrarError('No se puede conectar con el servicio de padrón.');
            return false;
        }

        this.crearInterfaz();
        await this.cargarDatos();

        console.log('✅ Componente de Resultados inicializado');
        return true;
    }

    /**
     * Crear la interfaz del componente
     */
    crearInterfaz() {
        this.container.innerHTML = `
            <div class="resultados-header">
                <div class="resultados-title">
                    <h2><i class="fas fa-chart-bar"></i> Resultados Electorales</h2>
                    <p class="resultados-subtitle">Análisis detallado de los relevamientos realizados</p>
                </div>
                <div class="resultados-actions">
                    <button id="btn-actualizar-resultados" class="btn btn-primary">
                        <i class="fas fa-sync"></i> Actualizar
                    </button>
                    <button id="btn-exportar-resultados" class="btn btn-secondary">
                        <i class="fas fa-file-export"></i> Exportar
                    </button>
                </div>
            </div>

            <div id="resultados-loading" class="loading-container">
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Cargando resultados...</p>
                </div>
            </div>

            <div id="resultados-content" class="resultados-content" style="display: none;">
                <!-- Estadísticas Generales -->
                <section class="estadisticas-generales">
                    <h3><i class="fas fa-tachometer-alt"></i> Resumen General</h3>
                    <div class="stats-grid" id="stats-generales">
                        <!-- Se llenará dinámicamente -->
                    </div>
                </section>

                <!-- Gráfico Principal -->
                <section class="grafico-principal">
                    <h3><i class="fas fa-chart-pie"></i> Distribución de Votos</h3>
                    <div class="chart-container">
                        <canvas id="chart-principal" width="400" height="200"></canvas>
                    </div>
                </section>

                <!-- Gráficos por Categorías -->
                <div class="graficos-grid">
                    <!-- Por Sexo -->
                    <section class="grafico-categoria">
                        <h3><i class="fas fa-venus-mars"></i> Resultados por Sexo</h3>
                        <div class="chart-container">
                            <canvas id="chart-sexo" width="300" height="300"></canvas>
                        </div>
                        <div class="categoria-stats" id="stats-sexo">
                            <!-- Tabla de estadísticas -->
                        </div>
                    </section>

                    <!-- Por Rango Etario -->
                    <section class="grafico-categoria">
                        <h3><i class="fas fa-users"></i> Resultados por Edad</h3>
                        <div class="chart-container">
                            <canvas id="chart-edad" width="300" height="300"></canvas>
                        </div>
                        <div class="categoria-stats" id="stats-edad">
                            <!-- Tabla de estadísticas -->
                        </div>
                    </section>

                    <!-- Por Circuito -->
                    <section class="grafico-categoria">
                        <h3><i class="fas fa-map-marker-alt"></i> Resultados por Circuito</h3>
                        <div class="chart-container">
                            <canvas id="chart-circuito" width="300" height="300"></canvas>
                        </div>
                        <div class="categoria-stats" id="stats-circuito">
                            <!-- Tabla de estadísticas -->
                        </div>
                    </section>

                    <!-- Participación -->
                    <section class="grafico-categoria">
                        <h3><i class="fas fa-chart-line"></i> Participación</h3>
                        <div class="chart-container">
                            <canvas id="chart-participacion" width="300" height="300"></canvas>
                        </div>
                        <div class="participacion-info" id="info-participacion">
                            <!-- Información de participación -->
                        </div>
                    </section>
                </div>
            </div>

            <div id="resultados-error" class="error-container" style="display: none;">
                <!-- Errores se mostrarán aquí -->
            </div>
        `;

        this.inicializarEventos();
    }

    /**
     * Inicializar eventos
     */
    inicializarEventos() {
        const btnActualizar = document.getElementById('btn-actualizar-resultados');
        const btnExportar = document.getElementById('btn-exportar-resultados');

        if (btnActualizar) {
            btnActualizar.addEventListener('click', () => this.actualizarResultados());
        }

        if (btnExportar) {
            btnExportar.addEventListener('click', () => this.exportarResultados());
        }
    }

    /**
     * Cargar todos los datos
     */
    async cargarDatos() {
        this.mostrarCarga(true);

        try {
            // Cargar datos en paralelo
            const [general, porSexo, porRangoEtario, porCircuito] = await Promise.all([
                window.apiService.obtenerEstadisticasAvanzadas(),
                window.apiService.obtenerEstadisticasPorSexo(),
                window.apiService.obtenerEstadisticasPorRangoEtario(),
                window.apiService.obtenerEstadisticasPorCircuito()
            ]);

            this.datos.general = general.data;
            this.datos.porSexo = porSexo.data;
            this.datos.porRangoEtario = porRangoEtario.data;
            this.datos.porCircuito = porCircuito.data;

            this.mostrarResultados();
            
        } catch (error) {
            console.error('❌ Error cargando datos:', error);
            this.mostrarError(`Error cargando datos: ${error.message}`);
        } finally {
            this.mostrarCarga(false);
        }
    }

    /**
     * Mostrar resultados
     */
    mostrarResultados() {
        this.mostrarEstadisticasGenerales();
        this.crearGraficos();
        this.mostrarTablasDetalle();
        
        document.getElementById('resultados-content').style.display = 'block';
    }

    /**
     * Mostrar estadísticas generales
     */
    mostrarEstadisticasGenerales() {
        const data = this.datos.general;
        const container = document.getElementById('stats-generales');

        container.innerHTML = `
            <div class="stat-card total">
                <div class="stat-icon">
                    <i class="fas fa-users"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.total_votantes)}</div>
                    <div class="stat-label">Total Votantes</div>
                </div>
            </div>
            
            <div class="stat-card relevados">
                <div class="stat-icon">
                    <i class="fas fa-poll"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.total_relevados)}</div>
                    <div class="stat-label">Relevados</div>
                    <div class="stat-percentage">${data.porcentaje_participacion}%</div>
                </div>
            </div>
            
            <div class="stat-card pj">
                <div class="stat-icon">
                    <i class="fas fa-flag"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.votos_pj)}</div>
                    <div class="stat-label">PJ</div>
                    <div class="stat-percentage">${data.porcentaje_pj || 0}%</div>
                </div>
            </div>
            
            <div class="stat-card ucr">
                <div class="stat-icon">
                    <i class="fas fa-flag"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.votos_ucr)}</div>
                    <div class="stat-label">UCR</div>
                    <div class="stat-percentage">${data.porcentaje_ucr || 0}%</div>
                </div>
            </div>
            
            <div class="stat-card indeciso">
                <div class="stat-icon">
                    <i class="fas fa-question-circle"></i>
                </div>
                <div class="stat-content">
                    <div class="stat-number">${this.formatNumber(data.votos_indeciso)}</div>
                    <div class="stat-label">Indecisos</div>
                    <div class="stat-percentage">${data.porcentaje_indeciso || 0}%</div>
                </div>
            </div>
        `;
    }

    /**
     * Crear todos los gráficos
     */
    crearGraficos() {
        this.crearGraficoPrincipal();
        this.crearGraficoPorSexo();
        this.crearGraficoPorEdad();
        this.crearGraficoPorCircuito();
        this.crearGraficoParticipacion();
    }

    /**
     * Crear gráfico principal de distribución
     */
    crearGraficoPrincipal() {
        const ctx = document.getElementById('chart-principal').getContext('2d');
        const data = this.datos.general;

        if (this.graficos.principal) {
            this.graficos.principal.destroy();
        }

        this.graficos.principal = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['PJ', 'UCR', 'Indecisos'],
                datasets: [{
                    data: [data.votos_pj, data.votos_ucr, data.votos_indeciso],
                    backgroundColor: ['#3498db', '#e74c3c', '#f39c12'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label;
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Crear gráfico por sexo
     */
    crearGraficoPorSexo() {
        const ctx = document.getElementById('chart-sexo').getContext('2d');
        const data = this.datos.porSexo;

        if (this.graficos.sexo) {
            this.graficos.sexo.destroy();
        }

        const labels = data.map(item => item.sexo === 'M' ? 'Masculino' : 'Femenino');
        const pjData = data.map(item => item.votos_pj || 0);
        const ucrData = data.map(item => item.votos_ucr || 0);
        const indecisoData = data.map(item => item.votos_indeciso || 0);

        this.graficos.sexo = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'PJ',
                        data: pjData,
                        backgroundColor: '#3498db'
                    },
                    {
                        label: 'UCR',
                        data: ucrData,
                        backgroundColor: '#e74c3c'
                    },
                    {
                        label: 'Indecisos',
                        data: indecisoData,
                        backgroundColor: '#f39c12'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    /**
     * Crear gráfico por rango etario
     */
    crearGraficoPorEdad() {
        const ctx = document.getElementById('chart-edad').getContext('2d');
        const data = this.datos.porRangoEtario;

        if (this.graficos.edad) {
            this.graficos.edad.destroy();
        }

        const labels = data.map(item => item.rango_etario);
        const pjData = data.map(item => item.votos_pj || 0);
        const ucrData = data.map(item => item.votos_ucr || 0);
        const indecisoData = data.map(item => item.votos_indeciso || 0);

        this.graficos.edad = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'PJ',
                        data: pjData,
                        backgroundColor: '#3498db'
                    },
                    {
                        label: 'UCR',
                        data: ucrData,
                        backgroundColor: '#e74c3c'
                    },
                    {
                        label: 'Indecisos',
                        data: indecisoData,
                        backgroundColor: '#f39c12'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    /**
     * Crear gráfico por circuito (solo los primeros 10)
     */
    crearGraficoPorCircuito() {
        const ctx = document.getElementById('chart-circuito').getContext('2d');
        const data = this.datos.porCircuito.slice(0, 10); // Solo primeros 10 circuitos

        if (this.graficos.circuito) {
            this.graficos.circuito.destroy();
        }

        const labels = data.map(item => item.circuito.substring(0, 20) + '...');
        const totalData = data.map(item => item.total_relevados || 0);

        this.graficos.circuito = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Relevamientos',
                    data: totalData,
                    backgroundColor: '#2ecc71'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                scales: {
                    x: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    /**
     * Crear gráfico de participación
     */
    crearGraficoParticipacion() {
        const ctx = document.getElementById('chart-participacion').getContext('2d');
        
        if (this.graficos.participacion) {
            this.graficos.participacion.destroy();
        }

        const participacionData = [
            { categoria: 'Por Sexo', data: this.datos.porSexo.map(item => item.porcentaje_participacion || 0) },
            { categoria: 'Por Edad', data: this.datos.porRangoEtario.map(item => item.porcentaje_participacion || 0) }
        ];

        // Promedio de participación por sexo y edad
        const promedioSexo = participacionData[0].data.reduce((a, b) => a + b, 0) / participacionData[0].data.length;
        const promedioEdad = participacionData[1].data.reduce((a, b) => a + b, 0) / participacionData[1].data.length;

        this.graficos.participacion = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: ['Masculino', 'Femenino', '18-30', '31-45', '46-60', '60+'],
                datasets: [{
                    label: 'Participación %',
                    data: [
                        ...this.datos.porSexo.map(item => item.porcentaje_participacion || 0),
                        ...this.datos.porRangoEtario.map(item => item.porcentaje_participacion || 0)
                    ],
                    backgroundColor: 'rgba(52, 152, 219, 0.2)',
                    borderColor: '#3498db',
                    pointBackgroundColor: '#3498db'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });

        // Mostrar información adicional
        document.getElementById('info-participacion').innerHTML = `
            <div class="participacion-stats">
                <h4>Análisis de Participación</h4>
                <div class="participacion-item">
                    <span class="label">Participación General:</span>
                    <span class="value">${this.datos.general.porcentaje_participacion}%</span>
                </div>
                <div class="participacion-item">
                    <span class="label">Promedio por Sexo:</span>
                    <span class="value">${promedioSexo.toFixed(1)}%</span>
                </div>
                <div class="participacion-item">
                    <span class="label">Promedio por Edad:</span>
                    <span class="value">${promedioEdad.toFixed(1)}%</span>
                </div>
            </div>
        `;
    }

    /**
     * Mostrar tablas de detalle
     */
    mostrarTablasDetalle() {
        this.mostrarTablaSexo();
        this.mostrarTablaEdad();
        this.mostrarTablaCircuito();
    }

    /**
     * Mostrar tabla de estadísticas por sexo
     */
    mostrarTablaSexo() {
        const container = document.getElementById('stats-sexo');
        const data = this.datos.porSexo;

        const tabla = data.map(item => `
            <tr>
                <td>${item.sexo === 'M' ? 'Masculino' : 'Femenino'}</td>
                <td>${this.formatNumber(item.total_relevados)}</td>
                <td>${this.formatNumber(item.votos_pj)}</td>
                <td>${this.formatNumber(item.votos_ucr)}</td>
                <td>${this.formatNumber(item.votos_indeciso)}</td>
                <td>${item.porcentaje_participacion}%</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Sexo</th>
                        <th>Relevados</th>
                        <th>PJ</th>
                        <th>UCR</th>
                        <th>Indecisos</th>
                        <th>Participación</th>
                    </tr>
                </thead>
                <tbody>
                    ${tabla}
                </tbody>
            </table>
        `;
    }

    /**
     * Mostrar tabla de estadísticas por edad
     */
    mostrarTablaEdad() {
        const container = document.getElementById('stats-edad');
        const data = this.datos.porRangoEtario;

        const tabla = data.map(item => `
            <tr>
                <td>${item.rango_etario}</td>
                <td>${this.formatNumber(item.total_relevados)}</td>
                <td>${this.formatNumber(item.votos_pj)}</td>
                <td>${this.formatNumber(item.votos_ucr)}</td>
                <td>${this.formatNumber(item.votos_indeciso)}</td>
                <td>${item.porcentaje_participacion}%</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Edad</th>
                        <th>Relevados</th>
                        <th>PJ</th>
                        <th>UCR</th>
                        <th>Indecisos</th>
                        <th>Participación</th>
                    </tr>
                </thead>
                <tbody>
                    ${tabla}
                </tbody>
            </table>
        `;
    }

    /**
     * Mostrar tabla de estadísticas por circuito (primeros 10)
     */
    mostrarTablaCircuito() {
        const container = document.getElementById('stats-circuito');
        const data = this.datos.porCircuito.slice(0, 10);

        const tabla = data.map(item => `
            <tr>
                <td>${item.circuito}</td>
                <td>${this.formatNumber(item.total_relevados)}</td>
                <td>${this.formatNumber(item.votos_pj)}</td>
                <td>${this.formatNumber(item.votos_ucr)}</td>
                <td>${this.formatNumber(item.votos_indeciso)}</td>
                <td>${item.porcentaje_participacion}%</td>
            </tr>
        `).join('');

        container.innerHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Circuito</th>
                        <th>Relevados</th>
                        <th>PJ</th>
                        <th>UCR</th>
                        <th>Indecisos</th>
                        <th>Participación</th>
                    </tr>
                </thead>
                <tbody>
                    ${tabla}
                </tbody>
            </table>
            <p class="tabla-note">Mostrando los primeros 10 circuitos</p>
        `;
    }

    /**
     * Actualizar resultados
     */
    async actualizarResultados() {
        await this.cargarDatos();
        this.mostrarNotificacion('Resultados actualizados', 'success');
    }

    /**
     * Exportar resultados
     */
    async exportarResultados() {
        try {
            // Crear datos para exportar
            const datosExportacion = {
                fecha_generacion: new Date().toISOString(),
                estadisticas_generales: this.datos.general,
                por_sexo: this.datos.porSexo,
                por_rango_etario: this.datos.porRangoEtario,
                por_circuito: this.datos.porCircuito
            };

            // Crear y descargar archivo JSON
            const blob = new Blob([JSON.stringify(datosExportacion, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `resultados_electorales_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.mostrarNotificacion('Resultados exportados exitosamente', 'success');
        } catch (error) {
            this.mostrarError(`Error exportando: ${error.message}`);
        }
    }

    // ==================== UTILIDADES ====================

    /**
     * Formatear números
     */
    formatNumber(num) {
        return new Intl.NumberFormat('es-AR').format(num || 0);
    }

    /**
     * Mostrar carga
     */
    mostrarCarga(mostrar) {
        const loading = document.getElementById('resultados-loading');
        const content = document.getElementById('resultados-content');
        
        if (mostrar) {
            loading.style.display = 'flex';
            content.style.display = 'none';
        } else {
            loading.style.display = 'none';
        }
    }

    /**
     * Mostrar error
     */
    mostrarError(mensaje) {
        const errorContainer = document.getElementById('resultados-error');
        errorContainer.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Error</h3>
                <p>${mensaje}</p>
            </div>
        `;
        errorContainer.style.display = 'block';
        document.getElementById('resultados-loading').style.display = 'none';
        document.getElementById('resultados-content').style.display = 'none';
    }

    /**
     * Mostrar notificación
     */
    mostrarNotificacion(mensaje, tipo = 'info') {
        // Crear elemento de notificación
        const notificacion = document.createElement('div');
        notificacion.className = `notification ${tipo}`;
        notificacion.innerHTML = `
            <i class="fas fa-${tipo === 'success' ? 'check' : tipo === 'error' ? 'times' : 'info'}-circle"></i>
            <span>${mensaje}</span>
        `;
        
        // Agregar al DOM
        document.body.appendChild(notificacion);
        
        // Remover después de 3 segundos
        setTimeout(() => {
            if (notificacion.parentNode) {
                notificacion.parentNode.removeChild(notificacion);
            }
        }, 3000);
    }
}

// Instancia global
window.resultadosComponent = new ResultadosComponent();
console.log('📊 ResultadosComponent cargado');