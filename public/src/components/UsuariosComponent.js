/**
 * Componente de Gestión de Usuarios para el panel de administración
 */
class UsuariosComponent {
    constructor() {
        this.container = null;
        this.usuarios = [];
        this.roles = [];
        this.filtros = {
            rol: '',
            estado: ''
        };
        this.cargando = false;
    }

    async init(containerId = 'usuarios-container') {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Contenedor ${containerId} no encontrado`);
        }

        this.crearInterfaz();
        this.inicializarEventos();
        await this.cargarRoles();
        await this.cargarUsuarios();
        return true;
    }

    crearInterfaz() {
        this.container.innerHTML = `
            <div class="usuarios-header">
                <div class="usuarios-title">
                    <h1><i class="fas fa-users-gear" aria-hidden="true"></i> Gesti\u00f3n de usuarios</h1>
                    <p class="usuarios-subtitle">Administraci\u00f3n de cuentas y roles del sistema</p>
                </div>
                <div class="usuarios-actions">
                    <button id="btn-crear-usuario" class="btn btn-primary" aria-label="Nuevo usuario">
                        <i class="fas fa-user-plus" aria-hidden="true"></i> <span class="btn-text">Nuevo usuario</span>
                    </button>
                </div>
            </div>

            <div class="usuarios-filtros">
                <div class="filtro-group">
                    <label for="filtro-rol">Rol</label>
                    <select id="filtro-rol" class="filtro-select">
                        <option value="">Todos los roles</option>
                    </select>
                </div>
                <div class="filtro-group">
                    <label for="filtro-estado">Estado</label>
                    <select id="filtro-estado" class="filtro-select">
                        <option value="">Todos</option>
                        <option value="activo">Activos</option>
                        <option value="inactivo">Inactivos</option>
                    </select>
                </div>
                <div class="filtro-group filtro-stats">
                    <span id="usuarios-count" class="usuarios-count">0 usuarios</span>
                </div>
            </div>

            <div class="usuarios-tabla-container">
                <div id="usuarios-loading" class="usuarios-loading" role="status" hidden>
                    <i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Cargando usuarios…
                </div>
                <table class="usuarios-tabla" id="usuarios-tabla">
                    <thead>
                        <tr>
                            <th>Usuario</th>
                            <th>Nombre Completo</th>
                            <th>Email</th>
                            <th>Rol</th>
                            <th>Estado</th>
                            <th>Creado</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="usuarios-tbody">
                    </tbody>
                </table>
                <div id="usuarios-empty" class="usuarios-empty" hidden>
                    <i class="fas fa-users-slash" aria-hidden="true"></i>
                    <p>No se encontraron usuarios</p>
                </div>
            </div>

            ${window.dialogo.html({
                id: 'modal-usuario', form: 'form-usuario', icono: 'fa-user-plus', titulo: 'Nuevo usuario',
                cuerpo: `
                    <input type="hidden" id="form-usuario-id" value="">
                    <div class="form-group">
                        <label for="form-username">Usuario <span class="required" aria-hidden="true">*</span></label>
                        <input type="text" id="form-username" class="form-input" placeholder="Nombre de usuario" required aria-required="true" minlength="3" autocomplete="off" autocapitalize="none" spellcheck="false">
                    </div>
                    <div class="form-group" id="form-password-group">
                        <label for="form-password">Contraseña <span class="required" aria-hidden="true">*</span></label>
                        <div class="password-input-wrapper">
                            <input type="password" id="form-password" class="form-input" placeholder="Mínimo 8 caracteres" required aria-required="true" minlength="8" maxlength="72" autocomplete="new-password">
                            <button type="button" class="password-toggle" id="toggle-password" aria-label="Mostrar la contraseña" aria-pressed="false">
                                <i class="fas fa-eye" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="form-nombre">Nombre completo <span class="required" aria-hidden="true">*</span></label>
                        <input type="text" id="form-nombre" class="form-input" placeholder="Nombre y apellido" required aria-required="true">
                    </div>
                    <div class="form-group">
                        <label for="form-email">Email</label>
                        <input type="email" id="form-email" class="form-input" placeholder="correo@ejemplo.com" autocomplete="off" spellcheck="false">
                    </div>
                    <div class="form-group">
                        <label for="form-rol">Rol <span class="required" aria-hidden="true">*</span></label>
                        <select id="form-rol" class="form-input" required aria-required="true">
                            <option value="">Seleccionar rol…</option>
                        </select>
                    </div>
                    <div id="form-error" class="form-error" role="alert" hidden></div>`,
                pie: `
                    <button type="button" class="btn btn-secondary" id="btn-cancelar-usuario">Cancelar</button>
                    <button type="submit" class="btn btn-primary" id="btn-guardar-usuario">
                        <i class="fas fa-save" aria-hidden="true"></i> Guardar
                    </button>`,
            })}

            ${window.dialogo.html({
                id: 'modal-password', form: 'form-password-reset', icono: 'fa-key', titulo: 'Resetear contraseña',
                cuerpo: `
                    <input type="hidden" id="reset-user-id" value="">
                    <p class="modal-info">Establecer nueva contraseña para <strong id="reset-username"></strong></p>
                    <div class="form-group">
                        <label for="reset-new-password">Nueva contraseña <span class="required" aria-hidden="true">*</span></label>
                        <div class="password-input-wrapper">
                            <input type="password" id="reset-new-password" class="form-input" placeholder="Mínimo 8 caracteres" required aria-required="true" minlength="8" maxlength="72" autocomplete="new-password">
                            <button type="button" class="password-toggle" id="toggle-reset-password" aria-label="Mostrar la contraseña" aria-pressed="false">
                                <i class="fas fa-eye" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <div id="reset-error" class="form-error" role="alert" hidden></div>`,
                pie: `
                    <button type="button" class="btn btn-secondary" id="btn-cancelar-password">Cancelar</button>
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-key" aria-hidden="true"></i> Resetear
                    </button>`,
            })}
        `;
    }

    inicializarEventos() {
        // Crear usuario
        document.getElementById('btn-crear-usuario').addEventListener('click', () => this.abrirModalCrear());

        // Form usuario submit
        document.getElementById('form-usuario').addEventListener('submit', (e) => {
            e.preventDefault();
            this.guardarUsuario();
        });

        // Cerrar modal usuario
        document.getElementById('modal-usuario-close').addEventListener('click', () => this.cerrarModalUsuario());
        document.getElementById('btn-cancelar-usuario').addEventListener('click', () => this.cerrarModalUsuario());

        // Form password reset submit
        document.getElementById('form-password-reset').addEventListener('submit', (e) => {
            e.preventDefault();
            this.resetearPassword();
        });

        // Cerrar modal password
        document.getElementById('modal-password-close').addEventListener('click', () => this.cerrarModalPassword());
        document.getElementById('btn-cancelar-password').addEventListener('click', () => this.cerrarModalPassword());

        // Mostrar/ocultar contraseña
        const alternarClave = (idInput, idBoton) => document.getElementById(idBoton).addEventListener('click', (e) => {
            const input = document.getElementById(idInput);
            const boton = e.currentTarget;
            const visible = input.type === 'password';
            input.type = visible ? 'text' : 'password';
            boton.setAttribute('aria-pressed', String(visible));
            boton.setAttribute('aria-label', visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
            const icon = boton.querySelector('i');
            icon.classList.toggle('fa-eye', !visible);
            icon.classList.toggle('fa-eye-slash', visible);
        });
        alternarClave('form-password', 'toggle-password');
        alternarClave('reset-new-password', 'toggle-reset-password');

        // Filtros
        document.getElementById('filtro-rol').addEventListener('change', (e) => {
            this.filtros.rol = e.target.value;
            this.renderizarTabla();
        });
        document.getElementById('filtro-estado').addEventListener('change', (e) => {
            this.filtros.estado = e.target.value;
            this.renderizarTabla();
        });
    }

    async cargarRoles() {
        try {
            const response = await window.apiService.obtenerRoles();
            if (response.success) {
                this.roles = response.data;
                this.actualizarSelectRoles();
            }
        } catch (error) {
            console.error('Error cargando roles:', error);
        }
    }

    actualizarSelectRoles() {
        // Select del filtro
        const filtroRol = document.getElementById('filtro-rol');
        const currentFiltroValue = filtroRol.value;
        filtroRol.innerHTML = '<option value="">Todos los roles</option>';
        this.roles.forEach(rol => {
            filtroRol.innerHTML += `<option value="${escaparHtml(rol.nombre)}">${escaparHtml(this.formatearRol(rol.nombre))}</option>`;
        });
        filtroRol.value = currentFiltroValue;

        // Select del formulario
        const formRol = document.getElementById('form-rol');
        formRol.innerHTML = '<option value="">Seleccionar rol…</option>';
        this.roles.forEach(rol => {
            formRol.innerHTML += `<option value="${escaparHtml(rol.nombre)}">${escaparHtml(this.formatearRol(rol.nombre))}</option>`;
        });
    }

    async cargarUsuarios() {
        this.cargando = true;
        document.getElementById('usuarios-loading').hidden = false;
        document.getElementById('usuarios-tabla').hidden = true;
        document.getElementById('usuarios-empty').hidden = true;

        try {
            const response = await window.apiService.obtenerUsuarios();
            if (response.success) {
                this.usuarios = response.data;
                this.renderizarTabla();
            }
        } catch (error) {
            console.error('Error cargando usuarios:', error);
            this.mostrarToast('Error al cargar usuarios: ' + error.message, 'error');
        } finally {
            this.cargando = false;
            document.getElementById('usuarios-loading').hidden = true;
        }
    }

    getUsuariosFiltrados() {
        return this.usuarios.filter(u => {
            if (this.filtros.rol && u.rol !== this.filtros.rol) return false;
            if (this.filtros.estado === 'activo' && !u.activo) return false;
            if (this.filtros.estado === 'inactivo' && u.activo) return false;
            return true;
        });
    }

    renderizarTabla() {
        const filtrados = this.getUsuariosFiltrados();
        const tbody = document.getElementById('usuarios-tbody');
        const tabla = document.getElementById('usuarios-tabla');
        const empty = document.getElementById('usuarios-empty');
        const count = document.getElementById('usuarios-count');

        count.textContent = `${filtrados.length} usuario${filtrados.length !== 1 ? 's' : ''}`;

        if (filtrados.length === 0) {
            tabla.hidden = true;
            empty.hidden = false;
            return;
        }

        tabla.hidden = false;
        empty.hidden = true;

        tbody.innerHTML = filtrados.map(usuario => `
            <tr class="${!usuario.activo ? 'usuario-inactivo' : ''}">
                <td>
                    <div class="usuario-cell">
                        <div class="usuario-avatar">${escaparHtml(this.getInitials(usuario.nombre_completo || usuario.username))}</div>
                        <span class="usuario-username">${this.escapeHtml(usuario.username)}</span>
                    </div>
                </td>
                <td>${this.escapeHtml(usuario.nombre_completo || '-')}</td>
                <td>${this.escapeHtml(usuario.email || '-')}</td>
                <td><span class="rol-badge rol-${escaparHtml(usuario.rol)}">${escaparHtml(this.formatearRol(usuario.rol))}</span></td>
                <td>
                    <span class="estado-badge ${usuario.activo ? 'estado-activo' : 'estado-inactivo'}">
                        <i class="fas ${usuario.activo ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                        ${usuario.activo ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td>${this.formatearFecha(usuario.created_at)}</td>
                <td>
                    <div class="acciones-cell">
                        <button type="button" class="btn-accion btn-editar" title="Editar usuario" aria-label="Editar a ${this.escapeHtml(usuario.username)}" data-id="${usuario.id}">
                            <i class="fas fa-edit" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion btn-password" title="Resetear contrase\u00f1a" aria-label="Resetear la contrase\u00f1a de ${this.escapeHtml(usuario.username)}" data-id="${usuario.id}" data-username="${this.escapeHtml(usuario.username)}">
                            <i class="fas fa-key" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="btn-accion ${usuario.activo ? 'btn-desactivar' : 'btn-activar'}"
                                title="${usuario.activo ? 'Desactivar' : 'Activar'} usuario"
                                aria-label="${usuario.activo ? 'Desactivar' : 'Activar'} a ${this.escapeHtml(usuario.username)}"
                                data-id="${usuario.id}"
                                data-activo="${usuario.activo}">
                            <i class="fas ${usuario.activo ? 'fa-user-slash' : 'fa-user-check'}" aria-hidden="true"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Bind action buttons
        tbody.querySelectorAll('.btn-editar').forEach(btn => {
            btn.addEventListener('click', () => this.abrirModalEditar(parseInt(btn.dataset.id)));
        });
        tbody.querySelectorAll('.btn-password').forEach(btn => {
            btn.addEventListener('click', () => this.abrirModalPassword(parseInt(btn.dataset.id), btn.dataset.username));
        });
        tbody.querySelectorAll('.btn-desactivar, .btn-activar').forEach(btn => {
            btn.addEventListener('click', () => this.toggleEstadoUsuario(parseInt(btn.dataset.id), btn.dataset.activo === 'true'));
        });
    }

