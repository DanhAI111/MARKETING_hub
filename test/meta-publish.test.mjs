import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MetaService } from '../worker/meta.js';

const require = createRequire(import.meta.url);
const { getGoogleDriveFolderId, listGoogleDriveFolderMedia } = require('../shared/meta-helpers.cjs');

// Users logged into multiple Google accounts copy account-scoped /drive/u/<n>/folders/<id>
// links. The old regex only matched /drive/folders/ → the folder URL was treated as a
// direct image → Facebook rejected it ("Invalid parameter"/"image format not supported").
test('extracts Drive folder id from both plain and account-scoped URLs', () => {
  assert.equal(
    getGoogleDriveFolderId('https://drive.google.com/drive/folders/abc123'),
    'abc123'
  );
  assert.equal(
    getGoogleDriveFolderId('https://drive.google.com/drive/u/1/folders/1WJ6tyJ8AVVC05SyxqXpdXAW9UUnSB-w-'),
    '1WJ6tyJ8AVVC05SyxqXpdXAW9UUnSB-w-'
  );
  assert.equal(
    getGoogleDriveFolderId('https://drive.google.com/drive/u/0/folders/xyz?usp=sharing'),
    'xyz'
  );
  // non-folder URLs stay non-folders
  assert.equal(getGoogleDriveFolderId('https://drive.google.com/file/d/f1/view'), '');
  assert.equal(getGoogleDriveFolderId('https://example.com/drive/u/1/folders/evil'), '');
});

const folderHtml = (entries) => entries
  .map(([id, name]) => `<div class="flip-entry" id="entry-${id}"><div class="flip-entry-title">${name}</div></div>`)
  .join('\n');

