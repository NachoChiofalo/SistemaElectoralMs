-- DB-018: todo usuario tiene rol. El service siempre lo resuelve, pero un INSERT directo podia
-- dejar una cuenta que inicia sesion y no tiene ningun permiso. Falla de forma visible si ya
-- existiera una (el preflight la cuenta antes), en vez de tocar datos.
ALTER TABLE usuarios ALTER COLUMN rol_id SET NOT NULL;
