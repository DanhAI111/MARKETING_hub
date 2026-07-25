require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const repo = require('./repository');
const meta = require('./meta');
const auth = require('./auth');
const { assertSecurityConfig } = require('./security');
const { rateLimit } = require('./rate-limit');
const { sendTaskNotification, sendDailyTaskSummaryIfDue } = require('./task-notifications');
const googleSheetsModule = import('../shared/google-sheets.mjs');
const sheetSyncModule = import('../shared/sheet-sync.mjs');

const app = express();
assertSecurityConfig();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost');
const ROOT_DIR = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT_DIR, 'manage_MKT.html');
let lastSync = null;
let syncInFlight = null;
let publishInFlight = false;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const assertExpectedVersion = async (latest, expectedUpdatedAt) => {
  if (!expectedUpdatedAt || latest?.updatedAt === expectedUpdatedAt) return;
  const err = new Error('Dữ liệu đã thay đổi');
  err.status = 409;
  err.latest = latest || null;
  throw err;
};

const writeAudit = (req, action, entityType, entityId, changes = {}) => repo.writeAuditLog({
  actorEmail: req.user?.email || '',
  action,
  entityType,
  entityId,
  changes
}).catch((err) => console.error('Audit log failed:', err.message));

const notifyTaskChange = (req, payload) => {
  sendTaskNotification(repo, { ...payload, actorEmail: req.user?.email || '' })
    .catch((err) => console.error('Task notification failed:', err.message));
};

app.use(express.json({ limit: '25mb' }));
auth.installRoutes(app);

app.use(auth.middleware);
// Serve only static asset dirs — never the repo root (would leak .env, DB, source).
const staticOpts = { index: false, dotfiles: 'deny' };
app.use('/css', express.static(path.join(ROOT_DIR, 'css'), staticOpts));
app.use('/js', express.static(path.join(ROOT_DIR, 'js'), staticOpts));
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets'), staticOpts));
app.get(['/', '/index.html'], (_req, res) => res.sendFile(INDEX_HTML));

const runSync = async (options = {}) => {
  if (syncInFlight) return syncInFlight;
  syncInFlight = meta.syncAll(options)
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
    const duePosts = await repo.claimDueScheduledPosts();
    for (const post of duePosts) {
      try {
        const published = await meta.publishScheduledPost(post);
        await repo.setPostPublishState(post.id, {
          ...published,
          status: 'published',
          source: published.source || post.source || 'meta',
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
    await repo.saveState('lastPublishRun', result);
    return result;
  } finally {
    publishInFlight = false;
  }
};

const fetchGoogleSheetCsvText = async (...args) => {
  const { fetchGoogleSheetCsvText: fetchCsv } = await googleSheetsModule;
  return fetchCsv(...args);
};

const syncLinkedScheduleSheets = async (options = {}) => {
  const { syncScheduleSheets } = await sheetSyncModule;
  return syncScheduleSheets({
    repo,
    sourceUrl: options.sourceUrl || '',
    defaultFanpageId: options.defaultFanpageId || '',
    timezoneOffset: options.timezoneOffset || '+07:00',
    fetchCsv: async (sourceUrl) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        return await fetchGoogleSheetCsvText(sourceUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    }
  });
};

app.get('/api/health', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    authRequired: auth.required(),
    metaConfigured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
    lastSync: lastSync || await repo.getState('lastMetaSync'),
    publisher: {
      lastRun: await repo.getState('lastPublishRun'),
      inFlight: publishInFlight
    }
  });
}));

app.get('/api/bootstrap', asyncHandler(async (req, res) => {
  res.json({
    ...await repo.getBootstrapData(),
    lastSync: lastSync || await repo.getState('lastMetaSync')
  });
}));

app.post('/api/fanpages/import-local', asyncHandler(async (req, res) => {
  const imported = await repo.importLocalData(req.body || {});
  writeAudit(req, 'import', 'bootstrap', 'local-data');
  res.json(imported);
}));

app.get('/api/fanpages', asyncHandler(async (req, res) => {
  res.json(await repo.listFanpages());
}));

app.post('/api/fanpages', asyncHandler(async (req, res) => {
  const fanpage = await repo.upsertFanpage(req.body || {});
  writeAudit(req, 'create', 'fanpage', fanpage.id, fanpage);
  res.status(201).json(fanpage);
}));

app.put('/api/fanpages/:id', asyncHandler(async (req, res) => {
  const fanpage = await repo.upsertFanpage({ ...(req.body || {}), id: req.params.id });
  writeAudit(req, 'update', 'fanpage', fanpage.id, fanpage);
  res.json(fanpage);
}));

app.delete('/api/fanpages/:id', asyncHandler(async (req, res) => {
  await repo.deleteFanpage(req.params.id);
  writeAudit(req, 'delete', 'fanpage', req.params.id);
  res.status(204).end();
}));

app.get('/api/posts', asyncHandler(async (req, res) => {
  res.json(await repo.listPosts({
    month: req.query.month || '',
    pending: req.query.pending === '1',
    limit: Number(req.query.limit || 500),
    offset: Number(req.query.offset || 0)
  }));
}));

app.post('/api/posts', asyncHandler(async (req, res) => {
  const post = await repo.upsertPost(req.body || {});
  writeAudit(req, 'create', 'post', post.id, post);
  if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
    setTimeout(() => processScheduledPosts().catch((err) => console.error('Immediate publish failed:', err.message)), 100).unref();
  }
  res.status(201).json(post);
}));

