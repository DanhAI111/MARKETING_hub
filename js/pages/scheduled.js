/* ═══════════════════════════════════════════
   MARKETING HUB - Scheduled Posts Page
   Group scheduled publishing queue by fanpage
   ═══════════════════════════════════════════ */

const ScheduledPage = (() => {
  let container = null;
  let currentMonth = Utils.getReportingMonth();
  let selectedStatus = '';
  let selectedPlatform = '';

  // Scheduled queue excludes 'published' — those leave the queue.
  const { published, ...STATUS_META } = Utils.POST_STATUSES;
  const getStatusMeta = (status) => STATUS_META[status] || STATUS_META.scheduled;

  const formatScheduleTime = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // The publishing queue is month-agnostic: it lists every not-yet-published
  // post so future-dated schedules are never hidden by the reporting month.
  const getScheduledPosts = () => {
    return Store.posts.getScheduled()
      .filter(post => {
        if (selectedStatus && post.status !== selectedStatus) return false;
        const fanpage = Store.fanpages.getById(post.fanpageId);
        if (selectedPlatform && fanpage?.platform !== selectedPlatform) return false;
        return true;
      })
      .sort((a, b) => (a.scheduledAt || a.date || '').localeCompare(b.scheduledAt || b.date || ''));
  };

  const render = (el) => {
    container = el;
    currentMonth = Utils.getReportingMonth();
    renderPage();
    // Pull the full cross-month pending queue from the backend, then re-render.
    if (window.RemoteStore?.available) {
      RemoteStore.loadPending()
        .then(() => renderPage())
        .catch((err) => Toast.error(err.message || 'Không thể tải hàng đợi'));
    }
  };

  const renderPage = () => {
    if (!container) return;

    const fanpages = Store.fanpages.getAll();
    const posts = getScheduledPosts();
    const postsByFanpage = new Map();
    posts.forEach(post => {
      const key = post.fanpageId || 'unknown';
      if (!postsByFanpage.has(key)) postsByFanpage.set(key, []);
      postsByFanpage.get(key).push(post);
    });

    const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
    const publishingCount = posts.filter(p => p.status === 'publishing').length;
    const failedCount = posts.filter(p => p.status === 'failed').length;
    const pageCount = postsByFanpage.size;

    container.innerHTML = `
      <div class="quick-stats" style="grid-template-columns: repeat(4, 1fr); margin-bottom: var(--space-5);">
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(245, 158, 11, 0.12); color: var(--warning-400);">${Utils.icons.clock}</div>
          <div class="stat-card-label">Chờ đăng</div>
          <div class="stat-card-value">${scheduledCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(59, 130, 246, 0.12); color: var(--info-400);">${Utils.icons.refresh}</div>
          <div class="stat-card-label">Đang đăng</div>
          <div class="stat-card-value">${publishingCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(239, 68, 68, 0.12); color: var(--danger-400);">${Utils.icons.warning}</div>
          <div class="stat-card-label">Lỗi đăng</div>
          <div class="stat-card-value">${failedCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(124, 58, 237, 0.12); color: var(--primary-400);">${Utils.icons.content}</div>
          <div class="stat-card-label">Page có lịch</div>
          <div class="stat-card-value">${pageCount}</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="toolbar-left">
          <button class="btn btn-ghost btn-sm" id="scheduledRefreshBtn">${Utils.icons.refresh} Tải lại hàng đợi</button>
          <select class="filter-select" id="scheduledStatusFilter">
            <option value="">Tất cả trạng thái</option>
            ${Object.entries(STATUS_META).map(([key, meta]) => `<option value="${key}" ${selectedStatus === key ? 'selected' : ''}>${meta.label}</option>`).join('')}
          </select>
          <select class="filter-select" id="scheduledPlatformFilter">
            <option value="">Tất cả nền tảng</option>
            ${Object.entries(Utils.PLATFORMS).map(([key, platform]) => `<option value="${key}" ${selectedPlatform === key ? 'selected' : ''}>${platform.name}</option>`).join('')}
          </select>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-secondary" id="processDuePostsBtn" ${window.RemoteStore?.available ? '' : 'disabled'}>
            ${Utils.icons.refresh}
            <span>Cập nhật hàng đợi</span>
          </button>
          <button class="btn btn-primary" id="goCreateScheduleBtn">
            ${Utils.icons.plus}
            <span>Tạo lịch đăng</span>
          </button>
        </div>
      </div>

      <div class="scheduled-page-list">
        ${fanpages.length === 0 ? renderEmptyState('Chưa có fanpage', 'Thêm fanpage trước khi tạo lịch đăng.') : renderFanpageGroups(fanpages, postsByFanpage)}
      </div>
    `;

    bindEvents();
  };

  const renderFanpageGroups = (fanpages, postsByFanpage) => {
    const visibleFanpages = fanpages
      .filter(fp => !selectedPlatform || fp.platform === selectedPlatform)
      .map(fp => ({ fanpage: fp, posts: postsByFanpage.get(fp.id) || [] }))
      .filter(group => group.posts.length > 0);

    const orphanPosts = postsByFanpage.get('unknown') || [];

    if (visibleFanpages.length === 0 && orphanPosts.length === 0) {
      return renderEmptyState('Không có bài đã lên lịch', 'Chưa có bài nào khớp bộ lọc hiện tại.');
    }

    return `
      ${visibleFanpages.map(group => renderFanpageGroup(group.fanpage, group.posts)).join('')}
      ${orphanPosts.length ? renderFanpageGroup(null, orphanPosts) : ''}
    `;
  };

  const renderFanpageGroup = (fanpage, posts) => {
    const platform = fanpage ? Utils.getPlatformInfo(fanpage.platform) : { name: 'Không rõ', icon: '', color: '#64748b' };
    return `
      <section class="scheduled-page-group">
        <div class="scheduled-page-header">
          <div class="fanpage-avatar" style="background: ${platform.color}20; color: ${platform.color};">
            ${fanpage?.imageUrl ? `<img src="${Utils.escapeHtml(fanpage.imageUrl)}" alt="${Utils.escapeHtml(fanpage.name)}" loading="lazy" onerror="this.parentElement.classList.add('is-fallback'); this.remove();">` : ''}
            <span class="fanpage-avatar-fallback">${platform.icon}</span>
          </div>
          <div class="scheduled-page-title">
            <div class="scheduled-page-name">${Utils.escapeHtml(fanpage?.name || 'Page không còn tồn tại')}</div>
            <div class="scheduled-page-meta">
              <span class="tag ${fanpage ? `tag-${fanpage.platform}` : 'tag-neutral'}">${platform.name}</span>
              <span>${posts.length} bài đã lên lịch</span>
            </div>
          </div>
        </div>
        <div class="scheduled-post-table">
          ${posts.map(renderScheduledPost).join('')}
        </div>
      </section>
    `;
  };

  const renderScheduledPost = (post) => {
    const status = getStatusMeta(post.status);
    const mediaCount = Array.isArray(post.mediaItems) ? post.mediaItems.length : (post.mediaUrl ? 1 : 0);
    return `
      <article class="scheduled-post-row ${post.status === 'failed' ? 'is-failed' : ''}">
        <div class="scheduled-post-time">
          <span>${formatScheduleTime(post.scheduledAt)}</span>
        </div>
        <div class="scheduled-post-main">
          <div class="scheduled-post-title">${Utils.escapeHtml(post.title || post.content || 'Bài đăng')}</div>
          <div class="scheduled-post-content">${Utils.escapeHtml(post.content || post.title || '')}</div>
          ${post.publishError ? `<div class="scheduled-post-error">${Utils.escapeHtml(post.publishError)}</div>` : ''}
        </div>
        <div class="scheduled-post-meta">
          ${mediaCount ? `<span class="post-media-count">${Utils.icons.image}${mediaCount}</span>` : ''}
          <span class="tag ${status.className}">${status.label}</span>
        </div>
        <div class="scheduled-post-actions">
          ${post.status === 'failed' ? `
            <button class="btn btn-icon btn-ghost btn-sm retry-scheduled-post-btn" data-id="${post.id}" data-tooltip="Thử đăng lại">
              ${Utils.icons.refresh}
            </button>
          ` : ''}
          <button class="btn btn-icon btn-ghost btn-sm delete-scheduled-post-btn" data-id="${post.id}" data-tooltip="Xóa khỏi lịch">
            ${Utils.icons.trash}
          </button>
        </div>
      </article>
    `;
  };

  const renderEmptyState = (title, desc) => `
    <div class="empty-state" style="padding: var(--space-10) 0;">
      <div class="empty-state-icon"></div>
      <div class="empty-state-title">${title}</div>
      <div class="empty-state-desc">${desc}</div>
    </div>
  `;

  const bindEvents = () => {
    container.querySelector('#scheduledRefreshBtn')?.addEventListener('click', async () => {
      if (window.RemoteStore?.available) {
        try {
          await RemoteStore.loadPending();
        } catch (err) {
          Toast.error(err.message || 'Không thể tải hàng đợi');
        }
      }
      renderPage();
    });

    container.querySelector('#scheduledStatusFilter')?.addEventListener('change', (e) => {
      selectedStatus = e.target.value;
      renderPage();
    });

    container.querySelector('#scheduledPlatformFilter')?.addEventListener('change', (e) => {
      selectedPlatform = e.target.value;
      renderPage();
    });

    container.querySelector('#goCreateScheduleBtn')?.addEventListener('click', () => {
      App.navigate('content');
    });

    container.querySelector('#processDuePostsBtn')?.addEventListener('click', async () => {
      if (!window.RemoteStore?.available) {
        Toast.error('Vui lòng chạy backend Node trước khi xử lý hàng đợi');
        return;
      }
      try {
        Toast.info('Đang cập nhật hàng đợi đăng bài...');
        const result = await RemoteStore.publishDue({ syncSheets: true });
        const sheetSync = result?.sheetSync;
        const syncText = sheetSync
          ? ` Đồng bộ Sheet: ${sheetSync.updated} cập nhật, ${sheetSync.created} bài mới.`
          : '';
        Toast.success(`Đã cập nhật hàng đợi đăng bài.${syncText}`);
        renderPage();
        Sidebar.updateBadge();
      } catch (err) {
        Toast.error(err.message || 'Không thể cập nhật hàng đợi');
      }
    });

    container.querySelectorAll('.retry-scheduled-post-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const postId = btn.dataset.id;
        if (window.RemoteStore?.available) {
          try {
            await RemoteStore.updatePost(postId, { status: 'scheduled', publishError: '' });
            await RemoteStore.publishDue();
            Toast.success('Đã thử đăng lại');
          } catch (err) {
            Toast.error(err.message || 'Không thể thử đăng lại');
          }
        } else {
          Store.posts.update(postId, { status: 'scheduled', publishError: '' });
          Toast.success('Đã đưa bài về trạng thái chờ đăng');
        }
        renderPage();
        Sidebar.updateBadge();
      });
    });

    container.querySelectorAll('.delete-scheduled-post-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const postId = btn.dataset.id;
        const post = Store.posts.getById(postId);
        if (!post) return;
        Modal.confirm({
          title: 'Xóa lịch đăng',
          message: `Bạn có chắc muốn xóa lịch đăng "${Utils.escapeHtml(post.title || 'Bài đăng')}"?`,
          icon: '',
          confirmLabel: 'Xóa',
          onConfirm: async () => {
            try {
              if (window.RemoteStore?.available) {
                await RemoteStore.deletePost(postId);
              } else {
                Store.posts.remove(postId);
              }
              Toast.success('Đã xóa lịch đăng');
              renderPage();
              Sidebar.updateBadge();
            } catch (err) {
              Toast.error(err.message || 'Không thể xóa lịch đăng');
            }
          }
        });
      });
    });
  };

  return { render };
})();

App.registerPage('scheduled', ScheduledPage);
