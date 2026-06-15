require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const repo = require('./repository');
const meta = require('./meta');
const auth = require('./auth');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost');
const PUBLIC_DIR = path.join(__dirname, '..');
const states = new Set();
let lastSync = null;
let syncInFlight = null;
let publishInFlight = false;

app.use(express.json({ limit: '25mb' }));
auth.installRoutes(app);
app.use(auth.middleware);
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'manage_MKT.html'
}));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const runSync = async () => {
  if (syncInFlight) return syncInFlight;
  syncInFlight = meta.syncAll()
    .then((result) => {
      lastSync = result;
      return result;
    })
    .finally(() => {
      syncInFlight = null;
    });
  return syncInFlight;
};

const processScheduledPosts = async () => {
  if (publishInFlight) return { skipped: true };
  publishInFlight = true;
  const result = { startedAt: new Date().toISOString(), published: 0, failed: 0, posts: [] };
  try {
    const duePosts = await repo.listDueScheduledPosts();
    for (const post of duePosts) {
      try {
        await repo.setPostPublishState(post.id, { status: 'publishing', publishError: '' });
        const published = await meta.publishScheduledPost(post);
        await repo.setPostPublishState(post.id, {
          ...published,
          status: 'published',
          source: post.source || 'meta',
          date: new Date().toISOString().slice(0, 10),
          publishedAt: new Date().toISOString(),
          publishError: ''
        });
        result.published++;
        result.posts.push({ id: post.id, status: 'published' });
      } catch (err) {
        await repo.setPostPublishState(post.id, {
          status: 'failed',
          publishError: err.message || 'Không thể đăng bài tự động'
        });
        result.failed++;
        result.posts.push({ id: post.id, status: 'failed', error: err.message });
      }
    }
    result.finishedAt = new Date().toISOString();
    return result;
  } finally {
    publishInFlight = false;
  }
};

