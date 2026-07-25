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
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_external
      ON posts(source, "externalPostId")
      WHERE "externalPostId" IS NOT NULL;

    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "sheetUrl" TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "sheetRowKey" TEXT;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS "sheetDefaultFanpageId" TEXT;

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
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
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
    lastSyncedAt: row.lastSyncedAt || '',
    syncStatus: row.syncStatus || '',
    syncError: row.syncError || '',
    kpis: parseJson(row.kpis, {}),
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
    const rows = await pgQuery('SELECT * FROM fanpages ORDER BY LOWER(name)');
    return rows.map((row) => fanpageFromRow(row));
  }
  return getSqlite().prepare('SELECT * FROM fanpages ORDER BY name COLLATE NOCASE').all().map((row) => fanpageFromRow(row));
};

const listPosts = async () => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM posts ORDER BY date DESC, "updatedAt" DESC');
    return rows.map(postFromRow);
  }
  return getSqlite().prepare('SELECT * FROM posts ORDER BY date DESC, updatedAt DESC').all().map(postFromRow);
};

const listDueScheduledPosts = async () => {
  if (usePostgres) {
    const rows = await pgQuery(`
      SELECT * FROM posts
      WHERE status = 'scheduled'
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
      AND scheduledAt IS NOT NULL
      AND scheduledAt != ''
      AND scheduledAt <= ?
    ORDER BY scheduledAt ASC
  `).all(now()).map(postFromRow);
};

const getFanpage = async (fanpageId) => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM fanpages WHERE id = $1', [fanpageId]);
    return fanpageFromRow(rows[0], { includeToken: true });
  }
  return fanpageFromRow(getSqlite().prepare('SELECT * FROM fanpages WHERE id = ?').get(fanpageId), { includeToken: true });
};

const getConnectedFanpages = async () => {
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM fanpages WHERE connected = TRUE');
    return rows.map((row) => fanpageFromRow(row, { includeToken: true }));
  }
  return getSqlite()
    .prepare('SELECT * FROM fanpages WHERE connected = 1')
    .all()
    .map((row) => fanpageFromRow(row, { includeToken: true }));
};

const listAppItems = async (collection) => {
  assertAppCollection(collection);
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM app_items WHERE collection = $1 ORDER BY "updatedAt" DESC', [collection]);
    return rows.map(appItemFromRow).filter(Boolean);
  }
  return getSqlite().prepare('SELECT * FROM app_items WHERE collection = ? ORDER BY updatedAt DESC')
    .all(collection)
    .map(appItemFromRow)
    .filter(Boolean);
};

