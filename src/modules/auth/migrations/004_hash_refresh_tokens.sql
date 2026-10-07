-- El codigo ahora guarda un hash SHA-256 del refresh token en vez del valor crudo
-- (ver specs/G3-sesion-jwt). Los refresh tokens emitidos antes de este deploy quedan
-- en texto plano y de todas formas dejan de poder validarse: el lookup nuevo busca por
-- hash, no por el valor original. Purgarlos no pierde nada utilizable y cierra la
-- ventana de exposicion de ese dato sin esperar a que venzan solos.
--
-- Correrla dos veces no hace nada distinto la segunda vez.

DELETE FROM refresh_tokens;
