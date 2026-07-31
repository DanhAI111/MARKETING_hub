/* ═══════════════════════════════════════════
   MARKETING HUB - Data Store
   localStorage CRUD operations
   ═══════════════════════════════════════════ */

const Store = (() => {
  const STORE_KEY = 'marketing_hub_data';
  const VERSION = 1;
  const UI_SAMPLE_PREFIX = 'ui-sample-';
  const UI_SAMPLE_BATCH = 'ui-preview-v1';
  const REMOTE_COLLECTIONS = [
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
  const GENERIC_REMOTE_COLLECTIONS = new Set(REMOTE_COLLECTIONS.filter(c => c !== 'fanpages' && c !== 'posts'));

  // Default data structure
  const defaultData = () => ({
    version: VERSION,
    fanpages: [],
    posts: [],
    tasks: [],
    events: [],
    expenses: [],
    adReports: [],
    employees: [],
    monthlyTargets: [],
    recurringExpenses: [],
    campaigns: [],
    marketingPlans: [],
    customCategories: null,
    settings: {
      sidebarCollapsed: false,
      currentPage: 'dashboard',
      currency: 'VND'
    }
  });

  // Generate unique ID
  const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
  };

  // In-memory cache of the parsed store. Re-parsing the full localStorage blob
  // on every getAll() made pages re-JSON.parse the entire dataset dozens of
  // times per render. The cache is the single source of truth in memory; every
  // save() refreshes it, so reads never re-parse. Only save() mutates the blob,
  // so the cache can never drift (the one raw removeItem — settings reset —
  // reloads the page immediately).
  let cache = null;

  // Load data from localStorage (memoized).
  const load = () => {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      // Merge with defaults to ensure all keys exist.
      cache = raw ? { ...defaultData(), ...JSON.parse(raw) } : defaultData();
    } catch (e) {
      console.error('Store load error:', e);
      cache = defaultData();
    }
    return cache;
  };

  // Save data to localStorage. Returns true on success, false on failure
  // (e.g. QuotaExceededError). Callers must not report success blindly.
  const save = (data) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      cache = data;
      return true;
    } catch (e) {
      console.error('Store save error:', e);
      const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      if (typeof Toast !== 'undefined') {
        Toast.error(quota
          ? 'Bộ nhớ trình duyệt đã đầy — không lưu được. Hãy xoá bớt ảnh/dữ liệu cũ.'
          : 'Không lưu được dữ liệu vào trình duyệt.');
      }
      return false;
    }
  };

  // Get all data
  const getData = () => load();

  const mergeRemoteData = (remoteData = {}) => {
    const data = load();
    const merged = { ...data };
    REMOTE_COLLECTIONS.forEach((collection) => {
      if (Array.isArray(remoteData[collection])) {
        merged[collection] = remoteData[collection];
      }
    });
    if (Object.prototype.hasOwnProperty.call(remoteData, 'customCategories')) {
      merged.customCategories = remoteData.customCategories;
    }
    save(merged);
    return merged;
  };

  const mergeRemotePosts = (posts = [], month = '') => {
    const data = load();
    const incoming = Array.isArray(posts) ? posts : [];
    if (!month) {
      data.posts = incoming;
    } else {
      data.posts = [
        ...(data.posts || []).filter(post => {
          const postMonth = (post.date || post.scheduledAt || '').slice(0, 7);
          return postMonth !== month;
        }),
        ...incoming
      ];
    }
    save(data);
    return data.posts;
  };

  // Replace the local pending set (all not-yet-published posts) with the
  // server's, keeping published posts untouched. Used by the publishing queue,
  // which spans every month and so can't key off a single reporting month.
  const mergeRemotePending = (posts = []) => {
    const data = load();
    const incoming = Array.isArray(posts) ? posts : [];
    data.posts = [
      ...(data.posts || []).filter(post => post.status === 'published'),
      ...incoming
    ];
    save(data);
    return data.posts;
  };

  const mirrorRemote = (collection, action, payload = {}) => {
    if (!window.RemoteStore?.available) return;
    if (GENERIC_REMOTE_COLLECTIONS.has(collection)) {
      const base = `/api/collections/${encodeURIComponent(collection)}`;
      if (action === 'create') {
        RemoteStore.mirror(base, { method: 'POST', body: JSON.stringify(payload.item) });
      } else if (action === 'update') {
        RemoteStore.mirror(`${base}/${encodeURIComponent(payload.id)}`, { method: 'PUT', body: JSON.stringify(payload.item || payload.updates) });
      } else if (action === 'remove') {
        RemoteStore.mirror(`${base}/${encodeURIComponent(payload.id)}`, { method: 'DELETE' });
      }
      return;
    }
    if (collection === 'fanpages') {
      if (action === 'create') {
        RemoteStore.mirror('/api/fanpages', { method: 'POST', body: JSON.stringify(payload.item) });
      } else if (action === 'update') {
        RemoteStore.mirror(`/api/fanpages/${encodeURIComponent(payload.id)}`, { method: 'PUT', body: JSON.stringify(payload.updates) });
      } else if (action === 'remove') {
        RemoteStore.mirror(`/api/fanpages/${encodeURIComponent(payload.id)}`, { method: 'DELETE' });
      }
    }
    if (collection === 'posts') {
      if (action === 'create') {
        RemoteStore.mirror('/api/posts', { method: 'POST', body: JSON.stringify(payload.item) });
      } else if (action === 'update') {
        RemoteStore.mirror(`/api/posts/${encodeURIComponent(payload.id)}`, { method: 'PUT', body: JSON.stringify(payload.updates) });
      } else if (action === 'remove') {
        RemoteStore.mirror(`/api/posts/${encodeURIComponent(payload.id)}`, { method: 'DELETE' });
      }
    }
  };

  // ── Generic CRUD ──

  // Return a shallow copy: callers sort/reverse the result in place
  // (e.g. campaigns, ads), which must never mutate the cached array.
  const getAll = (collection) => {
    const data = load();
    return data[collection] ? [...data[collection]] : [];
  };

  const getById = (collection, id) => {
    return getAll(collection).find(item => item.id === id);
  };

  const create = (collection, item) => {
    const data = load();
    const newItem = {
      ...item,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data[collection] = [...(data[collection] || []), newItem];
    save(data);
    mirrorRemote(collection, 'create', { item: newItem });
    return newItem;
  };

  const update = (collection, id, updates) => {
    const data = load();
    const previousItem = (data[collection] || []).find(item => item.id === id);
    data[collection] = (data[collection] || []).map(item =>
      item.id === id
        ? { ...item, ...updates, updatedAt: new Date().toISOString() }
        : item
    );
    save(data);
    const updatedItem = data[collection].find(item => item.id === id);
    mirrorRemote(collection, 'update', {
      id,
      updates: { ...updates, expectedUpdatedAt: previousItem?.updatedAt },
      item: { ...updatedItem, expectedUpdatedAt: previousItem?.updatedAt }
    });
    return updatedItem;
  };

  const remove = (collection, id) => {
    const data = load();
    data[collection] = (data[collection] || []).filter(item => item.id !== id);
    save(data);
    mirrorRemote(collection, 'remove', { id });
  };

  const bulkCreate = (collection, items) => {
    const data = load();
    const newItems = items.map(item => ({
      ...item,
      id: generateId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
    data[collection] = [...(data[collection] || []), ...newItems];
    save(data);
    newItems.forEach(item => mirrorRemote(collection, 'create', { item }));
    return newItems;
  };

  // ── Fanpages ──
  const fanpages = {
    getAll: () => getAll('fanpages'),
    getById: (id) => getById('fanpages', id),
    create: (fp) => create('fanpages', fp),
    update: (id, updates) => update('fanpages', id, updates),
    remove: (id) => {
      // Also remove associated posts and ad reports
      const data = load();
      data.posts = data.posts.filter(p => p.fanpageId !== id);
      data.adReports = data.adReports.filter(r => r.fanpageId !== id);
      data.fanpages = data.fanpages.filter(f => f.id !== id);
      save(data);
      mirrorRemote('fanpages', 'remove', { id });
    },
    getByPlatform: (platform) => getAll('fanpages').filter(f => f.platform === platform),
    setKpi: (id, month, target) => {
      const fp = getById('fanpages', id);
      if (!fp) return;
      const kpis = { ...(fp.kpis || {}) };
      kpis[month] = target;
      return update('fanpages', id, { kpis });
    },
    getKpi: (id, month) => {
      const fp = getById('fanpages', id);
      return fp?.kpis?.[month] || 0;
    }
  };

  // ── Posts ──
  const posts = {
    getAll: () => getAll('posts'),
    getById: (id) => getById('posts', id),
    create: (post) => create('posts', post),
    update: (id, updates) => update('posts', id, updates),
    remove: (id) => remove('posts', id),
    getByFanpage: (fanpageId) => getAll('posts').filter(p => p.fanpageId === fanpageId),
    getByMonth: (month) => getAll('posts').filter(p => p.status === 'published' && p.date && p.date.startsWith(month)),
    getScheduled: () => getAll('posts').filter(p => p.status !== 'published'),
    getScheduledByMonth: (month) => getAll('posts').filter(p => p.status !== 'published' && ((p.date && p.date.startsWith(month)) || (p.scheduledAt && p.scheduledAt.startsWith(month)))),
    getScheduledDue: () => {
      const now = new Date().toISOString();
      return getAll('posts').filter(p => ['scheduled', 'failed'].includes(p.status) && p.scheduledAt && p.scheduledAt <= now);
    },
    getCountByFanpageAndMonth: (fanpageId, month) => {
      return getAll('posts').filter(p => p.status === 'published' && p.fanpageId === fanpageId && p.date && p.date.startsWith(month)).length;
    },
    getFanpagesWithPostToday: () => {
      const today = new Date().toISOString().split('T')[0];
      const todayPosts = getAll('posts').filter(p => p.status === 'published' && p.date === today);
      return [...new Set(todayPosts.map(p => p.fanpageId))];
    }
  };

  // ── Tasks ──
  const tasks = {
    getAll: () => getAll('tasks'),
    getById: (id) => getById('tasks', id),
    create: (task) => create('tasks', { ...task, status: task.status || 'pending' }),
    update: (id, updates) => update('tasks', id, updates),
    remove: (id) => remove('tasks', id),
    getByStatus: (status) => getAll('tasks').filter(t => t.status === status),
    getOverdue: () => {
      const today = new Date().toISOString().split('T')[0];
      return getAll('tasks').filter(t => t.deadline && t.deadline < today && t.status !== 'completed');
    }
  };

  // ── Events ──
  const events = {
    getAll: () => getAll('events'),
    getById: (id) => getById('events', id),
    create: (event) => create('events', event),
    update: (id, updates) => update('events', id, updates),
    remove: (id) => remove('events', id),
    getUpcoming: (limit = 5) => {
      const today = new Date().toISOString().split('T')[0];
      return getAll('events')
        .filter(e => e.date >= today && e.status !== 'cancelled')
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, limit);
    },
    getByMonth: (month) => getAll('events').filter(e => e.date && e.date.startsWith(month))
  };

  // ── Expenses ──
  const expenses = {
    getAll: () => getAll('expenses'),
    getById: (id) => getById('expenses', id),
    create: (expense) => create('expenses', expense),
    update: (id, updates) => update('expenses', id, updates),
    remove: (id) => remove('expenses', id),
    getByMonth: (month) => getAll('expenses').filter(e => e.date && e.date.startsWith(month)),
    getByCategory: (category) => getAll('expenses').filter(e => e.category === category),
    getTotalByMonth: (month) => {
      return getAll('expenses')
        .filter(e => e.date && e.date.startsWith(month))
        .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    },
    getTotalByCategoryAndMonth: (category, month) => {
      return getAll('expenses')
        .filter(e => e.category === category && e.date && e.date.startsWith(month))
        .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    }
  };

  // ── Ad Reports ──
  const adReports = {
    getAll: () => getAll('adReports'),
    getById: (id) => getById('adReports', id),
    create: (report) => create('adReports', report),
    update: (id, updates) => update('adReports', id, updates),
    remove: (id) => remove('adReports', id),
    getByFanpage: (fanpageId) => getAll('adReports').filter(r => r.fanpageId === fanpageId),
    getByMonth: (month) => getAll('adReports').filter(r => r.date && r.date.startsWith(month)),
    getByFanpageAndMonth: (fanpageId, month) => {
      return getAll('adReports').filter(r => r.fanpageId === fanpageId && r.date && r.date.startsWith(month));
    },
    getAggregatedByMonth: (month) => {
      const reports = getAll('adReports').filter(r => r.date && r.date.startsWith(month));
      if (reports.length === 0) return null;
      return {
        spend: reports.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0),
        reach: reports.reduce((s, r) => s + (parseInt(r.reach) || 0), 0),
        impressions: reports.reduce((s, r) => s + (parseInt(r.impressions) || 0), 0),
        clicks: reports.reduce((s, r) => s + (parseInt(r.clicks) || 0), 0),
        messages: reports.reduce((s, r) => s + (parseInt(r.messages) || 0), 0),
        conversions: reports.reduce((s, r) => s + (parseInt(r.conversions) || 0), 0),
        engagement: reports.reduce((s, r) => s + (parseInt(r.engagement) || 0), 0),
        get cpc() { return this.clicks > 0 ? this.spend / this.clicks : 0; },
        get cpm() { return this.impressions > 0 ? (this.spend / this.impressions) * 1000 : 0; },
        get costPerMessage() { return this.messages > 0 ? this.spend / this.messages : 0; },
        get roas() { return this.spend > 0 ? (parseFloat(reports.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0)) / this.spend) : 0; }
      };
    }
  };

  // ── Settings ──
  const settings = {
    get: (key) => {
      const data = load();
      return data.settings?.[key];
    },
    set: (key, value) => {
      const data = load();
      data.settings = { ...(data.settings || {}), [key]: value };
      save(data);
    }
  };

  // ── Employees ──
  const employees = {
    getAll: () => getAll('employees'),
    getById: (id) => getById('employees', id),
    create: (emp) => create('employees', emp),
    update: (id, updates) => update('employees', id, updates),
    remove: (id) => remove('employees', id)
  };

  // ── Monthly Targets ──
  const monthlyTargets = {
    getAll: () => getAll('monthlyTargets'),
    getByMonth: (month) => {
      const all = getAll('monthlyTargets');
      return all.find(t => t.month === month) || null;
    },
    set: (month, targets) => {
      const data = load();
      const existing = (data.monthlyTargets || []).findIndex(t => t.month === month);
      if (existing >= 0) {
        data.monthlyTargets[existing] = { ...data.monthlyTargets[existing], ...targets, month, updatedAt: new Date().toISOString() };
      } else {
        data.monthlyTargets = [...(data.monthlyTargets || []), { ...targets, id: generateId(), month, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
      }
      save(data);
      const item = data.monthlyTargets.find(t => t.month === month);
      if (item) {
        mirrorRemote('monthlyTargets', existing >= 0 ? 'update' : 'create', {
          id: item.id,
          updates: item,
          item
        });
      }
    }
  };

  // ── Recurring Expenses ──
  const recurringExpenses = {
    getAll: () => getAll('recurringExpenses'),
    getById: (id) => getById('recurringExpenses', id),
    create: (item) => create('recurringExpenses', item),
    update: (id, updates) => update('recurringExpenses', id, updates),
    remove: (id) => remove('recurringExpenses', id),
    generateForMonth: (month) => {
      const templates = getAll('recurringExpenses').filter(r => r.active !== false);
      const existingExpenses = getAll('expenses');
      let generated = 0;
      templates.forEach(tpl => {
        const alreadyExists = existingExpenses.some(e => e.recurringId === tpl.id && e.date && e.date.startsWith(month));
        if (!alreadyExists) {
          create('expenses', {
            date: `${month}-01`,
            category: tpl.category,
            description: tpl.description,
            amount: tpl.amount,
            notes: `Tự động tạo từ chi phí định kỳ`,
            recurringId: tpl.id,
            uiSampleData: tpl.uiSampleData === true,
            sampleBatch: tpl.sampleBatch || ''
          });
          generated++;
        }
      });
      return generated;
    }
  };

  // ── Campaigns ──
  // A campaign groups posts, ad reports, events and expenses under one goal +
  // budget. Members soft-link back via campaignId; deleting a campaign clears
  // those links without deleting the member records.
  const campaigns = {
    getAll: () => getAll('campaigns'),
    getById: (id) => getById('campaigns', id),
    create: (c) => create('campaigns', { status: 'active', ...c }),
    update: (id, updates) => update('campaigns', id, updates),
    remove: (id) => {
      const data = load();
      const timestamp = new Date().toISOString();
      const memberCollections = ['posts', 'adReports', 'events', 'expenses'];
      const unlinkedItems = [];
      memberCollections.forEach((collection) => {
        data[collection] = (data[collection] || []).map((item) => {
          if (item.campaignId !== id) return item;
          const updated = { ...item, campaignId: '', updatedAt: timestamp };
          unlinkedItems.push({ collection, item: updated });
          return updated;
        });
      });
      data.campaigns = (data.campaigns || []).filter((campaign) => campaign.id !== id);
      save(data);

      unlinkedItems.forEach(({ collection, item }) => {
        mirrorRemote(collection, 'update', {
          id: item.id,
          updates: { campaignId: '' },
          item
        });
      });
      mirrorRemote('campaigns', 'remove', { id });
    },
    // Aggregate members + KPIs for a campaign, across every collection.
    getStats: (id) => {
      const posts = getAll('posts').filter(p => p.campaignId === id);
      const ads = getAll('adReports').filter(r => r.campaignId === id);
      const events = getAll('events').filter(e => e.campaignId === id);
      const expenses = getAll('expenses').filter(e => e.campaignId === id);
      const adSpend = ads.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
      const otherSpend = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
      const eventBudget = events.reduce((s, e) => s + (parseFloat(e.budget) || 0), 0);
      const revenue = ads.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);
      const totalSpend = adSpend + otherSpend + eventBudget;
      return {
        postCount: posts.length,
        publishedCount: posts.filter(p => p.status === 'published').length,
        adCount: ads.length,
        eventCount: events.length,
        expenseCount: expenses.length,
        adSpend,
        otherSpend,
        eventBudget,
        totalSpend,
        revenue,
        roas: adSpend > 0 ? revenue / adSpend : 0
      };
    }
  };

  // ── Revenue-driven marketing plans ──
  const marketingPlans = {
    getAll: () => getAll('marketingPlans'),
    getById: (id) => getById('marketingPlans', id),
    create: (plan) => create('marketingPlans', plan),
    update: (id, updates) => update('marketingPlans', id, updates),
    remove: (id) => remove('marketingPlans', id)
  };

  // ── Custom Expense Categories ──
  const customCategories = {
    getAll: () => {
      const data = load();
      return data.customCategories;
    },
    save: (categories) => {
      const data = load();
      data.customCategories = categories;
      save(data);
      if (window.RemoteStore?.available) {
        RemoteStore.mirror('/api/singletons/customCategories', {
          method: 'PUT',
          body: JSON.stringify({ value: categories })
        });
      }
    }
  };

  // ── Backup / Restore ──
  const backup = () => {
    const data = load();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketing_hub_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restore = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          save({ ...defaultData(), ...data });
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  // ── Reversible local UI sample data ──
  // This dataset is intentionally written in one localStorage transaction and
  // never mirrored to the remote API. Every record has a dedicated marker so it
  // can be removed later without touching the user's real records.
  const uiSampleData = (() => {
    const mark = (item) => ({
      ...item,
      uiSampleData: true,
      sampleBatch: UI_SAMPLE_BATCH,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const getMonthContext = () => {
      const now = new Date();
      const year = now.getFullYear();
      const monthIndex = now.getMonth();
      const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const day = Math.min(now.getDate(), daysInMonth);
      const dateAt = (offset = 0) => {
        const targetDay = Math.max(1, Math.min(daysInMonth, day + offset));
        return `${month}-${String(targetDay).padStart(2, '0')}`;
      };
      return { month, day, daysInMonth, dateAt };
    };

    const buildDataset = () => {
      const { month, dateAt } = getMonthContext();
      const fanpageFacebook = `${UI_SAMPLE_PREFIX}fanpage-facebook`;
      const fanpageInstagram = `${UI_SAMPLE_PREFIX}fanpage-instagram`;
      const fanpageTiktok = `${UI_SAMPLE_PREFIX}fanpage-tiktok`;
      const campaignLaunch = `${UI_SAMPLE_PREFIX}campaign-launch`;
      const campaignAwareness = `${UI_SAMPLE_PREFIX}campaign-awareness`;
      const publishedDates = [-18, -14, -10, -7, -4, -2, 0];
      const adDates = [-14, -11, -8, -5, -3, -1, 0];

      return {
        month,
        collections: {
          fanpages: [
            mark({
              id: fanpageFacebook,
              name: 'MKT Hub Vietnam',
              platform: 'facebook',
              link: 'https://facebook.com/mkthub.sample',
              connected: false,
              kpis: { [month]: 24 }
            }),
            mark({
              id: fanpageInstagram,
              name: 'MKT Hub Creative',
              platform: 'instagram',
              link: 'https://instagram.com/mkthub.sample',
              connected: false,
              kpis: { [month]: 18 }
            }),
            mark({
              id: fanpageTiktok,
              name: 'MKT Hub Short Video',
              platform: 'tiktok',
              link: 'https://tiktok.com/@mkthub.sample',
              connected: false,
              kpis: { [month]: 12 }
            })
          ],
          employees: [
            mark({ id: `${UI_SAMPLE_PREFIX}employee-an`, name: 'Minh An', role: 'Content Lead', email: 'minhan@example.test', avatar: '' }),
            mark({ id: `${UI_SAMPLE_PREFIX}employee-linh`, name: 'Khánh Linh', role: 'Performance', email: 'khanhlinh@example.test', avatar: '' }),
            mark({ id: `${UI_SAMPLE_PREFIX}employee-vy`, name: 'Thảo Vy', role: 'Event Executive', email: 'thaovy@example.test', avatar: '' })
          ],
          campaigns: [
            mark({
              id: campaignLaunch,
              name: 'Ra mắt sản phẩm mùa hè',
              goal: 'Tăng nhận diện, tạo khách hàng tiềm năng và kiểm thử hành trình chuyển đổi.',
              status: 'active',
              budget: 95000000,
              startAt: dateAt(-18),
              endAt: dateAt(5),
              fanpageIds: [fanpageFacebook, fanpageInstagram]
            }),
            mark({
              id: campaignAwareness,
              name: 'Nhận diện thương hiệu quý mới',
              goal: 'Mở rộng độ phủ trên video ngắn và nội dung hậu trường.',
              status: 'planning',
              budget: 60000000,
              startAt: dateAt(3),
              endAt: dateAt(6),
              fanpageIds: [fanpageInstagram, fanpageTiktok]
            })
          ],
          posts: [
            ...publishedDates.map((offset, index) => mark({
              id: `${UI_SAMPLE_PREFIX}post-published-${index + 1}`,
              fanpageId: index % 2 === 0 ? fanpageFacebook : fanpageInstagram,
              campaignId: campaignLaunch,
              date: dateAt(offset),
              title: [
                'Teaser sản phẩm mới',
                'Câu chuyện phía sau chiến dịch',
                'Video mở hộp phiên bản giới hạn',
                'Phản hồi sớm từ khách hàng',
                'Hậu trường buổi chụp hình',
                'Điểm nổi bật của sản phẩm',
                'Ưu đãi trong tuần ra mắt'
              ][index],
              content: 'Nội dung mẫu dùng để kiểm tra bố cục, bộ lọc và số liệu tổng quan.',
              status: 'published',
              approvalStatus: 'approved',
              reach: 18000 + index * 4200,
              engagement: 1300 + index * 240,
              clicks: 260 + index * 65
            })),
            mark({
              id: `${UI_SAMPLE_PREFIX}post-scheduled-1`,
              fanpageId: fanpageInstagram,
              campaignId: campaignLaunch,
              date: dateAt(2),
              scheduledAt: `${dateAt(2)}T09:00:00`,
              title: 'Livestream giải đáp về sản phẩm',
              content: 'Bài mẫu đã được duyệt và đang chờ đến giờ đăng.',
              status: 'scheduled',
              approvalStatus: 'approved'
            }),
            mark({
              id: `${UI_SAMPLE_PREFIX}post-scheduled-2`,
              fanpageId: fanpageTiktok,
              campaignId: campaignAwareness,
              date: dateAt(4),
              scheduledAt: `${dateAt(4)}T20:00:00`,
              title: 'Một ngày cùng đội ngũ sáng tạo',
              content: 'Video ngắn mẫu cho lịch đăng bài.',
              status: 'scheduled',
              approvalStatus: 'pending'
            })
          ],
          tasks: [
            mark({ id: `${UI_SAMPLE_PREFIX}task-1`, title: 'Duyệt nội dung livestream', partner: 'Nội bộ', assignee: 'Minh An', priority: 'high', status: 'in-progress', deadline: dateAt(1), notes: 'Kiểm tra CTA và thông tin ưu đãi.' }),
            mark({ id: `${UI_SAMPLE_PREFIX}task-2`, title: 'Tối ưu nhóm quảng cáo chuyển đổi', partner: 'Đội Performance', assignee: 'Khánh Linh', priority: 'high', status: 'review', deadline: dateAt(2), notes: 'Đối chiếu CPC giữa hai nhóm đối tượng.' }),
            mark({ id: `${UI_SAMPLE_PREFIX}task-3`, title: 'Chuẩn bị backdrop sự kiện', partner: 'Nhà cung cấp', assignee: 'Thảo Vy', priority: 'medium', status: 'pending', deadline: dateAt(3), notes: '' }),
            mark({ id: `${UI_SAMPLE_PREFIX}task-4`, title: 'Hoàn thiện báo cáo tuần', partner: 'Nội bộ', assignee: 'Khánh Linh', priority: 'medium', status: 'completed', deadline: dateAt(-1), notes: 'Đã gửi cho quản lý.' }),
            mark({ id: `${UI_SAMPLE_PREFIX}task-5`, title: 'Lên kịch bản video hậu trường', partner: 'Creative Studio', assignee: 'Minh An', priority: 'low', status: 'pending', deadline: dateAt(4), notes: '' })
          ],
          events: [
            mark({
              id: `${UI_SAMPLE_PREFIX}event-launch`,
              campaignId: campaignLaunch,
              name: 'Trải nghiệm sản phẩm mới',
              type: 'launch',
              date: dateAt(3),
              startTime: '09:00',
              endTime: '11:30',
              status: 'preparing',
              priority: 'high',
              address: 'Quận 1, TP.HCM',
              budget: 28000000,
              attendeeCount: 120,
              plan: 'Đón khách, trải nghiệm sản phẩm, chia sẻ từ đội ngũ và networking.'
            }),
            mark({
              id: `${UI_SAMPLE_PREFIX}event-workshop`,
              campaignId: campaignAwareness,
              name: 'Workshop sáng tạo video ngắn',
              type: 'workshop',
              date: dateAt(6),
              startTime: '14:00',
              endTime: '17:00',
              status: 'planning',
              priority: 'medium',
              address: 'Thủ Đức, TP.HCM',
              budget: 16000000,
              attendeeCount: 60
            })
          ],
          expenses: [
            mark({ id: `${UI_SAMPLE_PREFIX}expense-1`, campaignId: campaignLaunch, date: dateAt(-16), category: 'content', description: 'Sản xuất video chủ đạo', amount: 12000000, notes: 'Thanh toán đợt 1' }),
            mark({ id: `${UI_SAMPLE_PREFIX}expense-2`, campaignId: campaignLaunch, date: dateAt(-12), category: 'ads', description: 'Ngân sách quảng cáo Meta', amount: 9000000, notes: '' }),
            mark({ id: `${UI_SAMPLE_PREFIX}expense-3`, campaignId: campaignLaunch, date: dateAt(-7), category: 'event', description: 'Đặt cọc địa điểm sự kiện', amount: 8000000, notes: '' }),
            mark({ id: `${UI_SAMPLE_PREFIX}expense-4`, campaignId: campaignAwareness, date: dateAt(-4), category: 'kol', description: 'Chi phí cộng tác creator', amount: 6500000, notes: 'Hai video ngắn' }),
            mark({ id: `${UI_SAMPLE_PREFIX}expense-5`, campaignId: '', date: dateAt(-2), category: 'other', description: 'Kho tài nguyên thiết kế', amount: 1800000, notes: 'Gói sử dụng theo tháng' })
          ],
          adReports: adDates.flatMap((offset, index) => [
            mark({
              id: `${UI_SAMPLE_PREFIX}ad-facebook-${index + 1}`,
              campaignId: campaignLaunch,
              fanpageId: fanpageFacebook,
              date: dateAt(offset),
              spend: 720000 + index * 85000,
              reach: 16500 + index * 3400,
              impressions: 28400 + index * 5100,
              clicks: 540 + index * 86,
              messages: 38 + index * 7,
              conversions: 18 + index * 4,
              engagement: 1850 + index * 230,
              revenue: 2600000 + index * 520000
            }),
            mark({
              id: `${UI_SAMPLE_PREFIX}ad-instagram-${index + 1}`,
              campaignId: campaignLaunch,
              fanpageId: fanpageInstagram,
              date: dateAt(offset),
              spend: 540000 + index * 70000,
              reach: 13200 + index * 2800,
              impressions: 22600 + index * 4300,
              clicks: 420 + index * 72,
              messages: 29 + index * 6,
              conversions: 13 + index * 3,
              engagement: 1620 + index * 210,
              revenue: 2100000 + index * 430000
            })
          ]),
          recurringExpenses: [
            mark({
              id: `${UI_SAMPLE_PREFIX}recurring-design-tools`,
              description: 'Bộ công cụ thiết kế và quản lý nội dung',
              category: 'content',
              amount: 2450000,
              active: true,
              notes: 'Mẫu kiểm tra luồng chi phí định kỳ'
            })
          ],
          monthlyTargets: [
            mark({
              id: `${UI_SAMPLE_PREFIX}target-${month}`,
              month,
              totalBudget: 180000000,
              adsBudget: 65000000,
              eventBudget: 50000000,
              targetPosts: 54,
              targetEvents: 3,
              targetRevenue: 320000000
            })
          ]
        }
      };
    };

    const seed = () => {
      const data = load();
      const dataset = buildDataset();
      const counts = {};
      let added = 0;

      REMOTE_COLLECTIONS.forEach((collection) => {
        const current = Array.isArray(data[collection]) ? data[collection] : [];
        let incoming = dataset.collections[collection] || [];
        if (collection === 'monthlyTargets' && current.some(item => item.month === dataset.month)) {
          incoming = [];
        }
        const existingIds = new Set(current.map(item => item.id));
        const additions = incoming.filter(item => !existingIds.has(item.id));
        data[collection] = [...current, ...additions];
        counts[collection] = additions.length;
        added += additions.length;
      });

      save(data);
      return { added, month: dataset.month, counts };
    };

    const clear = () => {
      const data = load();
      const counts = {};
      let removed = 0;

      REMOTE_COLLECTIONS.forEach((collection) => {
        const current = Array.isArray(data[collection]) ? data[collection] : [];
        const remaining = current.filter(item =>
          item.uiSampleData !== true && !String(item.id || '').startsWith(UI_SAMPLE_PREFIX)
        );
        counts[collection] = current.length - remaining.length;
        removed += counts[collection];
        data[collection] = remaining;
      });

      save(data);
      return { removed, counts };
    };

    const getStatus = () => {
      const data = load();
      const counts = {};
      REMOTE_COLLECTIONS.forEach((collection) => {
        counts[collection] = (data[collection] || []).filter(item =>
          item.uiSampleData === true || String(item.id || '').startsWith(UI_SAMPLE_PREFIX)
        ).length;
      });
      return {
        active: Object.values(counts).some(count => count > 0),
        counts
      };
    };

    return { seed, clear, getStatus };
  })();

  // ── Seed demo data ──
  const seedDemoData = () => {
    const data = load();
    if (data.fanpages.length > 0) return; // Already has data

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonth = (() => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    // Demo fanpages
    const demoFanpages = [
      { name: 'Công ty ABC Official', platform: 'facebook', link: 'https://facebook.com/congtyabc', kpis: { [currentMonth]: 20, [prevMonth]: 18 } },
      { name: 'ABC Shop', platform: 'facebook', link: 'https://facebook.com/abcshop', kpis: { [currentMonth]: 15, [prevMonth]: 12 } },
      { name: 'ABC Lifestyle', platform: 'instagram', link: 'https://instagram.com/abclifestyle', kpis: { [currentMonth]: 25, [prevMonth]: 20 } },
      { name: 'ABC Official', platform: 'tiktok', link: 'https://tiktok.com/@abcofficial', kpis: { [currentMonth]: 12, [prevMonth]: 10 } },
      { name: 'ABC News', platform: 'threads', link: 'https://threads.net/@abcnews', kpis: { [currentMonth]: 10, [prevMonth]: 8 } },
      { name: 'ABC Vietnam', platform: 'zalo', link: 'https://zalo.me/abcvietnam', kpis: { [currentMonth]: 8, [prevMonth]: 8 } },
      { name: 'ABC Beauty', platform: 'facebook', link: 'https://facebook.com/abcbeauty', kpis: { [currentMonth]: 18, [prevMonth]: 15 } },
      { name: 'ABC Food', platform: 'instagram', link: 'https://instagram.com/abcfood', kpis: { [currentMonth]: 20, [prevMonth]: 16 } },
      { name: 'ABC Travel', platform: 'tiktok', link: 'https://tiktok.com/@abctravel', kpis: { [currentMonth]: 8, [prevMonth]: 8 } },
    ];

    const fps = bulkCreate('fanpages', demoFanpages);

    // Demo posts
    const demoPosts = [];
    fps.forEach(fp => {
      const target = fp.kpis?.[currentMonth] || 10;
      const count = Math.floor(target * (0.3 + Math.random() * 0.7));
      for (let i = 0; i < count; i++) {
        const day = Math.min(now.getDate(), Math.floor(Math.random() * now.getDate()) + 1);
        demoPosts.push({
          fanpageId: fp.id,
          date: `${currentMonth}-${String(day).padStart(2, '0')}`,
          title: `Bài viết ${i + 1} - ${fp.name}`,
          status: 'published'
        });
      }
    });
    bulkCreate('posts', demoPosts);

    // Demo tasks
    const demoTasks = [
      { title: 'Thiết kế banner sự kiện tháng 6', partner: 'Đối tác A', assignee: 'Minh', priority: 'high', status: 'in-progress', deadline: `${currentMonth}-${String(Math.min(now.getDate() + 3, 28)).padStart(2, '0')}`, notes: 'Cần hoàn thành trước thứ 6' },
      { title: 'Viết content quảng cáo sản phẩm mới', partner: 'Đối tác B', assignee: 'Hoa', priority: 'high', status: 'pending', deadline: `${currentMonth}-${String(Math.min(now.getDate() + 5, 28)).padStart(2, '0')}`, notes: '' },
      { title: 'Chụp ảnh sản phẩm cho Instagram', partner: 'Nội bộ', assignee: 'Tuấn', priority: 'medium', status: 'in-progress', deadline: `${currentMonth}-${String(Math.min(now.getDate() + 2, 28)).padStart(2, '0')}`, notes: '20 sản phẩm' },
      { title: 'Review nội dung KOL post', partner: 'Đối tác C', assignee: 'Linh', priority: 'medium', status: 'review', deadline: `${currentMonth}-${String(Math.min(now.getDate() + 1, 28)).padStart(2, '0')}`, notes: '' },
      { title: 'Lên kế hoạch nội dung tháng 7', partner: 'Nội bộ', assignee: 'Minh', priority: 'low', status: 'pending', deadline: `${currentMonth}-28`, notes: '' },
      { title: 'Báo cáo hiệu quả quảng cáo Q2', partner: 'Nội bộ', assignee: 'Hoa', priority: 'high', status: 'completed', deadline: `${currentMonth}-10`, notes: 'Đã gửi cho sếp' },
      { title: 'Liên hệ KOL cho campaign hè', partner: 'Đối tác D', assignee: 'Tuấn', priority: 'medium', status: 'pending', deadline: `${currentMonth}-20`, notes: '5 KOL mục tiêu' },
    ];
    bulkCreate('tasks', demoTasks);

    // Demo events
    const demoEvents = [
      { name: 'Workshop Marketing Digital 2026', type: 'workshop', date: `${currentMonth}-${String(Math.min(now.getDate() + 7, 28)).padStart(2, '0')}`, startTime: '09:00', endTime: '17:00', status: 'preparing', priority: 'high', address: 'Trung tâm Hội nghị ABC, Q.1, TP.HCM', budget: 25000000, attendeeCount: 150, plan: 'Workshop chia sẻ kiến thức Marketing Digital cho nhân viên và đối tác.', guestList: '' },
      { name: 'Team Building Q3', type: 'team-building', date: `${currentMonth}-25`, startTime: '07:00', endTime: '18:00', status: 'planning', priority: 'medium', address: 'Khu du lịch Đại Nam, Bình Dương', budget: 45000000, attendeeCount: 80, plan: '', guestList: '' },
      { name: 'Ra mắt sản phẩm mới', type: 'seminar', date: `${currentMonth}-${String(Math.min(now.getDate() + 14, 28)).padStart(2, '0')}`, startTime: '14:00', endTime: '17:00', status: 'preparing', priority: 'high', address: 'Khách sạn Intercontinental, Q.1, TP.HCM', budget: 80000000, attendeeCount: 200, plan: 'Sự kiện ra mắt dòng sản phẩm mới.', guestList: '' },
    ];
    bulkCreate('events', demoEvents);

    // Demo expenses
    const demoExpenses = [
      { date: `${currentMonth}-05`, category: 'ads', description: 'Facebook Ads - Campaign tháng 6', amount: 15000000, notes: '' },
      { date: `${currentMonth}-05`, category: 'ads', description: 'TikTok Ads - Video quảng cáo', amount: 8000000, notes: '' },
      { date: `${currentMonth}-10`, category: 'content', description: 'Thiết kế 20 visual posts', amount: 4000000, notes: 'Designer freelance' },
      { date: `${currentMonth}-08`, category: 'kol', description: 'KOL review sản phẩm - Influencer A', amount: 12000000, notes: '3 bài review' },
      { date: `${currentMonth}-12`, category: 'event', description: 'Đặt cọc venue Workshop', amount: 5000000, notes: '' },
      { date: `${currentMonth}-03`, category: 'print', description: 'In brochure sản phẩm mới', amount: 3500000, notes: '500 bản' },
      { date: `${currentMonth}-07`, category: 'other', description: 'Mua stock photos', amount: 1200000, notes: 'Shutterstock' },
      { date: `${prevMonth}-05`, category: 'ads', description: 'Facebook Ads - Campaign tháng 5', amount: 12000000, notes: '' },
      { date: `${prevMonth}-10`, category: 'content', description: 'Quay video TVC', amount: 18000000, notes: '' },
      { date: `${prevMonth}-15`, category: 'kol', description: 'KOL livestream - Influencer B', amount: 15000000, notes: '' },
    ];
    bulkCreate('expenses', demoExpenses);

    // Demo ad reports
    const demoAdReports = [];
    const adFanpages = fps.filter(f => f.platform === 'facebook' || f.platform === 'instagram');
    adFanpages.forEach(fp => {
      for (let d = 1; d <= Math.min(now.getDate(), 28); d++) {
        demoAdReports.push({
          fanpageId: fp.id,
          date: `${currentMonth}-${String(d).padStart(2, '0')}`,
          spend: Math.floor(300000 + Math.random() * 700000),
          reach: Math.floor(5000 + Math.random() * 15000),
          impressions: Math.floor(8000 + Math.random() * 25000),
          clicks: Math.floor(100 + Math.random() * 500),
          messages: Math.floor(10 + Math.random() * 50),
          conversions: Math.floor(2 + Math.random() * 20),
          engagement: Math.floor(200 + Math.random() * 800),
          revenue: Math.floor(500000 + Math.random() * 2000000)
        });
      }
    });
    bulkCreate('adReports', demoAdReports);
  };

  return {
    getData,
    mergeRemoteData,
    mergeRemotePosts,
    mergeRemotePending,
    fanpages,
    posts,
    tasks,
    events,
    expenses,
    adReports,
    settings,
    employees,
    monthlyTargets,
    recurringExpenses,
    campaigns,
    marketingPlans,
    customCategories,
    backup,
    restore,
    uiSampleData,
    seedDemoData,
    generateId
  };
})();
