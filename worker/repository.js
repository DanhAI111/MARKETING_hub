import { decrypt, encrypt } from './crypto.js';

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

const now = () => new Date().toISOString();
const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
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

export class Repository {
  constructor(env) {
    this.db = env.DB;
    this.tokenSecret = env.TOKEN_ENCRYPTION_KEY || 'dev-only-marketing-hub-token-key';
  }

  assertCollection(collection) {
    if (!APP_COLLECTIONS.includes(collection)) {
      const error = new Error(`Unsupported collection: ${collection}`);
      error.status = 404;
      throw error;
    }
  }

  assertSingleton(key) {
    if (!APP_SINGLETONS.includes(key)) {
      const error = new Error(`Unsupported singleton: ${key}`);
      error.status = 404;
      throw error;
    }
  }

  async listFanpages() {
    const { results } = await this.db.prepare('SELECT * FROM fanpages ORDER BY name COLLATE NOCASE').all();
    return results.map((row) => fanpageFromRow(row));
  }

  async listPosts() {
    const { results } = await this.db.prepare('SELECT * FROM posts ORDER BY date DESC, updatedAt DESC').all();
    return results.map(postFromRow);
  }

  async listDueScheduledPosts() {
    const { results } = await this.db.prepare(`
      SELECT * FROM posts
      WHERE status = 'scheduled'
        AND scheduledAt IS NOT NULL
        AND scheduledAt != ''
        AND scheduledAt <= ?
      ORDER BY scheduledAt ASC
      LIMIT 10
    `).bind(now()).all();
    return results.map(postFromRow);
  }

  async getFanpage(fanpageId) {
    return fanpageFromRow(
      await this.db.prepare('SELECT * FROM fanpages WHERE id = ?').bind(fanpageId).first(),
      { includeToken: true }
    );
  }

  async getConnectedFanpages() {
    const { results } = await this.db.prepare('SELECT * FROM fanpages WHERE connected = 1').all();
    return results.map((row) => fanpageFromRow(row, { includeToken: true }));
  }

  async listAppItems(collection) {
    this.assertCollection(collection);
    const { results } = await this.db.prepare(
      'SELECT * FROM app_items WHERE collection = ? ORDER BY updatedAt DESC'
    ).bind(collection).all();
    return results.map(appItemFromRow).filter(Boolean);
  }

  async getAppItem(collection, itemId) {
    this.assertCollection(collection);
    return appItemFromRow(await this.db.prepare(
      'SELECT * FROM app_items WHERE collection = ? AND id = ?'
    ).bind(collection, itemId).first());
  }

  async upsertAppItem(collection, item = {}) {
    this.assertCollection(collection);
    const timestamp = now();
    const existing = item.id ? await this.getAppItem(collection, item.id) : null;
    const itemId = existing?.id || item.id || crypto.randomUUID();
    const data = {
      ...(existing || {}),
      ...item,
      id: itemId,
      createdAt: existing?.createdAt || item.createdAt || timestamp,
      updatedAt: timestamp
    };
    await this.db.prepare(`
      INSERT INTO app_items (collection, id, data, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        data = excluded.data,
        updatedAt = excluded.updatedAt
    `).bind(collection, itemId, JSON.stringify(data), data.createdAt, data.updatedAt).run();
    return this.getAppItem(collection, itemId);
  }

  async deleteAppItem(collection, itemId) {
    this.assertCollection(collection);
    await this.db.prepare('DELETE FROM app_items WHERE collection = ? AND id = ?')
      .bind(collection, itemId).run();
  }

  async saveSingleton(key, value) {
    this.assertSingleton(key);
    await this.db.prepare(`
      INSERT INTO sync_state (key, value, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = excluded.updatedAt
    `).bind(key, JSON.stringify(value), now()).run();
    return value;
  }

  async getSingleton(key) {
    this.assertSingleton(key);
    const row = await this.db.prepare('SELECT value FROM sync_state WHERE key = ?').bind(key).first();
    return row ? parseJson(row.value, null) : null;
  }

