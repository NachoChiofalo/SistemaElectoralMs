-- Datos SINTÉTICOS para verificar el frontend (scripts/verificar-frontend.js).
-- Nombres y DNIs ficticios (rango 90.000.000+, que no corresponde a personas reales).
-- Correr SOLO contra una base descartable, nunca contra producción:
--   docker exec -i agora-pg-test psql -U postgres -d agora_test < scripts/datos-prueba-frontend.sql
-- Idempotente: no pisa lo que ya existe.

INSERT INTO padron.votantes (dni, anio_nac, apellido, nombre, domicilio, tipo_ejemplar, circuito, sexo, edad)
SELECT
  (90000000 + n)::text,
  1945 + (n * 7) % 60,
  (ARRAY['Quiroga','Benítez','Sosa','Aguirre','Domínguez','Ferreyra','Ledesma','Maidana',
         'Paz','Rivarola','Tolosa','Vega','Zárate','Ibarra','Cabrera'])[1 + n % 15],
  (ARRAY['Marta','Julián','Lucía','Ramiro','Elena','Tomás','Silvana','Esteban',
         'Noelia','Gastón','Rocío','Facundo','Alicia','Bruno','Paula'])[1 + (n * 3) % 15],
  (ARRAY['San Martín','Belgrano','Mitre','Sarmiento','Rivadavia','9 de Julio'])[1 + n % 6]
    || ' ' || (100 + (n * 13) % 1800),
  'A',
  (1 + n % 4)::text,
  CASE WHEN n % 2 = 0 THEN 'F' ELSE 'M' END,
  2026 - (1945 + (n * 7) % 60)
FROM generate_series(1, 400) AS n
ON CONFLICT (dni) DO NOTHING;

INSERT INTO padron.relevamientos (dni, opcion_politica, observacion, telefono, es_nuevo_votante, recibe_ayuda_social)
SELECT
  v.dni,
  (ARRAY['PJ','UCR','Indeciso'])[1 + (row_number() OVER (ORDER BY v.dni))::int % 3],
  CASE WHEN v.dni::bigint % 5 = 0 THEN 'Dato de prueba' ELSE NULL END,
  CASE WHEN v.dni::bigint % 3 = 0 THEN '3442-4' || lpad((v.dni::bigint % 100000)::text, 5, '0') ELSE '' END,
  v.dni::bigint % 17 = 0,
  v.dni::bigint % 11 = 0
FROM padron.votantes v
WHERE v.dni::bigint BETWEEN 90000001 AND 90000400
  AND v.dni::bigint % 5 <> 4
ON CONFLICT (dni) DO NOTHING;
