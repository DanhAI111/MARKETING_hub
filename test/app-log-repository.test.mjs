import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

test('application log repository filters, paginates, parses details and expires old rows', async () => {
  const require = createRequire(import.meta.url);
  const dbModulePath = require.resolve('../server/db.js');
  const repoModulePath = require.resolve('../server/repository.js');
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_logs (
      id TEXT PRIMARY KEY, level TEXT NOT NULL, component TEXT NOT NULL,
      event TEXT NOT NULL, message TEXT NOT NULL, correlationId TEXT,
      postId TEXT, fanpageId TEXT, platform TEXT, details TEXT, createdAt TEXT NOT NULL
    );
  `);
  delete require.cache[repoModulePath];
  delete require.cache[dbModulePath];
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: db };

  try {
    const repo = require('../server/repository.js');
    await repo.writeAppLog({
      id: 'log-1', level: 'error', component: 'publisher', event: 'failed',
      message: 'Instagram container failed', postId: 'post-1', platform: 'instagram',
      details: { code: 9004 }, createdAt: '2026-08-14T02:00:00.000Z'
    });
    await repo.writeAppLog({
      id: 'log-2', level: 'info', component: 'publisher', event: 'published',
      message: 'Facebook published', postId: 'post-2', platform: 'facebook',
      details: { externalPostId: 'fb-1' }, createdAt: '2026-08-14T03:00:00.000Z'
    });

    const errors = await repo.listAppLogs({
      from: '2026-08-13T00:00:00.000Z', to: '2026-08-14T04:00:00.000Z',
      level: 'error', q: 'container', limit: 1
    });
    assert.equal(errors.items.length, 1);
    assert.equal(errors.items[0].postId, 'post-1');
    assert.deepEqual(errors.items[0].details, { code: 9004 });

    const firstPage = await repo.listAppLogs({
      from: '2026-08-13T00:00:00.000Z', to: '2026-08-14T04:00:00.000Z', limit: 1
    });
    assert.equal(firstPage.items[0].id, 'log-2');
    assert.ok(firstPage.nextCursor);
    const secondPage = await repo.listAppLogs({
      from: '2026-08-13T00:00:00.000Z', to: '2026-08-14T04:00:00.000Z',
      cursor: firstPage.nextCursor, limit: 1
    });
    assert.equal(secondPage.items[0].id, 'log-1');

    assert.equal(await repo.cleanupAppLogs('2026-08-14T02:30:00.000Z'), 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_logs').get().count, 1);
  } finally {
    delete require.cache[repoModulePath];
    delete require.cache[dbModulePath];
    db.close();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
