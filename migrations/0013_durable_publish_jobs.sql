-- Durable outbox for resumable social publishing. Every external Meta mutation
-- is checkpointed here before the next cron tick advances the job.
CREATE TABLE IF NOT EXISTS publish_jobs (
  postId TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'queued',
  resolvedMedia TEXT,
  childContainerIds TEXT,
  parentContainerId TEXT,
  leaseToken TEXT,
  leaseUntil TEXT,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  nextAttemptAt TEXT,
  lastErrorCode TEXT,
  lastError TEXT,
  lastErrorAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_due
  ON publish_jobs(stage, nextAttemptAt);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id TEXT PRIMARY KEY,
  postId TEXT NOT NULL,
  stage TEXT NOT NULL,
  outcome TEXT NOT NULL,
  errorCode TEXT,
  errorMessage TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publish_attempts_post
  ON publish_attempts(postId, createdAt);
