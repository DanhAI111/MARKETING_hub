require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const repo = require('./repository');
const meta = require('./meta');
const auth = require('./auth');
const { assertSecurityConfig } = require('./security');
const { rateLimit } = require('./rate-limit');
const { suggestAllocation } = require('./ai-allocation');
const { sendTaskNotification, sendDailyTaskSummaryIfDue } = require('./task-notifications');
const googleSheetsModule = import('../shared/google-sheets.mjs');
const sheetSyncModule = import('../shared/sheet-sync.mjs');
const revenuePlannerModule = import('../shared/revenue-planner.mjs');
const { normalizePostMutation } = require('../shared/repository-helpers.cjs');
const { processWithConcurrency } = require('../shared/publish-queue.cjs');

const app = express();
assertSecurityConfig();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost');
const ROOT_DIR = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT_DIR, 'manage_MKT.html');
const PUBLISH_CONCURRENCY = 3;
const PUBLISH_LEASE_MS = 10 * 60 * 1000;
let lastSync = null;
let syncInFlight = null;
let publishInFlight = false;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const plannerInputsFromBody = (body = {}) => {
  const inputs = body.inputs && typeof body.inputs === 'object' ? body.inputs : body;
  return {
    ...inputs,
    ...(body.industry !== undefined ? { industry: body.industry } : {}),
    ...(body.goal !== undefined ? { goal: body.goal } : {})
  };
};

const assertPlannerInputs = async (inputs) => {
  const { validateInputs } = await revenuePlannerModule;
  const validation = validateInputs(inputs);
  if (validation.valid) return;
  const err = new Error(validation.errors.join(' '));
  err.status = 400;
  err.details = validation.errors;
  throw err;
};

// Clamp a query param to a safe integer range, rejecting NaN/negative values.
const clampInt = (value, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER }) => {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

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

const processClaimedPost = async (post) => {
  const safeTest = post.publishMode === 'safe_test';
  try {
    const output = safeTest
      ? await meta.testScheduledPost(post)
      : await meta.publishScheduledPost(post);
    if (output.deferred) {
      const saved = await repo.setPostPublishState(post.id, {
        status: 'scheduled',
        igContainerId: output.igContainerId || post.igContainerId || '',
        publishError: ''
      });
      return { id: post.id, status: 'deferred', post: saved };
    }
    const timestamp = new Date().toISOString();
    const partialError = safeTest ? (output.crossPostError || '') : '';
    const status = partialError ? 'failed' : (safeTest ? 'tested' : 'published');
    const saved = await repo.setPostPublishState(post.id, {
      ...output,
      status,
      source: output.source || post.source || (safeTest ? 'safe-test' : 'meta'),
      date: timestamp.slice(0, 10),
      ...(safeTest ? { testedAt: timestamp } : { publishedAt: timestamp }),
      publishError: output.crossPostError || ''
    });
    return { id: post.id, status, post: saved, ...(partialError ? { error: partialError } : {}) };
  } catch (err) {
    const saved = await repo.setPostPublishState(post.id, {
      status: 'failed',
      publishError: err.message || (safeTest ? 'Không thể chạy đăng thử' : 'Không thể đăng bài tự động')
    });
    return { id: post.id, status: 'failed', error: err.message, post: saved };
  }
};

const processScheduledPosts = async () => {
  if (publishInFlight) return { skipped: true };
  publishInFlight = true;
  const result = { startedAt: new Date().toISOString(), processed: 0, published: 0, tested: 0, failed: 0, released: 0, posts: [] };
  try {
    result.released = await repo.failStalePublishingPosts(
      new Date(Date.now() - PUBLISH_LEASE_MS).toISOString()
    );
    const duePosts = await repo.claimDueScheduledPosts();
    result.processed = duePosts.length;
    const processedPosts = await processWithConcurrency(duePosts,
      post => processClaimedPost(post),
      PUBLISH_CONCURRENCY
    );
    for (const processed of processedPosts) {
      if (processed.status === 'published') result.published++;
      else if (processed.status === 'tested') result.tested++;
      else if (processed.status === 'deferred') result.deferred = (result.deferred || 0) + 1;
      else result.failed++;
      result.posts.push({
        id: processed.id,
        status: processed.status,
        ...(processed.error ? { error: processed.error } : {})
      });
    }
    result.finishedAt = new Date().toISOString();
    await repo.saveState('lastPublishHeartbeat', result);
    if (result.processed || result.released) await repo.saveState('lastPublishRun', result);
    if (result.failed) await repo.saveState('lastPublishFailure', result);
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
    buildSha: process.env.BUILD_SHA || 'unknown',
    lastSync: lastSync || await repo.getState('lastMetaSync'),
    publisher: {
      lastRun: await repo.getState('lastPublishRun'),
      lastHeartbeat: await repo.getState('lastPublishHeartbeat'),
      lastFailure: await repo.getState('lastPublishFailure'),
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
    limit: clampInt(req.query.limit, { fallback: 500, min: 1, max: 5000 }),
    offset: clampInt(req.query.offset, { fallback: 0, min: 0 })
  }));
}));

