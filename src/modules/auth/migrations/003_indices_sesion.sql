-- Indices de las tablas que se consultan en cada verificacion de sesion.
--
-- token_blacklist.token_jti y refresh_tokens.token ya tienen indice por su UNIQUE.
-- Faltaban los de las busquedas y limpiezas por fecha y por usuario.

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires   ON token_blacklist(expires_at);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol_id           ON usuarios(rol_id);
CREATE INDEX IF NOT EXISTS idx_rol_permisos_rol_id       ON rol_permisos(rol_id);
