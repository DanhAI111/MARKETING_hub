/* ═══════════════════════════════════════════
   MARKETING HUB - Content & KPI Page
   Manage posting schedule and KPI targets
   ═══════════════════════════════════════════ */

const ContentPage = (() => {
  let container = null;
  let currentMonth = Utils.getReportingMonth();
  let selectedPlatform = '';

  const POST_STATUSES = {
    scheduled: { label: 'Chờ đăng', className: 'tag-warning' },
    publishing: { label: 'Đang đăng', className: 'tag-info' },
    published: { label: 'Đã đăng', className: 'tag-success' },
    failed: { label: 'Lỗi đăng', className: 'tag-danger' }
  };

  const getPostStatus = (status) => POST_STATUSES[status] || POST_STATUSES.published;

  const formatScheduleTime = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const toLocalDateTimeValue = (date = new Date()) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  // ── Render ──

  const render = (el) => {
    container = el;
    currentMonth = Utils.getReportingMonth();
    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    const fanpages = Store.fanpages.getAll();
    const filteredFanpages = selectedPlatform 
      ? fanpages.filter(fp => fp.platform === selectedPlatform)
      : fanpages;

    // Calculate Summary Stats
    let totalKpi = 0;
    let totalPosted = 0;
    let totalScheduled = 0;
    let totalFailed = 0;
    fanpages.forEach(fp => {
      totalKpi += fp.kpis?.[currentMonth] || 0;
      totalPosted += Store.posts.getCountByFanpageAndMonth(fp.id, currentMonth);
    });
    Store.posts.getScheduledByMonth(currentMonth).forEach(post => {
      if (post.status === 'failed') totalFailed++;
      else totalScheduled++;
    });
    const totalPercent = totalKpi > 0 ? Math.round((totalPosted / totalKpi) * 100) : 0;
    const progressColorClass = Utils.getKpiColor(totalPercent);

    container.innerHTML = `
      ${renderIntegrationPanel()}

      <!-- Summary Row -->
      <div class="quick-stats" style="grid-template-columns: repeat(4, 1fr); margin-bottom: var(--space-5);">
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(124, 58, 237, 0.12); color: var(--primary-400);">
            ${Utils.icons.target}
          </div>
          <div class="stat-card-label">Tổng mục tiêu KPI tháng</div>
          <div class="stat-card-value">${totalKpi} bài</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(59, 130, 246, 0.12); color: var(--info-400);">
            ${Utils.icons.content}
          </div>
          <div class="stat-card-label">Tổng bài đã đăng</div>
          <div class="stat-card-value">${totalPosted} bài</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(16, 185, 129, 0.12); color: var(--success-400);">
            ${Utils.icons.check}
          </div>
          <div class="stat-card-label">Tỷ lệ hoàn thành</div>
          <div class="stat-card-value ${progressColorClass}">${totalPercent}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(245, 158, 11, 0.12); color: var(--warning-400);">
            ${Utils.icons.clock}
          </div>
          <div class="stat-card-label">Đang chờ / lỗi đăng</div>
          <div class="stat-card-value">${totalScheduled}/${totalFailed}</div>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <!-- Month Picker -->
          <div class="month-picker">
            <button class="month-picker-btn" id="prevMonthBtn">
              ${Utils.icons.chevronLeft}
            </button>
            <span class="month-picker-label" id="currentMonthLabel">
              ${Utils.formatMonthYear(currentMonth)}
            </span>
            <button class="month-picker-btn" id="nextMonthBtn">
              ${Utils.icons.chevronRight}
            </button>
          </div>
          
          <!-- Platform Filter -->
          <select class="filter-select" id="platformFilterSelect">
            <option value="">Tất cả nền tảng</option>
            ${Object.entries(Utils.PLATFORMS).map(([k, v]) => 
              `<option value="${k}" ${selectedPlatform === k ? 'selected' : ''}>${v.name}</option>`
            ).join('')}
          </select>
        </div>
        
        <div class="toolbar-right">
          <button class="btn btn-secondary" id="syncMetaBtn" ${window.RemoteStore?.available ? '' : 'disabled'}>
            ${Utils.icons.refresh || Utils.icons.upload}
            <span>Đồng bộ ngay</span>
          </button>
          <button class="btn btn-secondary" id="connectMetaBtn" ${window.RemoteStore?.available ? '' : 'disabled'}>
            ${Utils.icons.link || Utils.icons.plus}
            <span>Liên kết Meta</span>
          </button>
          <button class="btn btn-primary" id="schedulePostBtn">
            ${Utils.icons.clock}
            <span>Lên lịch đăng</span>
          </button>
          <button class="btn btn-primary" id="addFanpageBtn">
            ${Utils.icons.plus}
            <span>Thêm Fanpage</span>
          </button>
        </div>
      </div>

      <!-- Fanpages Grid -->
      <div class="fanpage-grid">
        ${filteredFanpages.length === 0 ? renderEmptyState() : filteredFanpages.map(fp => renderFanpageCard(fp)).join('')}
      </div>
    `;

    bindEvents();
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

  const renderEmptyState = () => {
    return `
      <div class="empty-state span-4" style="grid-column: 1 / -1; padding: var(--space-8) 0;">
        <div class="empty-state-icon"></div>
        <div class="empty-state-title">Không tìm thấy Fanpage nào</div>
        <div class="empty-state-desc">Hãy thêm fanpage mới hoặc điều chỉnh bộ lọc để bắt đầu.</div>
      </div>
    `;
  };

  const renderFanpageCard = (fp) => {
    const platform = Utils.getPlatformInfo(fp.platform);
    const imageUrl = (fp.imageUrl || '').trim();
    const kpiTarget = fp.kpis?.[currentMonth] || 0;
    const posts = Store.posts.getAll()
      .filter(p => {
        if (p.fanpageId !== fp.id) return false;
        const postMonth = p.status === 'published'
          ? (p.date || '').slice(0, 7)
          : ((p.date || p.scheduledAt || '').slice(0, 7));
        return postMonth === currentMonth;
      })
      .sort((a, b) => (b.scheduledAt || b.publishedAt || b.date || '').localeCompare(a.scheduledAt || a.publishedAt || a.date || ''));
    
    const posted = posts.filter(p => p.status === 'published').length;
    const scheduled = posts.filter(p => p.status !== 'published').length;
    const percent = kpiTarget > 0 ? Math.round((posted / kpiTarget) * 100) : 0;
    const colorClass = Utils.getKpiColor(percent);

    return `
      <div class="fanpage-card">
        <div class="fanpage-header">
          <div class="fanpage-avatar" style="background: ${platform.color}20; color: ${platform.color};">
            ${imageUrl ? `
              <img src="${Utils.escapeHtml(imageUrl)}" alt="${Utils.escapeHtml(fp.name)}" loading="lazy" onerror="this.parentElement.classList.add('is-fallback'); this.remove();">
            ` : ''}
            <span class="fanpage-avatar-fallback">${platform.icon}</span>
          </div>
          <div class="fanpage-main">
            <div class="fanpage-card-top">
              <div class="fanpage-name" title="${Utils.escapeHtml(fp.name)}">
                ${Utils.escapeHtml(fp.name)}
              </div>
            </div>
            <div class="fanpage-link">
              <a href="${Utils.escapeHtml(fp.link || '#')}" target="_blank">
                Link ${Utils.icon('chevronRight', 'icon-xs')}
              </a>
            </div>
          </div>
          <div class="fanpage-side">
            <span class="fanpage-platform-badge tag tag-${fp.platform}" title="${platform.name}">
              <span>${platform.icon}</span>
              <span>${platform.name}</span>
            </span>
            <div class="fanpage-actions">
              <button class="btn btn-icon btn-ghost btn-sm add-post-btn" data-id="${fp.id}" data-tooltip="Thêm bài đăng">
                ${Utils.icons.plus}
              </button>
              <button class="btn btn-icon btn-ghost btn-sm schedule-post-card-btn" data-id="${fp.id}" data-tooltip="Lên lịch đăng">
                ${Utils.icons.clock}
              </button>
              <button class="btn btn-icon btn-ghost btn-sm edit-kpi-btn" data-id="${fp.id}" data-tooltip="Thiết lập KPI">
                ${Utils.icons.target}
              </button>
              <button class="btn btn-icon btn-ghost btn-sm edit-fp-btn" data-id="${fp.id}" data-tooltip="Chỉnh sửa">
                ${Utils.icons.edit}
              </button>
              <button class="btn btn-icon btn-ghost btn-sm delete-fp-btn" data-id="${fp.id}" data-tooltip="Xóa">
                ${Utils.icons.trash}
              </button>
            </div>
          </div>
        </div>

        <!-- KPI Progress -->
        <div class="kpi-info" style="margin-bottom: var(--space-3);">
          <div class="kpi-stats" style="display: flex; justify-content: space-between; font-size: var(--text-sm); font-weight: var(--weight-medium); margin-bottom: var(--space-1);">
            <span style="color: var(--text-secondary);">KPI Tháng: ${posted}/${kpiTarget} bài</span>
            <span class="${colorClass}">${percent}%</span>
          </div>
          <div class="progress-bar-container" style="height: 6px;">
            <div class="progress-bar-fill ${colorClass}" style="width: ${Math.min(percent, 100)}%"></div>
          </div>
        </div>

        <!-- Recent Posts List -->
        <div style="border-top: 1px solid var(--border-subtle); padding-top: var(--space-2);">
          <div style="font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--text-tertiary); margin-bottom: var(--space-2); display: flex; justify-content: space-between;">
            <span>DANH SÁCH BÀI ĐĂNG</span>
            <span>${posted} đã đăng${scheduled ? ` • ${scheduled} chờ` : ''}</span>
          </div>
          <div class="post-list">
            ${posts.length === 0 ? `
              <div style="text-align: center; color: var(--text-muted); font-size: var(--text-xs); padding: var(--space-4) 0;">
                Chưa đăng bài nào trong tháng này
              </div>
            ` : posts.map(p => renderPostItem(p)).join('')}
          </div>
        </div>
      </div>
    `;
  };

  const renderPostItem = (post) => {
    const status = getPostStatus(post.status);
    const displayTime = post.status === 'published'
      ? (post.date ? `${post.date.split('-')[2]}/${post.date.split('-')[1]}` : '')
      : formatScheduleTime(post.scheduledAt);
    const mediaCount = Array.isArray(post.mediaItems) ? post.mediaItems.length : (post.mediaUrl ? 1 : 0);
    return `
      <div class="post-item ${post.status === 'failed' ? 'post-item-failed' : ''}">
        <span class="post-date">${displayTime}</span>
        <span class="post-title-text" title="${Utils.escapeHtml(post.publishError || post.content || post.title)}">${Utils.escapeHtml(post.title || post.content || 'Bài đăng')}</span>
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

  // ── Bind Events ──

  const bindEvents = () => {
    // Month picker
    container.querySelector('#prevMonthBtn')?.addEventListener('click', () => {
      currentMonth = Utils.getPrevMonth(currentMonth);
      Utils.setReportingMonth(currentMonth);
      renderPage();
    });

    container.querySelector('#nextMonthBtn')?.addEventListener('click', () => {
      currentMonth = Utils.getNextMonth(currentMonth);
      Utils.setReportingMonth(currentMonth);
      renderPage();
    });

    // Platform filter
    container.querySelector('#platformFilterSelect')?.addEventListener('change', (e) => {
      selectedPlatform = e.target.value;
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
          icon: '🗑️',
          onConfirm: () => {
            Store.fanpages.remove(fpId);
            Toast.success('Đã xóa Fanpage');
            renderPage();
          }
        });
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
          icon: '🗑️',
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
            await RemoteStore.publishDue();
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
          status: 'published'
        });

        Toast.success('Đã thêm bài viết mới');
        Modal.close();
        renderPage();
        Sidebar.updateBadge();
      }
    });
  };

  const openScheduleChoiceModal = (defaultFanpageId = '') => {
    const content = `
      <div class="schedule-choice-grid">
        <button type="button" class="schedule-choice-card" id="manualScheduleChoice">
          <span class="schedule-choice-icon">${Utils.icons.edit}</span>
          <span class="schedule-choice-title">Lên lịch thủ công</span>
          <span class="schedule-choice-desc">Nhập nội dung, media và thời gian cho một bài đăng.</span>
        </button>
        <button type="button" class="schedule-choice-card" id="sheetScheduleChoice">
          <span class="schedule-choice-icon">${Utils.icons.upload}</span>
          <span class="schedule-choice-title">Nhập từ Google Sheets</span>
          <span class="schedule-choice-desc">Import nhiều bài cùng lúc từ link Google Sheets hoặc file CSV.</span>
        </button>
      </div>
    `;

    const modalEl = Modal.open({
      title: 'Chọn cách lên lịch đăng',
      content,
      showFooter: false
    });

    modalEl.querySelector('#manualScheduleChoice')?.addEventListener('click', () => {
      Modal.close();
      openSchedulePostModal(defaultFanpageId);
    });

    modalEl.querySelector('#sheetScheduleChoice')?.addEventListener('click', () => {
      Modal.close();
      openScheduleSheetImportModal(defaultFanpageId);
    });
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
        <label class="form-label">Fanpage / tài khoản <span style="color:var(--danger-400);">*</span></label>
        <select class="form-select" data-field="fanpageId" id="scheduleFanpageSelect">
          ${fanpages.map(fp => {
            const platform = Utils.getPlatformInfo(fp.platform);
            const connectedText = fp.connected ? '' : ' - chưa liên kết Meta';
            return `<option value="${fp.id}" ${selectedFanpage.id === fp.id ? 'selected' : ''}>${Utils.escapeHtml(fp.name)} (${platform.name}${connectedText})</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Nội dung bài đăng <span style="color:var(--danger-400);">*</span></label>
        <textarea class="form-textarea schedule-content-input" data-field="content" rows="6" placeholder="Nhập nội dung sẽ đăng lên fanpage"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Thời gian đăng <span style="color:var(--danger-400);">*</span></label>
          <input type="datetime-local" class="form-input" data-field="scheduledAt" value="${defaultTime}">
        </div>
        <div class="form-group">
          <label class="form-label">Trạng thái</label>
          <input type="text" class="form-input" value="Chờ đăng tự động" disabled>
        </div>
      </div>
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
          <div class="schedule-media-list" id="scheduleMediaList"></div>
          <div class="form-hint">Facebook hỗ trợ URL ảnh hoặc ảnh upload. Instagram cần URL ảnh công khai; file upload/base64 sẽ không đăng được lên Instagram.</div>
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
        const fanpage = Store.fanpages.getById(formData.fanpageId);
        const contentText = (formData.content || '').trim();
        if (!fanpage) {
          Toast.error('Vui lòng chọn fanpage');
          return;
        }
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
        if (fanpage.platform === 'instagram' && mediaItems.some(item => !/^https?:\/\//i.test(item.url || ''))) {
          Toast.error('Instagram chỉ nhận media có URL công khai');
          return;
        }
        if (!fanpage.connected) {
          Toast.warning('Fanpage chưa liên kết Meta; lịch sẽ được lưu nhưng chưa thể đăng tự động');
        }

        Store.posts.create({
          fanpageId: fanpage.id,
          title: contentText.slice(0, 80),
          content: contentText,
          date: formData.scheduledAt.slice(0, 10),
          scheduledAt: scheduledDate.toISOString(),
          mediaUrl: mediaItems[0]?.url || '',
          mediaItems,
          status: 'scheduled',
          source: 'scheduled'
        });

        if (window.RemoteStore?.available && scheduledDate <= new Date()) {
          try {
            await RemoteStore.publishDue();
          } catch (err) {
            Toast.error(err.message || 'Không thể xử lý lịch đăng ngay');
          }
        }

        Toast.success('Đã lưu lịch đăng bài');
        Modal.close();
        renderPage();
        Sidebar.updateBadge();
      }
    });

    bindScheduleMediaControls(modalEl);
  };

  const openScheduleSheetImportModal = (defaultFanpageId = '') => {
    const fanpages = Store.fanpages.getAll();
    if (fanpages.length === 0) {
      Toast.error('Vui lòng thêm fanpage trước khi nhập lịch đăng');
      return;
    }

    let parsedRows = [];
    let importItems = [];
    const selectedFanpage = Store.fanpages.getById(defaultFanpageId);

    const content = `
      <div class="sheet-import-layout">
        <div class="form-group">
          <label class="form-label">Link Google Sheets công khai</label>
          <div class="sheet-import-url-row">
            <input type="url" class="form-input" id="scheduleSheetUrl" placeholder="https://docs.google.com/spreadsheets/d/...">
            <button type="button" class="btn btn-secondary" id="loadScheduleSheetUrlBtn" ${window.RemoteStore?.available ? '' : 'disabled'}>
              ${Utils.icons.download}
              <span>Đọc link</span>
            </button>
          </div>
          <div class="form-hint">Ưu tiên link Publish to web của Google Sheets. Link chia sẻ “anyone can view” cũng được thử tự động; nếu Google chặn xuất CSV, hãy publish hoặc tải CSV rồi import file.</div>
        </div>

        <div class="form-group">
          <label class="form-label">Hoặc tải file CSV/TSV từ Google Sheets</label>
          <div class="sheet-import-dropzone" id="scheduleSheetDropzone">
            <input type="file" id="scheduleSheetFileInput" accept=".csv,.tsv,.txt" hidden>
            <div class="sheet-import-drop-icon">${Utils.icons.upload}</div>
            <div class="sheet-import-drop-title">Chọn file hoặc kéo thả vào đây</div>
            <div class="sheet-import-drop-desc">Google Sheets -> File -> Download -> CSV hoặc TSV</div>
          </div>
        </div>

        <div class="sheet-import-template">
          <div class="sheet-import-template-title">Cột hỗ trợ</div>
          <div class="sheet-import-template-text">fanpage, nội dung/content, thời gian đăng/scheduledAt, media, tiêu đề/title.</div>
          ${selectedFanpage ? `<div class="form-hint">Nếu file không có cột fanpage, toàn bộ bài sẽ áp dụng cho: ${Utils.escapeHtml(selectedFanpage.name)}.</div>` : ''}
        </div>

        <div class="sheet-import-preview" id="scheduleSheetPreview" style="display:none;"></div>
      </div>
    `;

    const modalEl = Modal.open({
      title: 'Nhập lịch đăng từ Google Sheets',
      content,
      size: 'lg',
      saveLabel: 'Nhập lịch đăng',
      onSave: async () => {
        const validItems = importItems.filter(item => item.valid);
        if (!validItems.length) {
          Toast.error('Chưa có dòng hợp lệ để nhập');
          return;
        }

        validItems.forEach(item => {
          Store.posts.create({
            fanpageId: item.fanpage.id,
            title: item.title || item.content.slice(0, 80),
            content: item.content,
            date: item.localDate,
            scheduledAt: item.scheduledAt,
            mediaUrl: item.mediaItems[0]?.url || '',
            mediaItems: item.mediaItems,
            status: 'scheduled',
            source: 'scheduled'
          });
        });

        if (window.RemoteStore?.available && validItems.some(item => new Date(item.scheduledAt) <= new Date())) {
          try {
            await RemoteStore.publishDue();
          } catch (err) {
            Toast.error(err.message || 'Không thể xử lý bài đến giờ');
          }
        }

        Toast.success(`Đã nhập ${validItems.length} lịch đăng`);
        Modal.close();
        renderPage();
        Sidebar.updateBadge();
      }
    });

    const renderImportPreview = () => {
      const preview = modalEl.querySelector('#scheduleSheetPreview');
      if (!preview) return;
      importItems = buildScheduleImportItems(parsedRows, defaultFanpageId);
      const validCount = importItems.filter(item => item.valid).length;
      const invalidCount = importItems.length - validCount;
      preview.style.display = 'block';
      preview.innerHTML = `
        <div class="sheet-import-summary">
          <span>${validCount} dòng hợp lệ</span>
          ${invalidCount ? `<span class="danger">${invalidCount} dòng lỗi</span>` : ''}
        </div>
        <div class="sheet-import-preview-list">
          ${importItems.slice(0, 8).map(item => renderScheduleImportPreviewItem(item)).join('')}
        </div>
        ${importItems.length > 8 ? `<div class="form-hint">Còn ${importItems.length - 8} dòng khác sẽ được nhập nếu hợp lệ.</div>` : ''}
      `;
    };

    const loadCsvText = (text, sourceName) => {
      const parsed = parseScheduleCsvContent(text);
      if (!parsed.rows.length) {
        Toast.error('Không tìm thấy dữ liệu lịch đăng trong file');
        return;
      }
      parsedRows = parsed.rows;
      Toast.success(`Đã đọc ${parsed.rows.length} dòng từ ${sourceName}`);
      renderImportPreview();
    };

    modalEl.querySelector('#loadScheduleSheetUrlBtn')?.addEventListener('click', async () => {
      const url = modalEl.querySelector('#scheduleSheetUrl')?.value.trim();
      if (!url) {
        Toast.error('Vui lòng dán link Google Sheets');
        return;
      }
      if (!window.RemoteStore?.available) {
        Toast.error('Vui lòng chạy backend Node để đọc link Google Sheets');
        return;
      }
      try {
        Toast.info('Đang đọc Google Sheets...');
        const result = await RemoteStore.fetchGoogleSheetCsv(url);
        loadCsvText(result.text || '', 'Google Sheets');
      } catch (err) {
        Toast.error(err.message || 'Không thể đọc Google Sheets');
      }
    });

    const fileInput = modalEl.querySelector('#scheduleSheetFileInput');
    const dropzone = modalEl.querySelector('#scheduleSheetDropzone');
    const handleFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => loadCsvText(reader.result || '', file.name);
      reader.onerror = () => Toast.error('Không thể đọc file');
      reader.readAsText(file, 'UTF-8');
    };

    dropzone?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => handleFile(fileInput.files?.[0]));
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragging');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragging');
      handleFile(e.dataTransfer.files?.[0]);
    });
  };

  const renderScheduleImportPreviewItem = (item) => {
    const status = item.valid ? 'Hợp lệ' : item.errors.join(', ');
    return `
      <div class="sheet-import-preview-item ${item.valid ? '' : 'is-invalid'}">
        <div>
          <div class="sheet-import-preview-title">${Utils.escapeHtml(item.content || item.title || 'Không có nội dung')}</div>
          <div class="sheet-import-preview-meta">
            ${Utils.escapeHtml(item.fanpage?.name || 'Chưa khớp fanpage')} · ${item.displayTime || 'Chưa có thời gian'}
          </div>
        </div>
        <span class="tag ${item.valid ? 'tag-success' : 'tag-danger'}">${Utils.escapeHtml(status)}</span>
      </div>
    `;
  };

  const buildScheduleImportItems = (rows, defaultFanpageId = '') => {
    const fanpages = Store.fanpages.getAll();
    return rows.map(row => {
      const title = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.title);
      const content = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.content);
      const fanpageText = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.fanpage);
      const scheduledRaw = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.scheduled);
      const dateRaw = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.date);
      const timeRaw = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.time);
      const mediaRaw = getScheduleRowValue(row, SCHEDULE_IMPORT_ALIASES.media);
      const fanpage = matchScheduleFanpage(fanpages, fanpageText, defaultFanpageId);
      const scheduledDate = parseScheduleDateTime(scheduledRaw, dateRaw, timeRaw);
      const mediaItems = parseScheduleMediaItems(mediaRaw);
      const errors = [];

      if (!fanpage) errors.push('Không tìm thấy fanpage');
      if (!content.trim()) errors.push('Thiếu nội dung');
      if (!scheduledDate) errors.push('Thời gian không hợp lệ');
      if (fanpage?.platform === 'instagram' && mediaItems.some(item => !/^https?:\/\//i.test(item.url || ''))) {
        errors.push('Instagram cần URL ảnh công khai');
      }

      return {
        valid: errors.length === 0,
        errors,
        fanpage,
        title: title.trim(),
        content: content.trim(),
        mediaItems,
        scheduledAt: scheduledDate ? scheduledDate.toISOString() : '',
        localDate: scheduledDate ? toLocalDateTimeValue(scheduledDate).slice(0, 10) : '',
        displayTime: scheduledDate ? formatScheduleTime(scheduledDate.toISOString()) : ''
      };
    });
  };

  const normalizeScheduleKey = (value = '') => {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  };

  const SCHEDULE_IMPORT_ALIASES = {
    title: ['title', 'tieu de', 'tiêu đề', 'chu de', 'chủ đề', 'topic'],
    content: [
      'content', 'noi dung', 'nội dung', 'noi dung bai dang', 'nội dung bài đăng',
      'caption', 'post', 'bai dang', 'bài đăng', 'bai viet', 'bài viết', 'copy',
      'text', 'mo ta', 'mô tả'
    ],
    fanpage: [
      'fanpage', 'page', 'ten page', 'tên page', 'fan page', 'facebook page',
      'tai khoan', 'tài khoản', 'account', 'kenh', 'kênh', 'kenh dang',
      'kênh đăng', 'page dang', 'page đăng', 'nhan hang', 'nhãn hàng',
      'brand', 'thuong hieu', 'thương hiệu'
    ],
    scheduled: [
      'scheduledat', 'scheduled at', 'schedule', 'datetime', 'thoi gian',
      'thời gian', 'thoi gian dang', 'thời gian đăng', 'lich dang',
      'lịch đăng', 'ngay gio', 'ngày giờ', 'ngay gio dang', 'ngày giờ đăng'
    ],
    date: ['date', 'ngay', 'ngày', 'ngay dang', 'ngày đăng', 'ngay len bai', 'ngày lên bài'],
    time: ['time', 'gio', 'giờ', 'gio dang', 'giờ đăng', 'khung gio', 'khung giờ'],
    media: [
      'media', 'image', 'anh', 'ảnh', 'hinh', 'hình', 'url anh', 'url ảnh',
      'link anh', 'link ảnh', 'link hinh', 'link hình', 'photo', 'video',
      'asset', 'creative'
    ]
  };

  const getScheduleRowValue = (row, aliases) => {
    const normalizedAliases = aliases.map(normalizeScheduleKey);
    const entry = Object.entries(row).find(([key]) => {
      const normalizedKey = normalizeScheduleKey(key);
      return normalizedAliases.some(alias => normalizedKey === alias || normalizedKey.includes(alias));
    });
    return entry ? String(entry[1] || '').trim() : '';
  };

  const matchScheduleFanpage = (fanpages, fanpageText, defaultFanpageId = '') => {
    const fallback = defaultFanpageId ? Store.fanpages.getById(defaultFanpageId) : null;
    if (!fanpageText.trim()) return fallback;
    const needle = normalizeScheduleKey(fanpageText);
    return fanpages.find(fp => fp.id === fanpageText)
      || fanpages.find(fp => normalizeScheduleKey(fp.name) === needle)
      || fanpages.find(fp => normalizeScheduleKey(fp.name).includes(needle) || needle.includes(normalizeScheduleKey(fp.name)))
      || fanpages.find(fp => (fp.link || '').toLowerCase().includes(fanpageText.toLowerCase()))
      || null;
  };

  const parseScheduleMediaItems = (raw = '') => {
    return String(raw || '')
      .split(/[\n;,|]+/)
      .map(url => url.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map(url => ({ type: 'image', url, name: url.split('/').pop() || 'Media URL' }));
  };

  const parseScheduleDateTime = (scheduledRaw, dateRaw = '', timeRaw = '') => {
    const raw = [scheduledRaw, [dateRaw, timeRaw].filter(Boolean).join(' ')].find(Boolean);
    if (!raw) return null;
    const value = String(raw).trim();
    const normalized = value.replace(/\s+/g, ' ');

    let match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (match) {
      const [, y, m, d, hh = '0', mm = '0'] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    match = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (match) {
      const [, d, m, y, hh = '0', mm = '0'] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const parseScheduleCsvContent = (text) => {
    const cleanText = String(text || '').replace(/^\uFEFF/, '');
    const previewLine = cleanText.split(/\r?\n/)[0] || '';
    const delimiter = detectScheduleCsvDelimiter(previewLine);
    const records = parseScheduleCsvRecords(cleanText, delimiter)
      .filter(record => record.some(value => String(value).trim()));
    if (records.length < 2) return { headers: [], rows: [] };
    const headerIndex = findScheduleHeaderRecordIndex(records);
    const headers = records[headerIndex];
    const rows = records.slice(headerIndex + 1).map(values => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    }).filter(row => Object.values(row).some(value => String(value).trim()));
    return { headers, rows };
  };

  const findScheduleHeaderRecordIndex = (records) => {
    const candidates = records.slice(0, Math.min(records.length, 12));
    let bestIndex = 0;
    let bestScore = -1;
    candidates.forEach((record, index) => {
      const normalized = record.map(normalizeScheduleKey);
      const score =
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.content) * 3 +
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.scheduled) * 3 +
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.date) * 2 +
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.time) * 2 +
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.fanpage) * 2 +
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.media) +
        scoreHeaderAliases(normalized, SCHEDULE_IMPORT_ALIASES.title);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestScore > 0 ? bestIndex : 0;
  };

  const scoreHeaderAliases = (normalizedHeaders, aliases) => {
    const normalizedAliases = aliases.map(normalizeScheduleKey);
    return normalizedHeaders.some(header =>
      normalizedAliases.some(alias => header === alias || header.includes(alias))
    ) ? 1 : 0;
  };

  const parseScheduleCsvRecords = (text, delimiter = ',') => {
    const records = [];
    let record = [];
    let current = '';
    let inQuotes = false;
    const input = String(text || '');
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char === '"') {
        if (inQuotes && input[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        record.push(current.trim());
        current = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && input[i + 1] === '\n') i++;
        record.push(current.trim());
        if (record.some(value => String(value).trim())) records.push(record);
        record = [];
        current = '';
      } else {
        current += char;
      }
    }
    record.push(current.trim());
    if (record.some(value => String(value).trim())) records.push(record);
    return records.map(row => row.map(value => value.replace(/^"|"$/g, '')));
  };

  const detectScheduleCsvDelimiter = (line) => {
    const tabCount = (line.match(/\t/g) || []).length;
    const semiCount = (line.match(/;/g) || []).length;
    const commaCount = (line.match(/,/g) || []).length;
    if (tabCount > commaCount && tabCount > semiCount) return '\t';
    if (semiCount > commaCount) return ';';
    return ',';
  };

  const parseScheduleCsvLine = (line, delimiter = ',') => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else if (char !== '\r') {
        current += char;
      }
    }
    result.push(current.trim());
    return result.map(value => value.replace(/^"|"$/g, ''));
  };

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

    const sync = () => {
      hiddenInput.value = JSON.stringify(mediaItems);
      list.innerHTML = mediaItems.length === 0 ? `
        <div class="schedule-media-empty">Chưa có media</div>
      ` : mediaItems.map((item, index) => `
        <div class="schedule-media-item">
          <div class="schedule-media-thumb">
            <img src="${Utils.escapeHtml(item.url)}" alt="${Utils.escapeHtml(item.name || 'Media')}" loading="lazy" onerror="this.parentElement.classList.add('is-broken'); this.remove();">
          </div>
          <div class="schedule-media-info">
            <div class="schedule-media-name">${Utils.escapeHtml(item.name || item.url)}</div>
            <div class="schedule-media-type">${item.url.startsWith('data:') ? 'Ảnh upload' : 'URL công khai'}</div>
          </div>
          <button type="button" class="btn btn-icon btn-ghost btn-sm remove-schedule-media-btn" data-index="${index}">
            ${Utils.icons.close}
          </button>
        </div>
      `).join('');

      list.querySelectorAll('.remove-schedule-media-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          mediaItems.splice(Number(btn.dataset.index), 1);
          sync();
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
      addMedia({ type: 'image', url, name: url.split('/').pop() || 'Ảnh URL' });
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
