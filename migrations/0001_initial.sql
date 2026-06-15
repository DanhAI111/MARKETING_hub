PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  accessTokenEncrypted TEXT NOT NULL,
  tokenExpiresAt TEXT,
  scopes TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fanpages (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  link TEXT,
  imageUrl TEXT,
  metaPageId TEXT,
  instagramBusinessId TEXT UNIQUE,
  pageAccessTokenEncrypted TEXT,
  connected INTEGER NOT NULL DEFAULT 0,
  lastSyncedAt TEXT,
  syncStatus TEXT,
  syncError TEXT,
  kpis TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  fanpageId TEXT NOT NULL,
  externalPostId TEXT,
  title TEXT NOT NULL,
  content TEXT,
  date TEXT NOT NULL,
  scheduledAt TEXT,
  publishedAt TEXT,
  permalink TEXT,
  mediaUrl TEXT,
  mediaItems TEXT,
  publishError TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'published',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (fanpageId) REFERENCES fanpages(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external
  ON posts(source, externalPostId)
  WHERE externalPostId IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_scheduled
  ON posts(status, scheduledAt);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_items (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload TEXT,
  expiresAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires
  ON oauth_states(expiresAt);
