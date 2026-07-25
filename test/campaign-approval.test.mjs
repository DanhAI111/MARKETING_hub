import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';

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

  CREATE TABLE app_items (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    deletedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
`);

const withSqliteRepository = async (run) => {
  const require = createRequire(import.meta.url);
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

const scheduledPost = (id, approvalStatus) => ({
  id,
  fanpageId: 'fp-1',
  title: id,
  content: id,
  date: '2026-07-25',
  scheduledAt: '2020-01-01T00:00:00.000Z',
  status: 'scheduled',
  source: 'scheduled',
  approvalStatus
});

test('claimDueScheduledPosts publishes only approved posts', async () => {
  await withSqliteRepository(async (repo) => {
    await repo.upsertPost(scheduledPost('approved-post', 'approved'));
    await repo.upsertPost(scheduledPost('pending-post', 'pending'));
    await repo.upsertPost(scheduledPost('rejected-post', 'rejected'));

    const claimed = await repo.claimDueScheduledPosts(10);

    assert.deepEqual(claimed.map((post) => post.id), ['approved-post']);
    assert.equal((await repo.getPost('pending-post')).status, 'scheduled');
    assert.equal((await repo.getPost('rejected-post')).status, 'scheduled');
  });
});

test('deleting a campaign clears its links without deleting member records', async () => {
  await withSqliteRepository(async (repo) => {
    await repo.upsertAppItem('campaigns', { id: 'campaign-1', name: 'Launch' });
    await repo.upsertAppItem('expenses', {
      id: 'expense-1',
      description: 'Creative',
      campaignId: 'campaign-1'
    });
    await repo.upsertAppItem('events', {
      id: 'event-1',
      name: 'Launch event',
      campaignId: 'campaign-1'
    });
    await repo.upsertPost({
      ...scheduledPost('post-1', 'approved'),
      campaignId: 'campaign-1'
    });

    await repo.deleteAppItem('campaigns', 'campaign-1');

    assert.equal((await repo.getPost('post-1')).campaignId, '');
    assert.equal((await repo.getAppItem('expenses', 'expense-1')).campaignId, '');
    assert.equal((await repo.getAppItem('events', 'event-1')).campaignId, '');
  });
});

test('local campaign deletion clears links from every member collection', () => {
  const source = fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const values = new Map();
  const context = vm.createContext({
    console,
    Date,
    Math,
    Blob,
    URL,
    FileReader: class {},
    window: { RemoteStore: { available: false } },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  vm.runInContext(`${source}\n;globalThis.__Store = Store;`, context);
  const store = context.__Store;

  const campaign = store.campaigns.create({ name: 'Launch' });
  const post = store.posts.create({ title: 'Post', campaignId: campaign.id });
  const ad = store.adReports.create({ campaignId: campaign.id });
  const event = store.events.create({ campaignId: campaign.id });
  const expense = store.expenses.create({ campaignId: campaign.id });

  store.campaigns.remove(campaign.id);

  assert.equal(store.posts.getById(post.id).campaignId, '');
  assert.equal(store.adReports.getById(ad.id).campaignId, '');
  assert.equal(store.events.getById(event.id).campaignId, '');
  assert.equal(store.expenses.getById(expense.id).campaignId, '');
});
