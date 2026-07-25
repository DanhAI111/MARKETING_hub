/* ═══════════════════════════════════════════
   MARKETING HUB - Main Application
   Routing, initialization, page management
   ═══════════════════════════════════════════ */

// Global error handler — shows errors visually for debugging
const escapeForError = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
window.onerror = (msg, src, line, col, err) => {
  const el = document.getElementById('mainContent');
  if (el) {
    el.innerHTML += `<div style="background:#1e0000;border:1px solid #ef4444;border-radius:8px;padding:16px;margin:16px;color:#fca5a5;font-family:monospace;font-size:13px;white-space:pre-wrap;"><b style='color:#f87171;'>⚠ JavaScript Error</b>\n\n${escapeForError(msg)}\n\nFile: ${escapeForError(src)}\nLine: ${line}:${col}\n${escapeForError(err?.stack || '')}</div>`;
  }
  console.error('App Error:', msg, src, line, col, err);
};

const App = (() => {
  const pages = {};
  let currentPage = null;
  let _dropdownClickHandler = null;

  // Register a page module
  const registerPage = (id, module) => {
    pages[id] = module;
  };

  // Navigate to a page
  const navigate = (pageId) => {
    if (!pages[pageId]) {
      console.warn(`Page "${pageId}" not found`);
      pageId = 'dashboard';
    }

    currentPage = pageId;
    Store.settings.set('currentPage', pageId);
    window.location.hash = pageId;

    // Update sidebar
    Sidebar.setActive(pageId);
    document.getElementById('sidebar')?.classList.remove('mobile-open');

    // Update header
    updateHeader(pageId);

    // Render page
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
      mainContent.innerHTML = '<div class="page" id="pageContainer"></div>';
      const container = document.getElementById('pageContainer');
      if (pages[pageId]?.render) {
        try {
          pages[pageId].render(container);
        } catch (err) {
          console.error(`Error rendering page "${pageId}":`, err);
          container.innerHTML = `<div style="background:#1e0000;border:1px solid #ef4444;border-radius:8px;padding:16px;margin:16px;color:#fca5a5;font-family:monospace;font-size:13px;white-space:pre-wrap;"><b style='color:#f87171;'>⚠ Page Render Error: ${escapeForError(pageId)}</b>\n\n${escapeForError(err.message)}\n\n${escapeForError(err.stack || '')}</div>`;
        }
      }
    }
  };

  // Page titles & subtitles
  const PAGE_META = {
    dashboard: { title: 'Tổng quan', subtitle: '' },
    content: { title: 'Lịch đăng bài', subtitle: 'Quản lý KPI & nội dung các fanpage' },
    scheduled: { title: 'Bài đã lên lịch', subtitle: 'Theo dõi hàng đợi đăng bài theo từng page' },
    tasks: { title: 'Công việc', subtitle: 'Điều hướng công việc hỗ trợ đối tác' },
    events: { title: 'Sự kiện', subtitle: 'Quản lý tổ chức sự kiện công ty' },
    campaigns: { title: 'Chiến dịch', subtitle: 'Gom bài đăng, quảng cáo, sự kiện & chi phí theo mục tiêu' },
    expenses: { title: 'Chi phí', subtitle: 'Thống kê chi phí marketing hàng tháng' },
    ads: { title: 'Hiệu quả Ads', subtitle: 'Thống kê hiệu quả chạy quảng cáo' },
    settings: { title: 'Cài đặt', subtitle: 'Quản lý fanpage, nhân viên, KPI & mục tiêu' },
  };

  const updateHeader = (pageId) => {
    const meta = PAGE_META[pageId] || {};
    const headerLeft = document.querySelector('.main-header-left');
    if (headerLeft) {
      headerLeft.innerHTML = `
        <button class="btn-icon btn-ghost mobile-menu-btn" id="mobileMenuBtn" style="display:none;">
          ${Utils.icons.menu}
        </button>
        <div>
          <h1 class="page-title">${meta.title || pageId}</h1>
          ${meta.subtitle ? `<p class="page-subtitle">${meta.subtitle}</p>` : ''}
        </div>
      `;
      // Mobile menu button
      document.getElementById('mobileMenuBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('sidebar')?.classList.toggle('mobile-open');
      });
      // Show mobile menu button on small screens
      if (window.innerWidth <= 768) {
        const btn = document.getElementById('mobileMenuBtn');
        if (btn) btn.style.display = 'flex';
      }
    }

    // Header right actions
    const headerRight = document.querySelector('.main-header-right');
    if (headerRight) {
      const today = new Date();
      const dateStr = `${today.getDate()} Tháng ${today.getMonth() + 1}, ${today.getFullYear()}`;
      const user = window.RemoteStore?.currentUser;
      const userName = user?.name || user?.email || '';
      const userInitial = (userName || 'U').trim().charAt(0).toUpperCase();
      headerRight.innerHTML = `
        <div class="global-search" id="globalSearch">
          <span class="global-search-icon">${Utils.icons.search}</span>
          <input type="text" class="global-search-input" id="globalSearchInput" placeholder="Tìm kiếm task, sự kiện, chi phí..." autocomplete="off">
          <div class="global-search-results" id="globalSearchResults" style="display:none;"></div>
        </div>
        <span class="page-subtitle" style="font-family: var(--font-mono);">${dateStr}</span>
        ${user ? `
          <div class="header-user" title="${Utils.escapeHtml(user.email || userName)}">
            ${user.picture
              ? `<img class="header-user-avatar" src="${Utils.escapeHtml(user.picture)}" alt="">`
              : `<span class="header-user-avatar header-user-initial">${Utils.escapeHtml(userInitial)}</span>`}
            <span class="header-user-name">${Utils.escapeHtml(userName)}</span>
            <button class="btn-icon btn-ghost" id="logoutBtn" title="Đăng xuất">${Utils.icons.logout}</button>
          </div>
        ` : ''}
      `;

      document.getElementById('logoutBtn')?.addEventListener('click', () => {
        window.RemoteStore?.logout?.();
      });

      // Global search
      const searchInput = document.getElementById('globalSearchInput');
      const searchResults = document.getElementById('globalSearchResults');
      let searchTimeout = null;

      searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = searchInput.value.trim().toLowerCase();
        if (q.length < 2) { searchResults.style.display = 'none'; return; }
        searchTimeout = setTimeout(() => renderSearchResults(q, searchResults), 200);
      });

      searchInput?.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 2) {
          searchResults.style.display = 'block';
        }
      });

      // Remove previous global handler to avoid leaks
      if (_dropdownClickHandler) {
        document.removeEventListener('click', _dropdownClickHandler);
      }
      _dropdownClickHandler = (e) => {
        if (!document.getElementById('globalSearch')?.contains(e.target)) {
          if (searchResults) searchResults.style.display = 'none';
        }
      };
      document.addEventListener('click', _dropdownClickHandler);
    }
  };

  // Global search across collections
  const renderSearchResults = (query, container) => {
    const results = [];

    // Search tasks
    Store.tasks.getAll().forEach(t => {
      if ((t.title || '').toLowerCase().includes(query) || (t.assignee || '').toLowerCase().includes(query)) {
        results.push({ type: 'tasks', icon: '✅', label: t.title, sub: t.assignee || '', page: 'tasks' });
      }
    });

    // Search events
    Store.events.getAll().forEach(e => {
      if ((e.name || '').toLowerCase().includes(query) || (e.address || '').toLowerCase().includes(query)) {
        results.push({ type: 'events', icon: '🎪', label: e.name, sub: Utils.formatDate(e.date), page: 'events' });
      }
    });

    // Search expenses
    Store.expenses.getAll().forEach(e => {
      if ((e.description || '').toLowerCase().includes(query)) {
        results.push({ type: 'expenses', icon: '💰', label: e.description, sub: Utils.formatVND(e.amount), page: 'expenses' });
      }
    });

    // Search posts
    Store.posts.getAll().forEach(p => {
      if ((p.title || '').toLowerCase().includes(query)) {
        const fp = Store.fanpages.getById(p.fanpageId);
        results.push({ type: 'posts', icon: '📝', label: p.title, sub: fp?.name || '', page: 'content' });
      }
    });

    // Search fanpages
    Store.fanpages.getAll().forEach(f => {
      if ((f.name || '').toLowerCase().includes(query)) {
        results.push({ type: 'fanpages', icon: Utils.getPlatformInfo(f.platform).icon, label: f.name, sub: Utils.getPlatformInfo(f.platform).name, page: 'content' });
      }
    });

    const limited = results.slice(0, 8);
    if (limited.length === 0) {
      container.innerHTML = '<div class="search-no-results">Không tìm thấy kết quả</div>';
    } else {
      container.innerHTML = limited.map((r, i) => `
        <div class="search-result-item" data-page="${r.page}" data-index="${i}" tabindex="0" role="button">
          <span class="search-result-icon">${r.icon}</span>
          <div class="search-result-info">
            <div class="search-result-label">${Utils.escapeHtml(r.label)}</div>
            <div class="search-result-sub">${Utils.escapeHtml(r.sub)}</div>
          </div>
          <span class="search-result-type">${r.type === 'tasks' ? 'Công việc' : r.type === 'events' ? 'Sự kiện' : r.type === 'expenses' ? 'Chi phí' : r.type === 'fanpages' ? 'Fanpage' : 'Bài đăng'}</span>
        </div>
      `).join('');
    }
    container.style.display = 'block';

    container.querySelectorAll('.search-result-item').forEach(item => {
      Utils.onActivate(item, () => {
        navigate(item.dataset.page);
        container.style.display = 'none';
        document.getElementById('globalSearchInput').value = '';
      });
    });
  };

  // Initialize app
  const init = () => {
    // Apply stored theme (defaults to dark Framer canvas).
    applyTheme(Store.settings.get('theme') || 'dark');

    // Render sidebar
    Sidebar.render();

    // Determine initial page
    const hash = window.location.hash.replace('#', '') || Store.settings.get('currentPage') || 'dashboard';
    navigate(hash);

    // Handle hash change
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && hash !== currentPage) {
        navigate(hash);
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      const mobileBtn = document.getElementById('mobileMenuBtn');
      if (mobileBtn) {
        mobileBtn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
      }
    });

    // Close sidebar on mobile when clicking main content
    document.querySelector('.main')?.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar')?.classList.remove('mobile-open');
      }
    });
  };

  const applyTheme = (theme) => {
    const t = theme === 'light' ? 'light' : 'dark';
    document.body.classList.toggle('dark', t === 'dark');
    document.body.classList.toggle('light', t === 'light');
  };

  const setTheme = (theme) => {
    Store.settings.set('theme', theme);
    applyTheme(theme);
  };

  const getTheme = () => Store.settings.get('theme') || 'dark';

  return { registerPage, navigate, init, setTheme, getTheme, get currentPage() { return currentPage; } };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const mainContent = document.getElementById('mainContent');
  if (mainContent) {
    mainContent.innerHTML = `
      <div class="page" style="display:grid;min-height:calc(100vh - 96px);place-items:center;color:var(--text-muted);font-family:var(--font-sans);">
        <div style="display:grid;gap:10px;text-align:center;">
          <div style="font-weight:700;color:var(--text-primary);">Đang tải MKT_Hub</div>
          <div style="font-size:13px;">Đang kiểm tra phiên đăng nhập và tải dữ liệu...</div>
        </div>
      </div>
    `;
  }

  let hydrated = false;
  if (window.RemoteStore) {
    try {
      hydrated = await RemoteStore.hydrate({ sync: false });
    } catch (err) {
      console.warn('Remote hydrate failed:', err.message);
      if (typeof Toast !== 'undefined' && RemoteStore.available) {
        Toast.warning('Không tải được dữ liệu mới từ máy chủ — đang hiển thị dữ liệu cục bộ.');
      }
    }
  }
  App.init();

  if (hydrated && window.RemoteStore?.currentUser) {
    window.setTimeout(async () => {
      try {
        await RemoteStore.syncNow();
        Sidebar.updateBadge?.();
        if (App.currentPage) App.navigate(App.currentPage);
      } catch (err) {
        console.warn('Background sync failed:', err.message);
      }
    }, 0);
  }
});
