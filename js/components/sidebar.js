/* ═══════════════════════════════════════════
   MARKETING HUB - Sidebar Component
   ═══════════════════════════════════════════ */

const Sidebar = (() => {
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Tổng quan', icon: 'dashboard' },
    { id: 'content', label: 'Lịch đăng bài', icon: 'content', badge: 'content' },
    { id: 'scheduled', label: 'Bài đã lên lịch', icon: 'clock', badge: 'scheduled' },
    { id: 'tasks', label: 'Công việc', icon: 'tasks', badge: 'tasks' },
    { id: 'events', label: 'Sự kiện', icon: 'events' },
    { id: 'expenses', label: 'Chi phí', icon: 'expenses' },
    { id: 'ads', label: 'Hiệu quả Ads', icon: 'ads' },
    { id: 'settings', label: 'Cài đặt', icon: 'settings' },
  ];

  let collapsed = false;

  const getContentBadge = () => {
    const allFanpages = Store.fanpages.getAll();
    const postedToday = Store.posts.getFanpagesWithPostToday();
    const notPosted = allFanpages.length - postedToday.length;
    return notPosted > 0 ? notPosted : 0;
  };

  const getTasksBadge = () => {
    return Store.tasks.getAll().filter(t => t.status === 'pending' || t.status === 'in-progress').length;
  };

  const getScheduledBadge = () => {
    return Store.posts.getScheduled().filter(p => p.status === 'scheduled' || p.status === 'failed').length;
  };

  const getBadgeValue = (type) => {
    if (type === 'content') return getContentBadge();
    if (type === 'scheduled') return getScheduledBadge();
    if (type === 'tasks') return getTasksBadge();
    return 0;
  };

  const render = () => {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.className = 'sidebar';
    const activePage = Store.settings.get('currentPage') || 'dashboard';

    sidebar.innerHTML = `
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <div class="sidebar-logo">
            ${Utils.icons.logo}
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="sidebar-nav-group">
            ${NAV_ITEMS.map(item => {
              const badgeVal = item.badge ? getBadgeValue(item.badge) : 0;
              const badgeClass = item.badge === 'content' || item.badge === 'scheduled' ? 'nav-item-badge warning' : 'nav-item-badge';
              return `
              <div class="nav-item-wrapper">
                <a class="nav-item ${activePage === item.id ? 'active' : ''}" data-page="${item.id}" href="#${item.id}" title="${item.label}">
                  <span class="nav-item-icon">${Utils.icons[item.icon]}</span>
                  <span class="nav-item-text">${item.label}</span>
                  ${item.badge ? `<span class="${badgeClass}" data-badge="${item.badge}" style="${badgeVal > 0 ? '' : 'display:none;'}">${badgeVal}</span>` : ''}
                </a>
              </div>
            `;}).join('')}
          </div>
        </nav>

        <div class="sidebar-footer">
          <button class="user-profile-btn" aria-label="User Profile">
            <span>MH</span>
          </button>
        </div>
      </div>
    `;

    // Attach events
    sidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        App.navigate(page);
      });
    });

    document.getElementById('sidebarToggle')?.addEventListener('click', toggle);
  };

  const toggle = () => {
    collapsed = !collapsed;
    Store.settings.set('sidebarCollapsed', collapsed);
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed', collapsed);
    }
  };

  const setActive = (pageId) => {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });
  };

  const updateBadge = () => {
    ['content', 'scheduled', 'tasks'].forEach(type => {
      const badge = document.querySelector(`[data-badge="${type}"]`);
      if (badge) {
        const val = getBadgeValue(type);
        badge.textContent = val;
        badge.style.display = val > 0 ? '' : 'none';
      }
    });
  };

  return { render, toggle, setActive, updateBadge };
})();
