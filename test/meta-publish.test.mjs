import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaService } from '../worker/meta.js';

test('publishes a Facebook video without creating a second feed share', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/page-1/videos')) {
      return new Response(JSON.stringify({ id: 'video-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: { message: 'Unexpected Graph call' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const meta = new MetaService({}, {
      decryptPageToken: async () => 'page-token'
    }, 'https://example.test');

    const result = await meta.publishFacebookPost(
      { platform: 'facebook', metaPageId: 'page-1' },
      {
        content: 'Video caption',
        mediaItems: [{ type: 'video', url: 'https://cdn.example.test/video.mp4' }]
      }
    );

    assert.equal(result.externalPostId, 'video-1');
    assert.equal(result.permalink, 'https://www.facebook.com/page-1/videos/video-1');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/page-1\/videos$/);
    assert.doesNotMatch(calls[0].url, /\/feed$/);
    assert.equal(calls[0].options.body.get('description'), 'Video caption');
    assert.equal(calls[0].options.body.get('published'), 'true');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Cross-post: a Facebook page with crossPostInstagram publishes to both FB and its
// Instagram sibling (same metaPageId).
const makeCrossPostFetch = (calls) => async (url, options = {}) => {
  const u = String(url);
  calls.push(u);
  if (u.endsWith('/page-1/photos')) return jsonResponse({ id: 'photo-1' });
  if (u.endsWith('/page-1/feed')) return jsonResponse({ id: 'fb-1' });
  if (u.endsWith('/ig-1/media')) return jsonResponse({ id: 'ig-container-1' });
  if (u.endsWith('/ig-1/media_publish')) return jsonResponse({ id: 'ig-post-1' });
  if (u.includes('/ig-post-1')) return jsonResponse({ permalink: 'https://instagram.com/p/ig-1' });
  return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
};
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('cross-posts a Facebook post to its Instagram sibling', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = makeCrossPostFetch(calls);
  const saved = [];
  try {
    const repo = {
      decryptPageToken: async () => 'page-token',
      getFanpage: async () => ({ id: 'fp-fb', platform: 'facebook', metaPageId: 'page-1', connected: true, crossPostInstagram: true }),
      getInstagramSiblingFanpage: async () => ({ id: 'fp-ig', platform: 'instagram', metaPageId: 'page-1', instagramBusinessId: 'ig-1', connected: true }),
      setPostPublishState: async (id, updates) => { saved.push({ id, updates }); }
    };
    const meta = new MetaService({}, repo, 'https://example.test');
    const result = await meta.publishScheduledPost({
      id: 'post-1', fanpageId: 'fp-fb', content: 'Hello',
      mediaItems: [{ type: 'image', url: 'https://cdn.example.test/a.jpg' }]
    });
    assert.equal(result.externalPostId, 'fb-1');
    assert.equal(result.source, 'facebook');
    assert.ok(calls.some((u) => u.endsWith('/ig-1/media_publish')), 'IG published');
    // FB result persisted before the IG attempt.
    assert.equal(saved[0].updates.externalPostId, 'fb-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cross-post retry does not re-publish Facebook', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = makeCrossPostFetch(calls);
  try {
    const repo = {
      decryptPageToken: async () => 'page-token',
      getFanpage: async () => ({ id: 'fp-fb', platform: 'facebook', metaPageId: 'page-1', connected: true, crossPostInstagram: true }),
      getInstagramSiblingFanpage: async () => ({ id: 'fp-ig', platform: 'instagram', metaPageId: 'page-1', instagramBusinessId: 'ig-1', connected: true }),
      setPostPublishState: async () => {}
    };
    const meta = new MetaService({}, repo, 'https://example.test');
    // Retry: FB already published (externalPostId set), only IG should run.
    const result = await meta.publishScheduledPost({
      id: 'post-1', fanpageId: 'fp-fb', content: 'Hello', externalPostId: 'fb-1', permalink: 'https://www.facebook.com/fb-1',
      mediaItems: [{ type: 'image', url: 'https://cdn.example.test/a.jpg' }]
    });
    assert.equal(result.externalPostId, 'fb-1');
    assert.equal(calls.filter((u) => u.endsWith('/page-1/feed')).length, 0, 'FB feed not called again');
    assert.ok(calls.some((u) => u.endsWith('/ig-1/media_publish')), 'IG published on retry');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
