-- DB-034: purgarVencidos() y el write-behind de actividad filtran por last_activity.
CREATE INDEX IF NOT EXISTS idx_active_sessions_last_activity ON active_sessions (last_activity);
