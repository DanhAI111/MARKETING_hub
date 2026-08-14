/* ═══════════════════════════════════════════
   MARKETING HUB - Backend API Bridge
   Keeps the static UI usable while mirroring data to the Node backend.
   ═══════════════════════════════════════════ */

const RemoteStore = (() => {
  const IMPORT_FLAG = 'marketing_hub_backend_imported_v2';
  const SYNC_COLLECTIONS = [
    'fanpages',
    'posts',
    'tasks',
    'events',
    'expenses',
    'adReports',
    'employees',
    'monthlyTargets',
    'recurringExpenses',
    'campaigns',
    'marketingPlans'
  ];
  const isServerMode = () => window.location.protocol !== 'file:';
  let available = false;
  let bootstrapped = false;
  let lastSync = null;
  let currentUser = null;
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  const readCookie = (name) => document.cookie
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf('=');
      return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
    .find(([key]) => key === name)?.[1] || '';

  const redirectToLogin = () => {
    if (window.location.pathname === '/login') return;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/login?next=${encodeURIComponent(next || '/')}`;
  };

  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const { timeout: timeoutMs = 5000, ...fetchOptions } = options;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const method = String(options.method || 'GET').toUpperCase();
    const csrfToken = mutatingMethods.has(method) ? readCookie('mh_csrf') : '';
    let res;
    try {
      res = await fetch(path, {
        ...fetchOptions,
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          ...(options.headers || {})
        },
        signal: controller.signal
      });
    } catch (err) {
      if (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort')) {
        throw new Error('Đồng bộ mất nhiều thời gian hơn dự kiến. Vui lòng thử lại sau ít phút.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 401) {
      redirectToLogin();
      throw new Error('Bạn cần đăng nhập để sử dụng ứng dụng.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `API error ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  };

  const check = async () => {
    if (!isServerMode()) return false;
    try {
      const health = await request('/api/health');
      available = !!health.ok;
      lastSync = health.lastSync || null;
      const user = await loadMe().catch(() => null);
      if (health.authRequired && !user) return false;
      return available;
    } catch {
      available = false;
      return false;
    }
  };

  const loadMe = async () => {
    if (!isServerMode()) return null;
    const session = await request('/api/me');
    currentUser = session.user || null;
    if (session.authRequired && !session.authenticated) redirectToLogin();
    return currentUser;
  };

  const importLocalOnce = async () => {
    if (localStorage.getItem(IMPORT_FLAG) === '1') return;
    const data = Store.getData();
    const hasCollectionData = SYNC_COLLECTIONS.some((collection) => (data[collection] || []).length > 0);
    const hasSingletonData = Object.prototype.hasOwnProperty.call(data, 'customCategories') && data.customCategories !== null;
    if (!hasCollectionData && !hasSingletonData) {
      localStorage.setItem(IMPORT_FLAG, '1');
      return;
    }
    await request('/api/fanpages/import-local', {
      method: 'POST',
      body: JSON.stringify({
        fanpages: data.fanpages || [],
        posts: data.posts || [],
        tasks: data.tasks || [],
        events: data.events || [],
        expenses: data.expenses || [],
        adReports: data.adReports || [],
        employees: data.employees || [],
        monthlyTargets: data.monthlyTargets || [],
        recurringExpenses: data.recurringExpenses || [],
        campaigns: data.campaigns || [],
        marketingPlans: data.marketingPlans || [],
        customCategories: data.customCategories
      })
    });
    localStorage.setItem(IMPORT_FLAG, '1');
  };

  const runFullSync = async () => {
    let cursor = 0;
    let attempts = 0;
    do {
      lastSync = await request(`/api/sync?cursor=${cursor}&maxFanpages=1&postLimit=25`, { method: 'POST', body: '{}', timeout: 60000 });
      cursor = lastSync.nextCursor || 0;
      attempts++;
    } while (lastSync.hasMore && attempts < 20);
    return lastSync;
  };

  const hydrate = async ({ sync = false } = {}) => {
    if (!available && !(await check())) return false;
    if (!currentUser) return false;
    await importLocalOnce();
    if (sync) {
      try {
        await runFullSync();
      } catch (err) {
        console.warn('Meta sync skipped:', err.message);
      }
    }
    const data = await request('/api/bootstrap');
    lastSync = data.lastSync || lastSync;
    Store.mergeRemoteData(data);
    bootstrapped = true;
    return true;
  };

  // Warn the user (at most once per interval) when a background write to the
  // server fails, so local edits don't silently diverge from the backend.
  let mirrorWarnAt = 0;
  const notifyMirrorFailure = () => {
    const nowMs = Date.now();
    if (nowMs - mirrorWarnAt < 8000) return;
    mirrorWarnAt = nowMs;
    if (typeof Toast !== 'undefined') {
      Toast.warning('Chưa đồng bộ được lên máy chủ — thay đổi mới chỉ lưu cục bộ. Sẽ thử lại khi tải lại trang.');
    }
  };

  const mirror = (path, options = {}) => {
    if (!available) return;
    request(path, options).catch((err) => {
      console.warn('Backend mirror failed:', err.message);
      notifyMirrorFailure();
    });
  };

  const connectMeta = () => {
    window.location.href = '/auth/meta/start';
  };

  const logout = () => {
    window.location.href = '/auth/logout';
  };

  const syncNow = async () => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    await runFullSync();
    const data = await request('/api/bootstrap');
    lastSync = data.lastSync || lastSync;
    Store.mergeRemoteData(data);
    return lastSync;
  };

  const publishDue = async () => {
    if (!available && !(await check())) return null;
    const result = await request('/api/publish-due', {
      method: 'POST',
      body: '{}',
      timeout: 30_000
    });
    await loadPosts(window.Utils?.getReportingMonth?.() || '');
    await loadPending().catch(() => {});
    return result;
  };

  const createPost = async (post, { refresh = true } = {}) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    const saved = await request('/api/posts', {
      method: 'POST',
      body: JSON.stringify(post || {})
    });
    if (refresh) await loadPending().catch(() => {});
    return saved;
  };

  const runPostTest = async (id, { refresh = true } = {}) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    const result = await request(`/api/posts/${encodeURIComponent(id)}/run-test`, {
      method: 'POST',
      body: '{}',
      timeout: 30000
    });
    if (refresh) {
      await loadPosts(window.Utils?.getReportingMonth?.() || '');
      await loadPending().catch(() => {});
    }
    return result;
  };

  const retryPost = async (id, { refresh = true } = {}) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    const result = await request(`/api/posts/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: '{}',
      timeout: 15_000
    });
    if (refresh) await loadPending().catch(() => {});
    return result;
  };

  const loadPosts = async (month = '', { limit = 500, offset = 0 } = {}) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const posts = await request(`/api/posts?${params.toString()}`);
    Store.mergeRemotePosts(posts, month);
    return posts;
  };

  // Publishing queue: pull every not-yet-published post across all months so
  // future-dated schedules show up regardless of the reporting month.
  const loadPending = async ({ limit = 500 } = {}) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    const posts = await request(`/api/posts?pending=1&limit=${limit}`);
    Store.mergeRemotePending(posts);
    return posts;
  };

  const updatePost = async (id, updates) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    return request(`/api/posts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates || {})
    });
  };

  const deletePost = async (id) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    await request(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await request('/api/bootstrap');
    lastSync = data.lastSync || lastSync;
    Store.mergeRemoteData(data);
    return true;
  };

  const loadAppLogs = async (filters = {}) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    return request(`/api/app-logs?${params.toString()}`, { timeout: 10_000 });
  };

  const loadPublishAttempts = async (postId, limit = 100) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    return request(`/api/posts/${encodeURIComponent(postId)}/publish-attempts?limit=${Math.min(Math.max(Number(limit) || 100, 1), 500)}`);
  };

  const sendClientLog = async (payload = {}) => {
    if (!isServerMode()) return null;
    return request('/api/app-logs/client', {
      method: 'POST', body: JSON.stringify(payload), timeout: 5_000
    });
  };

  const getHealth = async () => request('/api/health', { timeout: 10_000 });

  const computeMarketingPlan = async (inputs, weights) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    return request('/api/marketing-plans/compute', {
      method: 'POST',
      body: JSON.stringify({ inputs, ...(weights ? { weights } : {}) }),
      timeout: 15_000
    });
  };

  const suggestMarketingAllocation = async (inputs) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    return request('/api/marketing-plans/ai-suggest', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
      timeout: 25_000
    });
  };

  return {
    check,
    hydrate,
    mirror,
    connectMeta,
    loadMe,
    logout,
    syncNow,
    publishDue,
    createPost,
    runPostTest,
    retryPost,
    loadPosts,
    loadPending,
    updatePost,
    deletePost,
    loadAppLogs,
    loadPublishAttempts,
    sendClientLog,
    getHealth,
    computeMarketingPlan,
    suggestMarketingAllocation,
    get available() { return available; },
    get bootstrapped() { return bootstrapped; },
    get lastSync() { return lastSync; },
    get currentUser() { return currentUser; }
  };
})();

window.RemoteStore = RemoteStore;