app.put('/api/posts/:id', asyncHandler(async (req, res) => {
  await assertExpectedVersion(
    req.body?.expectedUpdatedAt ? await repo.getPost(req.params.id) : null,
    req.body?.expectedUpdatedAt
  );
  const { expectedUpdatedAt, ...updates } = req.body || {};
  const post = await repo.upsertPost({ ...updates, id: req.params.id });
  writeAudit(req, 'update', 'post', post.id, post);
  if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
    setTimeout(() => processScheduledPosts().catch((err) => console.error('Immediate publish failed:', err.message)), 100).unref();
  }
  res.json(post);
}));

app.delete('/api/posts/:id', asyncHandler(async (req, res) => {
  await repo.deletePost(req.params.id);
  writeAudit(req, 'delete', 'post', req.params.id);
  res.status(204).end();
}));

app.get('/api/collections/:collection', asyncHandler(async (req, res) => {
  res.json(await repo.listAppItems(req.params.collection));
}));

app.post('/api/collections/:collection', asyncHandler(async (req, res) => {
  const item = await repo.upsertAppItem(req.params.collection, req.body || {});
  writeAudit(req, 'create', req.params.collection, item.id, item);
  if (req.params.collection === 'tasks') {
    notifyTaskChange(req, { action: 'created', task: item });
  }
  res.status(201).json(item);
}));

app.put('/api/collections/:collection/:id', asyncHandler(async (req, res) => {
  const previous = req.params.collection === 'tasks' || req.body?.expectedUpdatedAt
    ? await repo.getAppItem(req.params.collection, req.params.id)
    : null;
  await assertExpectedVersion(
    req.body?.expectedUpdatedAt ? previous : null,
    req.body?.expectedUpdatedAt
  );
  const { expectedUpdatedAt, ...updates } = req.body || {};
  const item = await repo.upsertAppItem(req.params.collection, {
    ...updates,
    id: req.params.id
  });
  writeAudit(req, 'update', req.params.collection, item.id, item);
  if (req.params.collection === 'tasks') {
    notifyTaskChange(req, { action: 'updated', task: item, previousTask: previous });
  }
  res.json(item);
}));

app.delete('/api/collections/:collection/:id', asyncHandler(async (req, res) => {
  const previous = req.params.collection === 'tasks'
    ? await repo.getAppItem(req.params.collection, req.params.id)
    : null;
  await repo.deleteAppItem(req.params.collection, req.params.id);
  writeAudit(req, 'delete', req.params.collection, req.params.id);
  if (req.params.collection === 'tasks' && previous) {
    notifyTaskChange(req, { action: 'deleted', task: previous, previousTask: previous });
  }
  res.status(204).end();
}));

app.get('/api/singletons/:key', asyncHandler(async (req, res) => {
  res.json({ value: await repo.getSingleton(req.params.key) });
}));

app.put('/api/singletons/:key', asyncHandler(async (req, res) => {
  const value = await repo.saveSingleton(req.params.key, req.body?.value ?? null);
  writeAudit(req, 'update', 'singleton', req.params.key, { value });
  res.json({ value });
}));

app.post('/api/sync', rateLimit('sync', { limit: 60, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  res.json(await runSync({
    cursor: Object.prototype.hasOwnProperty.call(req.query, 'cursor') ? req.query.cursor : null,
    maxFanpages: Object.prototype.hasOwnProperty.call(req.query, 'maxFanpages') ? Number(req.query.maxFanpages) : null,
    postLimit: Number(req.query.postLimit || 100)
  }));
}));

app.post('/api/publish-due', asyncHandler(async (req, res) => {
  // Run sheet sync in the background (see worker/index.js) so a slow/hanging
  // Google Sheets fetch can't stall or fail the publish response.
  if (req.query.syncSheets === '1') {
    syncLinkedScheduleSheets().catch((err) => console.error('Background sheet sync failed:', err.message));
  }
  const publisher = await processScheduledPosts();
  res.json(publisher);
}));

app.post('/api/sheet-schedules/sync', asyncHandler(async (req, res) => {
  if (!req.body?.sourceUrl) {
    const err = new Error('Thiếu link Google Sheets');
    err.status = 400;
    throw err;
  }
  res.json(await syncLinkedScheduleSheets(req.body));
}));

app.post('/api/google-sheets/csv', rateLimit('google-sheets-csv', { limit: 60, windowSeconds: 60 }), asyncHandler(async (req, res) => {
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

app.get('/api/sync/status', asyncHandler(async (req, res) => {
  res.json({ inFlight: !!syncInFlight, lastSync: lastSync || await repo.getState('lastMetaSync') });
}));

app.get('/auth/meta/start', asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  await repo.saveOAuthState('meta', state, {});
  res.redirect(meta.authUrl(state));
}));

app.get('/auth/meta/callback', asyncHandler(async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    res.redirect(`/?meta_error=${encodeURIComponent(errorDescription || error)}#content`);
    return;
  }
  const savedState = code && state ? await repo.consumeOAuthState('meta', state) : null;
  if (!code || !state || !savedState) {
    res.redirect(`/?meta_error=${encodeURIComponent('Phiên liên kết Meta đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.') }#content`);
    return;
  }
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
    error: err.message || 'Internal server error',
    ...(err.status === 409 ? { latest: err.latest || null } : {})
  });
});

const startSchedulers = () => {
  setInterval(() => {
    runSync().catch((err) => console.error('Scheduled sync failed:', err.message));
  }, 15 * 60 * 1000).unref();

  setInterval(() => {
    processScheduledPosts().catch((err) => console.error('Scheduled publish failed:', err.message));
  }, 60 * 1000).unref();

  setInterval(() => {
    sendDailyTaskSummaryIfDue().catch((err) => console.error('Daily task summary failed:', err.message));
  }, 60 * 1000).unref();

  setTimeout(() => {
    processScheduledPosts().catch((err) => console.error('Startup publish failed:', err.message));
    sendDailyTaskSummaryIfDue().catch((err) => console.error('Startup task summary failed:', err.message));
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
