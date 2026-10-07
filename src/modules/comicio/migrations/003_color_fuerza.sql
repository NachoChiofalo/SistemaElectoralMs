-- Color de cada fuerza, para graficos y metricas de la pestana Resultados.
--
-- Es un indice 1..8 a una paleta fija de tokens (--ds-fuerza-1..8 en design-system.css),
-- no un hex libre: el frontend nunca escribe un color fuera del design system. Validado
-- en el service (rango 1..8), no con un CHECK: mismo criterio que tipoEleccion, que
-- tampoco lo tiene a nivel de base.

ALTER TABLE elecciones.fuerzas ADD COLUMN IF NOT EXISTS color SMALLINT NOT NULL DEFAULT 1;