    // Modal operations

    abrirModalCrear() {
        window.dialogo.fijarTitulo('modal-usuario', 'fa-user-plus', 'Nuevo usuario');
        document.getElementById('form-usuario-id').value = '';
        document.getElementById('form-username').value = '';
        document.getElementById('form-username').disabled = false;
        document.getElementById('form-password').value = '';
        document.getElementById('form-password-group').hidden = false;
        document.getElementById('form-nombre').value = '';
        document.getElementById('form-email').value = '';
        document.getElementById('form-rol').value = '';
        this.ocultarFormError('form-error');
        this.abrirDialogo('modal-usuario', 'form-username');
    }

    abrirModalEditar(userId) {
        const usuario = this.usuarios.find(u => u.id === userId);
        if (!usuario) return;

        window.dialogo.fijarTitulo('modal-usuario', 'fa-user-edit', 'Editar usuario');
        document.getElementById('form-usuario-id').value = usuario.id;
        document.getElementById('form-username').value = usuario.username;
        document.getElementById('form-username').disabled = true;
        document.getElementById('form-password-group').hidden = true;
        document.getElementById('form-nombre').value = usuario.nombre_completo || '';
        document.getElementById('form-email').value = usuario.email || '';
        document.getElementById('form-rol').value = usuario.rol || '';
        this.ocultarFormError('form-error');
        this.abrirDialogo('modal-usuario', 'form-nombre');
    }

