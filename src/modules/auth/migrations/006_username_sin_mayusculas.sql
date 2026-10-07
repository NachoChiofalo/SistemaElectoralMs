-- BE-040: 'Admin' y 'admin' no pueden ser cuentas distintas. El username se compara sin
-- distinguir mayusculas, pero se conserva tal como se guardo (no se renombra a nadie).
-- Falla de forma visible, antes de tocar nada, si ya hubiera dos cuentas que difieran
-- solo en mayusculas: ahi hay que decidir a mano cual se queda.
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_username_lower ON usuarios (LOWER(username));

-- BE-024: exportar el padron es solo para administradores (decision del 2026-10-07). El
-- encargado de relevamiento tenia padron.export pero las dos rutas exigen rol
-- administrador, asi que veia dos botones que respondian 403. Sin el permiso, no se le
-- muestran. Correrla dos veces no hace nada distinto.
DELETE FROM rol_permisos
 WHERE rol_id     = (SELECT id FROM roles    WHERE nombre = 'encargado_relevamiento')
   AND permiso_id = (SELECT id FROM permisos WHERE codigo = 'padron.export');
