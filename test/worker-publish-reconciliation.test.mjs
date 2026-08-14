import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { Repository } from '../worker/repository.js';

const createD1Adapter = (sqlite) => {
  const adapter = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (...params) => ({
        execute: () => statement.run(...params),
        first: async () => statement.get(...params),
        all: async () => ({ results: statement.all(...params) }),
        run: async () => {
          const result = statement.run(...params);
          return { meta: { changes: result.changes } };
        }
      });
      return {
        bind: (...params) => bound(...params),
        execute: () => statement.run(),
        first: async () => statement.get(),
        all: async () => ({ results: statement.all() }),
        run: async () => {
          const result = statement.run();
          return { meta: { changes: result.changes } };
        }
      };
    },
    async batch(statements) {
      return sqlite.transaction(() => statements.map((statement) => {
        const result = statement.execute();
        return { meta: { changes: result.changes } };
      }))();
    }
  };
  return adapter;
};

const createSchema = (db) => db.exec(`
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

  CREATE UNIQUE INDEX idx_posts_external
    ON posts(source, externalPostId)
    WHERE externalPostId IS NOT NULL;

  CREATE TABLE publish_jobs (
    postId TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'queued',
    externalPostId TEXT,
    resolvedMedia TEXT,
    childContainerIds TEXT,
    parentContainerId TEXT,
    leaseToken TEXT,
    leaseUntil TEXT,
    attemptCount INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt TEXT,
    lastErrorCode TEXT,
    lastError TEXT,
    lastErrorAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

test('D1 finalization merges a concurrently synced Instagram row into the scheduled post', async () => {
  const db = new Database(':memory:');
  createSchema(db);
  const repo = new Repository({
    DB: createD1Adapter(db),
    TOKEN_ENCRYPTION_KEY: 'test-token-encryption-key-32-characters'
  });

  try {
    await repo.upsertPost({
      id: 'scheduled-post',
      fanpageId: 'instagram-page',
      title: 'Scheduled caption',
      content: 'The original scheduled content',
      date: '2026-08-14',
      scheduledAt: '2026-08-14T07:00:00.000Z',
      mediaItems: [{ type: 'image', url: 'https://cdn.example.test/original.jpg' }],
      source: 'scheduled',
      status: 'publishing'
    });
    await repo.upsertPost({
      id: 'synced-post',
      fanpageId: 'instagram-page',
      externalPostId: 'instagram-media-1',
      title: 'Bài đăng Instagram',
      content: '',
      date: '2026-08-14',
      publishedAt: '2026-08-14T07:16:51.000Z',
      permalink: 'https://www.instagram.com/p/example/',
      mediaUrl: 'https://cdn.example.test/synced.jpg',
      engagement: { likes: 3, comments: 1 },
      source: 'instagram',
      status: 'published'
    });

    const published = await repo.setPostPublishState('scheduled-post', {
      externalPostId: 'instagram-media-1',
      publishedAt: '2026-08-14T07:16:54.000Z',
      source: 'instagram',
      status: 'published',
      publishError: ''
    });

    assert.equal(published.id, 'scheduled-post');
    assert.equal(published.status, 'published');
    assert.equal(published.externalPostId, 'instagram-media-1');
    assert.equal(published.content, 'The original scheduled content');
    assert.equal(published.permalink, 'https://www.instagram.com/p/example/');
    assert.equal(published.mediaUrl, 'https://cdn.example.test/synced.jpg');
    assert.deepEqual(published.engagement, { likes: 3, comments: 1 });
    const retiredSyncRow = await repo.getPost('synced-post');
    assert.equal(retiredSyncRow.externalPostId, '');
    assert.ok(retiredSyncRow.deletedAt, 'the duplicate sync row remains available for audit');
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM posts WHERE source = ? AND externalPostId = ?')
        .get('instagram', 'instagram-media-1').count,
      1
    );
  } finally {
    db.close();
  }
});

test('D1 recovery finalizes a completed Instagram job without calling Meta again', async () => {
  const db = new Database(':memory:');
  createSchema(db);
  const repo = new Repository({
    DB: createD1Adapter(db),
    TOKEN_ENCRYPTION_KEY: 'test-token-encryption-key-32-characters'
  });

  try {
    await repo.upsertPost({
      id: 'interrupted-post',
      fanpageId: 'instagram-page',
      title: 'Interrupted publish',
      content: 'Keep this scheduled caption',
      date: '2026-08-14',
      scheduledAt: '2026-08-14T07:00:00.000Z',
      source: 'scheduled',
      status: 'publishing'
    });
    await repo.upsertPost({
      id: 'interrupted-sync-row',
      fanpageId: 'instagram-page',
      externalPostId: 'instagram-media-recovered',
      title: 'Bài đăng Instagram',
      content: '',
      date: '2026-08-14',
      publishedAt: '2026-08-14T07:16:51.000Z',
      permalink: 'https://www.instagram.com/p/recovered/',
      source: 'instagram',
      status: 'published'
    });
    await repo.savePublishJob('interrupted-post', {
      platform: 'instagram',
      stage: 'completed',
      externalPostId: 'instagram-media-recovered'
    });

    const recovered = await repo.reconcileCompletedPublishJobs();

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].id, 'interrupted-post');
    assert.equal(recovered[0].status, 'published');
    assert.equal(recovered[0].externalPostId, 'instagram-media-recovered');
    assert.equal(recovered[0].permalink, 'https://www.instagram.com/p/recovered/');
    assert.equal((await repo.getPublishJob('interrupted-post')).stage, 'completed');
  } finally {
    db.close();
  }
});
