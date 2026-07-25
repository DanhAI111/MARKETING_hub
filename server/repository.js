const crypto = require('node:crypto');
const { encrypt, decrypt } = require('./crypto');

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const usePostgres = !!process.env.DATABASE_URL;

let sqliteDb = null;
let pgPool = null;

const APP_COLLECTIONS = [
  'tasks',
  'events',
  'expenses',
  'adReports',
  'employees',
  'monthlyTargets',
  'recurringExpenses'
];
const APP_SINGLETONS = ['customCategories'];

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const getSqlite = () => {
  if (!sqliteDb) sqliteDb = require('./db');
  return sqliteDb;
};

const getPool = () => {
  if (!pgPool) {
    const { Pool } = require('pg');
    const ssl = process.env.DATABASE_SSL === '0'
      ? false
      : (process.env.DATABASE_SSL === '1' || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined);
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  }
  return pgPool;
};

const pgQuery = async (sql, params = []) => {
  const result = await getPool().query(sql, params);
  return result.rows;
};

const initPostgres = async () => {
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS meta_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      "accessTokenEncrypted" TEXT NOT NULL,
      "tokenExpiresAt" TEXT,
      scopes TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fanpages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      link TEXT,
      "imageUrl" TEXT,
      "metaPageId" TEXT,
      "instagramBusinessId" TEXT,
      "pageAccessTokenEncrypted" TEXT,
      connected BOOLEAN NOT NULL DEFAULT FALSE,
      "lastSyncedAt" TEXT,
      "syncStatus" TEXT,
      "syncError" TEXT,
      kpis TEXT,
      "deletedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_fanpages_instagram
      ON fanpages("instagramBusinessId")
      WHERE "instagramBusinessId" IS NOT NULL;

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      "fanpageId" TEXT NOT NULL REFERENCES fanpages(id) ON DELETE CASCADE,
      "externalPostId" TEXT,
      title TEXT NOT NULL,
      content TEXT,
      date TEXT NOT NULL,
      "scheduledAt" TEXT,
      "publishedAt" TEXT,
      permalink TEXT,
      "mediaUrl" TEXT,
      "mediaItems" TEXT,
      "publishError" TEXT,
      "sheetUrl" TEXT,
      "sheetRowKey" TEXT,
      "sheetDefaultFanpageId" TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'published',
      "deletedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external
      ON posts(source, "externalPostId")
      WHERE "externalPostId" IS NOT NULL;

    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "sheetUrl" TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "sheetRowKey" TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "sheetDefaultFanpageId" TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "deletedAt" TEXT;
    ALTER TABLE fanpages ADD COLUMN IF NOT EXISTS "deletedAt" TEXT;
    ALTER TABLE fanpages ADD COLUMN IF NOT EXISTS "crossPostInstagram" BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_sheet_row
      ON posts("sheetUrl", "sheetRowKey")
      WHERE "sheetUrl" IS NOT NULL AND "sheetRowKey" IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      "updatedAt" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_items (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      "deletedAt" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );

    ALTER TABLE app_items ADD COLUMN IF NOT EXISTS "deletedAt" TEXT;

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      "windowStart" INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      "actorEmail" TEXT,
      action TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      changes TEXT,
      "createdAt" TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_entity
      ON audit_log("entityType", "entityId", "createdAt");
  `);
};

const init = async () => {
  if (usePostgres) {
    await initPostgres();
    return;
  }
  getSqlite();
};

const fanpageFromRow = (row, { includeToken = false } = {}) => {
  if (!row) return null;
  const fanpage = {
    id: row.id,
    platform: row.platform,
    name: row.name,
    link: row.link || '',
    imageUrl: row.imageUrl || '',
    metaPageId: row.metaPageId || '',
    instagramBusinessId: row.instagramBusinessId || '',
    connected: !!row.connected,
    crossPostInstagram: !!row.crossPostInstagram,
    lastSyncedAt: row.lastSyncedAt || '',
    syncStatus: row.syncStatus || '',
    syncError: row.syncError || '',
    kpis: parseJson(row.kpis, {}),
    deletedAt: row.deletedAt || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
  if (includeToken) fanpage.pageAccessTokenEncrypted = row.pageAccessTokenEncrypted || '';
  return fanpage;
};

const postFromRow = (row) => row && ({
  id: row.id,
  fanpageId: row.fanpageId,
  externalPostId: row.externalPostId || '',
  title: row.title,
  content: row.content || '',
  date: row.date,
  scheduledAt: row.scheduledAt || '',
  publishedAt: row.publishedAt || '',
  permalink: row.permalink || '',
  mediaUrl: row.mediaUrl || '',
  mediaItems: parseJson(row.mediaItems, []),
  publishError: row.publishError || '',
  sheetUrl: row.sheetUrl || '',
  sheetRowKey: row.sheetRowKey || '',
  sheetDefaultFanpageId: row.sheetDefaultFanpageId || '',
  source: row.source,
  status: row.status,
  deletedAt: row.deletedAt || '',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const appItemFromRow = (row) => row && parseJson(row.data, null);

const assertAppCollection = (collection) => {
  if (!APP_COLLECTIONS.includes(collection)) {
    const err = new Error(`Unsupported collection: ${collection}`);
    err.status = 404;
    throw err;
  }
};

const assertAppSingleton = (key) => {
  if (!APP_SINGLETONS.includes(key)) {
    const err = new Error(`Unsupported singleton: ${key}`);
    err.status = 404;
    throw err;
  }
};

const listFanpages = async () => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM fanpages WHERE "deletedAt" IS NULL OR "deletedAt" = \'\' ORDER BY LOWER(name)');
    return rows.map((row) => fanpageFromRow(row));
  }
  return getSqlite().prepare('SELECT * FROM fanpages WHERE deletedAt IS NULL OR deletedAt = \'\' ORDER BY name COLLATE NOCASE').all().map((row) => fanpageFromRow(row));
};

const listPosts = async ({ month = '', pending = false, limit = 500, offset = 0 } = {}) => {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const normalizedOffset = Math.max(Number(offset) || 0, 0);
  const monthPrefix = String(month || '').trim();
  // Publishing queue: all not-yet-published posts across every month.
  if (pending) {
    if (usePostgres) {
      const rows = await pgQuery(`
        SELECT * FROM posts
        WHERE ("deletedAt" IS NULL OR "deletedAt" = '')
          AND status != 'published'
        ORDER BY "scheduledAt" ASC, "updatedAt" DESC
        LIMIT $1 OFFSET $2
      `, [normalizedLimit, normalizedOffset]);
      return rows.map(postFromRow);
    }
    return getSqlite().prepare(`
      SELECT * FROM posts
      WHERE (deletedAt IS NULL OR deletedAt = '')
        AND status != 'published'
      ORDER BY scheduledAt ASC, updatedAt DESC
      LIMIT ? OFFSET ?
    `).all(normalizedLimit, normalizedOffset).map(postFromRow);
  }
  if (usePostgres) {
    const rows = monthPrefix
      ? await pgQuery(`
        SELECT * FROM posts
        WHERE ("deletedAt" IS NULL OR "deletedAt" = '')
          AND (date LIKE $1 OR "scheduledAt" LIKE $2)
        ORDER BY date DESC, "updatedAt" DESC
        LIMIT $3 OFFSET $4
      `, [`${monthPrefix}%`, `${monthPrefix}%`, normalizedLimit, normalizedOffset])
      : await pgQuery('SELECT * FROM posts WHERE "deletedAt" IS NULL OR "deletedAt" = \'\' ORDER BY date DESC, "updatedAt" DESC LIMIT $1 OFFSET $2', [normalizedLimit, normalizedOffset]);
    return rows.map(postFromRow);
  }
  return monthPrefix
    ? getSqlite().prepare(`
      SELECT * FROM posts
      WHERE (deletedAt IS NULL OR deletedAt = '')
        AND (date LIKE ? OR scheduledAt LIKE ?)
      ORDER BY date DESC, updatedAt DESC
      LIMIT ? OFFSET ?
    `).all(`${monthPrefix}%`, `${monthPrefix}%`, normalizedLimit, normalizedOffset).map(postFromRow)
    : getSqlite().prepare('SELECT * FROM posts WHERE deletedAt IS NULL OR deletedAt = \'\' ORDER BY date DESC, updatedAt DESC LIMIT ? OFFSET ?')
      .all(normalizedLimit, normalizedOffset).map(postFromRow);
};

const listSheetSyncPosts = async () => {
  if (usePostgres) {
    const rows = await pgQuery(`
      SELECT * FROM posts
      WHERE "deletedAt" IS NULL OR "deletedAt" = '' OR ("sheetUrl" IS NOT NULL AND "sheetUrl" != '')
      ORDER BY date DESC, "updatedAt" DESC
    `);
    return rows.map(postFromRow);
  }
  return getSqlite().prepare(`
    SELECT * FROM posts
    WHERE deletedAt IS NULL OR deletedAt = '' OR (sheetUrl IS NOT NULL AND sheetUrl != '')
    ORDER BY date DESC, updatedAt DESC
  `).all().map(postFromRow);
};

const listDueScheduledPosts = async () => {
  if (usePostgres) {
    const rows = await pgQuery(`
      SELECT * FROM posts
      WHERE status = 'scheduled'
        AND ("deletedAt" IS NULL OR "deletedAt" = '')
        AND "scheduledAt" IS NOT NULL
        AND "scheduledAt" != ''
        AND "scheduledAt" <= $1
      ORDER BY "scheduledAt" ASC
    `, [now()]);
    return rows.map(postFromRow);
  }
  return getSqlite().prepare(`
    SELECT * FROM posts
    WHERE status = 'scheduled'
      AND (deletedAt IS NULL OR deletedAt = '')
      AND scheduledAt IS NOT NULL
      AND scheduledAt != ''
      AND scheduledAt <= ?
    ORDER BY scheduledAt ASC
  `).all(now()).map(postFromRow);
};

const getPost = async (postId) => {
  const row = usePostgres
    ? (await pgQuery('SELECT * FROM posts WHERE id = $1', [postId]))[0]
    : getSqlite().prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  return postFromRow(row);
};

const claimDueScheduledPosts = async (limit = 10) => {
  const timestamp = now();
  if (usePostgres) {
    const rows = await pgQuery(`
      WITH due_posts AS (
        SELECT id FROM posts
        WHERE status = 'scheduled'
          AND ("deletedAt" IS NULL OR "deletedAt" = '')
          AND "scheduledAt" IS NOT NULL
          AND "scheduledAt" != ''
          AND "scheduledAt" <= $1
        ORDER BY "scheduledAt" ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE posts
      SET status = 'publishing',
          "publishError" = '',
          "updatedAt" = $1
      WHERE id IN (SELECT id FROM due_posts)
      RETURNING *
    `, [timestamp, limit]);
    return rows.map(postFromRow);
  }
  return getSqlite().prepare(`
    UPDATE posts
    SET status = 'publishing',
        publishError = '',
        updatedAt = ?
    WHERE id IN (
      SELECT id FROM posts
      WHERE status = 'scheduled'
        AND (deletedAt IS NULL OR deletedAt = '')
        AND scheduledAt IS NOT NULL
        AND scheduledAt != ''
        AND scheduledAt <= ?
      ORDER BY scheduledAt ASC
      LIMIT ?
    )
    RETURNING *
  `).all(timestamp, timestamp, limit).map(postFromRow);
};

const getFanpage = async (fanpageId) => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM fanpages WHERE id = $1', [fanpageId]);
    return fanpageFromRow(rows[0], { includeToken: true });
  }
  return fanpageFromRow(getSqlite().prepare('SELECT * FROM fanpages WHERE id = ?').get(fanpageId), { includeToken: true });
};

// Instagram fanpage sharing this Facebook page (same metaPageId), for cross-posting.
const getInstagramSiblingFanpage = async (metaPageId) => {
  if (!metaPageId) return null;
  if (usePostgres) {
    const rows = await pgQuery(
      'SELECT * FROM fanpages WHERE "metaPageId" = $1 AND platform = $2 AND ("deletedAt" IS NULL OR "deletedAt" = \'\') LIMIT 1',
      [metaPageId, 'instagram']
    );
    return fanpageFromRow(rows[0], { includeToken: true });
  }
  return fanpageFromRow(
    getSqlite()
      .prepare('SELECT * FROM fanpages WHERE metaPageId = ? AND platform = ? AND (deletedAt IS NULL OR deletedAt = \'\') LIMIT 1')
      .get(metaPageId, 'instagram'),
    { includeToken: true }
  );
};

const getConnectedFanpages = async () => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM fanpages WHERE connected = TRUE AND ("deletedAt" IS NULL OR "deletedAt" = \'\')');
    return rows.map((row) => fanpageFromRow(row, { includeToken: true }));
  }
  return getSqlite()
    .prepare('SELECT * FROM fanpages WHERE connected = 1 AND (deletedAt IS NULL OR deletedAt = \'\')')
    .all()
    .map((row) => fanpageFromRow(row, { includeToken: true }));
};

const listAppItems = async (collection) => {
  assertAppCollection(collection);
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM app_items WHERE collection = $1 AND ("deletedAt" IS NULL OR "deletedAt" = \'\') ORDER BY "updatedAt" DESC', [collection]);
    return rows.map(appItemFromRow).filter(Boolean);
  }
  return getSqlite().prepare('SELECT * FROM app_items WHERE collection = ? AND (deletedAt IS NULL OR deletedAt = \'\') ORDER BY updatedAt DESC')
    .all(collection)
    .map(appItemFromRow)
    .filter(Boolean);
};

const getAppItem = async (collection, itemId) => {
  assertAppCollection(collection);
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM app_items WHERE collection = $1 AND id = $2 AND ("deletedAt" IS NULL OR "deletedAt" = \'\')', [collection, itemId]);
    return appItemFromRow(rows[0]);
  }
  return appItemFromRow(getSqlite().prepare('SELECT * FROM app_items WHERE collection = ? AND id = ? AND (deletedAt IS NULL OR deletedAt = \'\')').get(collection, itemId));
};

const upsertAppItem = async (collection, item = {}) => {
  assertAppCollection(collection);
  const timestamp = now();
  const existing = item.id ? await getAppItem(collection, item.id) : null;
  const itemId = existing?.id || item.id || id();
  const data = {
    ...(existing || {}),
    ...item,
    id: itemId,
    createdAt: existing?.createdAt || item.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (usePostgres) {
    await pgQuery(`
      INSERT INTO app_items (collection, id, data, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(collection, id) DO UPDATE SET
        data = EXCLUDED.data,
        "updatedAt" = EXCLUDED."updatedAt"
    `, [collection, itemId, JSON.stringify(data), data.createdAt, data.updatedAt]);
    return getAppItem(collection, itemId);
  }

  getSqlite().prepare(`
    INSERT INTO app_items (collection, id, data, createdAt, updatedAt)
    VALUES (@collection, @id, @data, @createdAt, @updatedAt)
    ON CONFLICT(collection, id) DO UPDATE SET
      data = excluded.data,
      updatedAt = excluded.updatedAt
  `).run({
    collection,
    id: itemId,
    data: JSON.stringify(data),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  });
  return getAppItem(collection, itemId);
};

const deleteAppItem = async (collection, itemId) => {
  assertAppCollection(collection);
  const timestamp = now();
  if (usePostgres) {
    await pgQuery('UPDATE app_items SET "deletedAt" = $1, "updatedAt" = $2 WHERE collection = $3 AND id = $4', [timestamp, timestamp, collection, itemId]);
    return;
  }
  getSqlite().prepare('UPDATE app_items SET deletedAt = ?, updatedAt = ? WHERE collection = ? AND id = ?').run(timestamp, timestamp, collection, itemId);
};

const writeAuditLog = async ({ actorEmail = '', action, entityType, entityId, changes = {} }) => {
  const timestamp = now();
  const auditId = id();
  if (usePostgres) {
    await pgQuery(`
      INSERT INTO audit_log (id, "actorEmail", action, "entityType", "entityId", changes, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [auditId, actorEmail || null, action, entityType, entityId, JSON.stringify(changes || {}), timestamp]);
    return;
  }
  getSqlite().prepare(`
    INSERT INTO audit_log (id, actorEmail, action, entityType, entityId, changes, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(auditId, actorEmail || null, action, entityType, entityId, JSON.stringify(changes || {}), timestamp);
};

const saveSingleton = async (key, value) => {
  assertAppSingleton(key);
  const timestamp = now();
  if (usePostgres) {
    await pgQuery(`
      INSERT INTO sync_state (key, value, "updatedAt")
      VALUES ($1, $2, $3)
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        "updatedAt" = EXCLUDED."updatedAt"
    `, [key, JSON.stringify(value), timestamp]);
    return value;
  }
  getSqlite().prepare(`
    INSERT INTO sync_state (key, value, updatedAt)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updatedAt = excluded.updatedAt
  `).run({ key, value: JSON.stringify(value), updatedAt: timestamp });
  return value;
};

const getSingleton = async (key) => {
  assertAppSingleton(key);
  if (usePostgres) {
    const rows = await pgQuery('SELECT value FROM sync_state WHERE key = $1', [key]);
    return rows[0] ? parseJson(rows[0].value, null) : null;
  }
  const row = getSqlite().prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? parseJson(row.value, null) : null;
};

const saveState = async (key, value) => {
  const timestamp = now();
  if (usePostgres) {
    await pgQuery(`
      INSERT INTO sync_state (key, value, "updatedAt")
      VALUES ($1, $2, $3)
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        "updatedAt" = EXCLUDED."updatedAt"
    `, [key, JSON.stringify(value), timestamp]);
    return value;
  }
  getSqlite().prepare(`
    INSERT INTO sync_state (key, value, updatedAt)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updatedAt = excluded.updatedAt
  `).run({ key, value: JSON.stringify(value), updatedAt: timestamp });
  return value;
};

const getState = async (key) => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT value FROM sync_state WHERE key = $1', [key]);
    return rows[0] ? parseJson(rows[0].value, null) : null;
  }
  const row = getSqlite().prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? parseJson(row.value, null) : null;
};

const getBootstrapData = async () => ({
  fanpages: await listFanpages(),
  posts: await listPosts(),
  ...Object.fromEntries(await Promise.all(APP_COLLECTIONS.map(async (collection) => [collection, await listAppItems(collection)]))),
  customCategories: await getSingleton('customCategories')
});

const findFanpageRow = async (fanpage) => {
  if (!fanpage) return null;
  if (usePostgres) {
    if (fanpage.id) return (await pgQuery('SELECT * FROM fanpages WHERE id = $1', [fanpage.id]))[0] || null;
    if (fanpage.instagramBusinessId) {
      return (await pgQuery('SELECT * FROM fanpages WHERE "instagramBusinessId" = $1', [fanpage.instagramBusinessId]))[0] || null;
    }
    if (fanpage.metaPageId && fanpage.platform === 'facebook') {
      return (await pgQuery('SELECT * FROM fanpages WHERE "metaPageId" = $1 AND platform = $2', [fanpage.metaPageId, 'facebook']))[0] || null;
    }
    return null;
  }
  const db = getSqlite();
  return fanpage.id
    ? db.prepare('SELECT * FROM fanpages WHERE id = ?').get(fanpage.id)
    : fanpage.instagramBusinessId
      ? db.prepare('SELECT * FROM fanpages WHERE instagramBusinessId = ?').get(fanpage.instagramBusinessId)
      : fanpage.metaPageId && fanpage.platform === 'facebook'
        ? db.prepare('SELECT * FROM fanpages WHERE metaPageId = ? AND platform = ?').get(fanpage.metaPageId, 'facebook')
        : null;
};

const upsertFanpage = async (fanpage = {}) => {
  const timestamp = now();
  const existing = fanpageFromRow(await findFanpageRow(fanpage), { includeToken: true });
  const fanpageId = existing?.id || fanpage.id || id();
  const encryptedToken = fanpage.pageAccessToken
    ? encrypt(fanpage.pageAccessToken)
    : (fanpage.pageAccessTokenEncrypted || null);
  const data = {
    id: fanpageId,
    platform: fanpage.platform || existing?.platform || 'facebook',
    name: fanpage.name || existing?.name || 'Fanpage',
    link: fanpage.link || existing?.link || '',
    imageUrl: fanpage.imageUrl || existing?.imageUrl || '',
    metaPageId: fanpage.metaPageId || existing?.metaPageId || null,
    instagramBusinessId: fanpage.instagramBusinessId || existing?.instagramBusinessId || null,
    pageAccessTokenEncrypted: encryptedToken || existing?.pageAccessTokenEncrypted || null,
    connected: fanpage.connected === undefined ? !!existing?.connected : !!fanpage.connected,
    crossPostInstagram: fanpage.crossPostInstagram === undefined ? !!existing?.crossPostInstagram : !!fanpage.crossPostInstagram,
    lastSyncedAt: fanpage.lastSyncedAt || existing?.lastSyncedAt || null,
    syncStatus: fanpage.syncStatus || existing?.syncStatus || null,
    syncError: fanpage.syncError || '',
    kpis: JSON.stringify(fanpage.kpis || existing?.kpis || {}),
    createdAt: existing?.createdAt || fanpage.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (usePostgres) {
    await pgQuery(`
      INSERT INTO fanpages (
        id, platform, name, link, "imageUrl", "metaPageId", "instagramBusinessId", "pageAccessTokenEncrypted",
        connected, "lastSyncedAt", "syncStatus", "syncError", kpis, "createdAt", "updatedAt", "crossPostInstagram"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT(id) DO UPDATE SET
        platform = EXCLUDED.platform,
        name = EXCLUDED.name,
        link = EXCLUDED.link,
        "imageUrl" = EXCLUDED."imageUrl",
        "metaPageId" = COALESCE(EXCLUDED."metaPageId", fanpages."metaPageId"),
        "instagramBusinessId" = COALESCE(EXCLUDED."instagramBusinessId", fanpages."instagramBusinessId"),
        "pageAccessTokenEncrypted" = COALESCE(EXCLUDED."pageAccessTokenEncrypted", fanpages."pageAccessTokenEncrypted"),
        connected = EXCLUDED.connected,
        "lastSyncedAt" = COALESCE(EXCLUDED."lastSyncedAt", fanpages."lastSyncedAt"),
        "syncStatus" = COALESCE(EXCLUDED."syncStatus", fanpages."syncStatus"),
        "syncError" = EXCLUDED."syncError",
        kpis = EXCLUDED.kpis,
        "updatedAt" = EXCLUDED."updatedAt",
        "crossPostInstagram" = EXCLUDED."crossPostInstagram"
    `, [
      data.id, data.platform, data.name, data.link, data.imageUrl, data.metaPageId, data.instagramBusinessId,
      data.pageAccessTokenEncrypted, data.connected, data.lastSyncedAt, data.syncStatus, data.syncError,
      data.kpis, data.createdAt, data.updatedAt, data.crossPostInstagram
    ]);
    return fanpageFromRow((await pgQuery('SELECT * FROM fanpages WHERE id = $1', [fanpageId]))[0]);
  }

  getSqlite().prepare(`
    INSERT INTO fanpages (
      id, platform, name, link, imageUrl, metaPageId, instagramBusinessId, pageAccessTokenEncrypted,
      connected, lastSyncedAt, syncStatus, syncError, kpis, createdAt, updatedAt, crossPostInstagram
    ) VALUES (
      @id, @platform, @name, @link, @imageUrl, @metaPageId, @instagramBusinessId, @pageAccessTokenEncrypted,
      @connected, @lastSyncedAt, @syncStatus, @syncError, @kpis, @createdAt, @updatedAt, @crossPostInstagram
    )
    ON CONFLICT(id) DO UPDATE SET
      platform = excluded.platform,
      name = excluded.name,
      link = excluded.link,
      imageUrl = excluded.imageUrl,
      metaPageId = COALESCE(excluded.metaPageId, fanpages.metaPageId),
      instagramBusinessId = COALESCE(excluded.instagramBusinessId, fanpages.instagramBusinessId),
      pageAccessTokenEncrypted = COALESCE(excluded.pageAccessTokenEncrypted, fanpages.pageAccessTokenEncrypted),
      connected = excluded.connected,
      lastSyncedAt = COALESCE(excluded.lastSyncedAt, fanpages.lastSyncedAt),
      syncStatus = COALESCE(excluded.syncStatus, fanpages.syncStatus),
      syncError = excluded.syncError,
      kpis = excluded.kpis,
      updatedAt = excluded.updatedAt,
      crossPostInstagram = excluded.crossPostInstagram
  `).run({ ...data, connected: data.connected ? 1 : 0, crossPostInstagram: data.crossPostInstagram ? 1 : 0 });
  return fanpageFromRow(getSqlite().prepare('SELECT * FROM fanpages WHERE id = ?').get(fanpageId));
};

const deleteFanpage = async (fanpageId) => {
  const reports = await listAppItems('adReports');
  await Promise.all(reports
    .filter((report) => report.fanpageId === fanpageId)
    .map((report) => deleteAppItem('adReports', report.id)));
  const timestamp = now();
  if (usePostgres) {
    await pgQuery('UPDATE fanpages SET "deletedAt" = $1, "updatedAt" = $2 WHERE id = $3', [timestamp, timestamp, fanpageId]);
    await pgQuery('UPDATE posts SET "deletedAt" = $1, "updatedAt" = $2 WHERE "fanpageId" = $3', [timestamp, timestamp, fanpageId]);
    return;
  }
  getSqlite().prepare('UPDATE fanpages SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(timestamp, timestamp, fanpageId);
  getSqlite().prepare('UPDATE posts SET deletedAt = ?, updatedAt = ? WHERE fanpageId = ?').run(timestamp, timestamp, fanpageId);
};

const findPostRow = async (post) => {
  if (!post) return null;
  const hasSheetKey = post.sheetUrl && post.sheetRowKey;
  const isMetaSource = ['facebook', 'instagram'].includes(post.source);
  if (usePostgres) {
    if (hasSheetKey) {
      const row = (await pgQuery('SELECT * FROM posts WHERE "sheetUrl" = $1 AND "sheetRowKey" = $2', [post.sheetUrl, post.sheetRowKey]))[0] || null;
      if (row) return row;
    }
    if (post.id) {
      const row = (await pgQuery('SELECT * FROM posts WHERE id = $1', [post.id]))[0] || null;
      if (row) return row;
    }
    if (post.externalPostId) {
      const row = (await pgQuery('SELECT * FROM posts WHERE source = $1 AND "externalPostId" = $2', [post.source || 'manual', post.externalPostId]))[0] || null;
      if (row) return row;
      if (isMetaSource && post.fanpageId) {
        const identityRow = (await pgQuery(`
          SELECT * FROM posts
          WHERE "externalPostId" = $1
            AND "fanpageId" = $2
            AND ("deletedAt" IS NULL OR "deletedAt" = '')
          ORDER BY
            CASE WHEN "sheetUrl" IS NOT NULL AND "sheetUrl" != '' THEN 0 ELSE 1 END,
            "updatedAt" ASC
          LIMIT 1
        `, [post.externalPostId, post.fanpageId]))[0] || null;
        if (identityRow) return identityRow;
      }
    }
    return null;
  }
  const db = getSqlite();
  if (hasSheetKey) {
    const row = db.prepare('SELECT * FROM posts WHERE sheetUrl = ? AND sheetRowKey = ?').get(post.sheetUrl, post.sheetRowKey);
    if (row) return row;
  }
  if (post.id) {
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
    if (row) return row;
  }
  if (post.externalPostId) {
    const row = db.prepare('SELECT * FROM posts WHERE source = ? AND externalPostId = ?').get(post.source || 'manual', post.externalPostId);
    if (row) return row;
    if (isMetaSource && post.fanpageId) {
      const identityRow = db.prepare(`
        SELECT * FROM posts
        WHERE externalPostId = ?
          AND fanpageId = ?
          AND (deletedAt IS NULL OR deletedAt = '')
        ORDER BY
          CASE WHEN sheetUrl IS NOT NULL AND sheetUrl != '' THEN 0 ELSE 1 END,
          updatedAt ASC
        LIMIT 1
      `).get(post.externalPostId, post.fanpageId);
      if (identityRow) return identityRow;
    }
  }
  return null;
};

const pruneDuplicatePublishedPosts = async (post) => {
  if (!post?.id || !post.externalPostId || !post.fanpageId || post.status !== 'published') return post;
  if (!['facebook', 'instagram'].includes(post.source)) return post;
  const timestamp = now();
  if (usePostgres) {
    const duplicates = await pgQuery(`
      SELECT * FROM posts
      WHERE id != $1
        AND "fanpageId" = $2
        AND "externalPostId" = $3
        AND ("deletedAt" IS NULL OR "deletedAt" = '')
    `, [post.id, post.fanpageId, post.externalPostId]);
    if (!duplicates.length) return post;
    const sheetSource = duplicates.find((row) => row.sheetUrl || row.sheetRowKey || row.sheetDefaultFanpageId);
    await pgQuery(`
      UPDATE posts
      SET "deletedAt" = $1,
          "updatedAt" = $1,
          "sheetUrl" = NULL,
          "sheetRowKey" = NULL,
          "sheetDefaultFanpageId" = NULL
      WHERE id != $2
        AND "fanpageId" = $3
        AND "externalPostId" = $4
        AND ("deletedAt" IS NULL OR "deletedAt" = '')
    `, [timestamp, post.id, post.fanpageId, post.externalPostId]);
    if (sheetSource && (!post.sheetUrl || !post.sheetRowKey)) {
      await pgQuery(`
        UPDATE posts
        SET "sheetUrl" = COALESCE(NULLIF("sheetUrl", ''), $1),
            "sheetRowKey" = COALESCE(NULLIF("sheetRowKey", ''), $2),
            "sheetDefaultFanpageId" = COALESCE(NULLIF("sheetDefaultFanpageId", ''), $3),
            "updatedAt" = $4
        WHERE id = $5
      `, [sheetSource.sheetUrl || null, sheetSource.sheetRowKey || null, sheetSource.sheetDefaultFanpageId || null, timestamp, post.id]);
    }
    return getPost(post.id);
  }

  const db = getSqlite();
  const duplicates = db.prepare(`
    SELECT * FROM posts
    WHERE id != ?
      AND fanpageId = ?
      AND externalPostId = ?
      AND (deletedAt IS NULL OR deletedAt = '')
  `).all(post.id, post.fanpageId, post.externalPostId);
  if (!duplicates.length) return post;
  const sheetSource = duplicates.find((row) => row.sheetUrl || row.sheetRowKey || row.sheetDefaultFanpageId);
  db.prepare(`
    UPDATE posts
    SET deletedAt = ?,
        updatedAt = ?,
        sheetUrl = NULL,
        sheetRowKey = NULL,
        sheetDefaultFanpageId = NULL
    WHERE id != ?
      AND fanpageId = ?
      AND externalPostId = ?
      AND (deletedAt IS NULL OR deletedAt = '')
  `).run(timestamp, timestamp, post.id, post.fanpageId, post.externalPostId);
  if (sheetSource && (!post.sheetUrl || !post.sheetRowKey)) {
    db.prepare(`
      UPDATE posts
      SET sheetUrl = COALESCE(NULLIF(sheetUrl, ''), ?),
          sheetRowKey = COALESCE(NULLIF(sheetRowKey, ''), ?),
          sheetDefaultFanpageId = COALESCE(NULLIF(sheetDefaultFanpageId, ''), ?),
          updatedAt = ?
      WHERE id = ?
    `).run(sheetSource.sheetUrl || null, sheetSource.sheetRowKey || null, sheetSource.sheetDefaultFanpageId || null, timestamp, post.id);
  }
  return getPost(post.id);
};

const upsertPost = async (post = {}) => {
  const timestamp = now();
  const existing = postFromRow(await findPostRow(post));
  const postId = existing?.id || post.id || id();
  const data = {
    id: postId,
    fanpageId: post.fanpageId || existing?.fanpageId,
    externalPostId: post.externalPostId || existing?.externalPostId || null,
    title: post.title || existing?.title || 'Bài đăng',
    content: post.content !== undefined ? post.content : (existing?.content || ''),
    date: post.date || existing?.date,
    scheduledAt: post.scheduledAt !== undefined ? post.scheduledAt : (existing?.scheduledAt || null),
    publishedAt: post.publishedAt !== undefined ? post.publishedAt : (existing?.publishedAt || null),
    permalink: post.permalink || existing?.permalink || '',
    mediaUrl: post.mediaUrl || existing?.mediaUrl || '',
    mediaItems: JSON.stringify(post.mediaItems !== undefined ? post.mediaItems : (existing?.mediaItems || [])),
    publishError: post.publishError !== undefined ? post.publishError : (existing?.publishError || ''),
    sheetUrl: post.sheetUrl !== undefined ? post.sheetUrl : (existing?.sheetUrl || null),
    sheetRowKey: post.sheetRowKey !== undefined ? post.sheetRowKey : (existing?.sheetRowKey || null),
    sheetDefaultFanpageId: post.sheetDefaultFanpageId !== undefined
      ? post.sheetDefaultFanpageId
      : (existing?.sheetDefaultFanpageId || null),
    source: post.source || existing?.source || 'manual',
    status: post.status || existing?.status || 'published',
    deletedAt: post.deletedAt !== undefined
      ? post.deletedAt
      : ((post.sheetUrl && post.sheetRowKey) || (post.externalPostId && ['facebook', 'instagram'].includes(post.source))
        ? null
        : (existing?.deletedAt || null)),
    createdAt: existing?.createdAt || post.createdAt || timestamp,
    updatedAt: timestamp
  };

  // Match worker/repository.js: reject early with 400 instead of letting a NULL
  // hit the NOT NULL column and surface as an opaque 500.
  if (!data.fanpageId || !data.date) {
    const error = new Error('fanpageId and date are required for posts.');
    error.status = 400;
    throw error;
  }

  if (usePostgres) {
    await pgQuery(`
      INSERT INTO posts (
        id, "fanpageId", "externalPostId", title, content, date, "scheduledAt", "publishedAt", permalink, "mediaUrl",
        "mediaItems", "publishError", "sheetUrl", "sheetRowKey", "sheetDefaultFanpageId", source, status, "deletedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT(id) DO UPDATE SET
        "fanpageId" = EXCLUDED."fanpageId",
        "externalPostId" = EXCLUDED."externalPostId",
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        date = EXCLUDED.date,
        "scheduledAt" = EXCLUDED."scheduledAt",
        "publishedAt" = EXCLUDED."publishedAt",
        permalink = EXCLUDED.permalink,
        "mediaUrl" = EXCLUDED."mediaUrl",
        "mediaItems" = EXCLUDED."mediaItems",
        "publishError" = EXCLUDED."publishError",
        "sheetUrl" = EXCLUDED."sheetUrl",
        "sheetRowKey" = EXCLUDED."sheetRowKey",
        "sheetDefaultFanpageId" = EXCLUDED."sheetDefaultFanpageId",
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        "deletedAt" = EXCLUDED."deletedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `, [
      data.id, data.fanpageId, data.externalPostId, data.title, data.content, data.date, data.scheduledAt,
      data.publishedAt, data.permalink, data.mediaUrl, data.mediaItems, data.publishError,
      data.sheetUrl, data.sheetRowKey, data.sheetDefaultFanpageId, data.source,
      data.status, data.deletedAt, data.createdAt, data.updatedAt
    ]);
    return pruneDuplicatePublishedPosts(postFromRow((await pgQuery('SELECT * FROM posts WHERE id = $1', [postId]))[0]));
  }

  getSqlite().prepare(`
    INSERT INTO posts (
      id, fanpageId, externalPostId, title, content, date, scheduledAt, publishedAt, permalink, mediaUrl,
      mediaItems, publishError, sheetUrl, sheetRowKey, sheetDefaultFanpageId, source, status, deletedAt, createdAt, updatedAt
    ) VALUES (
      @id, @fanpageId, @externalPostId, @title, @content, @date, @scheduledAt, @publishedAt, @permalink, @mediaUrl,
      @mediaItems, @publishError, @sheetUrl, @sheetRowKey, @sheetDefaultFanpageId, @source, @status, @deletedAt, @createdAt, @updatedAt
    )
    ON CONFLICT(source, externalPostId) WHERE externalPostId IS NOT NULL DO UPDATE SET
      fanpageId = excluded.fanpageId,
      title = excluded.title,
      content = excluded.content,
      date = excluded.date,
      scheduledAt = excluded.scheduledAt,
      publishedAt = excluded.publishedAt,
      permalink = excluded.permalink,
      mediaUrl = excluded.mediaUrl,
      mediaItems = excluded.mediaItems,
      publishError = excluded.publishError,
      sheetUrl = excluded.sheetUrl,
      sheetRowKey = excluded.sheetRowKey,
      sheetDefaultFanpageId = excluded.sheetDefaultFanpageId,
      status = excluded.status,
      deletedAt = excluded.deletedAt,
      updatedAt = excluded.updatedAt
    ON CONFLICT(id) DO UPDATE SET
      fanpageId = excluded.fanpageId,
      externalPostId = excluded.externalPostId,
      title = excluded.title,
      content = excluded.content,
      date = excluded.date,
      scheduledAt = excluded.scheduledAt,
      publishedAt = excluded.publishedAt,
      permalink = excluded.permalink,
      mediaUrl = excluded.mediaUrl,
      mediaItems = excluded.mediaItems,
      publishError = excluded.publishError,
      sheetUrl = excluded.sheetUrl,
      sheetRowKey = excluded.sheetRowKey,
      sheetDefaultFanpageId = excluded.sheetDefaultFanpageId,
      source = excluded.source,
      status = excluded.status,
      deletedAt = excluded.deletedAt,
      updatedAt = excluded.updatedAt
  `).run(data);
  return pruneDuplicatePublishedPosts(postFromRow(getSqlite().prepare('SELECT * FROM posts WHERE id = ?').get(postId)));
};

const markMissingSyncedPostsDeleted = async ({ fanpageId, source, externalPostIds = [], sinceDate = '' }) => {
  const timestamp = now();
  const ids = [...new Set((externalPostIds || []).filter(Boolean))];
  // Guard: empty id set means the sync batch returned nothing (transient Meta
  // hiccup). Without an id list the NOT IN clause is dropped and every published
  // post would be soft-deleted. Never prune on an empty batch.
  if (ids.length === 0) return 0;
  if (usePostgres) {
    const params = [timestamp, fanpageId, source];
    const clauses = [
      '"fanpageId" = $2',
      'source = $3',
      '"externalPostId" IS NOT NULL',
      '("deletedAt" IS NULL OR "deletedAt" = \'\')',
      'status = \'published\''
    ];
    if (sinceDate) {
      params.push(sinceDate);
      clauses.push(`date >= $${params.length}`);
    }
    if (ids.length) {
      const placeholders = ids.map((value) => {
        params.push(value);
        return `$${params.length}`;
      }).join(', ');
      clauses.push(`"externalPostId" NOT IN (${placeholders})`);
    }
    const rows = await pgQuery(`
      UPDATE posts
      SET "deletedAt" = $1, "updatedAt" = $1
      WHERE ${clauses.join(' AND ')}
      RETURNING id
    `, params);
    return rows.length;
  }

  const params = [timestamp, fanpageId, source];
  const clauses = [
    'fanpageId = ?',
    'source = ?',
    'externalPostId IS NOT NULL',
    '(deletedAt IS NULL OR deletedAt = \'\')',
    "status = 'published'"
  ];
  if (sinceDate) {
    clauses.push('date >= ?');
    params.push(sinceDate);
  }
  if (ids.length) {
    clauses.push(`externalPostId NOT IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  }
  const result = getSqlite().prepare(`
    UPDATE posts
    SET deletedAt = ?, updatedAt = ?
    WHERE ${clauses.join(' AND ')}
  `).run(timestamp, ...params);
  return result.changes || 0;
};

const deletePost = async (postId) => {
  const timestamp = now();
  if (usePostgres) {
    await pgQuery('UPDATE posts SET "deletedAt" = $1, "updatedAt" = $2 WHERE id = $3', [timestamp, timestamp, postId]);
    return;
  }
  getSqlite().prepare('UPDATE posts SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(timestamp, timestamp, postId);
};

const setPostPublishState = async (postId, updates = {}) => {
  const existing = usePostgres
    ? postFromRow((await pgQuery('SELECT * FROM posts WHERE id = $1', [postId]))[0])
    : postFromRow(getSqlite().prepare('SELECT * FROM posts WHERE id = ?').get(postId));
  if (!existing) return null;
  return upsertPost({ ...existing, ...updates, id: postId });
};

const saveMetaAccount = async ({ accessToken, accessTokenEncrypted, tokenExpiresAt, scopes }) => {
  const timestamp = now();
  const encrypted = accessTokenEncrypted || encrypt(accessToken);
  if (usePostgres) {
    await pgQuery(`
      INSERT INTO meta_accounts (id, provider, "accessTokenEncrypted", "tokenExpiresAt", scopes, "createdAt", "updatedAt")
      VALUES ('meta', 'meta', $1, $2, $3, $4, $5)
      ON CONFLICT(id) DO UPDATE SET
        "accessTokenEncrypted" = EXCLUDED."accessTokenEncrypted",
        "tokenExpiresAt" = EXCLUDED."tokenExpiresAt",
        scopes = EXCLUDED.scopes,
        "updatedAt" = EXCLUDED."updatedAt"
    `, [encrypted, tokenExpiresAt || null, scopes || '', timestamp, timestamp]);
    return;
  }
  getSqlite().prepare(`
    INSERT INTO meta_accounts (id, provider, accessTokenEncrypted, tokenExpiresAt, scopes, createdAt, updatedAt)
    VALUES ('meta', 'meta', @accessTokenEncrypted, @tokenExpiresAt, @scopes, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      accessTokenEncrypted = excluded.accessTokenEncrypted,
      tokenExpiresAt = excluded.tokenExpiresAt,
      scopes = excluded.scopes,
      updatedAt = excluded.updatedAt
  `).run({
    accessTokenEncrypted: encrypted,
    tokenExpiresAt: tokenExpiresAt || null,
    scopes: scopes || '',
    createdAt: timestamp,
    updatedAt: timestamp
  });
};

const getMetaAccount = async () => {
  const row = usePostgres
    ? (await pgQuery('SELECT * FROM meta_accounts WHERE id = $1', ['meta']))[0]
    : getSqlite().prepare('SELECT * FROM meta_accounts WHERE id = ?').get('meta');
  if (!row) return null;
  return {
    ...row,
    accessToken: decrypt(row.accessTokenEncrypted)
  };
};

const decryptPageToken = (row) => decrypt(row?.pageAccessTokenEncrypted || '');

const setFanpageSyncStatus = async (fanpageId, status, error = '') => {
  const timestamp = now();
  if (usePostgres) {
    await pgQuery(`
      UPDATE fanpages
      SET "syncStatus" = $1, "syncError" = $2, "lastSyncedAt" = $3, "updatedAt" = $4
      WHERE id = $5
    `, [status, error, timestamp, timestamp, fanpageId]);
    return;
  }
  getSqlite().prepare('UPDATE fanpages SET syncStatus = ?, syncError = ?, lastSyncedAt = ?, updatedAt = ? WHERE id = ?')
    .run(status, error, timestamp, timestamp, fanpageId);
};

const importLocalData = async (payload = {}) => {
  for (const fp of payload.fanpages || []) {
    await upsertFanpage({ ...fp, connected: fp.connected || false });
  }
  for (const post of payload.posts || []) {
    if (post.fanpageId && post.date && post.title) {
      await upsertPost({ ...post, source: post.source || 'manual' });
    }
  }
  for (const collection of APP_COLLECTIONS) {
    for (const item of payload[collection] || []) {
      await upsertAppItem(collection, item);
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'customCategories')) {
    await saveSingleton('customCategories', payload.customCategories);
  }
  return getBootstrapData();
};

const close = async () => {
  if (pgPool) await pgPool.end();
};

module.exports = {
  APP_COLLECTIONS,
  init,
  close,
  listFanpages,
  listPosts,
  listSheetSyncPosts,
  listDueScheduledPosts,
  getPost,
  claimDueScheduledPosts,
  getFanpage,
  getInstagramSiblingFanpage,
  getConnectedFanpages,
  getBootstrapData,
  listAppItems,
  getAppItem,
  upsertAppItem,
  deleteAppItem,
  writeAuditLog,
  getSingleton,
  saveSingleton,
  getState,
  saveState,
  upsertFanpage,
  deleteFanpage,
  upsertPost,
  markMissingSyncedPostsDeleted,
  deletePost,
  setPostPublishState,
  saveMetaAccount,
  getMetaAccount,
  decryptPageToken,
  setFanpageSyncStatus,
  importLocalData
};
