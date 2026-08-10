import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';

const { normalizePostMutation } = createRequire(import.meta.url)('../shared/repository-helpers.cjs');

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

test('safe test mutations cannot be promoted to live or marked published by an API payload', () => {
  assert.deepEqual(
    normalizePostMutation({ publishMode: 'safe_test', status: 'published', approvalStatus: 'pending' }),
    { publishMode: 'safe_test', status: 'scheduled', approvalStatus: 'approved' }
  );
  assert.deepEqual(
    normalizePostMutation(
      { publishMode: 'live', status: 'scheduled' },
      { publishMode: 'safe_test', status: 'failed' }
    ),
    { publishMode: 'safe_test', status: 'scheduled', approvalStatus: 'approved' }
  );
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

test('server upsertPost persists and updates an Instagram container id', async () => {
  await withSqliteRepository(async (repo) => {
    const inserted = await repo.upsertPost({
      ...scheduledPost('container-round-trip', 'approved'),
      igContainerId: 'ig-container-first'
    });
    assert.equal(inserted.igContainerId, 'ig-container-first');
    assert.equal((await repo.getPost('container-round-trip')).igContainerId, 'ig-container-first');

    const updated = await repo.upsertPost({
      ...inserted,
      igContainerId: 'ig-container-replacement'
    });
    assert.equal(updated.igContainerId, 'ig-container-replacement');
    assert.equal((await repo.getPost('container-round-trip')).igContainerId, 'ig-container-replacement');
  });
});

test('stale publishing posts requeue recoverable containers without retrying completed or unrecoverable work', async () => {
  await withSqliteRepository(async (repo, db) => {
    await repo.upsertPost({
      ...scheduledPost('stale-container', 'approved'),
      igContainerId: 'ig-container-1'
    });
    await repo.upsertPost({
      ...scheduledPost('stale-published', 'approved'),
      externalPostId: 'ig-post-1'
    });
    await repo.upsertPost({
      ...scheduledPost('stale-safe-test', 'approved'),
      publishMode: 'safe_test',
      externalPostId: 'fb-unpublished-test-1'
    });
    await repo.upsertPost(scheduledPost('stale-unrecoverable', 'approved'));
    await repo.upsertPost(scheduledPost('active-post', 'approved'));
    db.prepare(`
      UPDATE posts
      SET status = 'publishing', updatedAt = ?
      WHERE id IN (?, ?, ?, ?)
    `).run(
      '2026-08-04T07:00:00.000Z',
      'stale-container',
      'stale-published',
      'stale-safe-test',
      'stale-unrecoverable'
    );
    db.prepare(`
      UPDATE posts
      SET status = 'publishing', updatedAt = ?
      WHERE id = ?
    `).run('2026-08-04T08:59:00.000Z', 'active-post');

    const released = await repo.failStalePublishingPosts('2026-08-04T08:50:00.000Z');

    assert.equal(released, 4);
    const staleContainer = await repo.getPost('stale-container');
    assert.equal(staleContainer.status, 'scheduled');
    assert.equal(staleContainer.igContainerId, 'ig-container-1');
    assert.equal(staleContainer.publishError, '');
    assert.equal((await repo.getPost('stale-published')).status, 'published');
    const staleSafeTest = await repo.getPost('stale-safe-test');
    assert.equal(staleSafeTest.status, 'scheduled');
    assert.equal(staleSafeTest.publishMode, 'safe_test');
    assert.equal(staleSafeTest.externalPostId, 'fb-unpublished-test-1');
    const staleUnrecoverable = await repo.getPost('stale-unrecoverable');
    assert.equal(staleUnrecoverable.status, 'failed');
    assert.match(staleUnrecoverable.publishError, /gián đoạn/i);
    assert.equal((await repo.getPost('active-post')).status, 'publishing');
  });
});

test('safe test posts persist their mode, claim individually, and leave the pending queue when tested', async () => {
  await withSqliteRepository(async (repo) => {
    const saved = await repo.upsertPost({
      ...scheduledPost('safe-post', 'approved'),
      publishMode: 'safe_test'
    });
    assert.equal(saved.publishMode, 'safe_test');

    const claimed = await repo.claimSafeTestPost('safe-post');
    assert.equal(claimed.status, 'publishing');
    assert.equal(claimed.publishMode, 'safe_test');
    assert.equal(await repo.claimSafeTestPost('safe-post'), undefined);

    await repo.setPostPublishState('safe-post', {
      status: 'tested',
      testedAt: '2026-08-04T03:00:00.000Z',
      testResult: { facebook: { visibility: 'unpublished' } }
    });
    const completed = await repo.getPost('safe-post');
    assert.equal(completed.status, 'tested');
    assert.equal(completed.testResult.facebook.visibility, 'unpublished');
    assert.deepEqual(await repo.listPosts({ pending: true }), []);
  });
});

test('deleting a campaign clears its links without deleting member records', async () => {
  await withSqliteRepository(async (repo, db) => {
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
    db.prepare(`
      UPDATE app_items
      SET data = json_set(data, '$.updatedAt', '2000-01-01T00:00:00.000Z'),
          updatedAt = '2000-01-01T00:00:00.000Z'
      WHERE collection = 'expenses' AND id = 'expense-1'
    `).run();

    await repo.deleteAppItem('campaigns', 'campaign-1');

    assert.equal((await repo.getPost('post-1')).campaignId, '');
    const expense = await repo.getAppItem('expenses', 'expense-1');
    const expenseRow = db.prepare(
      'SELECT updatedAt FROM app_items WHERE collection = ? AND id = ?'
    ).get('expenses', 'expense-1');
    assert.equal(expense.campaignId, '');
    assert.equal(expense.updatedAt, expenseRow.updatedAt);
    assert.notEqual(expense.updatedAt, '2000-01-01T00:00:00.000Z');
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
  const ad = store.adReports.create({ campaignId: campaign.id, spend: 100, revenue: 400 });
  const event = store.events.create({ campaignId: campaign.id, budget: 50 });
  const expense = store.expenses.create({ campaignId: campaign.id, amount: 25 });

  const stats = store.campaigns.getStats(campaign.id);
  assert.equal(stats.postCount, 1);
  assert.equal(stats.adCount, 1);
  assert.equal(stats.eventCount, 1);
  assert.equal(stats.expenseCount, 1);
  assert.equal(stats.totalSpend, 175);
  assert.equal(stats.revenue, 400);
  assert.equal(stats.roas, 4);

  store.campaigns.remove(campaign.id);

  assert.equal(store.posts.getById(post.id).campaignId, '');
  assert.equal(store.adReports.getById(ad.id).campaignId, '');
  assert.equal(store.events.getById(event.id).campaignId, '');
  assert.equal(store.expenses.getById(expense.id).campaignId, '');
});
