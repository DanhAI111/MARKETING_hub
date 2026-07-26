import { decrypt, encrypt } from './crypto.js';
import { readRequiredSecret } from './security.js';
import {
  APP_COLLECTIONS,
  APP_SINGLETONS,
  APPROVAL_STATUSES,
  now,
  parseJson,
  fanpageFromRow,
  postFromRow,
  appItemFromRow
} from '../shared/repository-helpers.cjs';

export class Repository {
  constructor(env) {
    this.db = env.DB;
    this.tokenSecret = readRequiredSecret(env, 'TOKEN_ENCRYPTION_KEY', 'dev-only-marketing-hub-token-key');
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
    const { results } = await this.db.prepare(`
      SELECT * FROM fanpages
      WHERE deletedAt IS NULL OR deletedAt = ''
      ORDER BY name COLLATE NOCASE
    `).all();
    return results.map((row) => fanpageFromRow(row));
  }

  async listPosts({ month = '', pending = false, limit = 500, offset = 0 } = {}) {
    const normalizedLimit = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    const normalizedOffset = Math.max(Number(offset) || 0, 0);
    // Publishing queue: every post not yet published, regardless of month, so
    // future-dated schedules are never hidden by the reporting-month filter.
    if (pending) {
      const { results } = await this.db.prepare(
        `SELECT * FROM posts
          WHERE (deletedAt IS NULL OR deletedAt = '')
            AND status != 'published'
          ORDER BY scheduledAt ASC, updatedAt DESC
          LIMIT ? OFFSET ?`
      ).bind(normalizedLimit, normalizedOffset).all();
      return results.map(postFromRow);
    }
    const monthPrefix = String(month || '').trim();
    const sql = monthPrefix
      ? `SELECT * FROM posts
          WHERE (deletedAt IS NULL OR deletedAt = '')
            AND (date LIKE ? OR scheduledAt LIKE ?)
          ORDER BY date DESC, updatedAt DESC
          LIMIT ? OFFSET ?`
      : `SELECT * FROM posts
          WHERE deletedAt IS NULL OR deletedAt = ''
          ORDER BY date DESC, updatedAt DESC
          LIMIT ? OFFSET ?`;
    const statement = this.db.prepare(sql);
    const { results } = monthPrefix
      ? await statement.bind(`${monthPrefix}%`, `${monthPrefix}%`, normalizedLimit, normalizedOffset).all()
      : await statement.bind(normalizedLimit, normalizedOffset).all();
    return results.map(postFromRow);
  }

  async listSheetSyncPosts() {
    const { results } = await this.db.prepare(`
      SELECT * FROM posts
      WHERE deletedAt IS NULL OR deletedAt = '' OR (sheetUrl IS NOT NULL AND sheetUrl != '')
      ORDER BY date DESC, updatedAt DESC
    `).all();
    return results.map(postFromRow);
  }

  async listDueScheduledPosts() {
    const { results } = await this.db.prepare(`
      SELECT * FROM posts
      WHERE status = 'scheduled'
        AND approvalStatus = 'approved'
        AND (deletedAt IS NULL OR deletedAt = '')
        AND scheduledAt IS NOT NULL
        AND scheduledAt != ''
        AND scheduledAt <= ?
      ORDER BY scheduledAt ASC
      LIMIT 10
    `).bind(now()).all();
    return results.map(postFromRow);
  }

  async claimDueScheduledPosts(limit = 10) {
    const timestamp = now();
    const { results } = await this.db.prepare(`
      UPDATE posts
      SET status = 'publishing',
          publishError = '',
          updatedAt = ?
      WHERE id IN (
        SELECT id FROM posts
        WHERE status = 'scheduled'
          AND approvalStatus = 'approved'
          AND (deletedAt IS NULL OR deletedAt = '')
          AND scheduledAt IS NOT NULL
          AND scheduledAt != ''
          AND scheduledAt <= ?
        ORDER BY scheduledAt ASC
        LIMIT ?
      )
      RETURNING *
    `).bind(timestamp, timestamp, limit).all();
    return results.map(postFromRow);
  }

