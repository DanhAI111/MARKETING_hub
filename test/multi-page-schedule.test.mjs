import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import ScheduleBatch from '../js/schedule-batch.js';

const contentSource = fs.readFileSync(new URL('../js/pages/content.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../manage_MKT.html', import.meta.url), 'utf8');

const facebook = {
  id: 'fb-1',
  name: 'Facebook One',
  platform: 'facebook',
  connected: true,
  metaPageId: 'meta-1',
  crossPostInstagram: false
};

const instagram = {
  id: 'ig-1',
  name: 'Instagram One',
  platform: 'instagram',
  connected: true,
  metaPageId: 'meta-1'
};

test('buildEntries creates one independent schedule per selected page with shared post fields', () => {
  const entries = ScheduleBatch.buildEntries({
    fanpages: [facebook, instagram],
    content: 'Cùng một nội dung',
    scheduledAt: '2026-08-05T02:30:00.000Z',
    date: '2026-08-05',
    mediaItems: [{ type: 'image', url: 'https://example.com/post.jpg' }],
    publishMode: 'live',
    approvalStatus: 'pending',
    campaignId: 'campaign-1'
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => entry.payload.fanpageId), ['fb-1', 'ig-1']);
  assert.ok(entries.every(entry => entry.payload.content === 'Cùng một nội dung'));
  assert.ok(entries.every(entry => entry.payload.scheduledAt === '2026-08-05T02:30:00.000Z'));
  assert.notEqual(entries[0].payload.mediaItems, entries[1].payload.mediaItems);

  entries[0].payload.mediaItems[0].url = 'https://example.com/changed.jpg';
  assert.equal(entries[1].payload.mediaItems[0].url, 'https://example.com/post.jpg');
});

test('validateSelection requires at least one page and applies Instagram media constraints to the whole selection', () => {
  assert.deepEqual(
    ScheduleBatch.validateSelection({ fanpages: [], mediaItems: [], publishMode: 'live', remoteAvailable: true }),
    ['Vui lòng chọn ít nhất một fanpage hoặc tài khoản']
  );

  const emptyInstagram = ScheduleBatch.validateSelection({
    fanpages: [facebook, instagram],
    mediaItems: [],
    publishMode: 'live',
    remoteAvailable: true
  });
  assert.ok(
    emptyInstagram.some(error => error.includes('Instagram One') && error.includes('ít nhất một ảnh hoặc video')),
    'every selected Facebook and Instagram destination must require media'
  );

  const errors = ScheduleBatch.validateSelection({
    fanpages: [facebook, instagram],
    mediaItems: [{ type: 'image', url: 'data:image/png;base64,abc' }, { type: 'video', url: 'https://example.com/reel.mp4' }],
    publishMode: 'live',
    remoteAvailable: true
  });

  // base64 media still rejected — IG needs a public URL
  assert.ok(errors.some(error => error.includes('Instagram One') && error.includes('URL công khai')));
  // IG video/Reels is now supported — a public video URL must NOT be blocked
  assert.ok(!errors.some(error => error.includes('video/Reels')));

  // a public video URL alone passes validation for Instagram
  const videoOk = ScheduleBatch.validateSelection({
    fanpages: [instagram],
    mediaItems: [{ type: 'video', url: 'https://example.com/reel.mp4' }],
    publishMode: 'live',
    remoteAvailable: true
  });
  assert.deepEqual(videoOk, []);
});

test('validateSelection allows paired Facebook and Instagram destinations as independent schedules', () => {
  const errors = ScheduleBatch.validateSelection({
    fanpages: [{ ...facebook, crossPostInstagram: true }, instagram],
    mediaItems: [{ type: 'image', url: 'https://example.com/post.jpg' }],
    publishMode: 'live',
    remoteAvailable: true
  });

  assert.deepEqual(errors, []);
});

test('validateSelection keeps safe testing limited to supported connected backend flow', () => {
  const tiktok = { id: 'tt-1', name: 'TikTok One', platform: 'tiktok', connected: true };
  const noBackend = ScheduleBatch.validateSelection({
    fanpages: [facebook], mediaItems: [{ type: 'image', url: 'data:image/png;base64,abc' }], publishMode: 'safe_test', remoteAvailable: false
  });
  const unsupported = ScheduleBatch.validateSelection({
    fanpages: [facebook, tiktok], mediaItems: [{ type: 'image', url: 'data:image/png;base64,abc' }], publishMode: 'safe_test', remoteAvailable: true
  });

  assert.ok(noBackend.some(error => error.includes('backend')));
  assert.ok(unsupported.some(error => error.includes('TikTok One')));
});

test('execute continues after one page fails and reports successes and failures independently', async () => {
  const entries = [facebook, instagram].map(fanpage => ({ fanpage, payload: { fanpageId: fanpage.id } }));
  const visited = [];
  const result = await ScheduleBatch.execute(entries, async entry => {
    visited.push(entry.fanpage.id);
    if (entry.fanpage.id === 'fb-1') throw new Error('Meta refused page');
    return { id: 'saved-ig' };
  });

  assert.deepEqual(visited, ['fb-1', 'ig-1']);
  assert.deepEqual(result.succeeded.map(item => item.entry.fanpage.id), ['ig-1']);
  assert.equal(result.failed[0].entry.fanpage.id, 'fb-1');
  assert.equal(result.failed[0].error.message, 'Meta refused page');
});

test('manual schedule UI exposes multi-page selection and loads the batch helper before the content page', () => {
  assert.match(htmlSource, /js\/schedule-batch\.js/);
  assert.match(contentSource, /schedule-fanpage-checkbox/);
  assert.match(contentSource, /Chọn tất cả/);
  assert.match(contentSource, /ScheduleBatch\.buildEntries/);
  assert.match(contentSource, /ScheduleBatch\.execute/);
});