// Drive folders can hold videos too. A video must resolve to the direct-download
// URL (a thumbnail of a video is a still image → Meta rejects/mangles it).
test('folder listing returns a direct-download video when the folder has only videos', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(folderHtml([['vid1', 'clip.mp4'], ['vid2', 'clip2.mov']]), { status: 200 });
  try {
    const items = await listGoogleDriveFolderMedia('folder-1');
    assert.equal(items.length, 1, 'exactly one video (FB/IG allow one video per post)');
    assert.equal(items[0].type, 'video');
    assert.equal(items[0].url, 'https://drive.usercontent.google.com/download?id=vid1&export=download&confirm=t');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('folder listing prefers images and keeps thumbnail URLs for them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(folderHtml([['img1', 'a.png'], ['vid1', 'clip.mp4']]), { status: 200 });
  try {
    const items = await listGoogleDriveFolderMedia('folder-1');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'image');
    assert.match(items[0].url, /thumbnail\?id=img1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test('safe test creates an unpublished Facebook post and validates its Instagram container', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), options };
    calls.push(call);
    if (call.url.endsWith('/page-1/photos')) return jsonResponse({ id: 'photo-1' });
    if (call.url.endsWith('/page-1/feed')) return jsonResponse({ id: 'fb-dark-1' });
    if (call.url.endsWith('/ig-1/media')) return jsonResponse({ id: 'ig-container-1' });
    if (call.url.includes('/ig-container-1?')) {
      return jsonResponse({ id: 'ig-container-1', status_code: 'FINISHED', status: 'Finished' });
    }
    return jsonResponse({ error: { message: `Unexpected Graph call: ${call.url}` } }, 500);
  };

  try {
    const saved = [];
    const repo = {
      decryptPageToken: async () => 'page-token',
      getFanpage: async () => ({
        id: 'fp-fb',
        platform: 'facebook',
        metaPageId: 'page-1',
        connected: true,
        crossPostInstagram: true
      }),
      getInstagramSiblingFanpage: async () => ({
        id: 'fp-ig',
        platform: 'instagram',
        instagramBusinessId: 'ig-1',
        connected: true
      }),
      setPostPublishState: async (id, updates) => saved.push({ id, updates })
    };
    const meta = new MetaService({}, repo, 'https://example.test');
    const result = await meta.testScheduledPost({
      id: 'post-test-1',
      fanpageId: 'fp-fb',
      content: 'Safe test',
      mediaItems: [{ type: 'image', url: 'https://cdn.example.test/a.jpg' }],
      publishMode: 'safe_test'
    });

    const feedCall = calls.find((call) => call.url.endsWith('/page-1/feed'));
    assert.equal(feedCall.options.body.get('published'), 'false');
    assert.ok(calls.some((call) => call.url.endsWith('/ig-1/media')));
    assert.ok(calls.some((call) => call.url.includes('/ig-container-1?')));
    assert.equal(calls.some((call) => call.url.endsWith('/ig-1/media_publish')), false);
    assert.equal(result.source, 'facebook-test');
    assert.equal(result.testResult.facebook.objectId, 'fb-dark-1');
    assert.equal(result.testResult.facebook.visibility, 'unpublished');
    assert.equal(result.testResult.instagram.containerId, 'ig-container-1');
    assert.equal(result.testResult.instagram.statusCode, 'FINISHED');
    assert.equal(saved[0].updates.testResult.facebook.objectId, 'fb-dark-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('safe Facebook video test never sets published=true', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ id: 'video-dark-1' });
  };

  try {
    const meta = new MetaService({}, {
      decryptPageToken: async () => 'page-token',
      getFanpage: async () => ({
        id: 'fp-fb', platform: 'facebook', metaPageId: 'page-1', connected: true, crossPostInstagram: false
      })
    }, 'https://example.test');

    const result = await meta.testScheduledPost({
      id: 'post-video-test',
      fanpageId: 'fp-fb',
      content: 'Safe video test',
      mediaItems: [{ type: 'video', url: 'https://cdn.example.test/video.mp4' }],
      publishMode: 'safe_test'
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/page-1\/videos$/);
    assert.equal(calls[0].options.body.get('published'), 'false');
    assert.equal(result.testResult.facebook.objectId, 'video-dark-1');
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

test('Facebook sync persists organic reactions, comments, and shares', async () => {
  const saved = [];
  const meta = new MetaService({}, {
    decryptPageToken: async () => 'page-token',
    upsertPost: async (post) => {
      saved.push(post);
      return post;
    },
    markMissingSyncedPostsDeleted: async () => 0
  }, 'https://example.test');
  meta.fetchFacebookPostBatch = async () => ({
    posts: [{
      id: 'fb-post-1',
      message: 'Launch',
      created_time: '2026-07-25T01:00:00.000Z',
      reactions: { summary: { total_count: 123 } },
      comments: { summary: { total_count: 45 } },
      shares: { count: 6 }
    }]
  });

  const count = await meta.syncFacebookPosts({
    id: 'fp-1',
    metaPageId: 'page-1'
  }, { limit: 100 });

  assert.equal(count, 1);
  assert.deepEqual(
    {
      likes: saved[0].engagement.likes,
      comments: saved[0].engagement.comments,
      shares: saved[0].engagement.shares,
      reach: saved[0].engagement.reach
    },
    { likes: 123, comments: 45, shares: 6, reach: 0 }
  );
  assert.match(saved[0].engagement.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('Instagram sync persists like and comment counts', async () => {
  const saved = [];
  const meta = new MetaService({}, {
    decryptPageToken: async () => 'page-token',
    upsertPost: async (post) => {
      saved.push(post);
      return post;
    },
    markMissingSyncedPostsDeleted: async () => 0
  }, 'https://example.test');
  meta.graphGet = async () => ({
    data: [{
      id: 'ig-post-1',
      caption: 'Launch',
      timestamp: '2026-07-25T01:00:00.000Z',
      like_count: 88,
      comments_count: 12
    }]
  });

  const count = await meta.syncInstagramMedia({
    id: 'fp-ig',
    instagramBusinessId: 'ig-1'
  }, { limit: 100 });

  assert.equal(count, 1);
  assert.deepEqual(
    {
      likes: saved[0].engagement.likes,
      comments: saved[0].engagement.comments,
      shares: saved[0].engagement.shares,
      reach: saved[0].engagement.reach
    },
    { likes: 88, comments: 12, shares: 0, reach: 0 }
  );
});

// Regression guard for the Bearer-token change (fix E): graphGet must send the
// access_token as an Authorization: Bearer header and NEVER in the query string
// (query leaks via logs/proxies). This path is the one hitting the real Graph API
// first in production, so lock the exact wire format.
test('graphGet sends access_token as Bearer header, not in query string', async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = '';
  let seenAuth = '';
  globalThis.fetch = async (url, options = {}) => {
    seenUrl = String(url);
    seenAuth = (options.headers && options.headers.Authorization) || '';
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const meta = new MetaService({}, {}, 'https://example.com');
    await meta.graphGet('me/accounts', { access_token: 'secret-token-123', fields: 'id,name' });
    // token must be in the header
    assert.equal(seenAuth, 'Bearer secret-token-123');
    // token must NOT appear anywhere in the URL/query
    assert.ok(!seenUrl.includes('secret-token-123'), 'access_token leaked into the URL');
    assert.ok(!seenUrl.includes('access_token'), 'access_token key leaked into the query string');
    // other params still go in the query
    assert.ok(seenUrl.includes('fields=id%2Cname'), 'normal params should stay in the query');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('graphGet with no access_token sends no Authorization header', async () => {
  const originalFetch = globalThis.fetch;
  let seenAuth = 'UNSET';
  globalThis.fetch = async (url, options = {}) => {
    seenAuth = options.headers ? options.headers.Authorization : undefined;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const meta = new MetaService({}, {}, 'https://example.com');
    await meta.graphGet('some/public', { fields: 'id' });
    assert.equal(seenAuth, undefined, 'no token -> no Authorization header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// IG video defers across cron ticks (no blocking poll — Cloudflare CPU budget).
// Tick 1: create the REELS container and park its id, no publish yet.
test('defers an Instagram video on the first tick by creating a REELS container', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, body: options.body });
    if (u.endsWith('/ig-1/media')) return jsonResponse({ id: 'reel-container-1' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'Reel caption', mediaItems: [{ type: 'video', url: 'https://cdn.example.test/reel.mp4' }] }
    );
    // deferred, not published
    assert.equal(result.deferred, true);
    assert.equal(result.igContainerId, 'reel-container-1');
    // container must be created as a REELS video, not an image
    const container = calls.find((c) => c.url.endsWith('/ig-1/media'));
    assert.equal(container.body.get('media_type'), 'REELS');
    assert.equal(container.body.get('video_url'), 'https://cdn.example.test/reel.mp4');
    assert.equal(container.body.get('image_url'), null);
    // must NOT publish on the first tick
    assert.equal(calls.some((c) => c.url.endsWith('/ig-1/media_publish')), false, 'no publish on tick 1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Tick 2: container already parked. FINISHED → single status check, then media_publish.
test('publishes a deferred Instagram video once its container is FINISHED', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/reel-container-1')) return jsonResponse({ status_code: 'FINISHED' });
    if (u.endsWith('/ig-1/media_publish')) return jsonResponse({ id: 'ig-reel-1' });
    if (u.includes('/ig-reel-1')) return jsonResponse({ permalink: 'https://instagram.com/reel/1', media_url: 'https://cdn/reel.mp4' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'Reel caption', igContainerId: 'reel-container-1', mediaItems: [{ type: 'video', url: 'https://cdn.example.test/reel.mp4' }] }
    );
    assert.equal(result.externalPostId, 'ig-reel-1');
    assert.equal(result.permalink, 'https://instagram.com/reel/1');
    assert.equal(result.igContainerId, '', 'container marker cleared after publish');
    // no second container created — reused the parked one
    assert.equal(calls.some((u) => u.endsWith('/ig-1/media')), false, 'no new container');
    assert.ok(calls.some((u) => u.includes('/reel-container-1')), 'checked parked container status');
    assert.ok(calls.some((u) => u.endsWith('/ig-1/media_publish')), 'published parked container');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Still encoding → defer again (reuse the same container id), never publish.
test('re-defers a deferred Instagram video while its container is still processing', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/reel-container-1')) return jsonResponse({ status_code: 'IN_PROGRESS' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'Reel caption', igContainerId: 'reel-container-1', mediaItems: [{ type: 'video', url: 'https://cdn.example.test/reel.mp4' }] }
    );
    assert.equal(result.deferred, true);
    assert.equal(result.igContainerId, 'reel-container-1');
    assert.equal(calls.some((u) => u.endsWith('/ig-1/media_publish')), false, 'not published while processing');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Multiple images = a real IG carousel: child containers with is_carousel_item,
// then a CAROUSEL parent referencing them, then one media_publish.
test('publishes multiple Instagram images as a carousel', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, body: options.body });
    if (u.endsWith('/ig-1/media')) {
      const isChild = options.body?.get('is_carousel_item') === 'true';
      if (isChild) return jsonResponse({ id: `child-${calls.filter(c => c.body?.get?.('is_carousel_item') === 'true').length}` });
      return jsonResponse({ id: 'carousel-1' });
    }
    if (u.endsWith('/ig-1/media_publish')) return jsonResponse({ id: 'ig-carousel-post' });
    if (u.includes('/ig-carousel-post')) return jsonResponse({ permalink: 'https://instagram.com/p/car1' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      {
        content: 'Album caption',
        mediaItems: [
          { type: 'image', url: 'https://cdn.example.test/1.jpg' },
          { type: 'image', url: 'https://cdn.example.test/2.jpg' },
          { type: 'image', url: 'https://cdn.example.test/3.jpg' }
        ]
      }
    );
    assert.equal(result.externalPostId, 'ig-carousel-post');
    assert.equal(result.warning, '', 'no "only first image" warning anymore');
    const children = calls.filter((c) => c.body?.get?.('is_carousel_item') === 'true');
    assert.equal(children.length, 3, 'one child container per image');
    assert.equal(children[0].body.get('image_url'), 'https://cdn.example.test/1.jpg');
    const parent = calls.find((c) => c.body?.get?.('media_type') === 'CAROUSEL');
    assert.ok(parent, 'carousel parent container created');
    assert.equal(parent.body.get('children'), 'child-1,child-2,child-3');
    assert.equal(parent.body.get('caption'), 'Album caption');
    // caption only on the parent, not the children
    assert.equal(children.every((c) => !c.body.get('caption')), true);
    const publishes = calls.filter((c) => c.url.endsWith('/ig-1/media_publish'));
    assert.equal(publishes.length, 1, 'single publish for the whole carousel');
    assert.equal(publishes[0].body.get('creation_id'), 'carousel-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('single Instagram image still publishes as a plain image container', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, body: options.body });
    if (u.endsWith('/ig-1/media')) return jsonResponse({ id: 'img-1' });
    if (u.endsWith('/ig-1/media_publish')) return jsonResponse({ id: 'ig-img-post' });
    if (u.includes('/ig-img-post')) return jsonResponse({ permalink: 'https://instagram.com/p/img1' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'One image', mediaItems: [{ type: 'image', url: 'https://cdn.example.test/1.jpg' }] }
    );
    assert.equal(result.externalPostId, 'ig-img-post');
    const container = calls.find((c) => c.url.endsWith('/ig-1/media'));
    assert.equal(container.body.get('media_type'), null, 'no CAROUSEL for single image');
    assert.equal(container.body.get('is_carousel_item'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Meta 9007/2207027 "Media ID is not available" = image container still processing
// (happens with slow sources like Drive downloads). Must defer, not fail.
test('defers an Instagram image when media_publish says the container is not ready', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/ig-1/media')) return jsonResponse({ id: 'img-container-1' });
    if (u.endsWith('/ig-1/media_publish')) {
      return jsonResponse({ error: { message: 'Media ID is not available', code: 9007, error_subcode: 2207027 } }, 400);
    }
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'Caption', mediaItems: [{ type: 'image', url: 'https://cdn.example.test/a.jpg' }] }
    );
    assert.equal(result.deferred, true);
    assert.equal(result.igContainerId, 'img-container-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishes a parked Instagram image container once FINISHED without recreating it', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/img-container-1')) return jsonResponse({ status_code: 'FINISHED' });
    if (u.endsWith('/ig-1/media_publish')) return jsonResponse({ id: 'ig-img-1' });
    if (u.includes('/ig-img-1')) return jsonResponse({ permalink: 'https://instagram.com/p/1' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    const result = await meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'Caption', igContainerId: 'img-container-1', mediaItems: [{ type: 'image', url: 'https://cdn.example.test/a.jpg' }] }
    );
    assert.equal(result.externalPostId, 'ig-img-1');
    assert.equal(result.igContainerId, '', 'marker cleared');
    assert.equal(calls.some((u) => u.endsWith('/ig-1/media')), false, 'no duplicate container');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fails a deferred Instagram video whose container reports an error status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/reel-container-2')) return jsonResponse({ status_code: 'ERROR', status: 'Định dạng video không hợp lệ' });
    return jsonResponse({ error: { message: `Unexpected Graph call: ${u}` } }, 500);
  };
  try {
    const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
    await assert.rejects(
      meta.publishInstagramPost(
        { platform: 'instagram', instagramBusinessId: 'ig-1' },
        { content: 'Reel caption', igContainerId: 'reel-container-2', mediaItems: [{ type: 'video', url: 'https://cdn.example.test/reel.mp4' }] }
      ),
      /Định dạng video không hợp lệ/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects an Instagram video that is not a public URL', async () => {
  const meta = new MetaService({}, { decryptPageToken: async () => 'ig-token' }, 'https://example.test');
  await assert.rejects(
    meta.publishInstagramPost(
      { platform: 'instagram', instagramBusinessId: 'ig-1' },
      { content: 'Reel caption', mediaItems: [{ type: 'video', url: 'data:video/mp4;base64,AAAA' }] }
    ),
    /công khai/
  );
});