    cerrarModalUsuario() {
        document.getElementById('modal-usuario').close();
    }

    abrirModalPassword(userId, username) {
        document.getElementById('reset-user-id').value = userId;
        document.getElementById('reset-username').textContent = username;
        document.getElementById('reset-new-password').value = '';
        this.ocultarFormError('reset-error');
        this.abrirDialogo('modal-password', 'reset-new-password');
    }

    cerrarModalPassword() {
        document.getElementById('modal-password').close();
    }

    /**
     * Abre un diálogo nativo y pone el foco en el campo pedido. `dialogo.mostrar` devuelve el foco
     * al botón que lo abrió cuando se cierra (incluido con Escape).
     */
    abrirDialogo(id, campoId) {
        const dlg = document.getElementById(id);
        if (dlg.open) return;
        window.dialogo.mostrar(dlg);
        document.getElementById(campoId)?.focus();
    }

    // CRUD operations

    async guardarUsuario() {
        const id = document.getElementById('form-usuario-id').value;
        const isEdit = !!id;

        const data = {
            nombre_completo: document.getElementById('form-nombre').value.trim(),
            email: document.getElementById('form-email').value.trim(),
            rol: document.getElementById('form-rol').value
        };

        if (!isEdit) {
            data.username = document.getElementById('form-username').value.trim();
            data.password = document.getElementById('form-password').value;

            if (!data.username || data.username.length < 3) {
                this.mostrarFormError('form-error', 'El usuario debe tener al menos 3 caracteres');
                return;
            }
            if (!data.password || data.password.length < 8) {
                this.mostrarFormError('form-error', 'La contrase\u00f1a debe tener al menos 8 caracteres');
                return;
            }
        }

        if (!data.nombre_completo) {
            this.mostrarFormError('form-error', 'El nombre completo es requerido');
            return;
        }
        if (!data.rol) {
            this.mostrarFormError('form-error', 'Debe seleccionar un rol');
            return;
        }

        const btn = document.getElementById('btn-guardar-usuario');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';

        try {
            let response;
            if (isEdit) {
                response = await window.apiService.actualizarUsuario(parseInt(id), data);
            } else {
                response = await window.apiService.crearUsuario(data);
            }

            if (response.success) {
                this.cerrarModalUsuario();
                this.mostrarToast(
                    isEdit ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente',
                    'success'
                );
                await this.cargarUsuarios();
            }
        } catch (error) {
            this.mostrarFormError('form-error', error.message || 'Error al guardar usuario');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar';
        }
    }

