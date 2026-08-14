/* ═══════════════════════════════════════════
   MARKETING HUB - Content & KPI Page
   Manage posting schedule and KPI targets
   ═══════════════════════════════════════════ */

const ContentPage = (() => {
  let container = null;
  let currentMonth = Utils.getReportingMonth();
  let selectedPlatform = '';
  let visiblePostLimit = 60;

  const POST_STATUSES = Utils.POST_STATUSES;
  const POSTS_PAGE_SIZE = 60;
  const getPostStatus = (status) => Utils.getPostStatus(status);

  const getInitials = (name = '') => String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || 'P';

  const formatScheduleTime = (value) => Utils.formatDateTime(value);

  const toLocalDateTimeValue = (date = new Date()) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  // ── Render ──

  const render = (el) => {
    container = el;
    currentMonth = Utils.getReportingMonth();
    visiblePostLimit = POSTS_PAGE_SIZE;
    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    // Read localStorage once. Re-loading and parsing the full store for every
    // fanpage/post row made this page increasingly slow as post history grew.
    const data = Store.getData();
    const fanpages = data.fanpages || [];
    const allPosts = data.posts || [];
    const fanpageById = new Map(fanpages.map(fanpage => [fanpage.id, fanpage]));
    const filteredFanpages = selectedPlatform 
      ? fanpages.filter(fp => fp.platform === selectedPlatform)
      : fanpages;

    // Calculate Summary Stats
    let totalKpi = 0;
    let totalScheduled = 0;
    let totalFailed = 0;
    let totalTested = 0;
    const publishedCounts = new Map();
    allPosts.forEach(post => {
      const date = post.status === 'published' ? post.date : (post.scheduledAt || post.date);
      if ((date || '').slice(0, 7) !== currentMonth) return;
      if (post.status === 'published') {
        publishedCounts.set(post.fanpageId, (publishedCounts.get(post.fanpageId) || 0) + 1);
      } else if (post.status === 'failed') {
        totalFailed++;
      } else if (post.status === 'tested') {
        totalTested++;
      } else {
        totalScheduled++;
      }
    });
    fanpages.forEach(fp => {
      totalKpi += fp.kpis?.[currentMonth] || 0;
    });
    const totalPosted = fanpages.reduce((sum, fp) => (
      sum + (publishedCounts.get(fp.id) || 0)
    ), 0);
    const totalPercent = totalKpi > 0 ? Math.round((totalPosted / totalKpi) * 100) : 0;
    const progressColorClass = Utils.getKpiColor(totalPercent);
    const filteredFanpageIds = new Set(filteredFanpages.map(fp => fp.id));
    const monthPosts = allPosts
      .filter(post => {
        if (!filteredFanpageIds.has(post.fanpageId)) return false;
        const date = post.status === 'published' ? post.date : (post.scheduledAt || post.date);
        return (date || '').slice(0, 7) === currentMonth;
      })
      .sort((a, b) => (b.scheduledAt || b.publishedAt || b.date || '').localeCompare(a.scheduledAt || a.publishedAt || a.date || ''));
    const visibleMonthPosts = monthPosts.slice(0, visiblePostLimit);
    const pendingTasks = (data.tasks || [])
      .filter(task => task.status !== 'completed')
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
      .slice(0, 4);
    const activeCampaigns = (data.campaigns || [])
      .filter(campaign => campaign.status === 'active')
      .slice(0, 3);

    container.innerHTML = `
      ${renderIntegrationPanel()}

      <div class="content-command-grid">
        <aside class="content-control-rail">
          <div class="panel-kicker">Điều khiển lịch</div>
          <div class="month-picker">
            <button class="month-picker-btn" id="prevMonthBtn">${Utils.icons.chevronLeft}</button>
            <span class="month-picker-label" id="currentMonthLabel">${Utils.formatMonthYear(currentMonth)}</span>
            <button class="month-picker-btn" id="nextMonthBtn">${Utils.icons.chevronRight}</button>
          </div>
          <select class="filter-select" id="platformFilterSelect">
            <option value="">Tất cả nền tảng</option>
            ${Object.entries(Utils.PLATFORMS).map(([k, v]) =>
              `<option value="${k}" ${selectedPlatform === k ? 'selected' : ''}>${v.name}</option>`
            ).join('')}
          </select>

          <div class="content-kpi-overview">
            <div class="content-kpi-ring" style="--progress:${Math.min(totalPercent, 100)}">
              <strong class="${progressColorClass}">${totalPercent}%</strong>
              <span>hoàn thành</span>
            </div>
            <div class="content-kpi-numbers">
              <div><span>Mục tiêu</span><strong>${totalKpi}</strong></div>
              <div><span>Đã đăng</span><strong>${totalPosted}</strong></div>
              <div><span>Chờ / lỗi</span><strong>${totalScheduled}/${totalFailed}</strong></div>
            </div>
          </div>

          <div class="panel-section-title">
            <span>Kênh nội dung</span>
            <button class="btn btn-icon btn-ghost btn-sm" id="addFanpageBtn" data-tooltip="Thêm Fanpage">${Utils.icons.plus}</button>
          </div>
          <div class="fanpage-control-list">
            ${filteredFanpages.length ? filteredFanpages.map(fp =>
              renderFanpageControl(fp, publishedCounts.get(fp.id) || 0)
            ).join('') : '<div class="context-empty">Chưa có kênh phù hợp bộ lọc.</div>'}
          </div>
        </aside>

        <section class="content-publishing-queue">
          <div class="queue-header">
            <div>
              <div class="panel-kicker">Publishing queue</div>
              <h2>Nội dung tháng này</h2>
              <p>${monthPosts.length} bài trên ${filteredFanpages.length} kênh đang được theo dõi.</p>
            </div>
            <div class="queue-actions">
              <button class="btn btn-secondary" id="syncMetaBtn" ${window.RemoteStore?.available ? '' : 'disabled'}>
                ${Utils.icons.refresh || Utils.icons.upload}<span>Đồng bộ</span>
              </button>
              <button class="btn btn-primary" id="schedulePostBtn">
                ${Utils.icons.clock}<span>Lên lịch đăng</span>
              </button>
            </div>
          </div>

          <div class="queue-status-strip">
            <span><i class="queue-dot published"></i>${totalPosted} đã đăng</span>
            <span><i class="queue-dot tested"></i>${totalTested} đã test</span>
            <span><i class="queue-dot scheduled"></i>${totalScheduled} chờ đăng</span>
            <span><i class="queue-dot failed"></i>${totalFailed} lỗi</span>
          </div>
          <div class="content-master-post-list">
            ${monthPosts.length ? visibleMonthPosts.map(post => {
              const fanpage = fanpageById.get(post.fanpageId);
              const platform = fanpage ? Utils.getPlatformInfo(fanpage.platform) : null;
              const imageUrl = String(fanpage?.imageUrl || '').trim();
              return `
                <article class="content-master-post">
                  <div class="content-master-channel" style="--channel-color:${platform?.color || '#64748b'}">
                    ${imageUrl ? `<img src="${Utils.escapeHtml(imageUrl)}" alt="" loading="lazy" data-content-remove-on-error>` : ''}
                    <span class="fanpage-avatar-fallback">${Utils.escapeHtml(getInitials(fanpage?.name || 'Page'))}</span>
                  </div>
                  <div class="content-master-body">
                    <div class="content-master-meta">
                      <span>${Utils.escapeHtml(fanpage?.name || 'Không rõ kênh')}</span>
                      <span>${post.status === 'published' ? Utils.formatDateShort(post.date) : formatScheduleTime(post.testedAt || post.scheduledAt)}</span>
                    </div>
                    ${renderPostItem(post, fanpage)}
                  </div>
                </article>
              `;
            }).join('') : `
              <div class="queue-empty">
                <span>${Utils.icons.calendar}</span>
                <strong>Chưa có nội dung trong tháng này</strong>
                <p>Tạo bài mới hoặc lên lịch để bắt đầu xây hàng đợi xuất bản.</p>
              </div>
            `}
          </div>
          ${monthPosts.length > visibleMonthPosts.length ? `
            <button class="btn btn-secondary content-load-more" id="loadMorePostsBtn">
              Hiển thị thêm ${Math.min(POSTS_PAGE_SIZE, monthPosts.length - visibleMonthPosts.length)} bài
            </button>
          ` : ''}
        </section>

        <aside class="context-rail content-action-rail">
          <div class="context-rail-heading">
            <span>Việc cần xử lý</span>
            <span class="live-indicator">Live</span>
          </div>
          <section class="context-block">
            <div class="context-block-title">Công việc gần hạn</div>
            ${pendingTasks.length ? pendingTasks.map(task => `
              <button class="context-row" data-content-task="${task.id}">
                <span class="context-date">${task.deadline ? Utils.formatDateShort(task.deadline) : '—'}</span>
                <span>${Utils.escapeHtml(task.title)}</span>
              </button>
            `).join('') : '<div class="context-empty">Không có công việc chờ xử lý.</div>'}
          </section>
          <section class="context-block">
            <div class="context-block-title">Chiến dịch đang chạy</div>
            ${activeCampaigns.length ? activeCampaigns.map(campaign => `
              <button class="context-row" data-content-campaign="${campaign.id}">
                <span class="status-pulse"></span>
                <span>${Utils.escapeHtml(campaign.name)}</span>
              </button>
            `).join('') : '<div class="context-empty">Chưa có chiến dịch đang chạy.</div>'}
          </section>
          <button class="btn btn-secondary context-rail-action" id="connectMetaBtn" ${window.RemoteStore?.available ? '' : 'disabled'}>
            ${Utils.icons.link || Utils.icons.plus}<span>Liên kết Meta</span>
          </button>
        </aside>
      </div>
    `;

    bindEvents();
    container.querySelectorAll('[data-content-task]').forEach(btn => btn.addEventListener('click', () => App.navigate('tasks')));
    container.querySelectorAll('[data-content-campaign]').forEach(btn => btn.addEventListener('click', () => App.navigate('campaigns')));
  };

  const renderIntegrationPanel = () => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('meta_connected') === '1';
    const metaError = params.get('meta_error');
    const isBackendOn = !!window.RemoteStore?.available;
    const lastSync = window.RemoteStore?.lastSync;
    const lastSyncText = lastSync?.finishedAt
      ? Utils.formatDate(lastSync.finishedAt.slice(0, 10))
      : 'Chưa đồng bộ';
    const statusClass = metaError ? 'danger' : connected ? 'success' : isBackendOn ? 'info' : 'warning';
    const title = metaError
      ? 'Liên kết Meta thất bại'
      : connected
        ? 'Đã liên kết Meta'
        : isBackendOn
          ? 'Backend đồng bộ đã sẵn sàng'
          : 'Chưa chạy backend đồng bộ';
    const desc = metaError
      ? Utils.escapeHtml(metaError)
      : isBackendOn
        ? `Dữ liệu sẽ tự đồng bộ khi tải lại trang và mỗi 15 phút. Lần cuối: ${lastSyncText}.`
        : 'Mở app bằng server Node để liên kết Facebook/Instagram và đồng bộ bài đăng tự động.';

    return `
      <div class="integration-panel ${statusClass}">
        <div>
          <div class="integration-title">${title}</div>
          <div class="integration-desc">${desc}</div>
        </div>
      </div>
    `;
  };

  const renderFanpageControl = (fp, posted = 0) => {
    const platform = Utils.getPlatformInfo(fp.platform);
    const imageUrl = String(fp.imageUrl || '').trim();
    const target = fp.kpis?.[currentMonth] || 0;
    const percent = target > 0 ? Math.min(100, Math.round((posted / target) * 100)) : 0;
    return `
      <div class="fanpage-control-item">
        <div class="fanpage-control-main">
          <span class="fanpage-control-avatar" style="color:${platform.color};background:${platform.color}18">
            ${imageUrl ? `<img src="${Utils.escapeHtml(imageUrl)}" alt="${Utils.escapeHtml(fp.name)}" loading="lazy" data-content-remove-on-error>` : ''}
            <span class="fanpage-avatar-fallback">${Utils.escapeHtml(getInitials(fp.name))}</span>
          </span>
          <div>
            <strong>${Utils.escapeHtml(fp.name)}</strong>
            <span>${posted}/${target || 0} bài · ${percent}%</span>
          </div>
        </div>
        <div class="fanpage-control-progress"><span style="width:${percent}%;background:${platform.color}"></span></div>
        <div class="fanpage-control-actions">
          <button class="btn btn-icon btn-ghost btn-sm add-post-btn" data-id="${fp.id}" data-tooltip="Thêm bài">${Utils.icons.plus}</button>
          <button class="btn btn-icon btn-ghost btn-sm schedule-post-card-btn" data-id="${fp.id}" data-tooltip="Lên lịch">${Utils.icons.clock}</button>
          <button class="btn btn-icon btn-ghost btn-sm edit-kpi-btn" data-id="${fp.id}" data-tooltip="KPI">${Utils.icons.target}</button>
          <button class="btn btn-icon btn-ghost btn-sm edit-fp-btn" data-id="${fp.id}" data-tooltip="Chỉnh sửa">${Utils.icons.edit}</button>
          <button class="btn btn-icon btn-ghost btn-sm delete-fp-btn" data-id="${fp.id}" data-tooltip="Xóa">${Utils.icons.trash}</button>
        </div>
      </div>
    `;
  };

  const renderPostItem = (post, fanpage) => {
    const status = getPostStatus(post.status);
    const displayTime = post.status === 'published'
      ? (post.date ? `${post.date.split('-')[2]}/${post.date.split('-')[1]}` : '')
      : formatScheduleTime(post.testedAt || post.scheduledAt);
    const mediaCount = Array.isArray(post.mediaItems) && post.mediaItems.length
      ? post.mediaItems.length
      : (post.mediaUrl ? 1 : 0);
    const thumbnailUrl = getPostThumbnail(post, fanpage);
    const channelFallback = normalizeThumbnailUrl(fanpage?.imageUrl);
    const platformFallback = getPlatformThumbnailFallback(fanpage?.platform);
    const permalink = ['published', 'tested'].includes(post.status) ? (post.permalink || '') : '';
    const linkable = /^https?:\/\//i.test(permalink);
    const eng = post.engagement;
    const engHtml = eng && (eng.likes || eng.comments || eng.shares)
      ? `<span class="post-engagement" title="Tương tác tự nhiên">Thích ${Utils.formatNumberCompact(eng.likes || 0)} · Bình luận ${Utils.formatNumberCompact(eng.comments || 0)}${eng.shares ? ` · Chia sẻ ${Utils.formatNumberCompact(eng.shares)}` : ''}</span>`
      : '';
    const instagramTest = post.testResult?.instagram;
    const testSummary = post.status === 'tested'
      ? `<span class="post-test-summary">Facebook: ẩn · Instagram: ${instagramTest?.status === 'completed' ? 'media hợp lệ' : 'không chạy'}</span>`
      : '';
    return `
      <div class="post-item ${thumbnailUrl ? 'has-thumbnail' : ''} ${post.status === 'failed' ? 'post-item-failed' : ''} ${linkable ? 'post-item-linkable' : ''}"${linkable ? ` data-permalink="${Utils.escapeHtml(permalink)}"` : ''}>
        ${thumbnailUrl ? `
          <span class="post-thumbnail">
            <img class="post-thumbnail-image" src="${Utils.escapeHtml(thumbnailUrl)}" alt="" loading="lazy" decoding="async" data-post-thumbnail data-channel-fallback="${Utils.escapeHtml(channelFallback)}" data-platform-fallback="${Utils.escapeHtml(platformFallback)}">
            <span class="post-thumbnail-fallback">${platformPlaceholderIcon()}</span>
          </span>
        ` : ''}
        <span class="post-date">${displayTime}</span>
        <span class="post-title-text" title="${Utils.escapeHtml(linkable ? 'Mở bài trên Facebook' : (post.publishError || post.content || post.title))}">${Utils.escapeHtml(post.title || post.content || 'Bài đăng')}</span>
        ${engHtml}
        ${testSummary}
        ${mediaCount ? `<span class="post-media-count">${Utils.icons.image || ''}${mediaCount}</span>` : ''}
        <span class="tag ${status.className} post-status-tag">${status.label}</span>
        ${post.status === 'failed' ? `
          <button class="btn btn-icon btn-ghost btn-sm retry-post-btn" data-id="${post.id}" data-tooltip="Thử đăng lại" style="padding: 2px; color: var(--warning-400);">
            ${Utils.icons.refresh || Utils.icons.clock}
          </button>
        ` : ''}
        <button class="btn btn-icon btn-ghost btn-sm delete-post-btn" data-id="${post.id}" style="padding: 2px; color: var(--text-muted); opacity: 0.5; margin-left: auto;">
          ${Utils.icons.close}
        </button>
      </div>
    `;
  };

  const normalizeThumbnailUrl = (rawValue = '') => {
    const raw = String(rawValue || '').trim();
    if (!raw || /\.(mp4|mov|webm)(?:$|[?#])/i.test(raw)) return '';
    if (/^data:image\//i.test(raw)) return raw;
    const safe = Utils.safeUrl(raw);
    if (safe === '#') return '';
    return MediaGallery.previewUrl(safe);
  };

  const getPlatformThumbnailFallback = (platform = '') => (
    String(platform).toLowerCase() === 'facebook'
      ? 'assets/mkt-hub-redesign/content-facebook.png'
      : 'assets/mkt-hub-redesign/event-workshop.png'
  );

  const getPostThumbnail = (post = {}, fanpage = null) => {
    const mediaItems = Array.isArray(post.mediaItems) ? post.mediaItems : [];
    const still = mediaItems.find(item => {
      const type = String(item?.type || '').toLowerCase();
      return item?.thumbnailUrl || item?.thumbnail_url || (item?.url && type !== 'video');
    });
    const raw = (
      still?.thumbnailUrl
      || still?.thumbnail_url
      || still?.url
      || post.thumbnailUrl
      || post.mediaUrl
      || ''
    );
    return normalizeThumbnailUrl(raw)
      || normalizeThumbnailUrl(fanpage?.imageUrl)
      || getPlatformThumbnailFallback(fanpage?.platform);
  };

  // ── Bind Events ──

  const bindEvents = () => {
    bindContentImageFallbacks();
    // Month picker
    container.querySelector('#prevMonthBtn')?.addEventListener('click', async () => {
      currentMonth = Utils.getPrevMonth(currentMonth);
      visiblePostLimit = POSTS_PAGE_SIZE;
      Utils.setReportingMonth(currentMonth);
      if (window.RemoteStore?.available) await RemoteStore.loadPosts(currentMonth).catch((err) => Toast.error(err.message));
      renderPage();
    });

    container.querySelector('#nextMonthBtn')?.addEventListener('click', async () => {
      currentMonth = Utils.getNextMonth(currentMonth);
      visiblePostLimit = POSTS_PAGE_SIZE;
      Utils.setReportingMonth(currentMonth);
      if (window.RemoteStore?.available) await RemoteStore.loadPosts(currentMonth).catch((err) => Toast.error(err.message));
      renderPage();
    });

    // Platform filter
    container.querySelector('#platformFilterSelect')?.addEventListener('change', (e) => {
      selectedPlatform = e.target.value;
      visiblePostLimit = POSTS_PAGE_SIZE;
      renderPage();
    });

    container.querySelector('#loadMorePostsBtn')?.addEventListener('click', () => {
      visiblePostLimit += POSTS_PAGE_SIZE;
      renderPage();
    });

    // Add Fanpage
    container.querySelector('#addFanpageBtn')?.addEventListener('click', () => {
      openFanpageModal();
    });

    container.querySelector('#schedulePostBtn')?.addEventListener('click', () => {
      openScheduleChoiceModal();
    });

    container.querySelector('#connectMetaBtn')?.addEventListener('click', () => {
      if (!window.RemoteStore?.available) {
        Toast.error('Vui lòng chạy backend Node trước khi liên kết Meta');
        return;
      }
      RemoteStore.connectMeta();
    });

    container.querySelector('#syncMetaBtn')?.addEventListener('click', async () => {
      if (!window.RemoteStore?.available) {
        Toast.error('Vui lòng chạy backend Node trước khi đồng bộ');
        return;
      }
      try {
        Toast.info('Đang đồng bộ bài đăng từ Meta...');
        await RemoteStore.syncNow();
        Toast.success('Đã đồng bộ dữ liệu mới');
        renderPage();
      } catch (err) {
        Toast.error(err.message || 'Đồng bộ thất bại');
      }
    });

    // Card Actions
    container.querySelectorAll('.add-post-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fpId = btn.dataset.id;
        openAddPostModal(fpId);
      });
    });

    container.querySelectorAll('.schedule-post-card-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openScheduleChoiceModal(btn.dataset.id);
      });
    });

    container.querySelectorAll('.edit-kpi-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fpId = btn.dataset.id;
        openEditKpiModal(fpId);
      });
    });

    container.querySelectorAll('.edit-fp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fpId = btn.dataset.id;
        const fp = Store.fanpages.getById(fpId);
        if (fp) openFanpageModal(fp);
      });
    });

    container.querySelectorAll('.delete-fp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fpId = btn.dataset.id;
        const fp = Store.fanpages.getById(fpId);
        if (!fp) return;

        Modal.confirm({
          title: 'Xóa Fanpage',
          message: `Bạn có chắc muốn xóa Fanpage "${Utils.escapeHtml(fp.name)}"? Điều này cũng sẽ xóa tất cả các bài đăng và báo cáo Ads liên quan.`,
          icon: Utils.icons.trash,
          onConfirm: () => {
            Store.fanpages.remove(fpId);
            Toast.success('Đã xóa Fanpage');
            renderPage();
          }
        });
      });
    });

    // Click a published row → open its Facebook/Instagram permalink.
    container.querySelectorAll('.post-item-linkable').forEach(row => {
      row.addEventListener('click', () => {
        const url = row.dataset.permalink;
        if (url) window.open(url, '_blank', 'noopener');
      });
    });

    container.querySelectorAll('.delete-post-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = btn.dataset.id;
        const post = Store.posts.getById(postId);
        if (!post) return;

        Modal.confirm({
          title: 'Xóa bài đăng',
          message: `Bạn có chắc muốn xóa bài đăng "${Utils.escapeHtml(post.title)}"?`,
          icon: Utils.icons.trash,
          onConfirm: async () => {
            try {
              if (window.RemoteStore?.available) {
                await RemoteStore.deletePost(postId);
              } else {
                Store.posts.remove(postId);
              }
              Toast.success('Đã xóa bài đăng');
              renderPage();
              Sidebar.updateBadge();
            } catch (err) {
              Toast.error(err.message || 'Không thể xóa bài đăng');
            }
          }
        });
      });
    });

    container.querySelectorAll('.retry-post-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const postId = btn.dataset.id;
        const post = Store.posts.getById(postId);
        if (!post) return;
        if (window.RemoteStore?.available) {
          try {
            Toast.info('Đang thử đăng lại bài đã lên lịch...');
            await RemoteStore.updatePost(postId, { status: 'scheduled', publishError: '' });
            if (post.publishMode === 'safe_test') await RemoteStore.runPostTest(postId);
            else await RemoteStore.publishDue();
            Toast.success('Đã xử lý hàng đợi đăng bài');
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
  };

  const bindContentImageFallbacks = () => {
    container.querySelectorAll('img[data-content-remove-on-error]').forEach(image => {
      const removeBrokenImage = () => {
        image.parentElement?.classList.add('is-fallback');
        image.remove();
      };
      image.addEventListener('error', removeBrokenImage, { once: true });
      if (image.complete && image.naturalWidth === 0) removeBrokenImage();
    });

    container.querySelectorAll('img[data-post-thumbnail]').forEach(image => {
      const applyNextFallback = () => {
        const stage = Number(image.dataset.fallbackStage || 0);
        const candidates = [image.dataset.channelFallback, image.dataset.platformFallback]
          .filter(Boolean);
        const next = candidates.find((candidate, index) => index >= stage && candidate !== image.getAttribute('src'));
        if (next) {
          image.dataset.fallbackStage = String(candidates.indexOf(next) + 1);
          image.src = next;
          return;
        }
        image.parentElement?.classList.add('is-broken');
        image.remove();
      };
      image.addEventListener('error', applyNextFallback);
      if (image.complete && image.naturalWidth === 0) applyNextFallback();
    });

  };

  // ── Modals ──

  const openFanpageModal = (fp = null) => {
    const isEdit = !!fp;
    const title = isEdit ? 'Chỉnh sửa Fanpage' : 'Thêm Fanpage mới';

    const content = `
      <div class="form-group">
        <label class="form-label">Tên Fanpage / Tài khoản <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="name" value="${isEdit ? Utils.escapeHtml(fp.name) : ''}" placeholder="Ví dụ: Công ty ABC Official">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nền tảng <span style="color:var(--danger-400);">*</span></label>
          <select class="form-select" data-field="platform" ${isEdit ? 'disabled' : ''}>
            ${Object.entries(Utils.PLATFORMS).map(([k, v]) => 
              `<option value="${k}" ${(isEdit ? fp.platform : 'facebook') === k ? 'selected' : ''}>${v.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">KPI mục tiêu tháng hiện tại</label>
          <input type="number" class="form-input" data-field="kpiTarget" value="${isEdit ? (fp.kpis?.[currentMonth] || 0) : 10}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Đường dẫn (Link)</label>
        <input type="url" class="form-input" data-field="link" value="${isEdit ? Utils.escapeHtml(fp.link || '') : ''}" placeholder="https://...">
      </div>
      <div class="form-group">
        <label class="form-label">Ảnh hiển thị của Page</label>
        <input type="hidden" data-field="imageUrl" id="fpImageValue" value="${isEdit ? Utils.escapeHtml(fp.imageUrl || '') : ''}">
        <div class="fanpage-image-upload">
          <div class="fanpage-image-preview" id="fpImagePreview">
            ${isEdit && fp.imageUrl ? `<img src="${Utils.escapeHtml(fp.imageUrl)}" alt="${Utils.escapeHtml(fp.name)}">` : `<span>${Utils.icons.image || platformPlaceholderIcon()}</span>`}
          </div>
          <div class="fanpage-image-controls">
            <input type="text" class="form-input" id="fpImageUrlInput" value="${isEdit ? Utils.escapeHtml(fp.imageUrl || '') : ''}" placeholder="Dán link ảnh hoặc tải ảnh lên">
            <div class="fanpage-image-buttons">
              <button type="button" class="btn btn-secondary" id="uploadFpImageBtn">Up ảnh</button>
              <button type="button" class="btn btn-ghost" id="clearFpImageBtn">Xóa ảnh</button>
            </div>
            <input type="file" id="fpImageFileInput" accept="image/*" hidden>
            <div class="form-hint">Ảnh đã tải lên sẽ được lưu cùng dữ liệu fanpage trên trình duyệt này.</div>
          </div>
        </div>
      </div>
    `;

    const modalEl = Modal.open({
      title,
      content,
      saveLabel: isEdit ? 'Cập nhật' : 'Tạo mới',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.name || !formData.name.trim()) {
          Toast.error('Vui lòng nhập tên fanpage');
          return;
        }

        const kpis = isEdit ? { ...(fp.kpis || {}) } : {};
        kpis[currentMonth] = parseInt(formData.kpiTarget) || 0;

        const fpData = {
          name: formData.name.trim(),
          platform: isEdit ? fp.platform : formData.platform,
          link: formData.link.trim(),
          imageUrl: formData.imageUrl.trim(),
          kpis
        };

        if (isEdit) {
          Store.fanpages.update(fp.id, fpData);
          Toast.success('Đã cập nhật Fanpage');
        } else {
          Store.fanpages.create(fpData);
          Toast.success('Đã thêm Fanpage mới');
        }
        Modal.close();
        renderPage();
      }
    });

    bindFanpageImageUpload(modalEl);
  };

  const platformPlaceholderIcon = () => {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  };

  const bindFanpageImageUpload = (modalEl) => {
    const imageValue = modalEl.querySelector('#fpImageValue');
    const imageUrlInput = modalEl.querySelector('#fpImageUrlInput');
    const fileInput = modalEl.querySelector('#fpImageFileInput');
    const uploadBtn = modalEl.querySelector('#uploadFpImageBtn');
    const clearBtn = modalEl.querySelector('#clearFpImageBtn');
    const preview = modalEl.querySelector('#fpImagePreview');

    const renderPreview = (src) => {
      preview.innerHTML = src
        ? `<img src="${Utils.escapeHtml(src)}" alt="Ảnh fanpage">`
        : `<span>${platformPlaceholderIcon()}</span>`;
    };

    imageUrlInput?.addEventListener('input', () => {
      const src = imageUrlInput.value.trim();
      imageValue.value = src;
      renderPreview(src);
    });

    uploadBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        Toast.error('Vui lòng chọn file ảnh');
        fileInput.value = '';
        return;
      }
      if (file.size > 1024 * 1024) {
        Toast.error('Ảnh tải trực tiếp phải nhỏ hơn 1MB để lưu trên Cloudflare D1');
        fileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result || '';
        imageValue.value = src;
        imageUrlInput.value = src;
        renderPreview(src);
      };
      reader.onerror = () => Toast.error('Không thể đọc file ảnh');
      reader.readAsDataURL(file);
    });

    clearBtn?.addEventListener('click', () => {
      imageValue.value = '';
      imageUrlInput.value = '';
      fileInput.value = '';
      renderPreview('');
    });
  };

  const openAddPostModal = (fpId) => {
    const fp = Store.fanpages.getById(fpId);
    if (!fp) return;

    const defaultDate = Utils.getDefaultDateForMonth(currentMonth);

    const content = `
      <div class="form-group">
        <label class="form-label">Fanpage</label>
        <input type="text" class="form-input" value="${Utils.escapeHtml(fp.name)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Tiêu đề bài viết <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="title" placeholder="Nhập tiêu đề hoặc nội dung chính">
      </div>
      <div class="form-group">
        <label class="form-label">Ngày đăng <span style="color:var(--danger-400);">*</span></label>
        <input type="date" class="form-input" data-field="date" value="${defaultDate}">
      </div>
      ${Utils.campaignPickerHtml('')}
    `;

    Modal.open({
      title: 'Nhập bài viết đã đăng',
      content,
      saveLabel: 'Ghi nhận bài đăng',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.title || !formData.title.trim()) {
          Toast.error('Vui lòng nhập tiêu đề bài viết');
          return;
        }
        if (!formData.date) {
          Toast.error('Vui lòng chọn ngày đăng');
          return;
        }

        Store.posts.create({
          fanpageId: fpId,
          title: formData.title.trim(),
          date: formData.date,
          status: 'published',
          campaignId: formData.campaignId || ''
        });

        Toast.success('Đã thêm bài viết mới');
        Modal.close();
        renderPage();
        Sidebar.updateBadge();
      }
    });
  };

  const openScheduleChoiceModal = (defaultFanpageId = '') => {
    openSchedulePostModal(defaultFanpageId);
  };

  const openSchedulePostModal = (defaultFanpageId = '') => {
    const fanpages = Store.fanpages.getAll();
    if (fanpages.length === 0) {
      Toast.error('Vui lòng thêm fanpage trước khi lên lịch đăng');
      return;
    }

    const defaultTime = toLocalDateTimeValue(new Date(Date.now() + 60 * 60 * 1000));
    const selectedFanpage = Store.fanpages.getById(defaultFanpageId) || fanpages[0];

    const content = `
      <div class="form-group">
        <div class="schedule-fanpage-heading">
          <label class="form-label">Fanpage / tài khoản <span style="color:var(--danger-400);">*</span></label>
          <span class="schedule-fanpage-count" id="scheduleFanpageCount">Đã chọn 1/${fanpages.length}</span>
        </div>
        <div class="schedule-fanpage-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" id="selectAllScheduleFanpages">Chọn tất cả</button>
          <button type="button" class="btn btn-ghost btn-sm" id="clearScheduleFanpages">Bỏ chọn</button>
        </div>
        <div class="schedule-fanpage-selector" id="scheduleFanpageSelector" role="group" aria-label="Chọn fanpage hoặc tài khoản đăng bài">
          ${fanpages.map(fp => {
            const platform = Utils.getPlatformInfo(fp.platform);
            const connectedText = fp.connected ? '' : ' - chưa liên kết Meta';
            return `
              <label class="schedule-fanpage-option ${selectedFanpage.id === fp.id ? 'is-selected' : ''}">
                <input type="checkbox" class="schedule-fanpage-checkbox" value="${Utils.escapeHtml(fp.id)}" ${selectedFanpage.id === fp.id ? 'checked' : ''}>
                <span class="schedule-fanpage-option-main">
                  <strong>${Utils.escapeHtml(fp.name)}</strong>
                  <small>${platform.name}${connectedText}</small>
                </span>
              </label>
            `;
          }).join('')}
        </div>
        <div class="form-hint">Nội dung, media, thời gian và chế độ đăng sẽ được áp dụng cho tất cả page đã chọn.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Nội dung bài đăng <span style="color:var(--danger-400);">*</span></label>
        <textarea class="form-textarea schedule-content-input" data-field="content" rows="6" placeholder="Nhập nội dung sẽ đăng lên fanpage"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Chế độ đăng</label>
        <div class="publish-mode-selector" role="radiogroup" aria-label="Chế độ đăng bài">
          <label class="publish-mode-option is-selected">
            <input type="radio" name="publishMode" data-field="publishMode" value="live" checked>
            <span><strong>Đăng thật</strong><small>Xuất bản công khai khi đến giờ.</small></span>
          </label>
          <label class="publish-mode-option publish-mode-option-test">
            <input type="radio" name="publishMode" data-field="publishMode" value="safe_test">
            <span><strong>Đăng thử — không công khai</strong><small>Facebook tạo bài ẩn; Instagram chỉ kiểm tra media container.</small></span>
          </label>
        </div>
        <div class="safe-test-notice" id="safeTestNotice" hidden></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Thời gian đăng <span style="color:var(--danger-400);">*</span></label>
          <input type="datetime-local" class="form-input" data-field="scheduledAt" value="${defaultTime}">
        </div>
        <div class="form-group">
          <label class="form-label">Phê duyệt</label>
          <select class="form-select" data-field="approvalStatus">
            <option value="pending" selected>Chờ phê duyệt trước khi đăng</option>
            <option value="approved">Đã duyệt, cho phép tự động đăng</option>
          </select>
        </div>
      </div>
      <div class="form-hint">Bài chờ duyệt sẽ không được đăng tự động, kể cả khi đã đến giờ.</div>
      ${Utils.campaignPickerHtml('')}
      <div class="form-group">
        <label class="form-label">Media</label>
        <input type="hidden" data-field="mediaItems" id="scheduleMediaItems" value="[]">
        <div class="schedule-media-builder">
          <div class="schedule-media-row">
            <input type="url" class="form-input" id="scheduleMediaUrlInput" placeholder="Dán URL ảnh công khai">
            <button type="button" class="btn btn-secondary" id="addScheduleMediaUrlBtn">Thêm URL</button>
            <button type="button" class="btn btn-secondary" id="uploadScheduleMediaBtn">Up ảnh</button>
            <input type="file" id="scheduleMediaFileInput" accept="image/*" multiple hidden>
          </div>
          <div class="schedule-media-list" id="scheduleMediaList" aria-live="polite" aria-label="Danh sách media theo thứ tự đăng"></div>
          <div class="form-hint">Kéo thả ảnh hoặc dùng nút trái/phải để đổi thứ tự. Facebook hỗ trợ URL ảnh/video hoặc ảnh upload. Instagram cần URL công khai (không nhận file upload/base64): nhiều ảnh sẽ đăng thành carousel (tối đa 10), video đăng thành Reels.</div>
        </div>
      </div>
    `;

    const modalEl = Modal.open({
      title: 'Lên lịch đăng bài tự động',
      content,
      size: 'lg',
      saveLabel: 'Lưu lịch đăng',
      onSave: async () => {
        const formData = Modal.getFormData();
        const selectedFanpages = getSelectedFanpages();
        const publishMode = formData.publishMode === 'safe_test' ? 'safe_test' : 'live';
        const contentText = (formData.content || '').trim();
        if (!contentText) {
          Toast.error('Vui lòng nhập nội dung bài đăng');
          return;
        }
        if (!formData.scheduledAt) {
          Toast.error('Vui lòng chọn thời gian đăng');
          return;
        }

        const scheduledDate = new Date(formData.scheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) {
          Toast.error('Thời gian đăng không hợp lệ');
          return;
        }

        const mediaItems = parseMediaItems(formData.mediaItems);
        const selectionErrors = ScheduleBatch.validateSelection({
          fanpages: selectedFanpages,
          mediaItems,
          publishMode,
          remoteAvailable: !!window.RemoteStore?.available
        });
        if (selectionErrors.length) {
          Toast.error(selectionErrors.join(' • '));
          return;
        }
        const disconnected = selectedFanpages.filter(fanpage => !fanpage.connected);
        if (disconnected.length) {
          Toast.warning(`${disconnected.map(fanpage => fanpage.name).join(', ')} chưa liên kết Meta; lịch vẫn được lưu nhưng chưa thể đăng tự động`);
        }

        const entries = ScheduleBatch.buildEntries({
          fanpages: selectedFanpages,
          content: contentText,
          date: formData.scheduledAt.slice(0, 10),
          scheduledAt: scheduledDate.toISOString(),
          mediaItems,
          campaignId: formData.campaignId || '',
          approvalStatus: publishMode === 'safe_test' ? 'approved' : (formData.approvalStatus || 'pending'),
          publishMode
        });

        if (saveButton?.disabled) return;
        if (saveButton) saveButton.disabled = true;
        Toast.info(publishMode === 'safe_test'
          ? `Đang xử lý đăng thử cho ${entries.length} page...`
          : `Đang lưu ${entries.length} lịch đăng...`);

        let outcome;
        try {
          outcome = await ScheduleBatch.execute(entries, async entry => {
            if (!window.RemoteStore?.available) return Store.posts.create(entry.payload);

            const saved = await RemoteStore.createPost(entry.payload, { refresh: false });
            if (publishMode !== 'safe_test' || scheduledDate > new Date()) return { saved };

            try {
              const testResult = await RemoteStore.runPostTest(saved.id, { refresh: false });
              return { saved, testResult };
            } catch (error) {
              // The schedule already exists and is marked failed by the server.
              // Report the test failure without creating a duplicate on retry.
              return { saved, testError: error instanceof Error ? error : new Error(String(error)) };
            }
          });

          if (window.RemoteStore?.available) {
            await RemoteStore.loadPosts(currentMonth).catch(() => {});
            await RemoteStore.loadPending().catch(() => {});
          }

          if (outcome.failed.length) {
            const succeededIds = new Set(outcome.succeeded.map(item => item.entry.fanpage.id));
            fanpageCheckboxes.forEach(checkbox => {
              if (succeededIds.has(checkbox.value)) checkbox.checked = false;
            });
            updateFanpageSelectionUi();
            const failedNames = outcome.failed.map(item => item.entry.fanpage.name).join(', ');
            Toast.error(`Đã lưu ${outcome.succeeded.length}/${entries.length} lịch. Chưa lưu được: ${failedNames}. Bạn có thể bấm lưu lại cho các page còn được chọn.`);
            renderPage();
            Sidebar.updateBadge();
            return;
          }

          const testFailures = outcome.succeeded.filter(item => item.value?.testError);
          if (testFailures.length) {
            Toast.warning(`Đã tạo đủ ${entries.length} lịch nhưng đăng thử lỗi ở: ${testFailures.map(item => item.entry.fanpage.name).join(', ')}. Có thể thử lại từ hàng đợi.`);
          } else if (publishMode === 'safe_test') {
            Toast.success(scheduledDate <= new Date()
              ? `Đã hoàn tất đăng thử không công khai trên ${entries.length} page.`
              : `Đã lưu ${entries.length} lịch đăng thử; cron sẽ chạy an toàn khi đến giờ.`);
          } else if (scheduledDate <= new Date()) {
            Toast.success(`Đã gửi đăng ngay ${entries.length} bài — hệ thống đang đăng, trạng thái sẽ cập nhật trong ít phút.`);
          } else {
            Toast.success(formData.approvalStatus === 'approved'
              ? `Đã lưu ${entries.length} lịch đăng bài`
              : `Đã lưu ${entries.length} bài vào hàng chờ duyệt`);
          }

          Modal.close();
          renderPage();
          Sidebar.updateBadge();
        } finally {
          if (saveButton?.isConnected) saveButton.disabled = false;
        }
      }
    });

    const publishModeInputs = modalEl.querySelectorAll('input[name="publishMode"]');
    const approvalSelect = modalEl.querySelector('[data-field="approvalStatus"]');
    const scheduleInput = modalEl.querySelector('[data-field="scheduledAt"]');
    const fanpageCheckboxes = [...modalEl.querySelectorAll('.schedule-fanpage-checkbox')];
    const fanpageCount = modalEl.querySelector('#scheduleFanpageCount');
    const safeTestNotice = modalEl.querySelector('#safeTestNotice');
    const saveButton = modalEl.querySelector('#modalSave');
    // "Đăng ngay" = same save flow with time pinned to now + approved; the server
    // (POST /api/posts) auto-runs the publish queue when scheduledAt <= now.
    const publishNowButton = document.createElement('button');
    publishNowButton.type = 'button';
    publishNowButton.className = 'btn btn-secondary';
    publishNowButton.id = 'modalPublishNow';
    saveButton?.before(publishNowButton);
    publishNowButton.addEventListener('click', () => {
      const scheduleInputEl = modalEl.querySelector('[data-field="scheduledAt"]');
      const approvalSelectEl = modalEl.querySelector('[data-field="approvalStatus"]');
      if (scheduleInputEl) scheduleInputEl.value = toLocalDateTimeValue(new Date());
      if (approvalSelectEl) approvalSelectEl.value = 'approved';
      saveButton?.click();
    });
    const getSelectedFanpages = () => fanpageCheckboxes
      .filter(checkbox => checkbox.checked)
      .map(checkbox => Store.fanpages.getById(checkbox.value))
      .filter(Boolean);
    const updatePublishModeUi = ({ resetTime = false } = {}) => {
      const isSafeTest = modalEl.querySelector('input[name="publishMode"]:checked')?.value === 'safe_test';
      const selected = getSelectedFanpages();
      modalEl.querySelectorAll('.publish-mode-option').forEach(option => {
        option.classList.toggle('is-selected', !!option.querySelector('input:checked'));
      });
      if (approvalSelect) {
        approvalSelect.disabled = isSafeTest;
        if (isSafeTest) approvalSelect.value = 'approved';
      }
      if (isSafeTest && resetTime && scheduleInput) scheduleInput.value = toLocalDateTimeValue(new Date());
      if (saveButton) {
        saveButton.textContent = isSafeTest
          ? `Chạy đăng thử (${selected.length})`
          : `Lưu ${selected.length} lịch đăng`;
      }
      // Safe test already runs immediately — a second immediate button would be noise.
      publishNowButton.hidden = isSafeTest;
      publishNowButton.textContent = `Đăng ngay (${selected.length})`;
      if (safeTestNotice) {
        safeTestNotice.hidden = !isSafeTest;
        if (isSafeTest) {
          safeTestNotice.textContent = selected.length
            ? selected.map(page => {
              if (page.platform === 'instagram') return `${page.name}: chỉ kiểm tra media container.`;
              if (page.platform !== 'facebook') return `${page.name}: chưa hỗ trợ đăng thử.`;
              return `${page.name}: tạo bài Facebook ẩn để kiểm tra.`;
            }).join(' ')
            : 'Chọn ít nhất một page để chạy đăng thử.';
        }
      }
    };
    const updateFanpageSelectionUi = () => {
      const selectedCount = fanpageCheckboxes.filter(checkbox => checkbox.checked).length;
      fanpageCheckboxes.forEach(checkbox => {
        checkbox.closest('.schedule-fanpage-option')?.classList.toggle('is-selected', checkbox.checked);
      });
      if (fanpageCount) fanpageCount.textContent = `Đã chọn ${selectedCount}/${fanpageCheckboxes.length}`;
      updatePublishModeUi();
    };
    publishModeInputs.forEach(input => input.addEventListener('change', () => updatePublishModeUi({ resetTime: input.value === 'safe_test' })));
    fanpageCheckboxes.forEach(checkbox => checkbox.addEventListener('change', updateFanpageSelectionUi));
    modalEl.querySelector('#selectAllScheduleFanpages')?.addEventListener('click', () => {
      fanpageCheckboxes.forEach(checkbox => { checkbox.checked = true; });
      updateFanpageSelectionUi();
    });
    modalEl.querySelector('#clearScheduleFanpages')?.addEventListener('click', () => {
      fanpageCheckboxes.forEach(checkbox => { checkbox.checked = false; });
      updateFanpageSelectionUi();
    });
    updateFanpageSelectionUi();

    bindScheduleMediaControls(modalEl);
  };

  const normalizeMediaUrl = (rawUrl = '') => {
    try {
      const url = new URL(rawUrl);
      if (!/(^|\.)drive\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/i.test(url.hostname)) return rawUrl;
      const fileId = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id');
      return fileId
        ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`
        : rawUrl;
    } catch {
      return rawUrl;
    }
  };

  const inferMediaType = (url = '', name = '') => /\.(mp4|mov|m4v|avi|webm|mkv)(?:$|[?#])/i.test(`${url} ${name}`)
    ? 'video'
    : 'image';

  const parseMediaItems = (raw) => {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item?.url).slice(0, 10) : [];
    } catch {
      return [];
    }
  };

  const bindScheduleMediaControls = (modalEl) => {
    const maxInlineUploadBytes = 1024 * 1024;
    const hiddenInput = modalEl.querySelector('#scheduleMediaItems');
    const urlInput = modalEl.querySelector('#scheduleMediaUrlInput');
    const addUrlBtn = modalEl.querySelector('#addScheduleMediaUrlBtn');
    const uploadBtn = modalEl.querySelector('#uploadScheduleMediaBtn');
    const fileInput = modalEl.querySelector('#scheduleMediaFileInput');
    const list = modalEl.querySelector('#scheduleMediaList');
    let mediaItems = [];
    let draggedIndex = null;

    const moveMedia = (fromIndex, toIndex) => {
      const reordered = MediaGallery.reorder(mediaItems, fromIndex, toIndex);
      if (reordered.every((item, index) => item === mediaItems[index])) return;
      mediaItems = reordered;
      sync();
    };

    const sync = () => {
      hiddenInput.value = JSON.stringify(mediaItems);
      list.innerHTML = mediaItems.length === 0 ? `
        <div class="schedule-media-empty">Chưa có media</div>
      ` : mediaItems.map((item, index) => {
        const isVideo = item.type === 'video';
        const displayName = item.url.startsWith('data:')
          ? (item.name || `Ảnh upload ${index + 1}`)
          : MediaGallery.displayName(item.url);
        const previewUrl = MediaGallery.previewUrl(item.url);
        const mediaType = item.url.startsWith('data:') ? 'Ảnh upload' : (isVideo ? 'Video URL' : 'Ảnh URL');
        return `
          <div class="schedule-media-item" draggable="true" data-index="${index}" title="Kéo để đổi thứ tự">
            <div class="schedule-media-order" aria-label="Ảnh thứ ${index + 1}">${index + 1}</div>
            <div class="schedule-media-thumb ${isVideo ? 'is-video' : ''}">
              ${isVideo
                ? '<span>VIDEO</span>'
                : `<img src="${Utils.escapeHtml(previewUrl)}" alt="Ảnh ${index + 1}: ${Utils.escapeHtml(displayName)}" loading="lazy" draggable="false" data-media-preview>`}
            </div>
            <div class="schedule-media-info">
              <div class="schedule-media-name" title="${Utils.escapeHtml(displayName)}">${Utils.escapeHtml(displayName)}</div>
              <div class="schedule-media-type">${mediaType} · Vị trí ${index + 1}</div>
              <div class="schedule-media-actions">
                <button type="button" class="btn btn-icon btn-ghost btn-sm move-schedule-media-btn" data-index="${index}" data-to="${index - 1}" aria-label="Đưa ảnh ${index + 1} sang trước" ${index === 0 ? 'disabled' : ''}>
                  ${Utils.icons.chevronLeft}
                </button>
                <button type="button" class="btn btn-icon btn-ghost btn-sm move-schedule-media-btn" data-index="${index}" data-to="${index + 1}" aria-label="Đưa ảnh ${index + 1} ra sau" ${index === mediaItems.length - 1 ? 'disabled' : ''}>
                  ${Utils.icons.chevronRight}
                </button>
                <button type="button" class="btn btn-icon btn-ghost btn-sm remove-schedule-media-btn" data-index="${index}" aria-label="Xóa ảnh ${index + 1}">
                  ${Utils.icons.close}
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      list.querySelectorAll('img[data-media-preview]').forEach(image => {
        const removeBrokenPreview = () => {
          image.parentElement?.classList.add('is-broken');
          image.remove();
        };
        image.addEventListener('error', removeBrokenPreview, { once: true });
        if (image.complete && image.naturalWidth === 0) removeBrokenPreview();
      });

      list.querySelectorAll('.remove-schedule-media-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          mediaItems.splice(Number(btn.dataset.index), 1);
          sync();
        });
      });

      list.querySelectorAll('.move-schedule-media-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          moveMedia(Number(btn.dataset.index), Number(btn.dataset.to));
        });
      });

      list.querySelectorAll('.schedule-media-item').forEach(itemEl => {
        itemEl.addEventListener('dragstart', (event) => {
          draggedIndex = Number(itemEl.dataset.index);
          itemEl.classList.add('is-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(draggedIndex));
          }
        });
        itemEl.addEventListener('dragover', (event) => {
          event.preventDefault();
          itemEl.classList.add('is-drag-over');
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        itemEl.addEventListener('dragleave', () => itemEl.classList.remove('is-drag-over'));
        itemEl.addEventListener('drop', (event) => {
          event.preventDefault();
          const transferIndex = Number(event.dataTransfer?.getData('text/plain'));
          const fromIndex = Number.isInteger(transferIndex) ? transferIndex : draggedIndex;
          itemEl.classList.remove('is-drag-over');
          moveMedia(fromIndex, Number(itemEl.dataset.index));
          draggedIndex = null;
        });
        itemEl.addEventListener('dragend', () => {
          draggedIndex = null;
          list.querySelectorAll('.schedule-media-item').forEach(candidate => {
            candidate.classList.remove('is-dragging', 'is-drag-over');
          });
        });
      });
    };

    const addMedia = (item) => {
      if (mediaItems.length >= 10) {
        Toast.error('Tối đa 10 media cho một lịch đăng');
        return;
      }
      mediaItems.push(item);
      sync();
    };

    addUrlBtn?.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) {
        Toast.error('URL media phải bắt đầu bằng http:// hoặc https://');
        return;
      }
      const normalizedUrl = normalizeMediaUrl(url);
      const name = MediaGallery.displayName(url);
      addMedia({ type: inferMediaType(normalizedUrl, name), url: normalizedUrl, name });
      urlInput.value = '';
    });

    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addUrlBtn?.click();
      }
    });

    uploadBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      const existingUploadBytes = mediaItems.reduce((total, item) => {
        if (!item.url?.startsWith('data:')) return total;
        return total + (Number(item.size) || Math.ceil(item.url.length * 0.75));
      }, 0);
      let selectedUploadBytes = 0;
      files.forEach(file => {
        if (!file.type.startsWith('image/')) {
          Toast.error(`File ${file.name} không phải ảnh`);
          return;
        }
        if (file.size > maxInlineUploadBytes) {
          Toast.error(`Ảnh ${file.name} phải nhỏ hơn 1MB để lưu trên Cloudflare D1`);
          return;
        }
        if (existingUploadBytes + selectedUploadBytes + file.size > maxInlineUploadBytes) {
          Toast.error('Tổng ảnh tải trực tiếp cho một lịch đăng không được vượt quá 1MB');
          return;
        }
        selectedUploadBytes += file.size;
        const reader = new FileReader();
        reader.onload = () => addMedia({
          type: 'image',
          url: reader.result || '',
          name: file.name,
          size: file.size
        });
        reader.onerror = () => Toast.error(`Không thể đọc file ${file.name}`);
        reader.readAsDataURL(file);
      });
      fileInput.value = '';
    });

    sync();
  };

  const openEditKpiModal = (fpId) => {
    const fp = Store.fanpages.getById(fpId);
    if (!fp) return;
    const currentKpi = fp.kpis?.[currentMonth] || 0;

    const content = `
      <div class="form-group">
        <label class="form-label">KPI bài đăng cho: <strong>${Utils.escapeHtml(fp.name)}</strong></label>
        <div style="font-size: var(--text-xs); color: var(--text-tertiary); margin-bottom: var(--space-3);">Áp dụng cho tháng: ${Utils.formatMonthYear(currentMonth)}</div>
        <input type="number" class="form-input" data-field="kpiTarget" value="${currentKpi}" min="0" placeholder="Ví dụ: 15">
      </div>
    `;

    Modal.open({
      title: 'Thiết lập mục tiêu KPI',
      content,
      saveLabel: 'Cập nhật KPI',
      onSave: () => {
        const formData = Modal.getFormData();
        const target = parseInt(formData.kpiTarget);
        if (isNaN(target) || target < 0) {
          Toast.error('Số lượng bài đăng không hợp lệ');
          return;
        }

        Store.fanpages.setKpi(fpId, currentMonth, target);
        Toast.success('Đã cập nhật mục tiêu KPI');
        Modal.close();
        renderPage();
      }
    });
  };

  return { render };
})();

App.registerPage('content', ContentPage);