  async saveState(key, value) {
    await this.db.prepare(`
      INSERT INTO sync_state (key, value, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = excluded.updatedAt
    `).bind(key, JSON.stringify(value), now()).run();
    return value;
  }

  async getState(key) {
    const row = await this.db.prepare('SELECT value FROM sync_state WHERE key = ?').bind(key).first();
    return row ? parseJson(row.value, null) : null;
  }

  async getBootstrapData() {
    const collections = await Promise.all(
      APP_COLLECTIONS.map(async (collection) => [collection, await this.listAppItems(collection)])
    );
    return {
      fanpages: await this.listFanpages(),
      posts: await this.listPosts(),
      ...Object.fromEntries(collections),
      customCategories: await this.getSingleton('customCategories')
    };
  }

  async findFanpageRow(fanpage) {
    if (!fanpage) return null;
    if (fanpage.id) {
      return this.db.prepare('SELECT * FROM fanpages WHERE id = ?').bind(fanpage.id).first();
    }
    if (fanpage.instagramBusinessId) {
      return this.db.prepare('SELECT * FROM fanpages WHERE instagramBusinessId = ?')
        .bind(fanpage.instagramBusinessId).first();
    }
    if (fanpage.metaPageId && fanpage.platform === 'facebook') {
      return this.db.prepare('SELECT * FROM fanpages WHERE metaPageId = ? AND platform = ?')
        .bind(fanpage.metaPageId, 'facebook').first();
    }
    return null;
  }

  async upsertFanpage(fanpage = {}) {
    const timestamp = now();
    const existing = fanpageFromRow(await this.findFanpageRow(fanpage), { includeToken: true });
    const fanpageId = existing?.id || fanpage.id || crypto.randomUUID();
    const encryptedToken = fanpage.pageAccessToken
      ? await encrypt(fanpage.pageAccessToken, this.tokenSecret)
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
    await this.db.prepare(`
      INSERT INTO fanpages (
        id, platform, name, link, imageUrl, metaPageId, instagramBusinessId, pageAccessTokenEncrypted,
        connected, lastSyncedAt, syncStatus, syncError, kpis, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    `).bind(
      data.id, data.platform, data.name, data.link, data.imageUrl, data.metaPageId,
      data.instagramBusinessId, data.pageAccessTokenEncrypted, data.connected ? 1 : 0,
      data.lastSyncedAt, data.syncStatus, data.syncError, data.kpis, data.createdAt, data.updatedAt
    ).run();
    return fanpageFromRow(await this.db.prepare('SELECT * FROM fanpages WHERE id = ?').bind(fanpageId).first());
  }

  async deleteFanpage(fanpageId) {
    const reports = await this.listAppItems('adReports');
    await Promise.all(reports
      .filter((report) => report.fanpageId === fanpageId)
      .map((report) => this.deleteAppItem('adReports', report.id)));
    await this.db.prepare('DELETE FROM fanpages WHERE id = ?').bind(fanpageId).run();
  }

  async findPostRow(post) {
    if (!post) return null;
    if (post.id) return this.db.prepare('SELECT * FROM posts WHERE id = ?').bind(post.id).first();
    if (post.externalPostId) {
      return this.db.prepare('SELECT * FROM posts WHERE source = ? AND externalPostId = ?')
        .bind(post.source || 'manual', post.externalPostId).first();
    }
    return null;
  }

