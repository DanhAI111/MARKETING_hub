ALTER TABLE posts ADD COLUMN publishMode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE posts ADD COLUMN testedAt TEXT;
ALTER TABLE posts ADD COLUMN testResult TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_publish_mode
  ON posts(publishMode, status, scheduledAt);
