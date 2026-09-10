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
                    <h2><i class="fas fa-users-gear"></i> Gesti\u00f3n de Usuarios</h2>
                    <p class="usuarios-subtitle">Administraci\u00f3n de cuentas y roles del sistema</p>
                </div>
                <div class="usuarios-actions">
                    <button id="btn-crear-usuario" class="btn btn-primary">
                        <i class="fas fa-user-plus"></i> <span class="btn-text">Nuevo Usuario</span>
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
                <div id="usuarios-loading" class="usuarios-loading" style="display: none;">
                    <i class="fas fa-spinner fa-spin"></i> Cargando usuarios...
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
                <div id="usuarios-empty" class="usuarios-empty" style="display: none;">
                    <i class="fas fa-users-slash"></i>
                    <p>No se encontraron usuarios</p>
                </div>
            </div>

            <!-- Modal Crear/Editar Usuario -->
            <div id="modal-usuario" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="modal-usuario-titulo"><i class="fas fa-user-plus"></i> Nuevo Usuario</h3>
                        <button class="modal-close" id="modal-usuario-close">&times;</button>
                    </div>
                    <form id="form-usuario" class="modal-body">
                        <input type="hidden" id="form-usuario-id" value="">
                        <div class="form-group">
                            <label for="form-username">Usuario <span class="required">*</span></label>
                            <input type="text" id="form-username" class="form-input" placeholder="Nombre de usuario" required minlength="3" autocomplete="off">
                        </div>
                        <div class="form-group" id="form-password-group">
                            <label for="form-password">Contrase\u00f1a <span class="required">*</span></label>
                            <div class="password-input-wrapper">
                                <input type="password" id="form-password" class="form-input" placeholder="M\u00ednimo 6 caracteres" required minlength="6" autocomplete="new-password">
                                <button type="button" class="password-toggle" id="toggle-password">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="form-nombre">Nombre Completo <span class="required">*</span></label>
                            <input type="text" id="form-nombre" class="form-input" placeholder="Nombre y apellido" required>
                        </div>
                        <div class="form-group">
                            <label for="form-email">Email</label>
                            <input type="email" id="form-email" class="form-input" placeholder="correo@ejemplo.com">
                        </div>
                        <div class="form-group">
                            <label for="form-rol">Rol <span class="required">*</span></label>
                            <select id="form-rol" class="form-input" required>
                                <option value="">Seleccionar rol...</option>
                            </select>
                        </div>
                        <div id="form-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-usuario">Cancelar</button>
                            <button type="submit" class="btn btn-primary" id="btn-guardar-usuario">
                                <i class="fas fa-save"></i> Guardar
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Modal Resetear Contrase\u00f1a -->
            <div id="modal-password" class="modal-overlay" style="display: none;">
                <div class="modal-content modal-sm">
                    <div class="modal-header">
                        <h3><i class="fas fa-key"></i> Resetear Contrase\u00f1a</h3>
                        <button class="modal-close" id="modal-password-close">&times;</button>
                    </div>
                    <form id="form-password-reset" class="modal-body">
                        <input type="hidden" id="reset-user-id" value="">
                        <p class="modal-info">Establecer nueva contrase\u00f1a para <strong id="reset-username"></strong></p>
                        <div class="form-group">
                            <label for="reset-new-password">Nueva Contrase\u00f1a <span class="required">*</span></label>
                            <div class="password-input-wrapper">
                                <input type="password" id="reset-new-password" class="form-input" placeholder="M\u00ednimo 6 caracteres" required minlength="6" autocomplete="new-password">
                                <button type="button" class="password-toggle" id="toggle-reset-password">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <div id="reset-error" class="form-error" style="display: none;"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="btn-cancelar-password">Cancelar</button>
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-key"></i> Resetear
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Notificaci\u00f3n toast -->
            <div id="toast-container" class="toast-container"></div>
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

        // Cerrar modales con click en overlay
        document.getElementById('modal-usuario').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalUsuario();
        });
        document.getElementById('modal-password').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) this.cerrarModalPassword();
        });

        // Toggle password visibility
        document.getElementById('toggle-password').addEventListener('click', () => {
            const input = document.getElementById('form-password');
            const icon = document.getElementById('toggle-password').querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });

        document.getElementById('toggle-reset-password').addEventListener('click', () => {
            const input = document.getElementById('reset-new-password');
            const icon = document.getElementById('toggle-reset-password').querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });

        // Filtros
        document.getElementById('filtro-rol').addEventListener('change', (e) => {
            this.filtros.rol = e.target.value;
            this.renderizarTabla();
        });
        document.getElementById('filtro-estado').addEventListener('change', (e) => {
            this.filtros.estado = e.target.value;
            this.renderizarTabla();
        });

        // Cerrar modales con Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cerrarModalUsuario();
                this.cerrarModalPassword();
            }
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
            filtroRol.innerHTML += `<option value="${rol.nombre}">${this.formatearRol(rol.nombre)}</option>`;
        });
        filtroRol.value = currentFiltroValue;

        // Select del formulario
        const formRol = document.getElementById('form-rol');
        formRol.innerHTML = '<option value="">Seleccionar rol...</option>';
        this.roles.forEach(rol => {
            formRol.innerHTML += `<option value="${rol.nombre}">${this.formatearRol(rol.nombre)}</option>`;
        });
    }

    async cargarUsuarios() {
        this.cargando = true;
        document.getElementById('usuarios-loading').style.display = 'flex';
        document.getElementById('usuarios-tabla').style.display = 'none';
        document.getElementById('usuarios-empty').style.display = 'none';

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
            document.getElementById('usuarios-loading').style.display = 'none';
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
            tabla.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }

        tabla.style.display = 'table';
        empty.style.display = 'none';

        tbody.innerHTML = filtrados.map(usuario => `
            <tr class="${!usuario.activo ? 'usuario-inactivo' : ''}">
                <td>
                    <div class="usuario-cell">
                        <div class="usuario-avatar">${this.getInitials(usuario.nombre_completo || usuario.username)}</div>
                        <span class="usuario-username">${this.escapeHtml(usuario.username)}</span>
                    </div>
                </td>
                <td>${this.escapeHtml(usuario.nombre_completo || '-')}</td>
                <td>${this.escapeHtml(usuario.email || '-')}</td>
                <td><span class="rol-badge rol-${usuario.rol}">${this.formatearRol(usuario.rol)}</span></td>
                <td>
                    <span class="estado-badge ${usuario.activo ? 'estado-activo' : 'estado-inactivo'}">
                        <i class="fas ${usuario.activo ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                        ${usuario.activo ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td>${this.formatearFecha(usuario.created_at)}</td>
                <td>
                    <div class="acciones-cell">
                        <button class="btn-accion btn-editar" title="Editar usuario" data-id="${usuario.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-accion btn-password" title="Resetear contrase\u00f1a" data-id="${usuario.id}" data-username="${this.escapeHtml(usuario.username)}">
                            <i class="fas fa-key"></i>
                        </button>
                        <button class="btn-accion ${usuario.activo ? 'btn-desactivar' : 'btn-activar'}"
                                title="${usuario.activo ? 'Desactivar' : 'Activar'} usuario"
                                data-id="${usuario.id}"
                                data-activo="${usuario.activo}">
                            <i class="fas ${usuario.activo ? 'fa-user-slash' : 'fa-user-check'}"></i>
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
        document.getElementById('modal-usuario-titulo').innerHTML = '<i class="fas fa-user-plus"></i> Nuevo Usuario';
        document.getElementById('form-usuario-id').value = '';
        document.getElementById('form-username').value = '';
        document.getElementById('form-username').disabled = false;
        document.getElementById('form-password').value = '';
        document.getElementById('form-password-group').style.display = 'block';
        document.getElementById('form-nombre').value = '';
        document.getElementById('form-email').value = '';
        document.getElementById('form-rol').value = '';
        document.getElementById('form-error').style.display = 'none';
        document.getElementById('modal-usuario').style.display = 'flex';
        document.getElementById('form-username').focus();
    }

    abrirModalEditar(userId) {
        const usuario = this.usuarios.find(u => u.id === userId);
        if (!usuario) return;

        document.getElementById('modal-usuario-titulo').innerHTML = '<i class="fas fa-user-edit"></i> Editar Usuario';
        document.getElementById('form-usuario-id').value = usuario.id;
        document.getElementById('form-username').value = usuario.username;
        document.getElementById('form-username').disabled = true;
        document.getElementById('form-password-group').style.display = 'none';
        document.getElementById('form-nombre').value = usuario.nombre_completo || '';
        document.getElementById('form-email').value = usuario.email || '';
        document.getElementById('form-rol').value = usuario.rol || '';
        document.getElementById('form-error').style.display = 'none';
        document.getElementById('modal-usuario').style.display = 'flex';
        document.getElementById('form-nombre').focus();
    }

    cerrarModalUsuario() {
        document.getElementById('modal-usuario').style.display = 'none';
    }

    abrirModalPassword(userId, username) {
        document.getElementById('reset-user-id').value = userId;
        document.getElementById('reset-username').textContent = username;
        document.getElementById('reset-new-password').value = '';
        document.getElementById('reset-error').style.display = 'none';
        document.getElementById('modal-password').style.display = 'flex';
        document.getElementById('reset-new-password').focus();
    }

    cerrarModalPassword() {
        document.getElementById('modal-password').style.display = 'none';
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
            if (!data.password || data.password.length < 6) {
                this.mostrarFormError('form-error', 'La contrase\u00f1a debe tener al menos 6 caracteres');
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
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

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
        const confirmed = confirm(`\u00bfEst\u00e1 seguro que desea ${action} este usuario?`);
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

        if (!newPassword || newPassword.length < 6) {
            this.mostrarFormError('reset-error', 'La contrase\u00f1a debe tener al menos 6 caracteres');
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

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    mostrarFormError(elementId, message) {
        const el = document.getElementById(elementId);
        el.textContent = message;
        el.style.display = 'block';
    }

    mostrarToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
        toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${this.escapeHtml(message)}`;

        container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => toast.classList.add('toast-visible'));

        setTimeout(() => {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
}

// Instancia global
window.usuariosComponent = new UsuariosComponent();