  async upsertPost(post = {}) {
    const timestamp = now();
    const existing = postFromRow(await this.findPostRow(post));
    const postId = existing?.id || post.id || crypto.randomUUID();
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
    if (!data.fanpageId || !data.date) {
      const error = new Error('fanpageId and date are required for posts.');
      error.status = 400;
      throw error;
    }
    await this.db.prepare(`
      INSERT INTO posts (
        id, fanpageId, externalPostId, title, content, date, scheduledAt, publishedAt, permalink, mediaUrl,
        mediaItems, publishError, sheetUrl, sheetRowKey, sheetDefaultFanpageId, source, status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    `).bind(
      data.id, data.fanpageId, data.externalPostId, data.title, data.content, data.date,
      data.scheduledAt, data.publishedAt, data.permalink, data.mediaUrl, data.mediaItems,
      data.publishError, data.sheetUrl, data.sheetRowKey, data.sheetDefaultFanpageId,
      data.source, data.status, data.createdAt, data.updatedAt
    ).run();
    return postFromRow(await this.db.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first());
  }

  async deletePost(postId) {
    await this.db.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
  }

  async setPostPublishState(postId, updates = {}) {
    const existing = postFromRow(await this.db.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first());
    if (!existing) return null;
    return this.upsertPost({ ...existing, ...updates, id: postId });
  }

  async saveMetaAccount({ accessToken, accessTokenEncrypted, tokenExpiresAt, scopes }) {
    const timestamp = now();
    const encryptedToken = accessTokenEncrypted || await encrypt(accessToken, this.tokenSecret);
    await this.db.prepare(`
      INSERT INTO meta_accounts (id, provider, accessTokenEncrypted, tokenExpiresAt, scopes, createdAt, updatedAt)
      VALUES ('meta', 'meta', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        accessTokenEncrypted = excluded.accessTokenEncrypted,
        tokenExpiresAt = excluded.tokenExpiresAt,
        scopes = excluded.scopes,
        updatedAt = excluded.updatedAt
    `).bind(encryptedToken, tokenExpiresAt || null, scopes || '', timestamp, timestamp).run();
  }

  async getMetaAccount() {
    const row = await this.db.prepare('SELECT * FROM meta_accounts WHERE id = ?').bind('meta').first();
    if (!row) return null;
    return { ...row, accessToken: await decrypt(row.accessTokenEncrypted, this.tokenSecret) };
  }

  async decryptPageToken(row) {
    return decrypt(row?.pageAccessTokenEncrypted || '', this.tokenSecret);
  }

  async setFanpageSyncStatus(fanpageId, status, error = '') {
    const timestamp = now();
    await this.db.prepare(`
      UPDATE fanpages
      SET syncStatus = ?, syncError = ?, lastSyncedAt = ?, updatedAt = ?
      WHERE id = ?
    `).bind(status, error, timestamp, timestamp, fanpageId).run();
  }

  async saveOAuthState(provider, state, payload = null, ttlSeconds = 600) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.prepare(`
      INSERT INTO oauth_states (state, provider, payload, expiresAt)
      VALUES (?, ?, ?, ?)
    `).bind(state, provider, JSON.stringify(payload), expiresAt).run();
  }

  async consumeOAuthState(provider, state) {
    if (!state) return null;
    const row = await this.db.prepare(
      'SELECT * FROM oauth_states WHERE state = ? AND provider = ? AND expiresAt > ?'
    ).bind(state, provider, now()).first();
    await this.db.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    return row ? parseJson(row.payload, {}) : null;
  }

  async cleanupOAuthStates() {
    await this.db.prepare('DELETE FROM oauth_states WHERE expiresAt <= ?').bind(now()).run();
  }

  async importLocalData(payload = {}) {
    for (const fanpage of payload.fanpages || []) {
      await this.upsertFanpage({ ...fanpage, connected: fanpage.connected || false });
    }
    for (const post of payload.posts || []) {
      if (post.fanpageId && post.date && post.title) {
        await this.upsertPost({ ...post, source: post.source || 'manual' });
      }
    }
    for (const collection of APP_COLLECTIONS) {
      for (const item of payload[collection] || []) await this.upsertAppItem(collection, item);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'customCategories')) {
      await this.saveSingleton('customCategories', payload.customCategories);
    }
    return this.getBootstrapData();
  }
}

export { APP_COLLECTIONS };
