import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import Database from 'better-sqlite3';

import { MetaService } from '../worker/meta.js';
import { Repository } from '../worker/repository.js';

const require = createRequire(import.meta.url);
const { getPostRetentionCutoff } = require('../shared/repository-helpers.cjs');

const createRepositorySchema = (db) => db.exec(`
  CREATE TABLE posts (
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
    campaignId TEXT,
    engagement TEXT,
    approvalStatus TEXT NOT NULL DEFAULT 'approved',
    publishMode TEXT NOT NULL DEFAULT 'live',
    testedAt TEXT,
    testResult TEXT,
    igContainerId TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'published',
    deletedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE UNIQUE INDEX idx_posts_sheet_row
    ON posts(sheetUrl, sheetRowKey)
    WHERE sheetUrl IS NOT NULL AND sheetRowKey IS NOT NULL;

  CREATE UNIQUE INDEX idx_posts_external
    ON posts(source, externalPostId)
    WHERE externalPostId IS NOT NULL;
`);

const withSqliteRepository = async (run) => {
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const db = new Database(':memory:');
  createRepositorySchema(db);
  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db
  };

  try {
    await run(require('../server/repository.js'), db);
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
};

const postFixture = (id, {
  status = 'published',
  publishedAt = new Date().toISOString(),
  sheetUrl = '',
  sheetRowKey = ''
} = {}) => ({
  id,
  fanpageId: 'fanpage-1',
  title: id,
  content: id,
  date: publishedAt.slice(0, 10),
  publishedAt,
  scheduledAt: status === 'scheduled' || status === 'publishing'
    ? '2026-05-01T00:00:00.000Z'
    : '',
  sheetUrl,
  sheetRowKey,
  source: sheetUrl ? 'sheet' : 'manual',
  status
});

test('post retention cutoff is exactly two rolling calendar months before the reference instant', () => {
  assert.equal(
    getPostRetentionCutoff('2026-08-10T14:27:31.456Z'),
    '2026-06-10T14:27:31.456Z'
  );
});

test('SQLite retention soft-deletes only active published posts strictly older than the cutoff', async () => {
  await withSqliteRepository(async (repo, db) => {
    const cutoff = getPostRetentionCutoff();
    const expiredAt = new Date(new Date(cutoff).getTime() - 1).toISOString();
    const recentAt = new Date().toISOString();
    const retainedIds = [
      'published-at-cutoff',
      'recent-published',
      'old-scheduled',
      'old-failed',
      'old-tested',
      'old-publishing'
    ];

    await repo.upsertPost(postFixture('old-published', { publishedAt: expiredAt }));
    await repo.upsertPost(postFixture('old-sheet-published', {
      publishedAt: expiredAt,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      sheetRowKey: 'content!7'
    }));
    await repo.upsertPost(postFixture('published-at-cutoff', { publishedAt: cutoff }));
    await repo.upsertPost(postFixture('recent-published', { publishedAt: recentAt }));
    await repo.upsertPost(postFixture('old-scheduled', { status: 'scheduled', publishedAt: expiredAt }));
    await repo.upsertPost(postFixture('old-failed', { status: 'failed', publishedAt: expiredAt }));
    await repo.upsertPost(postFixture('old-tested', { status: 'tested', publishedAt: expiredAt }));
    await repo.upsertPost(postFixture('old-publishing', { status: 'publishing', publishedAt: expiredAt }));
    await repo.upsertPost(postFixture('already-deleted', { publishedAt: expiredAt }));
    db.prepare('UPDATE posts SET deletedAt = ? WHERE id = ?')
      .run('2026-01-15T00:00:00.000Z', 'already-deleted');

    const expired = await repo.cleanupOldPublishedPosts(cutoff);

    assert.equal(expired, 2);
    assert.ok((await repo.getPost('old-published')).deletedAt);
    assert.ok((await repo.getPost('old-sheet-published')).deletedAt);
    assert.equal((await repo.getPost('already-deleted')).deletedAt, '2026-01-15T00:00:00.000Z');
    for (const id of retainedIds) {
      assert.equal((await repo.getPost(id)).deletedAt, '', `${id} must remain active`);
    }

    const visibleIds = (await repo.listPosts({ limit: 100 })).map((post) => post.id);
    assert.ok(!visibleIds.includes('old-published'));
    assert.ok(!visibleIds.includes('old-sheet-published'));
    for (const id of retainedIds) assert.ok(visibleIds.includes(id), `${id} must remain visible`);

  });
});

