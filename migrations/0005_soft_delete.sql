ALTER TABLE posts ADD COLUMN deletedAt TEXT;
ALTER TABLE app_items ADD COLUMN deletedAt TEXT;
ALTER TABLE fanpages ADD COLUMN deletedAt TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts(deletedAt);
CREATE INDEX IF NOT EXISTS idx_app_items_deleted_at ON app_items(deletedAt);
CREATE INDEX IF NOT EXISTS idx_fanpages_deleted_at ON fanpages(deletedAt);