const getAppItem = async (collection, itemId) => {
  assertAppCollection(collection);
  if (usePostgres) {
    const rows = await pgQuery('SELECT * FROM app_items WHERE collection = $1 AND id = $2', [collection, itemId]);
    return appItemFromRow(rows[0]);
  }
  return appItemFromRow(getSqlite().prepare('SELECT * FROM app_items WHERE collection = ? AND id = ?').get(collection, itemId));
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
  if (usePostgres) {
    await pgQuery('DELETE FROM app_items WHERE collection = $1 AND id = $2', [collection, itemId]);
    return;
  }
  getSqlite().prepare('DELETE FROM app_items WHERE collection = ? AND id = ?').run(collection, itemId);
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
        connected, "lastSyncedAt", "syncStatus", "syncError", kpis, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15
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
        "updatedAt" = EXCLUDED."updatedAt"
    `, [
      data.id, data.platform, data.name, data.link, data.imageUrl, data.metaPageId, data.instagramBusinessId,
      data.pageAccessTokenEncrypted, data.connected, data.lastSyncedAt, data.syncStatus, data.syncError,
      data.kpis, data.createdAt, data.updatedAt
    ]);
    return fanpageFromRow((await pgQuery('SELECT * FROM fanpages WHERE id = $1', [fanpageId]))[0]);
  }

  getSqlite().prepare(`
    INSERT INTO fanpages (
      id, platform, name, link, imageUrl, metaPageId, instagramBusinessId, pageAccessTokenEncrypted,
      connected, lastSyncedAt, syncStatus, syncError, kpis, createdAt, updatedAt
    ) VALUES (
      @id, @platform, @name, @link, @imageUrl, @metaPageId, @instagramBusinessId, @pageAccessTokenEncrypted,
      @connected, @lastSyncedAt, @syncStatus, @syncError, @kpis, @createdAt, @updatedAt
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
      updatedAt = excluded.updatedAt
  `).run({ ...data, connected: data.connected ? 1 : 0 });
  return fanpageFromRow(getSqlite().prepare('SELECT * FROM fanpages WHERE id = ?').get(fanpageId));
};

const deleteFanpage = async (fanpageId) => {
  const reports = await listAppItems('adReports');
  await Promise.all(reports
    .filter((report) => report.fanpageId === fanpageId)
    .map((report) => deleteAppItem('adReports', report.id)));
  if (usePostgres) {
    await pgQuery('DELETE FROM fanpages WHERE id = $1', [fanpageId]);
    return;
  }
  getSqlite().prepare('DELETE FROM fanpages WHERE id = ?').run(fanpageId);
};

const findPostRow = async (post) => {
  if (!post) return null;
  if (usePostgres) {
    if (post.id) return (await pgQuery('SELECT * FROM posts WHERE id = $1', [post.id]))[0] || null;
    if (post.externalPostId) {
      return (await pgQuery('SELECT * FROM posts WHERE source = $1 AND "externalPostId" = $2', [post.source || 'manual', post.externalPostId]))[0] || null;
    }
    return null;
  }
  const db = getSqlite();
  return post.id
    ? db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id)
    : post.externalPostId
      ? db.prepare('SELECT * FROM posts WHERE source = ? AND externalPostId = ?').get(post.source || 'manual', post.externalPostId)
      : null;
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
    createdAt: existing?.createdAt || post.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (usePostgres) {
    await pgQuery(`
      INSERT INTO posts (
        id, "fanpageId", "externalPostId", title, content, date, "scheduledAt", "publishedAt", permalink, "mediaUrl",
        "mediaItems", "publishError", "sheetUrl", "sheetRowKey", "sheetDefaultFanpageId", source, status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19
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
        "updatedAt" = EXCLUDED."updatedAt"
    `, [
      data.id, data.fanpageId, data.externalPostId, data.title, data.content, data.date, data.scheduledAt,
      data.publishedAt, data.permalink, data.mediaUrl, data.mediaItems, data.publishError,
      data.sheetUrl, data.sheetRowKey, data.sheetDefaultFanpageId, data.source,
      data.status, data.createdAt, data.updatedAt
    ]);
    return postFromRow((await pgQuery('SELECT * FROM posts WHERE id = $1', [postId]))[0]);
  }

  getSqlite().prepare(`
    INSERT INTO posts (
      id, fanpageId, externalPostId, title, content, date, scheduledAt, publishedAt, permalink, mediaUrl,
      mediaItems, publishError, sheetUrl, sheetRowKey, sheetDefaultFanpageId, source, status, createdAt, updatedAt
    ) VALUES (
      @id, @fanpageId, @externalPostId, @title, @content, @date, @scheduledAt, @publishedAt, @permalink, @mediaUrl,
      @mediaItems, @publishError, @sheetUrl, @sheetRowKey, @sheetDefaultFanpageId, @source, @status, @createdAt, @updatedAt
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
      updatedAt = excluded.updatedAt
  `).run(data);
  return postFromRow(getSqlite().prepare('SELECT * FROM posts WHERE id = ?').get(postId));
};

const deletePost = async (postId) => {
  if (usePostgres) {
    await pgQuery('DELETE FROM posts WHERE id = $1', [postId]);
    return;
  }
  getSqlite().prepare('DELETE FROM posts WHERE id = ?').run(postId);
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
  listDueScheduledPosts,
  getFanpage,
  getConnectedFanpages,
  getBootstrapData,
  listAppItems,
  getAppItem,
  upsertAppItem,
  deleteAppItem,
  getSingleton,
  saveSingleton,
  upsertFanpage,
  deleteFanpage,
  upsertPost,
  deletePost,
  setPostPublishState,
  saveMetaAccount,
  getMetaAccount,
  decryptPageToken,
  setFanpageSyncStatus,
  importLocalData
};