  async getPost(postId) {
    return postFromRow(await this.db.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first());
  }

  async getFanpage(fanpageId) {
    return fanpageFromRow(
      await this.db.prepare('SELECT * FROM fanpages WHERE id = ?').bind(fanpageId).first(),
      { includeToken: true }
    );
  }

  async getInstagramSiblingFanpage(metaPageId) {
    if (!metaPageId) return null;
    return fanpageFromRow(
      await this.db.prepare(
        "SELECT * FROM fanpages WHERE metaPageId = ? AND platform = 'instagram' AND (deletedAt IS NULL OR deletedAt = '') LIMIT 1"
      ).bind(metaPageId).first(),
      { includeToken: true }
    );
  }

  async getConnectedFanpages() {
    const { results } = await this.db.prepare(`
      SELECT * FROM fanpages
      WHERE connected = 1
        AND (deletedAt IS NULL OR deletedAt = '')
    `).all();
    return results.map((row) => fanpageFromRow(row, { includeToken: true }));
  }

  async listAppItems(collection) {
    this.assertCollection(collection);
    const { results } = await this.db.prepare(
      `SELECT * FROM app_items
       WHERE collection = ?
         AND (deletedAt IS NULL OR deletedAt = '')
       ORDER BY updatedAt DESC`
    ).bind(collection).all();
    return results.map(appItemFromRow).filter(Boolean);
  }