test('Worker retention cleanup binds the cutoff and updates only active published rows', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            run: async () => ({ meta: { changes: 3 } })
          };
        }
      };
    }
  };
  const repo = new Repository({
    DB: db,
    TOKEN_ENCRYPTION_KEY: 'test-token-encryption-key-32-characters'
  });
  const cutoff = '2026-06-10T14:27:31.456Z';

  assert.equal(await repo.cleanupOldPublishedPosts(cutoff), 3);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE posts/i);
  assert.match(calls[0].sql, /status\s*=\s*'published'/i);
  assert.match(calls[0].sql, /deletedAt IS NULL OR deletedAt = ''/i);
  assert.match(calls[0].sql, /publishedAt/i);
  assert.ok(calls[0].params.includes(cutoff));
});

test('Worker Meta sync ignores expired Facebook and Instagram history and runs retention cleanup', async () => {
  const recentTimestamp = new Date().toISOString();
  const savedPosts = [];
  const pruned = [];
  const cleanupCalls = [];
  const requestedLimits = [];
  const repo = {
    decryptPageToken: async () => 'page-token',
    getConnectedFanpages: async () => [
      {
        id: 'facebook-page',
        name: 'Facebook page',
        platform: 'facebook',
        metaPageId: 'meta-page-1',
        pageAccessTokenEncrypted: 'encrypted'
      },
      {
        id: 'instagram-page',
        name: 'Instagram page',
        platform: 'instagram',
        instagramBusinessId: 'instagram-business-1',
        pageAccessTokenEncrypted: 'encrypted'
      }
    ],
    getState: async () => 0,
    saveState: async () => {},
    setFanpageSyncStatus: async () => {},
    upsertPost: async (post) => {
      savedPosts.push(post);
      return post;
    },
    markMissingSyncedPostsDeleted: async (input) => pruned.push(input),
    cleanupOldPublishedPosts: async (cutoff) => {
      cleanupCalls.push(cutoff);
      return 0;
    }
  };
  const meta = new MetaService({}, repo, 'https://example.test');
  meta.refreshFanpageProfile = async (fanpage) => fanpage;
  meta.fetchFacebookPostBatch = async (_fanpage, _token, limit) => {
    requestedLimits.push(limit);
    return ({
    posts: [
      { id: 'fb-expired', created_time: '2026-01-01T00:00:00.000Z' },
      { id: 'fb-recent', created_time: recentTimestamp }
    ]
    });
  };
  meta.graphGet = async (path, params) => {
    assert.match(path, /instagram-business-1\/media/);
    requestedLimits.push(params.limit);
    return {
      data: [
        { id: 'ig-expired', timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'ig-recent', timestamp: recentTimestamp }
      ]
    };
  };

  const result = await meta.syncAll({ maxFanpages: 2, postLimit: 100 });

  assert.equal(result.totalPosts, 2);
  assert.deepEqual(savedPosts.map((post) => post.externalPostId).sort(), ['fb-recent', 'ig-recent']);
  assert.deepEqual(
    pruned.map((entry) => entry.externalPostIds),
    [['fb-recent'], ['ig-recent']]
  );
  assert.deepEqual(requestedLimits, [25, 25], 'Worker sync must cap each Meta page below the CPU-heavy 100-post batch');
  assert.equal(result.postLimit, 25);
  assert.ok(cleanupCalls.length >= 1, 'Meta sync must invoke repository retention cleanup');
});