app.post('/api/posts', asyncHandler(async (req, res) => {
  const post = await repo.upsertPost(normalizePostMutation(req.body || {}));
  writeAudit(req, 'create', 'post', post.id, post);
  res.status(201).json(post);
}));

app.put('/api/posts/:id', asyncHandler(async (req, res) => {
  const latest = await repo.getPost(req.params.id);
  await assertExpectedVersion(
    latest,
    req.body?.expectedUpdatedAt
  );
  const { expectedUpdatedAt, ...updates } = req.body || {};
  const post = await repo.upsertPost({ ...normalizePostMutation(updates, latest), id: req.params.id });
  writeAudit(req, 'update', 'post', post.id, post);
  res.json(post);
}));

app.post('/api/posts/:id/retry', asyncHandler(async (req, res) => {
  const post = await repo.requeuePostForRetry(req.params.id);
  if (!post) {
    const latest = await repo.getPost(req.params.id);
    if (!latest) return res.status(404).json({ error: 'Không tìm thấy bài đăng.' });
    if (latest.publishMode !== 'live') return res.status(400).json({ error: 'Bài đăng thử dùng thao tác chạy thử riêng.' });
    return res.status(409).json({ error: 'Bài không ở trạng thái lỗi hoặc đã được đưa vào hàng đợi.', latest });
  }
  writeAudit(req, 'retry', 'post', post.id, { status: 'queued' });
  return res.status(202).json({ id: post.id, status: 'queued', post });
}));

app.post('/api/posts/:id/run-test', asyncHandler(async (req, res) => {
  const post = await repo.claimSafeTestPost(req.params.id);
  if (!post) {
    const latest = await repo.getPost(req.params.id);
    if (!latest) return res.status(404).json({ error: 'Không tìm thấy bài đăng thử.' });
    if (latest.publishMode !== 'safe_test') return res.status(400).json({ error: 'Bài này không ở chế độ đăng thử.' });
    return res.status(409).json({ error: 'Bài đăng thử đang được xử lý hoặc đã hoàn tất.', latest });
  }
  const processed = await processClaimedPost(post);
  writeAudit(req, 'run-test', 'post', post.id, { status: processed.status });
  return res.status(processed.status === 'failed' ? 422 : 200).json(processed);
}));

app.delete('/api/posts/:id', asyncHandler(async (req, res) => {
  await repo.deletePost(req.params.id);
  writeAudit(req, 'delete', 'post', req.params.id);
  res.status(204).end();
}));

app.post('/api/marketing-plans/compute', asyncHandler(async (req, res) => {
  const inputs = plannerInputsFromBody(req.body || {});
  await assertPlannerInputs(inputs);
  const { computePlan } = await revenuePlannerModule;
  res.json(computePlan(inputs, req.body?.weights));
}));

app.post(
  '/api/marketing-plans/ai-suggest',
  rateLimit('ai-suggest', { limit: 20, windowSeconds: 60 }),
  asyncHandler(async (req, res) => {
    const inputs = plannerInputsFromBody(req.body || {});
    await assertPlannerInputs(inputs);
    res.json(await suggestAllocation({
      inputs,
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
      onError: (err) => console.error('AI allocation failed; using fallback:', err.message)
    }));
  })
);

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
    maxFanpages: Object.prototype.hasOwnProperty.call(req.query, 'maxFanpages')
      ? clampInt(req.query.maxFanpages, { fallback: null, min: 1, max: 1000 })
      : null,
    postLimit: clampInt(req.query.postLimit, { fallback: 100, min: 1, max: 100 })
  }));
}));

app.post('/api/publish-due', rateLimit('publish-due', { limit: 30, windowSeconds: 60 }), asyncHandler(async (req, res) => {
  const publisher = await processScheduledPosts();
  if (req.query.syncSheets === '1' && publisher.processed === 0) {
    syncLinkedScheduleSheets().catch((err) => console.error('Background sheet sync failed:', err.message));
  }
  res.json(publisher);
}));

app.post('/api/sheet-schedules/sync', rateLimit('sheet-schedules-sync', { limit: 30, windowSeconds: 60 }), asyncHandler(async (req, res) => {
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

app.get('/auth/meta/start', rateLimit('meta-auth', { limit: 20, windowSeconds: 60 }), asyncHandler(async (req, res) => {
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

  setInterval(() => {
    repo.cleanupOAuthStates().catch((err) => console.error('OAuth state cleanup failed:', err.message));
  }, 15 * 60 * 1000).unref();

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
