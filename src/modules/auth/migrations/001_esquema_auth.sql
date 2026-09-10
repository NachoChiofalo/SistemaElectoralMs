-- Esquema de autenticacion, roles y permisos.
--
-- Describe el estado que el codigo viejo creaba en cada arranque con CREATE TABLE
-- IF NOT EXISTS. Contra una base que ya lo tiene, esta migracion se marca como
-- aplicada con `npm run migrate:adopt` en lugar de ejecutarse.

CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT,
    activo      BOOLEAN DEFAULT true,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permisos (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(50) UNIQUE NOT NULL,
    nombre      VARCHAR(100) NOT NULL,
    descripcion TEXT,
    modulo      VARCHAR(50) NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rol_permisos (
    id         SERIAL PRIMARY KEY,
    rol_id     INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permiso_id INTEGER REFERENCES permisos(id) ON DELETE CASCADE,
    UNIQUE (rol_id, permiso_id)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(100) NOT NULL,
    email           VARCHAR(100),
    rol_id          INTEGER REFERENCES roles(id),
    activo          BOOLEAN DEFAULT true,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    token      VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_blacklist (
    id         SERIAL PRIMARY KEY,
    token_jti  VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Una sola sesion activa por usuario: iniciar sesion en otro dispositivo invalida
-- la anterior.
CREATE TABLE IF NOT EXISTS active_sessions (
    user_id       INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    session_jti   VARCHAR(255) NOT NULL,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
