-- DB-004: auth guardaba las fechas como TIMESTAMP (hora de pared, sin zona) mientras que
-- las tablas nuevas y la auditoria usan TIMESTAMPTZ. Lo ya guardado se interpreta como UTC:
-- Render y Supabase corren en UTC, y el driver serializa las fechas con el huso del proceso
-- de Node. (Antes de aplicar en produccion se comprueba con scripts/preflight-migraciones.js.)
--
-- Idempotente: solo convierte las columnas que todavia son TIMESTAMP. Reconvertir una
-- columna ya TIMESTAMPTZ con AT TIME ZONE 'UTC' la correria horas.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT table_schema, table_name, column_name
      FROM information_schema.columns
     WHERE data_type = 'timestamp without time zone'
       AND table_schema = 'public'
       AND (table_name, column_name) IN (
         ('roles', 'created_at'),
         ('permisos', 'created_at'),
         ('usuarios', 'created_at'),
         ('usuarios', 'updated_at'),
         ('refresh_tokens', 'expires_at'),
         ('refresh_tokens', 'created_at'),
         ('token_blacklist', 'expires_at'),
         ('token_blacklist', 'created_at'),
         ('active_sessions', 'last_activity'),
         ('active_sessions', 'created_at')
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
      c.table_schema, c.table_name, c.column_name, c.column_name
    );
  END LOOP;
END $$;
