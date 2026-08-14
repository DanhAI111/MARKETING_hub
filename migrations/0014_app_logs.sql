CREATE TABLE IF NOT EXISTS app_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  correlationId TEXT,
  postId TEXT,
  fanpageId TEXT,
  platform TEXT,
  details TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_logs_created
  ON app_logs(createdAt DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_level
  ON app_logs(level, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_component
  ON app_logs(component, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_app_logs_post
  ON app_logs(postId, createdAt DESC)
  WHERE postId IS NOT NULL AND postId != '';