    async toggleEstadoUsuario(userId, currentlyActive) {
        const action = currentlyActive ? 'desactivar' : 'activar';
        const confirmed = await window.dialogo.confirmar({
            titulo: currentlyActive ? 'Desactivar usuario' : 'Activar usuario',
            mensaje: `\u00bfEst\u00e1 seguro que desea ${action} este usuario?`,
            confirmar: currentlyActive ? 'Desactivar' : 'Activar',
            tono: currentlyActive ? 'peligro' : undefined,
        });
        if (!confirmed) return;

        try {
            const response = await window.apiService.toggleUsuario(userId, !currentlyActive);
            if (response.success) {
                this.mostrarToast(
                    currentlyActive ? 'Usuario desactivado' : 'Usuario activado',
                    'success'
                );
                await this.cargarUsuarios();
            }
        } catch (error) {
            this.mostrarToast('Error: ' + error.message, 'error');
        }
    }

    async resetearPassword() {
        const userId = document.getElementById('reset-user-id').value;
        const newPassword = document.getElementById('reset-new-password').value;

        if (!newPassword || newPassword.length < 8) {
            this.mostrarFormError('reset-error', 'La contrase\u00f1a debe tener al menos 8 caracteres');
            return;
        }

        try {
            const response = await window.apiService.resetearPassword(parseInt(userId), newPassword);
            if (response.success) {
                this.cerrarModalPassword();
                this.mostrarToast('Contrase\u00f1a reseteada exitosamente', 'success');
            }
        } catch (error) {
            this.mostrarFormError('reset-error', error.message || 'Error al resetear contrase\u00f1a');
        }
    }

