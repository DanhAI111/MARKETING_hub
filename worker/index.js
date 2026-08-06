import { AuthService } from './auth.js';
import { MetaService } from './meta.js';
import { Repository } from './repository.js';
import { assertSecurityConfig } from './security.js';
import { sendDailyTaskSummaryIfDue, sendTaskNotification } from './task-notifications.js';
import { computePlan, validateInputs } from '../shared/revenue-planner.mjs';
import { suggestAllocation } from '../shared/ai-allocation.mjs';
import { syncScheduleSheets } from '../shared/sheet-sync.mjs';
import { fetchGoogleSheetCsvText } from '../shared/google-sheets.mjs';
import { normalizePostMutation } from '../shared/repository-helpers.cjs';
import { processWithConcurrency } from '../shared/publish-queue.cjs';

// Cloudflare kills a cron invocation that exceeds its CPU/wall-clock budget with
// no JS error, stranding every claimed post in 'publishing'. A single post is NOT
// cheap: a Google Drive *folder* mediaUrl expands to a carousel of up to 10 images,
// each doing its own /photos upload before the feed call — one carousel ≈ a dozen
// Meta subrequests + a Drive fetch. Proven in prod 2026-08-05: 1 post published
// fine, a broadcast of 7 carousels (batch 3 × concurrency 3 = 3 heavy posts in
// parallel) was silently isolate-killed mid-run and stale-swept to 'failed'.
// So we publish strictly ONE post per tick, sequentially — the guaranteed-safe
// unit (a lone post fits the budget). The 1-min cron drains any backlog 1/tick.
const PUBLISH_CONCURRENCY = 1;
const PUBLISH_LEASE_MS = 10 * 60 * 1000;
const PUBLISH_BATCH_LIMIT = 1;

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

const noContent = () => new Response(null, { status: 204 });
const clientIp = (request) => request.headers.get('cf-connecting-ip')
  || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  || 'unknown';
const rateLimitResponse = (retryAfter) => json(
  { error: 'Rate limit exceeded', retryAfter },
  429,
  { 'Retry-After': String(retryAfter) }
);
const parseJsonBody = async (request) => {
  if (!request.body) return {};
  return request.json().catch(() => {
    const error = new Error('JSON body không hợp lệ.');
    error.status = 400;
    throw error;
  });
};

const requireRateLimit = async (repo, request, name, config) => {
  const result = await repo.checkRateLimit(`${name}:${clientIp(request)}`, config);
  return result.allowed ? null : rateLimitResponse(result.retryAfter);
};

const conflict = (latest) => json({ error: 'Dữ liệu đã thay đổi', latest }, 409);

const plannerInputsFromBody = (body = {}) => {
  const inputs = body.inputs && typeof body.inputs === 'object' ? body.inputs : body;
  return {
    ...inputs,
    ...(body.industry !== undefined ? { industry: body.industry } : {}),
    ...(body.goal !== undefined ? { goal: body.goal } : {})
  };
};

const assertPlannerInputs = (inputs) => {
  const validation = validateInputs(inputs);
  if (validation.valid) return;
  const error = new Error(validation.errors.join(' '));
  error.status = 400;
  error.details = validation.errors;
  throw error;
};

const versionMatches = (latest, expectedUpdatedAt) => (
  !expectedUpdatedAt || (latest && latest.updatedAt === expectedUpdatedAt)
);

const isPublicAssetPath = (pathname) => (
  pathname.startsWith('/js/')
  || pathname.startsWith('/css/')
  || pathname.startsWith('/assets/')
  || pathname === '/favicon.ico'
);

