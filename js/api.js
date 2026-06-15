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
    'recurringExpenses'
  ];
  const isServerMode = () => window.location.protocol !== 'file:';
  let available = false;
  let bootstrapped = false;
  let lastSync = null;
  let currentUser = null;

  const redirectToLogin = () => {
    if (window.location.pathname === '/login') return;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/login?next=${encodeURIComponent(next || '/')}`;
  };

  const request = async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
      ...options
    }).finally(() => clearTimeout(timeout));
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
      await loadMe().catch(() => null);
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
        customCategories: data.customCategories
      })
    });
    localStorage.setItem(IMPORT_FLAG, '1');
  };

  const hydrate = async ({ sync = false } = {}) => {
    if (!available && !(await check())) return false;
    await importLocalOnce();
    if (sync) {
      try {
        lastSync = await request('/api/sync', { method: 'POST', body: '{}' });
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

  const mirror = (path, options = {}) => {
    if (!available) return;
    request(path, options).catch((err) => {
      console.warn('Backend mirror failed:', err.message);
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
    let cursor = 0;
    let attempts = 0;
    do {
      lastSync = await request(`/api/sync?cursor=${cursor}&maxFanpages=1&postLimit=100`, { method: 'POST', body: '{}' });
      cursor = lastSync.nextCursor || 0;
      attempts++;
    } while (lastSync.hasMore && attempts < 20);
    const data = await request('/api/bootstrap');
    lastSync = data.lastSync || lastSync;
    Store.mergeRemoteData(data);
    return lastSync;
  };

  const publishDue = async () => {
    if (!available && !(await check())) return null;
    const result = await request('/api/publish-due', { method: 'POST', body: '{}' });
    const data = await request('/api/bootstrap');
    lastSync = data.lastSync || lastSync;
    Store.mergeRemoteData(data);
    return result;
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

  const fetchGoogleSheetCsv = async (url) => {
    if (!available && !(await check())) throw new Error('Backend chưa sẵn sàng');
    return request('/api/google-sheets/csv', {
      method: 'POST',
      body: JSON.stringify({ url })
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
    updatePost,
    deletePost,
    fetchGoogleSheetCsv,
    get available() { return available; },
    get bootstrapped() { return bootstrapped; },
    get lastSync() { return lastSync; },
    get currentUser() { return currentUser; }
  };
})();

window.RemoteStore = RemoteStore;
