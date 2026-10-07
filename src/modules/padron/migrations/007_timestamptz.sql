-- DB-004: ver auth/007. Mismo criterio: lo guardado se interpreta como UTC, y solo se
-- convierten las columnas que todavia son TIMESTAMP (idempotente).
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT table_schema, table_name, column_name
      FROM information_schema.columns
     WHERE data_type = 'timestamp without time zone'
       AND table_schema = 'padron'
       AND (table_name, column_name) IN (
         ('votantes', 'created_at'),
         ('votantes', 'updated_at'),
         ('relevamientos', 'fecha_relevamiento'),
         ('relevamientos', 'fecha_modificacion'),
         ('relevamientos', 'fecha_detalle')
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
      c.table_schema, c.table_name, c.column_name, c.column_name
    );
  END LOOP;
END $$;
