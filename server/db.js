const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'marketing_hub.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
    deletedAt TEXT,
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
    sheetUrl TEXT,
    sheetRowKey TEXT,
    sheetDefaultFanpageId TEXT,
    publishMode TEXT NOT NULL DEFAULT 'live',
    testedAt TEXT,
    testResult TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'published',
    deletedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (fanpageId) REFERENCES fanpages(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external
    ON posts(source, externalPostId)
    WHERE externalPostId IS NOT NULL;

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_items (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    deletedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    windowStart INTEGER NOT NULL
  );

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
`);

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

ensureColumn('posts', 'content', 'TEXT');
ensureColumn('posts', 'scheduledAt', 'TEXT');
ensureColumn('posts', 'publishedAt', 'TEXT');
ensureColumn('posts', 'mediaItems', 'TEXT');
ensureColumn('posts', 'publishError', 'TEXT');
ensureColumn('posts', 'sheetUrl', 'TEXT');
ensureColumn('posts', 'sheetRowKey', 'TEXT');
ensureColumn('posts', 'sheetDefaultFanpageId', 'TEXT');
ensureColumn('posts', 'deletedAt', 'TEXT');
ensureColumn('posts', 'campaignId', 'TEXT');
ensureColumn('posts', 'engagement', 'TEXT');
ensureColumn('posts', 'approvalStatus', "TEXT NOT NULL DEFAULT 'approved'");
ensureColumn('posts', 'publishMode', "TEXT NOT NULL DEFAULT 'live'");
ensureColumn('posts', 'testedAt', 'TEXT');
ensureColumn('posts', 'testResult', 'TEXT');
ensureColumn('app_items', 'deletedAt', 'TEXT');
ensureColumn('fanpages', 'deletedAt', 'TEXT');
ensureColumn('fanpages', 'crossPostInstagram', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_sheet_row
    ON posts(sheetUrl, sheetRowKey)
    WHERE sheetUrl IS NOT NULL AND sheetRowKey IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_posts_campaign
    ON posts(campaignId)
    WHERE campaignId IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_posts_approval_queue
    ON posts(status, approvalStatus, scheduledAt)
    WHERE status = 'scheduled';

  CREATE INDEX IF NOT EXISTS idx_posts_publish_mode
    ON posts(publishMode, status, scheduledAt)
`);

module.exports = db;