    // Helpers

    formatearRol(rol) {
        const nombres = {
            'administrador': 'Administrador',
            'encargado_relevamiento': 'Enc. Relevamiento',
            'consultor': 'Consultor'
        };
        return nombres[rol] || rol;
    }

    formatearFecha(fecha) {
        if (!fecha) return '-';
        const d = new Date(fecha);
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    getInitials(name) {
        return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    }

    /**
     * Escapa un dato antes de interpolarlo en HTML.
     *
     * Delega en el helper compartido (`src/lib/escapar.js`). Antes era
     * `div.textContent = x; return div.innerHTML`, que escapa `&`, `<` y `>` pero **no
     * las comillas** — y acá se usa dentro de atributos (`data-username="${...}"`), donde
     * eso no alcanza: un valor que empiece con comilla se sale del atributo.
     */
    escapeHtml(texto) {
        return escaparHtml(texto);
    }

    mostrarFormError(elementId, message) {
        const el = document.getElementById(elementId);
        el.textContent = message;
        el.hidden = false;
    }

    ocultarFormError(elementId) {
        const el = document.getElementById(elementId);
        el.textContent = '';
        el.hidden = true;
    }

    /** Avisos del sistema (regiones vivas), no un contenedor propio. */
    mostrarToast(message, type = 'info') {
        window.avisos.mostrar(message, type);
    }
}

// Instancia global
window.usuariosComponent = new UsuariosComponent();
