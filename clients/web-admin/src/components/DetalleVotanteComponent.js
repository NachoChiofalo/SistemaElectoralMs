/**
 * Componente para gestión de DetalleVotante
 * Permite agregar información cualitativa adicional por votante
 */
class DetalleVotanteComponent {
    constructor() {
        this.estado = {
            cargando: false,
            votanteActual: null,
            detalleActual: null
        };
        this.apiService = window.apiService;
    }

    /**
     * Abrir modal de gestión de detalles
     * @param {string} dni - DNI del votante
     */
    async abrirModalDetalles(dni) {
        try {
            this.estado.cargando = true;
            
            // Obtener datos del votante y detalle existente
            await this.cargarDatosVotante(dni);
            
            // Crear y mostrar modal
            this.crearModal();
            this.mostrarModal();
            
        } catch (error) {
            console.error('Error abriendo modal de detalles:', error);
            this.mostrarError('Error al cargar los datos del votante');
        } finally {
            this.estado.cargando = false;
        }
    }

    /**
     * Cargar datos del votante y detalle existente
     * @private
     */
    async cargarDatosVotante(dni) {
        try {
            // Cargar datos básicos del votante
            const respuestaVotante = await this.apiService.obtenerVotantePorDni(dni);
            if (!respuestaVotante.success) {
                throw new Error('No se pudo cargar la información del votante');
            }
            this.estado.votanteActual = respuestaVotante.data;

            // Cargar detalle existente (puede no existir)
            try {
                const respuestaDetalle = await this.apiService.request(`/padron/detalle-votante/${dni}`);

                if (respuestaDetalle.success) {
                    this.estado.detalleActual = respuestaDetalle.data;
                }
            } catch (error) {
                console.warn('Detalle no encontrado, se creará uno nuevo');
                this.estado.detalleActual = null;
            }

        } catch (error) {
            console.error('Error cargando datos del votante:', error);
            throw error;
        }
    }

