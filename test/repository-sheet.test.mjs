import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const createPostsSchema = (db) => db.exec(`
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

test('upsertPost reuses and restores a soft-deleted Google Sheets row', async () => {
  const require = createRequire(import.meta.url);
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const db = new Database(':memory:');
  createPostsSchema(db);

  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db
  };

  try {
    const repo = require('../server/repository.js');
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/example/edit#gid=0';

    await repo.upsertPost({
      id: 'old-post',
      fanpageId: 'fp-1',
      title: 'Old content',
      content: 'Old content',
      date: '2026-06-22',
      scheduledAt: '2026-06-22T03:00:00.000Z',
      sheetUrl,
      sheetRowKey: 'id:row-1',
      source: 'scheduled-sheet',
      status: 'scheduled',
      deletedAt: '2026-06-22T04:00:00.000Z'
    });

    const saved = await repo.upsertPost({
      fanpageId: 'fp-1',
      title: 'New content',
      content: 'New content',
      date: '2026-06-23',
      scheduledAt: '2026-06-23T03:00:00.000Z',
      sheetUrl,
      sheetRowKey: 'id:row-1',
      source: 'scheduled-sheet',
      status: 'scheduled'
    });

    assert.equal(saved.id, 'old-post');
    assert.equal(saved.content, 'New content');
    assert.equal(saved.deletedAt, '');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM posts').get().count, 1);
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('upsertPost lets Google Sheets row identity win over a conflicting payload id', async () => {
  const require = createRequire(import.meta.url);
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const db = new Database(':memory:');
  createPostsSchema(db);

  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db
  };

  try {
    const repo = require('../server/repository.js');
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/example/edit#gid=0';

    await repo.upsertPost({
      id: 'sheet-owner',
      fanpageId: 'fp-1',
      title: 'Sheet owner',
      content: 'Sheet owner',
      date: '2026-06-22',
      scheduledAt: '2026-06-22T03:00:00.000Z',
      sheetUrl,
      sheetRowKey: 'id:row-1',
      source: 'scheduled-sheet',
      status: 'scheduled'
    });

    await repo.upsertPost({
      id: 'other-post',
      fanpageId: 'fp-1',
      title: 'Other post',
      content: 'Other post',
      date: '2026-06-21',
      scheduledAt: '2026-06-21T03:00:00.000Z',
      source: 'scheduled',
      status: 'scheduled'
    });

    const saved = await repo.upsertPost({
      id: 'other-post',
      fanpageId: 'fp-1',
      title: 'Changed from sheet',
      content: 'Changed from sheet',
      date: '2026-06-23',
      scheduledAt: '2026-06-23T03:00:00.000Z',
      sheetUrl,
      sheetRowKey: 'id:row-1',
      source: 'scheduled-sheet',
      status: 'scheduled'
    });

    assert.equal(saved.id, 'sheet-owner');
    assert.equal(saved.content, 'Changed from sheet');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM posts WHERE sheetUrl = ? AND sheetRowKey = ?').get(sheetUrl, 'id:row-1').count, 1);
    assert.equal(db.prepare('SELECT content FROM posts WHERE id = ?').get('other-post').content, 'Other post');
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('upsertPost promotes a published scheduled sheet post to Meta source without duplicating it', async () => {
  const require = createRequire(import.meta.url);
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const db = new Database(':memory:');
  createPostsSchema(db);

  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db
  };

  try {
    const repo = require('../server/repository.js');
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/example/edit#gid=0';

    await repo.upsertPost({
      id: 'scheduled-row',
      fanpageId: 'fp-1',
      externalPostId: 'fb-post-1',
      title: 'Sheet post',
      content: 'Sheet post',
      date: '2026-06-22',
      scheduledAt: '2026-06-22T03:00:00.000Z',
      publishedAt: '2026-06-22T03:01:00.000Z',
      sheetUrl,
      sheetRowKey: 'id:row-1',
      source: 'scheduled-sheet',
      status: 'published'
    });

    const saved = await repo.upsertPost({
      fanpageId: 'fp-1',
      externalPostId: 'fb-post-1',
      title: 'Synced from Facebook',
      content: 'Synced from Facebook',
      date: '2026-06-22',
      publishedAt: '2026-06-22T03:01:00.000Z',
      permalink: 'https://facebook.com/fb-post-1',
      source: 'facebook',
      status: 'published'
    });

    assert.equal(saved.id, 'scheduled-row');
    assert.equal(saved.source, 'facebook');
    assert.equal(saved.sheetUrl, sheetUrl);
    assert.equal(saved.sheetRowKey, 'id:row-1');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM posts WHERE deletedAt IS NULL OR deletedAt = ?').get('').count, 1);
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('upsertPost prunes historical duplicate Meta rows and preserves sheet linkage', async () => {
  const require = createRequire(import.meta.url);
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const db = new Database(':memory:');
  createPostsSchema(db);
  const timestamp = '2026-06-22T03:00:00.000Z';
  db.prepare(`
    INSERT INTO posts (id, fanpageId, externalPostId, title, content, date, scheduledAt, publishedAt, sheetUrl, sheetRowKey, source, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('scheduled-row', 'fp-1', 'fb-post-1', 'Sheet post', 'Sheet post', '2026-06-22', timestamp, timestamp, 'https://docs.google.com/sheet', 'id:row-1', 'scheduled-sheet', 'published', timestamp, timestamp);
  db.prepare(`
    INSERT INTO posts (id, fanpageId, externalPostId, title, content, date, publishedAt, source, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('facebook-row', 'fp-1', 'fb-post-1', 'Facebook post', 'Facebook post', '2026-06-22', timestamp, 'facebook', 'published', timestamp, timestamp);

  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db
  };

  try {
    const repo = require('../server/repository.js');
    const saved = await repo.upsertPost({
      fanpageId: 'fp-1',
      externalPostId: 'fb-post-1',
      title: 'Synced from Facebook',
      content: 'Synced from Facebook',
      date: '2026-06-22',
      publishedAt: timestamp,
      source: 'facebook',
      status: 'published'
    });

    assert.equal(saved.id, 'facebook-row');
    assert.equal(saved.sheetUrl, 'https://docs.google.com/sheet');
    assert.equal(saved.sheetRowKey, 'id:row-1');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM posts WHERE (deletedAt IS NULL OR deletedAt = ?) AND fanpageId = ? AND externalPostId = ?').get('', 'fp-1', 'fb-post-1').count, 1);
    assert.ok(db.prepare('SELECT deletedAt FROM posts WHERE id = ?').get('scheduled-row').deletedAt);
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('markMissingSyncedPostsDeleted never prunes on an empty batch', async () => {
  const require = createRequire(import.meta.url);
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const db = new Database(':memory:');
  createPostsSchema(db);

  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db
  };

  try {
    const repo = require('../server/repository.js');

    for (const id of ['post-a', 'post-b']) {
      await repo.upsertPost({
        id,
        fanpageId: 'fp-1',
        externalPostId: `ext-${id}`,
        title: id,
        content: id,
        date: '2026-06-22',
        source: 'facebook',
        status: 'published'
      });
    }

    // Transient Meta hiccup: sync returned zero ids. Must not soft-delete anything.
    const removed = await repo.markMissingSyncedPostsDeleted({
      fanpageId: 'fp-1',
      source: 'facebook',
      externalPostIds: [],
      sinceDate: ''
    });

    assert.equal(removed, 0);
    const live = db.prepare(
      "SELECT COUNT(*) AS count FROM posts WHERE deletedAt IS NULL OR deletedAt = ''"
    ).get().count;
    assert.equal(live, 2);
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
