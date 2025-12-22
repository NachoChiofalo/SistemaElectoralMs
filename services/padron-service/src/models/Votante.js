/**
 * Modelo de Votante - Datos provenientes del CSV
 */
class Votante {
    constructor(dni, anioNac, apellido, nombre, domicilio, tipoEjempl, circuito, sexo) {
        this.dni = dni;
        this.anioNac = parseInt(anioNac);
        this.apellido = apellido;
        this.nombre = nombre;
        this.domicilio = domicilio;
        this.tipoEjempl = tipoEjempl;
        this.circuito = circuito;
        this.sexo = sexo;
        this.edad = this.calcularEdad();
    }

    calcularEdad() {
        return new Date().getFullYear() - this.anioNac;
    }

    getNombreCompleto() {
        return `${this.apellido}, ${this.nombre}`;
    }

    toJSON() {
        return {
            dni: this.dni,
            anioNac: this.anioNac,
            apellido: this.apellido,
            nombre: this.nombre,
            domicilio: this.domicilio,
            tipoEjempl: this.tipoEjempl,
            circuito: this.circuito,
            sexo: this.sexo,
            edad: this.edad
        };
    }

    static fromCSVRow(row) {
        return new Votante(
            row.DNI || row.dni,
            row['AÑO NAC'] || row.anioNac,
            row.APELLIDO || row.apellido,
            row.NOMBRE || row.nombre,
            row.DOMICILIO || row.domicilio,
            row.TIPO_EJEMPL || row.tipoEjempl,
            row.CIRCUITO || row.circuito,
            row.S || row.sexo
        );
    }

    static fromJSON(data) {
        return new Votante(
            data.dni,
            data.anioNac,
            data.apellido,
            data.nombre,
            data.domicilio,
            data.tipoEjempl,
            data.circuito,
            data.sexo
        );
    }

    // Validaciones
    static validate(data) {
        const errors = [];
        
        if (!data.dni || data.dni.length < 7) {
            errors.push('DNI inválido');
        }
        if (!data.apellido || data.apellido.trim() === '') {
            errors.push('Apellido requerido');
        }
        if (!data.nombre || data.nombre.trim() === '') {
            errors.push('Nombre requerido');
        }
        if (!data.anioNac || data.anioNac < 1900) {
            errors.push('Año de nacimiento inválido');
        }
        
        return errors;
    }
}

module.exports = Votante;