/**
 * Modelo de Relevamiento - Información política adicional por votante
 */
class RelevamientoVotante {
    constructor(dni, opcionPolitica = 'Indeciso', observacion = '', fechaRelevamiento = null) {
        this.dni = dni;
        this.opcionPolitica = opcionPolitica; // 'PJ', 'UCR', 'Indeciso'
        this.observacion = observacion;
        this.fechaRelevamiento = fechaRelevamiento || new Date().toISOString();
        this.fechaModificacion = this.fechaRelevamiento;
    }

    actualizar(opcionPolitica, observacion) {
        this.opcionPolitica = opcionPolitica;
        this.observacion = observacion;
        this.fechaModificacion = new Date().toISOString();
    }

    toJSON() {
        return {
            dni: this.dni,
            opcionPolitica: this.opcionPolitica,
            observacion: this.observacion,
            fechaRelevamiento: this.fechaRelevamiento,
            fechaModificacion: this.fechaModificacion
        };
    }

    static fromJSON(data) {
        const relevamiento = new RelevamientoVotante(
            data.dni,
            data.opcionPolitica,
            data.observacion,
            data.fechaRelevamiento
        );
        relevamiento.fechaModificacion = data.fechaModificacion;
        return relevamiento;
    }

    // Validaciones
    static validate(data) {
        const errors = [];
        const opcionesValidas = ['PJ', 'UCR', 'Indeciso'];
        
        if (!data.dni) {
            errors.push('DNI requerido');
        }
        if (!opcionesValidas.includes(data.opcionPolitica)) {
            errors.push('Opción política inválida');
        }
        
        return errors;
    }
}

module.exports = RelevamientoVotante;