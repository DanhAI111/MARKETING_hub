import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contentSource = fs.readFileSync(new URL('../js/pages/content.js', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const storeSource = fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');

test('manual schedule form exposes a clearly labelled non-public test mode', () => {
  assert.match(contentSource, /Đăng thử — không công khai/);
  assert.match(contentSource, /data-field="publishMode"/);
  assert.match(contentSource, /value="safe_test"/);
  assert.match(contentSource, /Instagram[^<]*(container|media)/i);
});

test('safe test uses a post-specific API instead of processing the live due queue', () => {
  assert.match(apiSource, /\/api\/posts\/\$\{encodeURIComponent\(id\)\}\/run-test/);
  assert.match(apiSource, /const createPost = async/);
  assert.match(contentSource, /RemoteStore\.runPostTest\(/);
});

test('tested posts are terminal and excluded from publishing KPIs and pending queues', () => {
  assert.match(storeSource, /TERMINAL_POST_STATUSES/);
  assert.match(storeSource, /new Set\(\['published', 'tested'\]\)/);
  assert.match(storeSource, /p\.status === 'published'/);
});