    /**
     * Crear HTML del modal
     * @private
     */
    crearModal() {
        const votante = this.estado.votanteActual;
        const detalle = this.estado.detalleActual;

        // Remover modal existente si existe
        const modalExistente = document.getElementById('modal-detalle-votante');
        if (modalExistente) {
            modalExistente.remove();
        }

        // Crear nuevo modal
        const modalHTML = `
            <div id="modal-detalle-votante" class="modal-overlay">
                <div class="modal-content modal-medium">
                    <div class="modal-header">
                        <h3><i class="fas fa-user-edit"></i> Gestionar Detalles del Votante</h3>
                        <button class="modal-close" onclick="detalleVotanteComponent.cerrarModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <!-- Información del votante -->
                        <div class="votante-info">
                            <div class="info-row">
                                <div class="info-item">
                                    <label>DNI:</label>
                                    <span class="value">${votante.dni}</span>
                                </div>
                                <div class="info-item">
                                    <label>Nombre:</label>
                                    <span class="value">${votante.apellido}, ${votante.nombre}</span>
                                </div>
                            </div>
                            <div class="info-row">
                                <div class="info-item">
                                    <label>Edad:</label>
                                    <span class="value">${votante.edad} años</span>
                                </div>
                                <div class="info-item">
                                    <label>Circuito:</label>
                                    <span class="value">${votante.circuito}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Formulario de condiciones especiales -->
                        <form id="form-detalle-votante" class="detalle-form">
                            <div class="condiciones-grid">
                                <div class="condicion-item">
                                    <label class="checkbox-container">
                                        <input type="checkbox" 
                                               id="es-nuevo-votante" 
                                               ${detalle?.esNuevoVotante ? 'checked' : ''}>
                                        <span class="checkmark"></span>
                                        <span class="label-text">
                                            <i class="fas fa-user-plus icon-nuevo"></i>
                                            Es Nuevo Votante
                                        </span>
                                    </label>
                                    <small class="description">No apareció en elecciones anteriores</small>
                                </div>

                                <div class="condicion-item">
                                    <label class="checkbox-container">
                                        <input type="checkbox" 
                                               id="esta-fallecido" 
                                               ${detalle?.estaFallecido ? 'checked' : ''}>
                                        <span class="checkmark"></span>
                                        <span class="label-text">
                                            <i class="fas fa-cross icon-fallecido"></i>
                                            Está Fallecido
                                        </span>
                                    </label>
                                    <small class="description">Información de fallecimiento confirmada</small>
                                </div>

                                <div class="condicion-item">
                                    <label class="checkbox-container">
                                        <input type="checkbox" 
                                               id="es-empleado-municipal" 
                                               ${detalle?.esEmpleadoMunicipal ? 'checked' : ''}>
                                        <span class="checkmark"></span>
                                        <span class="label-text">
                                            <i class="fas fa-building icon-empleado"></i>
                                            Es Empleado Municipal
                                        </span>
                                    </label>
                                    <small class="description">Trabaja en la administración municipal</small>
                                </div>

                                <div class="condicion-item">
                                    <label class="checkbox-container">
                                        <input type="checkbox" 
                                               id="recibe-ayuda-social" 
                                               ${detalle?.recibeAyudaSocial ? 'checked' : ''}>
                                        <span class="checkmark"></span>
                                        <span class="label-text">
                                            <i class="fas fa-hands-helping icon-ayuda"></i>
                                            Recibe Ayuda Social
                                        </span>
                                    </label>
                                    <small class="description">Recibe asistencia social del municipio</small>
                                </div>
                            </div>

                            <!-- Observaciones adicionales -->
                            <div class="observaciones-section">
                                <label for="observaciones-detalle">Observaciones Adicionales:</label>
                                <textarea id="observaciones-detalle" 
                                          rows="3" 
                                          placeholder="Información adicional sobre las condiciones del votante...">${detalle?.observacionesDetalle || ''}</textarea>
                            </div>

                            ${detalle ? `
                            <div class="fecha-info">
                                <small><i class="fas fa-clock"></i> Última actualización: ${this.formatearFecha(detalle.fechaModificacion)}</small>
                            </div>
                            ` : ''}
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="detalleVotanteComponent.cerrarModal()">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        ${detalle ? `
                        <button type="button" class="btn btn-warning" onclick="detalleVotanteComponent.eliminarDetalle()">
                            <i class="fas fa-trash"></i> Resetear
                        </button>
                        ` : ''}
                        <button type="button" class="btn btn-primary" onclick="detalleVotanteComponent.guardarDetalle()">
                            <i class="fas fa-save"></i> Guardar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
     * Mostrar modal
     * @private
     */
    mostrarModal() {
        const modal = document.getElementById('modal-detalle-votante');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Cerrar modal
     */
    cerrarModal() {
        const modal = document.getElementById('modal-detalle-votante');
        if (modal) {
            modal.remove();
            document.body.style.overflow = '';
        }
        this.estado.votanteActual = null;
        this.estado.detalleActual = null;
    }

    /**
     * Guardar detalle del votante
     */
    async guardarDetalle() {
        try {
            this.estado.cargando = true;
            this.mostrarCargandoGuardar(true);

            const formData = this.obtenerDatosFormulario();
            
            const response = await this.apiService.request('/padron/detalle-votante', {
                method: 'POST',
                body: JSON.stringify({
                    dni: this.estado.votanteActual.dni,
                    condiciones: formData
                })
            });

            this.mostrarExito('Detalle guardado correctamente');
            this.cerrarModal();
            
            // Recargar lista si existe el componente padre
            if (window.padronComponent && window.padronComponent.cargarDatos) {
                await window.padronComponent.cargarDatos();
            }

        } catch (error) {
            console.error('Error guardando detalle:', error);
            this.mostrarError(`Error al guardar: ${error.message}`);
        } finally {
            this.estado.cargando = false;
            this.mostrarCargandoGuardar(false);
        }
    }

    /**
     * Eliminar detalle del votante (resetear condiciones)
     */
    async eliminarDetalle() {
        if (!confirm('¿Está seguro de que desea resetear todas las condiciones especiales de este votante?')) {
            return;
        }

        try {
            this.estado.cargando = true;

            const response = await this.apiService.request(`/padron/detalle-votante/${this.estado.votanteActual.dni}`, {
                method: 'DELETE'
            });

            this.mostrarExito('Condiciones reseteadas correctamente');
            this.cerrarModal();
            
            // Recargar lista si existe el componente padre
            if (window.padronComponent && window.padronComponent.cargarDatos) {
                await window.padronComponent.cargarDatos();
            }

        } catch (error) {
            console.error('Error eliminando detalle:', error);
            this.mostrarError(`Error al resetear: ${error.message}`);
        } finally {
            this.estado.cargando = false;
        }
    }

    /**
     * Obtener datos del formulario
     * @private
     */
    obtenerDatosFormulario() {
        return {
            esNuevoVotante: document.getElementById('es-nuevo-votante').checked,
            estaFallecido: document.getElementById('esta-fallecido').checked,
            esEmpleadoMunicipal: document.getElementById('es-empleado-municipal').checked,
            recibeAyudaSocial: document.getElementById('recibe-ayuda-social').checked,
            observacionesDetalle: document.getElementById('observaciones-detalle').value.trim()
        };
    }

    /**
     * Mostrar indicador de carga en botón guardar
     * @private
     */
    mostrarCargandoGuardar(cargando) {
        const modal = document.getElementById('modal-detalle-votante');
        if (!modal) return;

        const btnGuardar = modal.querySelector('.btn-primary');
        if (btnGuardar) {
            if (cargando) {
                btnGuardar.disabled = true;
                btnGuardar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
            } else {
                btnGuardar.disabled = false;
                btnGuardar.innerHTML = '<i class="fas fa-save"></i> Guardar';
            }
        }
    }

    /**
     * Generar iconos para condiciones especiales
     * @param {Object} detalle - Detalle del votante
     * @returns {string} HTML con iconos
     */
    static generarIconosCondiciones(detalle) {
        if (!detalle) return '';

        const iconos = [];
        
        if (detalle.esNuevoVotante) {
            iconos.push('<i class="fas fa-user-plus icon-nuevo" title="Nuevo Votante"></i>');
        }
        
        if (detalle.estaFallecido) {
            iconos.push('<i class="fas fa-cross icon-fallecido" title="Fallecido"></i>');
        }
        
        if (detalle.esEmpleadoMunicipal) {
            iconos.push('<i class="fas fa-building icon-empleado" title="Empleado Municipal"></i>');
        }
        
        if (detalle.recibeAyudaSocial) {
            iconos.push('<i class="fas fa-hands-helping icon-ayuda" title="Recibe Ayuda Social"></i>');
        }

        return iconos.length > 0 ? `<span class="condiciones-iconos">${iconos.join(' ')}</span>` : '';
    }

    /**
     * Formatear fecha para mostrar
     * @private
     */
    formatearFecha(fecha) {
        if (!fecha) return 'No disponible';
        return new Date(fecha).toLocaleString('es-AR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Mostrar mensaje de éxito
     * @private
     */
    mostrarExito(mensaje) {
        // Utilizar el sistema de notificaciones del componente principal si existe
        if (window.padronComponent && window.padronComponent.mostrarNotificacion) {
            window.padronComponent.mostrarNotificacion(mensaje, 'success');
        } else {
            alert(mensaje);
        }
    }

    /**
     * Mostrar mensaje de error
     * @private
     */
    mostrarError(mensaje) {
        // Utilizar el sistema de notificaciones del componente principal si existe
        if (window.padronComponent && window.padronComponent.mostrarNotificacion) {
            window.padronComponent.mostrarNotificacion(mensaje, 'error');
        } else {
            alert(`Error: ${mensaje}`);
        }
    }
}

// Crear instancia global
window.detalleVotanteComponent = new DetalleVotanteComponent();