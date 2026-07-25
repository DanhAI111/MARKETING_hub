/* ═══════════════════════════════════════════
   MARKETING HUB - Campaigns Page
   Group posts + ads + events + expenses under one goal & budget
   ═══════════════════════════════════════════ */

const CampaignsPage = (() => {
  let container = null;
  let filters = { search: '', status: '' };

  const render = (el) => {
    container = el;
    filters = { search: '', status: '' };
    renderPage();
  };

  const getFiltered = () => {
    let list = Store.campaigns.getAll();
    const q = filters.search.toLowerCase().trim();
    if (q) list = list.filter(c => (c.name || '').toLowerCase().includes(q) || (c.goal || '').toLowerCase().includes(q));
    if (filters.status) list = list.filter(c => c.status === filters.status);
    return list.sort((a, b) => (b.startAt || '').localeCompare(a.startAt || ''));
  };

  const renderPage = () => {
    if (!container) return;
    const campaigns = getFiltered();
    const totals = campaigns.reduce((acc, c) => {
      const s = Store.campaigns.getStats(c.id);
      acc.spend += s.totalSpend;
      acc.revenue += s.revenue;
      return acc;
    }, { spend: 0, revenue: 0 });

    container.innerHTML = `
      <div class="quick-stats campaign-quick-stats" style="margin-bottom: var(--space-5);">
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(139, 92, 246, 0.12); color: #a78bfa;">
            ${Utils.icons.megaphone}
          </div>
          <div class="stat-card-label">Chiến dịch đang chạy</div>
          <div class="stat-card-value">${campaigns.filter(c => c.status === 'active').length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(245, 158, 11, 0.12); color: var(--warning-400);">
            ${Utils.icons.expenses}
          </div>
          <div class="stat-card-label">Tổng chi phí</div>
          <div class="stat-card-value">${Utils.formatVND(totals.spend)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(16, 185, 129, 0.12); color: var(--success-400);">
            ${Utils.icons.target}
          </div>
          <div class="stat-card-label">Tổng doanh thu (ước tính)</div>
          <div class="stat-card-value">${Utils.formatVND(totals.revenue)}</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-input-wrapper">
            ${Utils.icons.search}
            <input type="text" class="search-input" id="campaignSearch"
                   placeholder="Tìm chiến dịch..." value="${Utils.escapeHtml(filters.search)}">
          </div>
          <select class="filter-select" id="campaignStatusFilter">
            <option value="">Tất cả trạng thái</option>
            ${Object.entries(Utils.CAMPAIGN_STATUSES).map(([k, v]) =>
              `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-primary" id="addCampaignBtn">
            ${Utils.icons.plus}
            <span>Thêm Chiến Dịch</span>
          </button>
        </div>
      </div>

      <div id="campaignsContent">
        ${campaigns.length ? renderCards(campaigns) : renderEmptyState()}
      </div>
    `;

    bindEvents();
  };

  const renderCards = (campaigns) => `
    <div class="campaign-grid">
      ${campaigns.map(c => {
        const stats = Store.campaigns.getStats(c.id);
        const statusInfo = Utils.CAMPAIGN_STATUSES[c.status] || { label: c.status, cssClass: 'tag-neutral' };
        const budget = parseFloat(c.budget) || 0;
        const pct = budget > 0 ? Math.min(100, Math.round((stats.totalSpend / budget) * 100)) : 0;
        const overBudget = budget > 0 && stats.totalSpend > budget;
        return `
          <div class="campaign-card card clickable-row" data-campaign-id="${Utils.escapeHtml(c.id)}" tabindex="0" role="button"
               style="padding:var(--space-4);cursor:pointer;display:grid;gap:var(--space-3);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-2);">
              <h3 style="font-size:var(--text-md);font-weight:var(--weight-bold);color:var(--text-primary);margin:0;">
                ${Utils.escapeHtml(c.name)}
              </h3>
              <span class="tag ${statusInfo.cssClass}">${Utils.escapeHtml(statusInfo.label)}</span>
            </div>
            ${c.goal ? `<p style="font-size:var(--text-sm);color:var(--text-secondary);margin:0;">${Utils.escapeHtml(c.goal)}</p>` : ''}
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);font-family:var(--font-mono);">
              ${c.startAt ? Utils.formatDateShort(c.startAt) : '—'} → ${c.endAt ? Utils.formatDateShort(c.endAt) : '—'}
            </div>
            <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;font-size:var(--text-xs);color:var(--text-secondary);">
              <span>📝 ${stats.postCount} bài</span>
              <span>📣 ${stats.adCount} ads</span>
              <span>🎪 ${stats.eventCount} sự kiện</span>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;font-size:var(--text-xs);margin-bottom:4px;">
                <span style="color:var(--text-tertiary);">Ngân sách</span>
                <span class="font-mono" style="color:${overBudget ? 'var(--danger-400)' : 'var(--text-secondary)'};">
                  ${Utils.formatVND(stats.totalSpend)} / ${Utils.formatVND(budget)}
                </span>
              </div>
              <div style="height:6px;background:var(--bg-tertiary);border-radius:999px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${overBudget ? 'var(--danger-400)' : 'var(--success-400)'};"></div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:var(--text-xs);color:var(--text-tertiary);">
              <span>ROAS: <strong class="font-mono" style="color:var(--text-primary);">${stats.roas.toFixed(2)}x</strong></span>
              <span>DT: <strong class="font-mono" style="color:var(--text-primary);">${Utils.formatVND(stats.revenue)}</strong></span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const renderEmptyState = () => `
    <div class="empty-state" style="padding: var(--space-8) 0;">
      <div class="empty-state-icon"></div>
      <div class="empty-state-title">Chưa có chiến dịch nào</div>
      <div class="empty-state-desc">Tạo chiến dịch để gom bài đăng, quảng cáo, sự kiện và chi phí theo một mục tiêu.</div>
    </div>
  `;

  const bindEvents = () => {
    const searchEl = container.querySelector('#campaignSearch');
    searchEl?.addEventListener('input', Utils.debounce((e) => {
      filters.search = e.target.value;
      renderPage();
    }, 250));

    container.querySelector('#campaignStatusFilter')?.addEventListener('change', (e) => {
      filters.status = e.target.value;
      renderPage();
    });

    container.querySelector('#addCampaignBtn')?.addEventListener('click', () => openCampaignModal());

    container.querySelectorAll('[data-campaign-id]').forEach(el => {
      Utils.onActivate(el, () => {
        const c = Store.campaigns.getById(el.dataset.campaignId);
        if (c) openDetailModal(c);
      });
    });
  };

  // ── Add / Edit modal ──

  const openCampaignModal = (campaign = null) => {
    const isEdit = !!campaign;
    const fanpages = Store.fanpages.getAll();
    const selected = new Set(isEdit ? (campaign.fanpageIds || []) : []);

    const content = `
      <div class="form-group">
        <label class="form-label">Tên chiến dịch <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="name"
               value="${isEdit ? Utils.escapeHtml(campaign.name) : ''}" placeholder="Ví dụ: Campaign hè 2026">
      </div>
      <div class="form-group">
        <label class="form-label">Mục tiêu</label>
        <input type="text" class="form-input" data-field="goal"
               value="${isEdit ? Utils.escapeHtml(campaign.goal || '') : ''}" placeholder="Tăng nhận diện, ra mắt sản phẩm...">
      </div>
      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Trạng thái</label>
          <select class="form-select" data-field="status">
            ${Object.entries(Utils.CAMPAIGN_STATUSES).map(([k, v]) =>
              `<option value="${k}" ${(isEdit ? campaign.status : 'active') === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ngày bắt đầu</label>
          <input type="date" class="form-input" data-field="startAt" value="${isEdit ? (campaign.startAt || '') : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Ngày kết thúc</label>
          <input type="date" class="form-input" data-field="endAt" value="${isEdit ? (campaign.endAt || '') : ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Ngân sách dự kiến (VNĐ)</label>
        <input type="number" class="form-input" data-field="budget" min="0"
               value="${isEdit ? (campaign.budget || 0) : 0}" placeholder="Ngân sách toàn chiến dịch">
      </div>
      <div class="form-group">
        <label class="form-label">Fanpage tham gia</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-2);max-height:160px;overflow:auto;">
          ${fanpages.length ? fanpages.map(fp => `
            <label style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;">
              <input type="checkbox" class="campaign-fanpage-cb" value="${Utils.escapeHtml(fp.id)}" ${selected.has(fp.id) ? 'checked' : ''}>
              <span>${Utils.getPlatformInfo(fp.platform).icon} ${Utils.escapeHtml(fp.name)}</span>
            </label>
          `).join('') : '<span style="font-size:var(--text-sm);color:var(--text-tertiary);">Chưa có fanpage nào.</span>'}
        </div>
      </div>
      ${isEdit ? `
        <div style="text-align:left;margin-top:var(--space-2);">
          <button class="btn btn-danger btn-sm" id="deleteCampaignBtn">
            ${Utils.icons.trash}<span>Xóa chiến dịch</span>
          </button>
        </div>` : ''}
    `;

    Modal.open({
      title: isEdit ? 'Chỉnh sửa chiến dịch' : 'Thêm chiến dịch mới',
      content,
      size: 'lg',
      saveLabel: isEdit ? 'Cập nhật' : 'Tạo mới',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.name || !formData.name.trim()) {
          Toast.error('Vui lòng nhập tên chiến dịch');
          return;
        }
        if (formData.startAt && formData.endAt && formData.endAt < formData.startAt) {
          Toast.error('Ngày kết thúc phải sau ngày bắt đầu');
          return;
        }
        const fanpageIds = Array.from(document.querySelectorAll('.campaign-fanpage-cb:checked')).map(cb => cb.value);
        const data = {
          name: formData.name.trim(),
          goal: (formData.goal || '').trim(),
          status: formData.status,
          startAt: formData.startAt || '',
          endAt: formData.endAt || '',
          budget: parseFloat(formData.budget) || 0,
          fanpageIds
        };
        if (isEdit) {
          Store.campaigns.update(campaign.id, data);
          Toast.success('Đã cập nhật chiến dịch');
        } else {
          Store.campaigns.create(data);
          Toast.success('Đã thêm chiến dịch mới');
        }
        Modal.close();
        renderPage();
      }
    });

    if (isEdit) {
      setTimeout(() => {
        document.getElementById('deleteCampaignBtn')?.addEventListener('click', () => {
          Modal.close();
          Modal.confirm({
            title: 'Xóa chiến dịch',
            message: `Xóa chiến dịch "${Utils.escapeHtml(campaign.name)}"? Bài đăng, quảng cáo, sự kiện và chi phí liên kết sẽ được gỡ khỏi chiến dịch nhưng không bị xóa.`,
            icon: '🗑️',
            onConfirm: () => {
              Store.campaigns.remove(campaign.id);
              Toast.success('Đã xóa chiến dịch');
              renderPage();
            }
          });
        });
      }, 50);
    }
  };

  // ── Detail modal (read-only aggregation) ──

  const openDetailModal = (campaign) => {
    const stats = Store.campaigns.getStats(campaign.id);
    const budget = parseFloat(campaign.budget) || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((stats.totalSpend / budget) * 100)) : 0;
    const overBudget = budget > 0 && stats.totalSpend > budget;
    const fanpages = (campaign.fanpageIds || [])
      .map(id => Store.fanpages.getById(id)).filter(Boolean);

    const metric = (label, value) => `
      <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:var(--space-3);">
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${label}</div>
        <div style="font-size:var(--text-md);font-weight:var(--weight-bold);color:var(--text-primary);font-family:var(--font-mono);">${value}</div>
      </div>
    `;

    const content = `
      <div style="display:grid;gap:var(--space-4);">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--space-2);">
          ${metric('Bài đăng', `${stats.publishedCount}/${stats.postCount}`)}
          ${metric('Quảng cáo', stats.adCount)}
          ${metric('Sự kiện', stats.eventCount)}
          ${metric('Chi phí khác', stats.expenseCount)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:var(--space-2);">
          ${metric('Chi ads', Utils.formatVND(stats.adSpend))}
          ${metric('Chi phí + sự kiện', Utils.formatVND(stats.otherSpend + stats.eventBudget))}
          ${metric('Doanh thu', Utils.formatVND(stats.revenue))}
          ${metric('ROAS', `${stats.roas.toFixed(2)}x`)}
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:var(--text-sm);margin-bottom:4px;">
            <span style="color:var(--text-secondary);">Tiến độ ngân sách</span>
            <span class="font-mono" style="color:${overBudget ? 'var(--danger-400)' : 'var(--text-secondary)'};">
              ${Utils.formatVND(stats.totalSpend)} / ${Utils.formatVND(budget)} (${pct}%)
            </span>
          </div>
          <div style="height:10px;background:var(--bg-tertiary);border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${overBudget ? 'var(--danger-400)' : 'var(--success-400)'};"></div>
          </div>
        </div>
        ${fanpages.length ? `
          <div>
            <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:6px;">Fanpage tham gia</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${fanpages.map(fp => `<span class="tag tag-neutral">${Utils.getPlatformInfo(fp.platform).icon} ${Utils.escapeHtml(fp.name)}</span>`).join('')}
            </div>
          </div>` : ''}
      </div>
    `;

    Modal.open({
      title: campaign.name,
      content,
      size: 'lg',
      saveLabel: 'Chỉnh sửa',
      onSave: () => {
        Modal.close();
        openCampaignModal(campaign);
      }
    });
  };

  return { render };
})();

App.registerPage('campaigns', CampaignsPage);