  async getAppItem(collection, itemId) {
    this.assertCollection(collection);
    return appItemFromRow(await this.db.prepare(
      `SELECT * FROM app_items
       WHERE collection = ? AND id = ?
         AND (deletedAt IS NULL OR deletedAt = '')`
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
    const timestamp = now();
    if (collection === 'campaigns') {
      await this.db.prepare('UPDATE posts SET campaignId = NULL, updatedAt = ? WHERE campaignId = ?')
        .bind(timestamp, itemId).run();
      await this.db.prepare(`
        UPDATE app_items
        SET data = json_set(data, '$.campaignId', '', '$.updatedAt', ?),
            updatedAt = ?
        WHERE collection IN ('adReports', 'events', 'expenses')
          AND json_extract(data, '$.campaignId') = ?
      `).bind(timestamp, timestamp, itemId).run();
    }
    await this.db.prepare('UPDATE app_items SET deletedAt = ?, updatedAt = ? WHERE collection = ? AND id = ?')
      .bind(timestamp, timestamp, collection, itemId).run();
  }

  async writeAuditLog({ actorEmail = '', action, entityType, entityId, changes = {} }) {
    await this.db.prepare(`
      INSERT INTO audit_log (id, actorEmail, action, entityType, entityId, changes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      actorEmail || null,
      action,
      entityType,
      entityId,
      JSON.stringify(changes || {}),
      now()
    ).run();
  }

  async checkRateLimit(key, { limit, windowSeconds }) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = nowSeconds - (nowSeconds % windowSeconds);
    const row = await this.db.prepare(`
      INSERT INTO rate_limits (key, count, windowStart)
      VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.windowStart = excluded.windowStart THEN rate_limits.count + 1
          ELSE 1
        END,
        windowStart = excluded.windowStart
      RETURNING count, windowStart
    `).bind(key, windowStart).first();
    const count = Number(row?.count || 1);
    const retryAfter = Math.max(1, windowStart + windowSeconds - nowSeconds);
    return { allowed: count <= limit, limit, count, retryAfter };
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
      crossPostInstagram: fanpage.crossPostInstagram === undefined ? !!existing?.crossPostInstagram : !!fanpage.crossPostInstagram,
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
        connected, lastSyncedAt, syncStatus, syncError, kpis, createdAt, updatedAt, crossPostInstagram
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    `).bind(
      data.id, data.platform, data.name, data.link, data.imageUrl, data.metaPageId,
      data.instagramBusinessId, data.pageAccessTokenEncrypted, data.connected ? 1 : 0,
      data.lastSyncedAt, data.syncStatus, data.syncError, data.kpis, data.createdAt, data.updatedAt,
      data.crossPostInstagram ? 1 : 0
    ).run();
    return fanpageFromRow(await this.db.prepare('SELECT * FROM fanpages WHERE id = ?').bind(fanpageId).first());
  }

  async deleteFanpage(fanpageId) {
    const timestamp = now();
    await this.db.prepare(`
      UPDATE app_items SET deletedAt = ?, updatedAt = ?
      WHERE collection = 'adReports'
        AND json_extract(data, '$.fanpageId') = ?
        AND (deletedAt IS NULL OR deletedAt = '')
    `).bind(timestamp, timestamp, fanpageId).run();
    await this.db.prepare('UPDATE fanpages SET deletedAt = ?, updatedAt = ? WHERE id = ?')
      .bind(timestamp, timestamp, fanpageId).run();
    await this.db.prepare('UPDATE posts SET deletedAt = ?, updatedAt = ? WHERE fanpageId = ?')
      .bind(timestamp, timestamp, fanpageId).run();
  }

  async findPostRow(post) {
    if (!post) return null;
    const isMetaSource = ['facebook', 'instagram'].includes(post.source);
    if (post.sheetUrl && post.sheetRowKey) {
      const row = await this.db.prepare('SELECT * FROM posts WHERE sheetUrl = ? AND sheetRowKey = ?')
        .bind(post.sheetUrl, post.sheetRowKey).first();
      if (row) return row;
    }
    if (post.id) {
      const row = await this.db.prepare('SELECT * FROM posts WHERE id = ?').bind(post.id).first();
      if (row) return row;
    }
    if (post.externalPostId) {
      const row = await this.db.prepare('SELECT * FROM posts WHERE source = ? AND externalPostId = ?')
        .bind(post.source || 'manual', post.externalPostId).first();
      if (row) return row;
      if (isMetaSource && post.fanpageId) {
        const identityRow = await this.db.prepare(`
          SELECT * FROM posts
          WHERE externalPostId = ?
            AND fanpageId = ?
            AND (deletedAt IS NULL OR deletedAt = '')
          ORDER BY
            CASE WHEN sheetUrl IS NOT NULL AND sheetUrl != '' THEN 0 ELSE 1 END,
            updatedAt ASC
          LIMIT 1
        `).bind(post.externalPostId, post.fanpageId).first();
        if (identityRow) return identityRow;
      }
    }
    return null;
  }

  async pruneDuplicatePublishedPosts(post) {
    if (!post?.id || !post.externalPostId || !post.fanpageId || post.status !== 'published') return post;
    if (!['facebook', 'instagram'].includes(post.source)) return post;
    const { results } = await this.db.prepare(`
      SELECT * FROM posts
      WHERE id != ?
        AND fanpageId = ?
        AND externalPostId = ?
        AND (deletedAt IS NULL OR deletedAt = '')
    `).bind(post.id, post.fanpageId, post.externalPostId).all();
    if (!results.length) return post;
    const timestamp = now();
    const sheetSource = results.find((row) => row.sheetUrl || row.sheetRowKey || row.sheetDefaultFanpageId);
    await this.db.prepare(`
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
    `).bind(timestamp, timestamp, post.id, post.fanpageId, post.externalPostId).run();
    if (sheetSource && (!post.sheetUrl || !post.sheetRowKey)) {
      await this.db.prepare(`
        UPDATE posts
        SET sheetUrl = COALESCE(NULLIF(sheetUrl, ''), ?),
            sheetRowKey = COALESCE(NULLIF(sheetRowKey, ''), ?),
            sheetDefaultFanpageId = COALESCE(NULLIF(sheetDefaultFanpageId, ''), ?),
            updatedAt = ?
        WHERE id = ?
      `).bind(
        sheetSource.sheetUrl || null,
        sheetSource.sheetRowKey || null,
        sheetSource.sheetDefaultFanpageId || null,
        timestamp,
        post.id
      ).run();
    }
    return this.getPost(post.id);
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
      campaignId: post.campaignId !== undefined ? (post.campaignId || null) : (existing?.campaignId || null),
      engagement: JSON.stringify(post.engagement !== undefined ? post.engagement : (existing?.engagement || null)),
      approvalStatus: APPROVAL_STATUSES.has(post.approvalStatus)
        ? post.approvalStatus
        : (existing?.approvalStatus || 'approved'),
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
    if (!data.fanpageId || !data.date) {
      const error = new Error('fanpageId and date are required for posts.');
      error.status = 400;
      throw error;
    }
    await this.db.prepare(`
      INSERT INTO posts (
        id, fanpageId, externalPostId, title, content, date, scheduledAt, publishedAt, permalink, mediaUrl,
        mediaItems, publishError, sheetUrl, sheetRowKey, sheetDefaultFanpageId, campaignId, engagement, approvalStatus,
        source, status, deletedAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        campaignId = excluded.campaignId,
        engagement = excluded.engagement,
        approvalStatus = excluded.approvalStatus,
        source = excluded.source,
        status = excluded.status,
        deletedAt = excluded.deletedAt,
        updatedAt = excluded.updatedAt
    `).bind(
      data.id, data.fanpageId, data.externalPostId, data.title, data.content, data.date,
      data.scheduledAt, data.publishedAt, data.permalink, data.mediaUrl, data.mediaItems,
      data.publishError, data.sheetUrl, data.sheetRowKey, data.sheetDefaultFanpageId,
      data.campaignId, data.engagement, data.approvalStatus,
      data.source, data.status, data.deletedAt, data.createdAt, data.updatedAt
    ).run();
    return this.pruneDuplicatePublishedPosts(postFromRow(await this.db.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first()));
  }

  async markMissingSyncedPostsDeleted({ fanpageId, source, externalPostIds = [], sinceDate = '' }) {
    const timestamp = now();
    const ids = [...new Set((externalPostIds || []).filter(Boolean))];
    // Guard: empty id set (transient Meta hiccup returning no posts) would drop
    // the NOT IN clause and soft-delete every published post. Never prune then.
    if (ids.length === 0) return 0;
    const params = [timestamp, timestamp, fanpageId, source];
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
      // D1 caps the number of bound SQL variables. Passing a full Meta page
      // (100 IDs) as individual placeholders exceeds that cap, so bind the list
      // once and expand it through SQLite's JSON table function.
      clauses.push('externalPostId NOT IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(ids));
    }
    const result = await this.db.prepare(`
      UPDATE posts
      SET deletedAt = ?, updatedAt = ?
      WHERE ${clauses.join(' AND ')}
    `).bind(...params).run();
    return result.meta?.changes || 0;
  }

  async deletePost(postId) {
    const timestamp = now();
    await this.db.prepare('UPDATE posts SET deletedAt = ?, updatedAt = ? WHERE id = ?')
      .bind(timestamp, timestamp, postId).run();
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
    // Atomic delete-and-return: a concurrent callback with the same state can't
    // double-consume it (only one DELETE matches the row). Expiry filtered here
    // so an expired state is rejected even though the row is removed.
    const row = await this.db.prepare(
      'DELETE FROM oauth_states WHERE state = ? AND provider = ? AND expiresAt > ? RETURNING payload'
    ).bind(state, provider, now()).first();
    return row ? parseJson(row.payload, {}) : null;
  }

  async cleanupOAuthStates() {
    await this.db.prepare('DELETE FROM oauth_states WHERE expiresAt <= ?').bind(now()).run();
  }

  async cleanupRateLimits(maxAgeSeconds = 3600) {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    await this.db.prepare('DELETE FROM rate_limits WHERE windowStart < ?').bind(cutoff).run();
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
