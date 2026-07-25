-- Campaign soft-link + organic engagement snapshot + approval workflow on posts.
ALTER TABLE posts ADD COLUMN campaignId TEXT;
ALTER TABLE posts ADD COLUMN engagement TEXT;
ALTER TABLE posts ADD COLUMN approvalStatus TEXT NOT NULL DEFAULT 'approved';

CREATE INDEX IF NOT EXISTS idx_posts_campaign ON posts(campaignId) WHERE campaignId IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_approval_queue
  ON posts(status, approvalStatus, scheduledAt)
  WHERE status = 'scheduled';
