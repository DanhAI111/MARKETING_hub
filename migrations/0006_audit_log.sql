CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actorEmail TEXT,
  action TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  changes TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log(entityType, entityId, createdAt);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log(actorEmail, createdAt);