const syncLinkedScheduleSheets = async (repo, options = {}) => syncScheduleSheets({
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

const processClaimedPost = async (repo, meta, post) => {
  const safeTest = post.publishMode === 'safe_test';
  try {
    const output = safeTest
      ? await meta.testScheduledPost(post)
      : await meta.publishScheduledPost(post);
    // IG video (Reels) defers across cron ticks while Instagram encodes. Park the
    // containerId and return the post to 'scheduled' so the next tick re-claims and
    // does a cheap FINISHED check — never a blocking poll (publish-stale-root-cause).
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
  } catch (error) {
    const saved = await repo.setPostPublishState(post.id, {
      status: 'failed',
      publishError: error.message || (safeTest ? 'Không thể chạy đăng thử' : 'Không thể đăng bài tự động')
    });
    return { id: post.id, status: 'failed', error: error.message, post: saved };
  }
};

const processScheduledPosts = async (repo, meta) => {
  const result = { startedAt: new Date().toISOString(), published: 0, tested: 0, failed: 0, released: 0, posts: [] };
  result.released = await repo.failStalePublishingPosts(
    new Date(Date.now() - PUBLISH_LEASE_MS).toISOString()
  );
  const duePosts = await repo.claimDueScheduledPosts(PUBLISH_BATCH_LIMIT);
  const processedPosts = await processWithConcurrency(duePosts,
    post => processClaimedPost(repo, meta, post),
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
  await repo.saveState('lastPublishRun', result);
  return result;
};

const handleRequest = async (request, env, context) => {
  assertSecurityConfig(env);
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();
  const repo = new Repository(env);
  const auth = new AuthService(env, repo, request);
  const meta = new MetaService(env, repo, url.origin);
  const audit = (action, entityType, entityId, changes = {}) => {
    context.waitUntil(repo.writeAuditLog({
      actorEmail: user?.email || '',
      action,
      entityType,
      entityId,
      changes
    }).catch((error) => console.error('Audit log failed:', error)));
  };
  const notifyTaskChange = (payload) => {
    context.waitUntil(sendTaskNotification(env, repo, {
      ...payload,
      actorEmail: user?.email || '',
      origin: url.origin
    }).catch((error) => console.error('Task notification failed:', error)));
  };

  if (method === 'GET' && pathname === '/api/health') {
    return json({
      ok: true,
      platform: 'cloudflare-workers',
      authRequired: auth.required(),
      metaConfigured: !!(env.META_APP_ID && env.META_APP_SECRET),
      lastSync: await repo.getState('lastMetaSync'),
      publisher: { lastRun: await repo.getState('lastPublishRun') }
    });
  }

  if (method === 'GET' && pathname === '/api/me') {
    const user = await auth.readSession();
    return json({ authenticated: !!user, user, authRequired: auth.required() });
  }

  if (method === 'GET' && pathname === '/login') {
    return new Response(auth.loginHtml(url.searchParams.get('error') || '', url.searchParams.get('next') || '/'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  if (method === 'POST' && pathname === '/login') {
    const limited = await requireRateLimit(repo, request, 'login', { limit: 5, windowSeconds: 60 });
    if (limited) return limited;
    return auth.finishPassword();
  }

  if (method === 'GET' && pathname === '/auth/google/start') {
    const limited = await requireRateLimit(repo, request, 'google-auth', { limit: 20, windowSeconds: 60 });
    if (limited) return limited;
    return auth.startGoogle(url);
  }
  if (method === 'GET' && pathname === '/auth/google/callback') return auth.finishGoogle(url);
  if (method === 'GET' && pathname === '/auth/logout') {
    const headers = new Headers({ Location: `${url.origin}/login` });
    headers.append('Set-Cookie', auth.clearCookie());
    headers.append('Set-Cookie', auth.clearCsrfCookie());
    return new Response(null, { status: 302, headers });
  }

  if (method === 'GET' && isPublicAssetPath(pathname)) {
    return env.ASSETS.fetch(request);
  }

  const user = await auth.readSession();
  if (auth.required() && !user) {
    if (pathname.startsWith('/api/')) return json({ error: 'Unauthorized' }, 401);
    return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(`${pathname}${url.search}${url.hash}`)}`, 302);
  }
  if (user) auth.verifyCsrf();

  if (method === 'GET' && pathname === '/api/meta/diagnostics') {
    return json(await meta.diagnostics());
  }

  if (method === 'GET' && pathname === '/api/bootstrap') {
    return json({ ...await repo.getBootstrapData(), lastSync: await repo.getState('lastMetaSync') });
  }
  if (method === 'POST' && pathname === '/api/fanpages/import-local') {
    const imported = await repo.importLocalData(await parseJsonBody(request));
    audit('import', 'bootstrap', 'local-data');
    return json(imported);
  }
  if (method === 'GET' && pathname === '/api/fanpages') return json(await repo.listFanpages());
  if (method === 'POST' && pathname === '/api/fanpages') {
    const fanpage = await repo.upsertFanpage(await parseJsonBody(request));
    audit('create', 'fanpage', fanpage.id, fanpage);
    return json(fanpage, 201);
  }

  let match = pathname.match(/^\/api\/fanpages\/([^/]+)$/);
  if (match && method === 'PUT') {
    const fanpage = await repo.upsertFanpage({ ...await parseJsonBody(request), id: decodeURIComponent(match[1]) });
    audit('update', 'fanpage', fanpage.id, fanpage);
    return json(fanpage);
  }
  if (match && method === 'DELETE') {
    const fanpageId = decodeURIComponent(match[1]);
    await repo.deleteFanpage(fanpageId);
    audit('delete', 'fanpage', fanpageId);
    return noContent();
  }

  if (method === 'GET' && pathname === '/api/posts') {
    const month = url.searchParams.get('month');
    const pending = url.searchParams.get('pending') === '1';
    const limit = Number(url.searchParams.get('limit') || 500);
    const offset = Number(url.searchParams.get('offset') || 0);
    return json(await repo.listPosts({ month, pending, limit, offset }));
  }
  if (method === 'POST' && pathname === '/api/posts') {
    const post = await repo.upsertPost(normalizePostMutation(await parseJsonBody(request)));
    audit('create', 'post', post.id, post);
    if (post.publishMode !== 'safe_test' && post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
      context.waitUntil(processScheduledPosts(repo, meta));
    }
    return json(post, 201);
  }

  match = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (match && method === 'PUT') {
    const body = await parseJsonBody(request);
    const postId = decodeURIComponent(match[1]);
    const latest = await repo.getPost(postId);
    if (!versionMatches(latest, body.expectedUpdatedAt)) return conflict(latest);
    const { expectedUpdatedAt, ...updates } = body;
    const post = await repo.upsertPost({ ...normalizePostMutation(updates, latest), id: postId });
    audit('update', 'post', post.id, post);
    if (post.publishMode !== 'safe_test' && post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
      context.waitUntil(processScheduledPosts(repo, meta));
    }
    return json(post);
  }
  if (match && method === 'DELETE') {
    const postId = decodeURIComponent(match[1]);
    await repo.deletePost(postId);
    audit('delete', 'post', postId);
    return noContent();
  }

  match = pathname.match(/^\/api\/posts\/([^/]+)\/run-test$/);
  if (match && method === 'POST') {
    const postId = decodeURIComponent(match[1]);
    const post = await repo.claimSafeTestPost(postId);
    if (!post) {
      const latest = await repo.getPost(postId);
      if (!latest) return json({ error: 'Không tìm thấy bài đăng thử.' }, 404);
      if (latest.publishMode !== 'safe_test') return json({ error: 'Bài này không ở chế độ đăng thử.' }, 400);
      return json({ error: 'Bài đăng thử đang được xử lý hoặc đã hoàn tất.', latest }, 409);
    }
    const processed = await processClaimedPost(repo, meta, post);
    audit('run-test', 'post', post.id, { status: processed.status });
    return json(processed, processed.status === 'failed' ? 422 : 200);
  }

  if (method === 'POST' && pathname === '/api/marketing-plans/compute') {
    const body = await parseJsonBody(request);
    const inputs = plannerInputsFromBody(body);
    assertPlannerInputs(inputs);
    return json(computePlan(inputs, body.weights));
  }

  if (method === 'POST' && pathname === '/api/marketing-plans/ai-suggest') {
    const limited = await requireRateLimit(repo, request, 'ai-suggest', { limit: 20, windowSeconds: 60 });
    if (limited) return limited;
    const body = await parseJsonBody(request);
    const inputs = plannerInputsFromBody(body);
    assertPlannerInputs(inputs);
    return json(await suggestAllocation({
      inputs,
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || 'claude-opus-5',
      onError: (error) => console.error('AI allocation failed; using fallback:', error.message)
    }));
  }

  match = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (match && method === 'GET') return json(await repo.listAppItems(decodeURIComponent(match[1])));
  if (match && method === 'POST') {
    const collection = decodeURIComponent(match[1]);
    const item = await repo.upsertAppItem(collection, await parseJsonBody(request));
    audit('create', collection, item.id, item);
    if (collection === 'tasks') notifyTaskChange({ action: 'created', task: item });
    return json(item, 201);
  }

  match = pathname.match(/^\/api\/collections\/([^/]+)\/([^/]+)$/);
  if (match && method === 'PUT') {
    const collection = decodeURIComponent(match[1]);
    const itemId = decodeURIComponent(match[2]);
    const body = await parseJsonBody(request);
    const latest = collection === 'tasks' || body.expectedUpdatedAt ? await repo.getAppItem(collection, itemId) : null;
    if (!versionMatches(latest, body.expectedUpdatedAt)) return conflict(latest);
    const { expectedUpdatedAt, ...updates } = body;
    const item = await repo.upsertAppItem(collection, {
      ...updates,
      id: itemId
    });
    audit('update', collection, item.id, item);
    if (collection === 'tasks') notifyTaskChange({ action: 'updated', task: item, previousTask: latest });
    return json(item);
  }
  if (match && method === 'DELETE') {
    const collection = decodeURIComponent(match[1]);
    const itemId = decodeURIComponent(match[2]);
    const previous = collection === 'tasks' ? await repo.getAppItem(collection, itemId) : null;
    await repo.deleteAppItem(collection, itemId);
    audit('delete', collection, itemId);
    if (collection === 'tasks' && previous) notifyTaskChange({ action: 'deleted', task: previous, previousTask: previous });
    return noContent();
  }

  match = pathname.match(/^\/api\/singletons\/([^/]+)$/);
  if (match && method === 'GET') return json({ value: await repo.getSingleton(decodeURIComponent(match[1])) });
  if (match && method === 'PUT') {
    const body = await parseJsonBody(request);
    const key = decodeURIComponent(match[1]);
    const value = await repo.saveSingleton(key, body.value ?? null);
    audit('update', 'singleton', key, { value });
    return json({ value });
  }

  if (method === 'POST' && pathname === '/api/sync') {
    const limited = await requireRateLimit(repo, request, 'sync', { limit: 60, windowSeconds: 60 });
    if (limited) return limited;
    return json(await meta.syncAll({
      cursor: url.searchParams.has('cursor') ? url.searchParams.get('cursor') : null,
      maxFanpages: Number(url.searchParams.get('maxFanpages') || 1),
      postLimit: Number(url.searchParams.get('postLimit') || 100)
    }));
  }
  if (method === 'POST' && pathname === '/api/publish-due') {
    const limited = await requireRateLimit(repo, request, 'publish-due', { limit: 30, windowSeconds: 60 });
    if (limited) return limited;
    // Sheet sync fetches N Google Sheets (15s each) + can exhaust the Worker's
    // wall-clock/subrequest budget → Cloudflare edge 503. Run it in the
    // background so publishing (the fast path) always returns cleanly; newly
    // synced rows publish on the next tick / cron run.
    if (url.searchParams.get('syncSheets') === '1') {
      context.waitUntil(
        syncLinkedScheduleSheets(repo).catch((err) =>
          console.error('Background sheet sync failed:', err?.message || err)
        )
      );
    }
    const publisher = await processScheduledPosts(repo, meta);
    return json(publisher);
  }
  if (method === 'POST' && pathname === '/api/sheet-schedules/sync') {
    const limited = await requireRateLimit(repo, request, 'sheet-schedules-sync', { limit: 30, windowSeconds: 60 });
    if (limited) return limited;
    const body = await parseJsonBody(request);
    if (!body.sourceUrl) return json({ error: 'Thiếu link Google Sheets' }, 400);
    return json(await syncLinkedScheduleSheets(repo, body));
  }
  if (method === 'GET' && pathname === '/api/sync/status') {
    return json({ inFlight: false, lastSync: await repo.getState('lastMetaSync') });
  }

  if (method === 'POST' && pathname === '/api/google-sheets/csv') {
    const limited = await requireRateLimit(repo, request, 'google-sheets-csv', { limit: 60, windowSeconds: 60 });
    if (limited) return limited;
    const body = await parseJsonBody(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const text = await fetchGoogleSheetCsvText(body.url || '', { signal: controller.signal });
      if (text.length > 2 * 1024 * 1024) {
        const error = new Error('File Google Sheets quá lớn. Vui lòng giới hạn dưới 2MB CSV.');
        error.status = 413;
        throw error;
      }
      return json({ text });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (method === 'GET' && pathname === '/auth/meta/start') {
    const limited = await requireRateLimit(repo, request, 'meta-auth', { limit: 20, windowSeconds: 60 });
    if (limited) return limited;
    const state = crypto.randomUUID();
    await repo.saveOAuthState('meta', state, {});
    return Response.redirect(meta.authUrl(state), 302);
  }

  if (method === 'GET' && pathname === '/auth/meta/callback') {
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    if (error) {
      return Response.redirect(`${url.origin}/?meta_error=${encodeURIComponent(errorDescription || error)}#content`, 302);
    }
    const code = url.searchParams.get('code');
    const state = await repo.consumeOAuthState('meta', url.searchParams.get('state'));
    if (!code || !state) {
      return Response.redirect(`${url.origin}/?meta_error=${encodeURIComponent('Phiên liên kết Meta đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.')}#content`, 302);
    }
    try {
      const token = await meta.exchangeCode(code);
      await meta.connectPages(token);
      await meta.syncAll();
      return Response.redirect(`${url.origin}/?meta_connected=1#content`, 302);
    } catch (callbackError) {
      return Response.redirect(`${url.origin}/?meta_error=${encodeURIComponent(callbackError.message || 'Không thể hoàn tất liên kết Meta.')}#content`, 302);
    }
  }

  if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return json({ error: 'Not found' }, 404);
  }

  return env.ASSETS.fetch(request);
};

export default {
  async fetch(request, env, context) {
    try {
      return await handleRequest(request, env, context);
    } catch (error) {
      console.error(error);
      if (new URL(request.url).pathname.startsWith('/api/')) {
        return json({ error: error.message || 'Internal server error' }, error.status || 500);
      }
      return new Response(error.message || 'Internal server error', { status: error.status || 500 });
    }
  },

  async scheduled(controller, env, context) {
    const repo = new Repository(env);
    const origin = env.PUBLIC_BASE_URL || 'https://marketing-hub.workers.dev';
    const meta = new MetaService(env, repo, origin);
    const tasks = [
      processScheduledPosts(repo, meta),
      syncLinkedScheduleSheets(repo),
      repo.cleanupOAuthStates(),
      repo.cleanupRateLimits(),
      sendDailyTaskSummaryIfDue(env, repo, controller.scheduledTime)
    ];
    if (new Date(controller.scheduledTime).getUTCMinutes() % 15 === 0 && env.META_APP_ID && env.META_APP_SECRET) {
      tasks.push(meta.syncAll());
    }
    context.waitUntil(Promise.allSettled(tasks));
  }
};
