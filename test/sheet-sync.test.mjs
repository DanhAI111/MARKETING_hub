import test from 'node:test';
import assert from 'node:assert/strict';
import { syncScheduleSheets } from '../shared/sheet-sync.mjs';

const fanpages = [{ id: 'fp-1', name: 'Fanpage A', platform: 'facebook' }];

test('does not adopt a legacy scheduled post when duplicate candidates match', async () => {
  const posts = [
    {
      id: 'post-1',
      fanpageId: 'fp-1',
      content: 'Same content',
      scheduledAt: '2026-06-22T03:00:00.000Z',
      mediaItems: [],
      status: 'scheduled'
    },
    {
      id: 'post-2',
      fanpageId: 'fp-1',
      content: 'Same content',
      scheduledAt: '2026-06-22T03:00:00.000Z',
      mediaItems: [],
      status: 'scheduled'
    }
  ];
  const saved = [];
  const repo = {
    listPosts: async () => posts,
    listFanpages: async () => fanpages,
    upsertPost: async (post) => {
      saved.push(post);
      return post;
    }
  };

  const csv = [
    'id,fanpage,content,scheduledAt',
    'row-1,Fanpage A,Same content,2026-06-22 10:00'
  ].join('\n');

  const result = await syncScheduleSheets({
    repo,
    sourceUrl: 'https://docs.google.com/spreadsheets/d/example/edit#gid=0',
    fetchCsv: async () => csv,
    timezoneOffset: '+07:00'
  });

  assert.equal(saved.length, 0);
  assert.equal(result.created, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.details[0].warnings.length, 1);
});

test('skips linked posts that are already published', async () => {
  const posts = [{
    id: 'post-1',
    fanpageId: 'fp-1',
    content: 'Published content',
    scheduledAt: '2026-06-22T03:00:00.000Z',
    mediaItems: [],
    sheetUrl: 'https://docs.google.com/spreadsheets/d/example/edit#gid=0',
    sheetRowKey: 'id:row-1',
    status: 'published'
  }];
  const repo = {
    listPosts: async () => posts,
    listFanpages: async () => fanpages,
    upsertPost: async () => {
      throw new Error('published post should not be updated');
    }
  };
  const csv = [
    'id,fanpage,content,scheduledAt',
    'row-1,Fanpage A,Changed content,2026-06-22 10:00'
  ].join('\n');

  const result = await syncScheduleSheets({
    repo,
    sourceUrl: posts[0].sheetUrl,
    fetchCsv: async () => csv,
    timezoneOffset: '+07:00'
  });

  assert.equal(result.skipped, 1);
  assert.equal(result.updated, 0);
});

test('reused STT with a new schedule time creates a fresh queue entry', async () => {
  // A published post already holds sheetRowKey id:row-99. The sheet now reuses
  // STT 99 for brand-new content at a different time — it must NOT be blocked
  // by the old published row; a new scheduled post is created instead.
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/example/edit#gid=0';
  const posts = [{
    id: 'post-old',
    fanpageId: 'fp-1',
    content: 'Old published content',
    scheduledAt: '2026-06-30T03:30:00.000Z',
    mediaItems: [],
    sheetUrl,
    sheetRowKey: 'id:row-99',
    status: 'published'
  }];
  const saved = [];
  const repo = {
    listSheetSyncPosts: async () => posts,
    listFanpages: async () => fanpages,
    upsertPost: async (post) => { saved.push(post); return post; }
  };
  const csv = [
    'id,fanpage,content,scheduledAt',
    'row-99,Fanpage A,New reused-STT content,2026-07-22 22:00'
  ].join('\n');

  const result = await syncScheduleSheets({
    repo,
    sourceUrl: sheetUrl,
    fetchCsv: async () => csv,
    timezoneOffset: '+07:00',
    nowIso: '2026-07-22T00:00:00.000Z'
  });

  assert.equal(result.created, 1);
  assert.equal(result.skipped, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].content, 'New reused-STT content');
  assert.equal(saved[0].status, 'scheduled');
  // New entry is keyed by row id + time, leaving the old published row intact.
  assert.equal(saved[0].sheetRowKey, 'id:row-99@2026-07-22T15:00:00.000Z');
  assert.notEqual(saved[0].id, 'post-old');
});

test('loads linked sheet sources from the unpaginated sync post list', async () => {
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/example/edit#gid=0';
  const posts = [{
    id: 'post-1',
    fanpageId: 'fp-1',
    content: 'Existing content',
    scheduledAt: '2026-06-22T03:00:00.000Z',
    mediaItems: [],
    sheetUrl,
    sheetRowKey: 'id:row-1',
    status: 'scheduled'
  }];
  const saved = [];
  const repo = {
    listPosts: async () => [],
    listSheetSyncPosts: async () => posts,
    listFanpages: async () => fanpages,
    upsertPost: async (post) => {
      saved.push(post);
      return post;
    }
  };
  const csv = [
    'id,fanpage,content,scheduledAt',
    'row-1,Fanpage A,Existing content,2026-06-22 10:00',
    'row-2,Fanpage A,New content,2026-06-22 11:00'
  ].join('\n');

  const result = await syncScheduleSheets({
    repo,
    fetchCsv: async () => csv,
    timezoneOffset: '+07:00',
    nowIso: '2026-06-01T00:00:00.000Z'
  });

  assert.equal(result.sources, 1);
  assert.equal(result.created, 1);
  assert.equal(result.updated, 1);
  assert.equal(saved.length, 2);
  assert.equal(saved[1].content, 'New content');
});

test('does not import a brand-new row whose scheduled time is already past', async () => {
  const repo = {
    listPosts: async () => [],
    listSheetSyncPosts: async () => [],
    listFanpages: async () => fanpages,
    upsertPost: async () => { throw new Error('past new row must not be created'); }
  };
  const csv = [
    'id,fanpage,content,scheduledAt',
    'row-1,Fanpage A,Old content,2026-06-22 10:00'
  ].join('\n');
  const result = await syncScheduleSheets({
    repo,
    sourceUrl: 'https://docs.google.com/spreadsheets/d/example/edit#gid=0',
    fetchCsv: async () => csv,
    timezoneOffset: '+07:00',
    nowIso: '2026-07-22T00:00:00.000Z'
  });
  assert.equal(result.created, 0);
  assert.equal(result.skipped, 1);
});

test('uses soft-deleted linked sheet rows as sync sources so they can be restored', async () => {
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/example/edit#gid=0';
  const posts = [{
    id: 'post-1',
    fanpageId: 'fp-1',
    content: 'Deleted content',
    scheduledAt: '2026-06-22T03:00:00.000Z',
    mediaItems: [],
    sheetUrl,
    sheetRowKey: 'id:row-1',
    status: 'scheduled',
    deletedAt: '2026-06-22T04:00:00.000Z'
  }];
  const saved = [];
  const repo = {
    listSheetSyncPosts: async () => posts,
    listFanpages: async () => fanpages,
    upsertPost: async (post) => {
      saved.push(post);
      return { ...post, deletedAt: '' };
    }
  };
  const csv = [
    'id,fanpage,content,scheduledAt',
    'row-1,Fanpage A,Restored content,2026-06-22 10:00'
  ].join('\n');

  const result = await syncScheduleSheets({
    repo,
    fetchCsv: async () => csv,
    timezoneOffset: '+07:00'
  });

  assert.equal(result.sources, 1);
  assert.equal(result.updated, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'post-1');
  assert.equal(saved[0].content, 'Restored content');
});
