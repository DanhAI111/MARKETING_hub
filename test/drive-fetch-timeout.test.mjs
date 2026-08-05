import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  fetchWithTimeout,
  resolveMediaItems
} = require('../shared/meta-helpers.cjs');

// A fetch that hangs until its abort signal fires, then rejects like the real
// runtime does. Proves the timeout wins instead of the request hanging forever.
const hangingFetch = () => (url, options = {}) =>
  new Promise((_resolve, reject) => {
    const signal = options.signal;
    if (!signal) return; // never resolves without a signal → would hang
    if (signal.aborted) return reject(abortError());
    signal.addEventListener('abort', () => reject(abortError()));
  });

const abortError = () => {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
};

test('fetchWithTimeout aborts a hung request within the timeout', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = hangingFetch();
  try {
    const started = Date.now();
    await assert.rejects(
      fetchWithTimeout('https://drive.google.com/anything', {}, 50),
      /Hết thời gian tải media từ Google Drive/
    );
    assert.ok(Date.now() - started < 1000, 'should reject promptly, not hang');
  } finally {
    globalThis.fetch = original;
  }
});

// Rejects with AbortError as soon as the signal fires — same failure shape as a
// real timeout, without waiting the full 8s default so the suite stays fast.
const abortingFetch = () => (url, options = {}) =>
  new Promise((_resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) return reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()));
    // Simulate an abort arriving quickly (as if the deadline were tiny).
    queueMicrotask(() => signal?.dispatchEvent?.(new Event('abort')));
  });

test('a hung Drive HEAD fails one media item without hanging the batch', async () => {
  const original = globalThis.fetch;
  // Drive file URL triggers the HEAD probe in resolveMediaItem; make it abort.
  globalThis.fetch = abortingFetch();
  try {
    const post = {
      mediaItems: [{ type: 'image', url: 'https://drive.google.com/file/d/ABC123/view' }]
    };
    await assert.rejects(
      resolveMediaItems(post),
      /Hết thời gian tải media từ Google Drive/
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('a non-Drive URL never triggers a Drive fetch and resolves offline', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not fetch'); };
  try {
    const post = {
      mediaItems: [{ type: 'image', url: 'https://cdn.example.com/pic.jpg' }]
    };
    const items = await resolveMediaItems(post);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://cdn.example.com/pic.jpg');
    assert.equal(called, false, 'plain public URLs must not hit the network');
  } finally {
    globalThis.fetch = original;
  }
});
