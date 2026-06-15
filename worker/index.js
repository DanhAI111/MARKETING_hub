import { AuthService } from './auth.js';
import { MetaService } from './meta.js';
import { Repository } from './repository.js';

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

const noContent = () => new Response(null, { status: 204 });
const parseJsonBody = async (request) => {
  if (!request.body) return {};
  return request.json().catch(() => {
    const error = new Error('JSON body không hợp lệ.');
    error.status = 400;
    throw error;
  });
};

const googleSheetCsvUrls = (inputUrl) => {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    const error = new Error('Link Google Sheets không hợp lệ');
    error.status = 400;
    throw error;
  }
  if (url.hostname !== 'docs.google.com') {
    const error = new Error('Chỉ hỗ trợ link Google Sheets từ docs.google.com');
    error.status = 400;
    throw error;
  }

  if (url.pathname.includes('/spreadsheets/') && (url.searchParams.get('output') === 'csv' || url.searchParams.get('format') === 'csv')) {
    return [url.toString()];
  }

  const publishedMatch = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([^/]+)/);
  const regularMatch = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/);
  if (!publishedMatch && !regularMatch) {
    const error = new Error('Không tìm thấy Google Sheets ID trong link');
    error.status = 400;
    throw error;
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
  const error = new Error(
    lastText && /^\s*<!doctype html|^\s*<html[\s>]/i.test(lastText)
      ? 'Google trả về trang HTML thay vì CSV. Hãy dùng File > Share > Publish to web hoặc tải CSV lên trực tiếp.'
      : 'Không thể đọc Google Sheets. Hãy kiểm tra quyền chia sẻ hoặc publish sheet.'
  );
  error.status = lastStatus || 400;
  throw error;
};

const processScheduledPosts = async (repo, meta) => {
  const result = { startedAt: new Date().toISOString(), published: 0, failed: 0, posts: [] };
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
    } catch (error) {
      await repo.setPostPublishState(post.id, {
        status: 'failed',
        publishError: error.message || 'Không thể đăng bài tự động'
      });
      result.failed++;
      result.posts.push({ id: post.id, status: 'failed', error: error.message });
    }
  }
  result.finishedAt = new Date().toISOString();
  await repo.saveState('lastPublishRun', result);
  return result;
};

const handleRequest = async (request, env, context) => {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();
  const repo = new Repository(env);
  const auth = new AuthService(env, repo, request);
  const meta = new MetaService(env, repo, url.origin);

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
  if (method === 'POST' && pathname === '/login') return auth.finishPassword();

  if (method === 'GET' && pathname === '/auth/google/start') return auth.startGoogle(url);
  if (method === 'GET' && pathname === '/auth/google/callback') return auth.finishGoogle(url);
  if (method === 'GET' && pathname === '/auth/logout') {
    const headers = new Headers({ Location: `${url.origin}/login` });
    headers.append('Set-Cookie', auth.clearCookie());
    return new Response(null, { status: 302, headers });
  }

  const user = await auth.readSession();
  if (auth.required() && !user) {
    if (pathname.startsWith('/api/')) return json({ error: 'Unauthorized' }, 401);
    return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(`${pathname}${url.search}${url.hash}`)}`, 302);
  }

  if (method === 'GET' && pathname === '/api/meta/diagnostics') {
    return json(await meta.diagnostics());
  }

  if (method === 'GET' && pathname === '/api/bootstrap') {
    return json({ ...await repo.getBootstrapData(), lastSync: await repo.getState('lastMetaSync') });
  }
  if (method === 'POST' && pathname === '/api/fanpages/import-local') {
    return json(await repo.importLocalData(await parseJsonBody(request)));
  }
  if (method === 'GET' && pathname === '/api/fanpages') return json(await repo.listFanpages());
  if (method === 'POST' && pathname === '/api/fanpages') {
    return json(await repo.upsertFanpage(await parseJsonBody(request)), 201);
  }

  let match = pathname.match(/^\/api\/fanpages\/([^/]+)$/);
  if (match && method === 'PUT') {
    return json(await repo.upsertFanpage({ ...await parseJsonBody(request), id: decodeURIComponent(match[1]) }));
  }
  if (match && method === 'DELETE') {
    await repo.deleteFanpage(decodeURIComponent(match[1]));
    return noContent();
  }

  if (method === 'GET' && pathname === '/api/posts') {
    const month = url.searchParams.get('month');
    const posts = (await repo.listPosts()).filter((post) => !month || post.date.startsWith(month));
    return json(posts);
  }
  if (method === 'POST' && pathname === '/api/posts') {
    const post = await repo.upsertPost(await parseJsonBody(request));
    if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
      context.waitUntil(processScheduledPosts(repo, meta));
    }
    return json(post, 201);
  }

  match = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (match && method === 'PUT') {
    const post = await repo.upsertPost({ ...await parseJsonBody(request), id: decodeURIComponent(match[1]) });
    if (post.status === 'scheduled' && post.scheduledAt && post.scheduledAt <= new Date().toISOString()) {
      context.waitUntil(processScheduledPosts(repo, meta));
    }
    return json(post);
  }
  if (match && method === 'DELETE') {
    await repo.deletePost(decodeURIComponent(match[1]));
    return noContent();
  }

  match = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (match && method === 'GET') return json(await repo.listAppItems(decodeURIComponent(match[1])));
  if (match && method === 'POST') {
    return json(await repo.upsertAppItem(decodeURIComponent(match[1]), await parseJsonBody(request)), 201);
  }

  match = pathname.match(/^\/api\/collections\/([^/]+)\/([^/]+)$/);
  if (match && method === 'PUT') {
    return json(await repo.upsertAppItem(
      decodeURIComponent(match[1]),
      { ...await parseJsonBody(request), id: decodeURIComponent(match[2]) }
    ));
  }
  if (match && method === 'DELETE') {
    await repo.deleteAppItem(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    return noContent();
  }

  match = pathname.match(/^\/api\/singletons\/([^/]+)$/);
  if (match && method === 'GET') return json({ value: await repo.getSingleton(decodeURIComponent(match[1])) });
  if (match && method === 'PUT') {
    const body = await parseJsonBody(request);
    return json({ value: await repo.saveSingleton(decodeURIComponent(match[1]), body.value ?? null) });
  }

  if (method === 'POST' && pathname === '/api/sync') {
    return json(await meta.syncAll({
      cursor: url.searchParams.has('cursor') ? url.searchParams.get('cursor') : null,
      maxFanpages: Number(url.searchParams.get('maxFanpages') || 1),
      postLimit: Number(url.searchParams.get('postLimit') || 100)
    }));
  }
  if (method === 'POST' && pathname === '/api/publish-due') {
    return json(await processScheduledPosts(repo, meta));
  }
  if (method === 'GET' && pathname === '/api/sync/status') {
    return json({ inFlight: false, lastSync: await repo.getState('lastMetaSync') });
  }

  if (method === 'POST' && pathname === '/api/google-sheets/csv') {
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
    const tasks = [processScheduledPosts(repo, meta), repo.cleanupOAuthStates()];
    if (new Date(controller.scheduledTime).getUTCMinutes() % 15 === 0 && env.META_APP_ID && env.META_APP_SECRET) {
      tasks.push(meta.syncAll());
    }
    context.waitUntil(Promise.allSettled(tasks));
  }
};
