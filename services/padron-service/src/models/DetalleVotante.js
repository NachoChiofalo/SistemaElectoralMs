/**
 * Modelo de Detalle de Votante - Información cualitativa adicional
 * 
 * Esta clase modela información complementaria sobre el estado o condición 
 * de un votante, permitiendo caracterizar aspectos cualitativos importantes
 * para el proceso electoral.
 * 
 * Diseño:
 * - Relación 1:1 con Votante (un votante tiene un conjunto de detalles)
 * - Flags booleanos para cada condición (extensible y no excluyente)
 * - Patrón Builder para facilitar creación y modificación
 */
class DetalleVotante {
    /**
     * Constructor del DetalleVotante
     * @param {string} dni - DNI del votante asociado
     * @param {Object} condiciones - Objeto con las condiciones del votante
     */
    constructor(dni, condiciones = {}) {
        this.dni = dni;
        
        // Estados/Condiciones del votante (flags booleanos para extensibilidad)
        this.esNuevoVotante = condiciones.esNuevoVotante || false;
        this.estaFallecido = condiciones.estaFallecido || false;
        this.esEmpleadoMunicipal = condiciones.esEmpleadoMunicipal || false;
        this.recibeAyudaSocial = condiciones.recibeAyudaSocial || false;
        
        // Metadatos
        this.fechaCreacion = condiciones.fechaCreacion || new Date().toISOString();
        this.fechaModificacion = this.fechaCreacion;
        this.observacionesDetalle = condiciones.observacionesDetalle || '';
    }

    /**
     * Actualizar condiciones del votante
     * @param {Object} nuevasCondiciones - Nuevas condiciones a actualizar
     */
    actualizar(nuevasCondiciones) {
        // Actualizar solo las condiciones proporcionadas
        if (nuevasCondiciones.hasOwnProperty('esNuevoVotante')) {
            this.esNuevoVotante = nuevasCondiciones.esNuevoVotante;
        }
        if (nuevasCondiciones.hasOwnProperty('estaFallecido')) {
            this.estaFallecido = nuevasCondiciones.estaFallecido;
        }
        if (nuevasCondiciones.hasOwnProperty('esEmpleadoMunicipal')) {
            this.esEmpleadoMunicipal = nuevasCondiciones.esEmpleadoMunicipal;
        }
        if (nuevasCondiciones.hasOwnProperty('recibeAyudaSocial')) {
            this.recibeAyudaSocial = nuevasCondiciones.recibeAyudaSocial;
        }
        if (nuevasCondiciones.hasOwnProperty('observacionesDetalle')) {
            this.observacionesDetalle = nuevasCondiciones.observacionesDetalle;
        }

        this.fechaModificacion = new Date().toISOString();
    }

    /**
     * Obtener resumen de condiciones activas
     * @returns {Array} Array de condiciones activas
     */
    obtenerCondicionesActivas() {
        const condiciones = [];
        
        if (this.esNuevoVotante) condiciones.push('Nuevo Votante');
        if (this.estaFallecido) condiciones.push('Fallecido');
        if (this.esEmpleadoMunicipal) condiciones.push('Empleado Municipal');
        if (this.recibeAyudaSocial) condiciones.push('Recibe Ayuda Social');
        
        return condiciones;
    }

    /**
     * Obtener íconos representativos para la UI
     * @returns {Array} Array de objetos con ícono y descripción
     */
    obtenerIconos() {
        const iconos = [];
        
        if (this.esNuevoVotante) {
            iconos.push({ icono: 'fas fa-user-plus', descripcion: 'Nuevo Votante', clase: 'nuevo-votante' });
        }
        if (this.estaFallecido) {
            iconos.push({ icono: 'fas fa-cross', descripcion: 'Fallecido', clase: 'fallecido' });
        }
        if (this.esEmpleadoMunicipal) {
            iconos.push({ icono: 'fas fa-building', descripcion: 'Empleado Municipal', clase: 'empleado-municipal' });
        }
        if (this.recibeAyudaSocial) {
            iconos.push({ icono: 'fas fa-hands-helping', descripcion: 'Recibe Ayuda Social', clase: 'ayuda-social' });
        }
        
        return iconos;
    }

    /**
     * Verificar si tiene alguna condición especial
     * @returns {boolean} True si tiene al menos una condición activa
     */
    tieneCondicionesEspeciales() {
        return this.esNuevoVotante || 
               this.estaFallecido || 
               this.esEmpleadoMunicipal || 
               this.recibeAyudaSocial;
    }

    /**
     * Serializar a JSON
     * @returns {Object} Representación JSON del detalle
     */
    toJSON() {
        return {
            dni: this.dni,
            esNuevoVotante: this.esNuevoVotante,
            estaFallecido: this.estaFallecido,
            esEmpleadoMunicipal: this.esEmpleadoMunicipal,
            recibeAyudaSocial: this.recibeAyudaSocial,
            observacionesDetalle: this.observacionesDetalle,
            fechaCreacion: this.fechaCreacion,
            fechaModificacion: this.fechaModificacion
        };
    }

    /**
     * Crear instancia desde JSON
     * @param {Object} data - Datos del detalle
     * @returns {DetalleVotante} Instancia del detalle
     */
    static fromJSON(data) {
        return new DetalleVotante(data.dni, {
            esNuevoVotante: data.esNuevoVotante,
            estaFallecido: data.estaFallecido,
            esEmpleadoMunicipal: data.esEmpleadoMunicipal,
            recibeAyudaSocial: data.recibeAyudaSocial,
            observacionesDetalle: data.observacionesDetalle,
            fechaCreacion: data.fechaCreacion,
            fechaModificacion: data.fechaModificacion
        });
    }

    /**
     * Validar datos del detalle
     * @param {Object} data - Datos a validar
     * @returns {Array} Array de errores encontrados
     */
    static validate(data) {
        const errors = [];
        
        if (!data.dni || typeof data.dni !== 'string') {
            errors.push('DNI es requerido y debe ser string');
        }
        
        // Validar que los flags sean booleanos
        const flags = ['esNuevoVotante', 'estaFallecido', 'esEmpleadoMunicipal', 'recibeAyudaSocial'];
        flags.forEach(flag => {
            if (data.hasOwnProperty(flag) && typeof data[flag] !== 'boolean') {
                errors.push(`${flag} debe ser un valor booleano`);
            }
        });
        
        if (data.observacionesDetalle && typeof data.observacionesDetalle !== 'string') {
            errors.push('observacionesDetalle debe ser string');
        }
        
        return errors;
    }

    /**
     * Builder pattern para crear instancias fácilmente
     */
    static builder(dni) {
        return new DetalleVotanteBuilder(dni);
    }
}

/**
 * Builder para facilitar la creación de DetalleVotante
 */
class DetalleVotanteBuilder {
    constructor(dni) {
        this.dni = dni;
        this.condiciones = {};
    }

    nuevoVotante(valor = true) {
        this.condiciones.esNuevoVotante = valor;
        return this;
    }

    fallecido(valor = true) {
        this.condiciones.estaFallecido = valor;
        return this;
    }

    empleadoMunicipal(valor = true) {
        this.condiciones.esEmpleadoMunicipal = valor;
        return this;
    }

    ayudaSocial(valor = true) {
        this.condiciones.recibeAyudaSocial = valor;
        return this;
    }

    observaciones(texto) {
        this.condiciones.observacionesDetalle = texto;
        return this;
    }

    build() {
        return new DetalleVotante(this.dni, this.condiciones);
    }
}

module.exports = DetalleVotante;