const googleSheetCsvUrls = (inputUrl) => {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    const err = new Error('Link Google Sheets không hợp lệ');
    err.status = 400;
    throw err;
  }

  if (url.hostname !== 'docs.google.com') {
    const err = new Error('Chỉ hỗ trợ link Google Sheets từ docs.google.com');
    err.status = 400;
    throw err;
  }

  if (url.pathname.includes('/spreadsheets/') && (url.searchParams.get('output') === 'csv' || url.searchParams.get('format') === 'csv')) {
    return [url.toString()];
  }

  const publishedMatch = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([^/]+)/);
  const regularMatch = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/);
  if (!publishedMatch && !regularMatch) {
    const err = new Error('Không tìm thấy Google Sheets ID trong link');
    err.status = 400;
    throw err;
  }

  const hashParams = new URLSearchParams(String(url.hash || '').replace(/^#/, ''));
  const gid = url.searchParams.get('gid') || hashParams.get('gid') || '0';
  if (publishedMatch) {
    const id = publishedMatch[1];
    return [
      `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=csv&gid=${encodeURIComponent(gid)}`,
      `https://docs.google.com/spreadsheets/d/e/${id}/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`
    ];
  }
  const id = regularMatch[1];
  return [
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`,
    `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv&gid=${encodeURIComponent(gid)}`
  ];
};

const fetchGoogleSheetCsvText = async (inputUrl, { signal } = {}) => {
  const headers = {
    'Accept': 'text/csv,text/plain,*/*',
    'User-Agent': 'Mozilla/5.0 MarketingHub/1.0'
  };
  let lastStatus = 0;
  let lastText = '';
  for (const csvUrl of googleSheetCsvUrls(inputUrl)) {
    const response = await fetch(csvUrl, { headers, signal });
    const text = await response.text();
    lastStatus = response.status;
    lastText = text;
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHtml = /^\s*<!doctype html|^\s*<html[\s>]/i.test(text);
    if (response.ok && text.trim() && !looksLikeHtml && !contentType.includes('text/html')) {
      return text;
    }
  }
  const err = new Error(
    lastText && /^\s*<!doctype html|^\s*<html[\s>]/i.test(lastText)
      ? 'Google trả về trang HTML thay vì CSV. Hãy dùng File > Share > Publish to web hoặc tải CSV lên trực tiếp.'
      : 'Không thể đọc Google Sheets. Hãy kiểm tra quyền chia sẻ hoặc publish sheet.'
  );
  err.status = lastStatus || 400;
  throw err;
};

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    authRequired: auth.required(),
    metaConfigured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
    lastSync,
    publisher: {
      inFlight: publishInFlight
    }
  });
});

app.get('/api/bootstrap', asyncHandler(async (req, res) => {
  res.json({
    ...await repo.getBootstrapData(),
    lastSync
  });
}));

app.post('/api/fanpages/import-local', asyncHandler(async (req, res) => {
  res.json(await repo.importLocalData(req.body || {}));
}));

app.get('/api/fanpages', asyncHandler(async (req, res) => {
  res.json(await repo.listFanpages());
}));

app.post('/api/fanpages', asyncHandler(async (req, res) => {
  res.status(201).json(await repo.upsertFanpage(req.body || {}));
}));

app.put('/api/fanpages/:id', asyncHandler(async (req, res) => {
  res.json(await repo.upsertFanpage({ ...(req.body || {}), id: req.params.id }));
}));

app.delete('/api/fanpages/:id', asyncHandler(async (req, res) => {
  await repo.deleteFanpage(req.params.id);
  res.status(204).end();
}));

app.get('/api/posts', asyncHandler(async (req, res) => {
  const month = req.query.month;
  const posts = (await repo.listPosts()).filter((post) => !month || post.date.startsWith(month));
  res.json(posts);
}));

app.post('/api/posts', asyncHandler(async (req, res) => {
  const post = await repo.upsertPost(req.body || {});
  if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
    setTimeout(() => processScheduledPosts().catch((err) => console.error('Immediate publish failed:', err.message)), 100).unref();
  }
  res.status(201).json(post);
}));

app.put('/api/posts/:id', asyncHandler(async (req, res) => {
  const post = await repo.upsertPost({ ...(req.body || {}), id: req.params.id });
  if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
    setTimeout(() => processScheduledPosts().catch((err) => console.error('Immediate publish failed:', err.message)), 100).unref();
  }
  res.json(post);
}));

app.delete('/api/posts/:id', asyncHandler(async (req, res) => {
  await repo.deletePost(req.params.id);
  res.status(204).end();
}));

app.get('/api/collections/:collection', asyncHandler(async (req, res) => {
  res.json(await repo.listAppItems(req.params.collection));
}));

app.post('/api/collections/:collection', asyncHandler(async (req, res) => {
  res.status(201).json(await repo.upsertAppItem(req.params.collection, req.body || {}));
}));

app.put('/api/collections/:collection/:id', asyncHandler(async (req, res) => {
  res.json(await repo.upsertAppItem(req.params.collection, { ...(req.body || {}), id: req.params.id }));
}));

app.delete('/api/collections/:collection/:id', asyncHandler(async (req, res) => {
  await repo.deleteAppItem(req.params.collection, req.params.id);
  res.status(204).end();
}));

app.get('/api/singletons/:key', asyncHandler(async (req, res) => {
  res.json({ value: await repo.getSingleton(req.params.key) });
}));

app.put('/api/singletons/:key', asyncHandler(async (req, res) => {
  res.json({ value: await repo.saveSingleton(req.params.key, req.body?.value ?? null) });
}));

app.post('/api/sync', asyncHandler(async (req, res) => {
  res.json(await runSync());
}));

app.post('/api/publish-due', asyncHandler(async (req, res) => {
  res.json(await processScheduledPosts());
}));

app.post('/api/google-sheets/csv', asyncHandler(async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const text = await fetchGoogleSheetCsvText(req.body?.url || '', { signal: controller.signal });
    if (text.length > 2 * 1024 * 1024) {
      const err = new Error('File Google Sheets quá lớn. Vui lòng giới hạn dưới 2MB CSV.');
      err.status = 413;
      throw err;
    }
    res.json({ text });
  } finally {
    clearTimeout(timeout);
  }
}));

app.get('/api/sync/status', (req, res) => {
  res.json({ inFlight: !!syncInFlight, lastSync });
});

app.get('/auth/meta/start', asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  states.add(state);
  setTimeout(() => states.delete(state), 10 * 60 * 1000).unref();
  res.redirect(meta.authUrl(state));
}));

app.get('/auth/meta/callback', asyncHandler(async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    res.redirect(`/?meta_error=${encodeURIComponent(errorDescription || error)}#content`);
    return;
  }
  if (!code || !state || !states.has(state)) {
    res.redirect(`/?meta_error=${encodeURIComponent('Phiên liên kết Meta đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.') }#content`);
    return;
  }
  states.delete(state);
  try {
    const token = await meta.exchangeCode(code);
    await meta.connectPages(token);
    await runSync();
    res.redirect('/?meta_connected=1#content');
  } catch (err) {
    console.error('Meta callback failed:', err);
    const message = err.message || 'Không thể hoàn tất liên kết Meta.';
    res.redirect(`/?meta_error=${encodeURIComponent(message)}#content`);
  }
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

const startSchedulers = () => {
  setInterval(() => {
    runSync().catch((err) => console.error('Scheduled sync failed:', err.message));
  }, 15 * 60 * 1000).unref();

  setInterval(() => {
    processScheduledPosts().catch((err) => console.error('Scheduled publish failed:', err.message));
  }, 60 * 1000).unref();

  setTimeout(() => {
    processScheduledPosts().catch((err) => console.error('Startup publish failed:', err.message));
  }, 2000).unref();
};

const start = async () => {
  await repo.init();
  startSchedulers();
  app.listen(PORT, HOST, () => {
    console.log(`Marketing Hub running at http://${HOST}:${PORT}`);
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      console.log('Meta OAuth is disabled until META_APP_ID and META_APP_SECRET are set in .env');
    }
    if (auth.required() && !auth.configured()) {
      console.log('Google login is required but GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are missing.');
    }
  });
};

start().catch((err) => {
  console.error('Failed to start Marketing Hub:', err);
  process.exit(1);
});
