import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { Repository } from '../worker/repository.js';

const contentSource = fs.readFileSync(new URL('../js/pages/content.js', import.meta.url), 'utf8');
const contentCss = fs.readFileSync(new URL('../css/pages.css', import.meta.url), 'utf8');
const metaSource = fs.readFileSync(new URL('../worker/meta.js', import.meta.url), 'utf8');

test('content page renders from one store snapshot instead of reparsing storage for every row', () => {
  const renderPageSource = contentSource.slice(
    contentSource.indexOf('const renderPage ='),
    contentSource.indexOf('const renderIntegrationPanel =')
  );

  assert.match(renderPageSource, /const data = Store\.getData\(\)/);
  assert.doesNotMatch(renderPageSource, /Store\.(fanpages|posts|tasks|campaigns)\./);
  assert.doesNotMatch(renderPageSource, /Store\.fanpages\.getById/);
});

test('fanpage controls render the real profile image with a text fallback', () => {
  const controlSource = contentSource.slice(
    contentSource.indexOf('const renderFanpageControl ='),
    contentSource.indexOf('const renderFanpageCard =')
  );

  assert.match(controlSource, /fp\.imageUrl/);
  assert.match(controlSource, /fanpage-control-avatar/);
  assert.match(controlSource, /<img[^>]+loading="lazy"/);
  assert.match(controlSource, /fanpage-avatar-fallback/);
});

test('post rows render lazy thumbnails and progressively reveal long lists', () => {
  assert.match(contentSource, /const POSTS_PAGE_SIZE = 60/);
  assert.match(contentSource, /monthPosts\.slice\(0,\s*visiblePostLimit\)/);
  assert.match(contentSource, /id="loadMorePostsBtn"/);
  assert.match(contentSource, /const getPostThumbnail =/);
  assert.match(contentSource, /post\.mediaUrl/);
  assert.match(contentSource, /post-thumbnail-image/);
  assert.match(contentCss, /\.post-thumbnail/);
  assert.match(contentCss, /\.post-thumbnail-image/);
});

test('Instagram sync stores a still thumbnail for videos', () => {
  assert.match(metaSource, /media_type/);
  assert.match(
    metaSource,
    /item\.media_type === 'VIDEO'\s*\?\s*\(item\.thumbnail_url \|\| item\.media_url \|\| ''\)/
  );
});

test('D1 missing-post pruning binds the synced ID list as one JSON parameter', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          calls.push({ sql, params });
          return {
            run: async () => ({ meta: { changes: 0 } })
          };
        }
      };
    }
  };
  const repo = new Repository({
    DB: db,
    TOKEN_ENCRYPTION_KEY: 'test-token-encryption-key-32-characters'
  });
  const ids = Array.from({ length: 100 }, (_, index) => `post-${index + 1}`);

  await repo.markMissingSyncedPostsDeleted({
    fanpageId: 'fanpage-1',
    source: 'facebook',
    externalPostIds: ids,
    sinceDate: '2026-07-01'
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /json_each\(\?\)/);
  assert.ok(calls[0].params.length <= 6, `expected <= 6 SQL variables, got ${calls[0].params.length}`);
  assert.deepEqual(JSON.parse(calls[0].params.at(-1)), ids);
});
