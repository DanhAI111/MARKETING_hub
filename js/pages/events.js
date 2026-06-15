/* ═══════════════════════════════════════════
   MARKETING HUB - Events Page
   Manage company events & automatically link budgets
   ═══════════════════════════════════════════ */

const EventsPage = (() => {
  let container = null;
  let currentMonth = Utils.getReportingMonth();
  let activeTab = 'list'; // 'list' or 'timeline'
  let filters = { search: '', status: '', type: '' };

  // ── Render ──

  const render = (el) => {
    container = el;
    currentMonth = Utils.getReportingMonth();
    filters = { search: '', status: '', type: '' };
    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    const events = getFilteredEvents();
    const stats = calculateStats(events);

    container.innerHTML = `
      <!-- Stats Summary -->
      <div class="quick-stats" style="grid-template-columns: repeat(3, 1fr); margin-bottom: var(--space-5);">
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(59, 130, 246, 0.12); color: var(--info-400);">
            ${Utils.icons.events}
          </div>
          <div class="stat-card-label">Tổng số sự kiện</div>
          <div class="stat-card-value">${stats.totalEvents}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(245, 158, 11, 0.12); color: var(--warning-400);">
            ${Utils.icons.expenses}
          </div>
          <div class="stat-card-label">Tổng kinh phí tổ chức</div>
          <div class="stat-card-value">${Utils.formatVND(stats.totalBudget)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(16, 185, 129, 0.12); color: var(--success-400);">
            ${Utils.icons.user}
          </div>
          <div class="stat-card-label">Tổng khách tham dự dự kiến</div>
          <div class="stat-card-value">${Utils.formatNumber(stats.totalAttendees)} người</div>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
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

          <!-- Search -->
          <div class="search-input-wrapper">
            ${Utils.icons.search}
            <input type="text" class="search-input" id="eventSearch" 
                   placeholder="Tìm sự kiện..." value="${Utils.escapeHtml(filters.search)}">
          </div>

          <!-- Status Filter -->
          <select class="filter-select" id="eventStatusFilter">
            <option value="">Tất cả trạng thái</option>
            ${Object.entries(Utils.EVENT_STATUSES).map(([k, v]) => 
              `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>

          <!-- Type Filter -->
          <select class="filter-select" id="eventTypeFilter">
            <option value="">Tất cả loại hình</option>
            ${Object.entries(Utils.EVENT_TYPES).map(([k, v]) => 
              `<option value="${k}" ${filters.type === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
        
        <div class="toolbar-right">
          <button class="btn btn-primary" id="addEventBtn">
            ${Utils.icons.plus}
            <span>Thêm Sự Kiện</span>
          </button>
        </div>
      </div>

      <!-- View Tabs -->
      <div class="tabs" style="margin-bottom: var(--space-4);">
        <button class="tab-item ${activeTab === 'list' ? 'active' : ''}" id="tabListBtn">Danh sách sự kiện</button>
        <button class="tab-item ${activeTab === 'timeline' ? 'active' : ''}" id="tabTimelineBtn">Trực quan (Timeline)</button>
      </div>

      <!-- Content Area -->
      <div id="eventsContent">
        ${activeTab === 'list' ? renderTableView(events) : renderTimelineView(events)}
      </div>
    `;

    bindEvents();
  };

  // ── Helpers ──

  const getFilteredEvents = () => {
    let list = Store.events.getByMonth(currentMonth);
    
    // Sort: upcoming events first (planning, preparing, ongoing first, then completed, then cancelled)
    // and sort by date ascending for upcoming, descending for past
    const q = filters.search.toLowerCase().trim();
    if (q) {
      list = list.filter(e => 
        (e.name || '').toLowerCase().includes(q) ||
        (e.address || '').toLowerCase().includes(q) ||
        (e.plan || '').toLowerCase().includes(q)
      );
    }
    if (filters.status) {
      list = list.filter(e => e.status === filters.status);
    }
    if (filters.type) {
      list = list.filter(e => e.type === filters.type);
    }

    return list.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  };

  const calculateStats = (events) => {
    let totalBudget = 0;
    let totalAttendees = 0;
    
    events.forEach(e => {
      totalBudget += parseFloat(e.budget) || 0;
      totalAttendees += parseInt(e.attendeeCount) || 0;
    });

    return {
      totalEvents: events.length,
      totalBudget,
      totalAttendees
    };
  };

  // ── Render Views ──

  const renderTableView = (events) => {
    if (events.length === 0) {
      return renderEmptyState();
    }

    return `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Giờ</th>
              <th>Tên sự kiện</th>
              <th>Loại hình</th>
              <th>Trạng thái</th>
              <th>Ưu tiên</th>
              <th>Địa điểm</th>
              <th class="text-right">Kinh phí</th>
              <th class="text-right">Số người</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(e => {
              const statusInfo = Utils.EVENT_STATUSES[e.status] || { label: e.status, cssClass: 'tag-neutral' };
              const priorityInfo = Utils.PRIORITIES[e.priority] || { label: e.priority, cssClass: 'tag-neutral' };
              const dateStr = Utils.formatDateShort(e.date);
              const timeStr = e.startTime ? `${e.startTime}${e.endTime ? ' - ' + e.endTime : ''}` : 'Chưa set';
              
              return `
                <tr class="clickable-row" data-event-id="${e.id}">
                  <td style="white-space: nowrap; font-family: var(--font-mono);">${dateStr}</td>
                  <td style="white-space: nowrap; font-family: var(--font-mono);">${timeStr}</td>
                  <td style="font-weight: var(--weight-medium); color: var(--text-primary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${Utils.escapeHtml(e.name)}
                  </td>
                  <td>${Utils.EVENT_TYPES[e.type] || e.type || 'Khác'}</td>
                  <td><span class="tag ${statusInfo.cssClass}">${statusInfo.label}</span></td>
                  <td><span class="tag ${priorityInfo.cssClass}">${priorityInfo.label}</span></td>
                  <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${Utils.escapeHtml(e.address || '—')}
                  </td>
                  <td class="text-right font-mono" style="font-weight: var(--weight-semibold);">
                    ${Utils.formatVND(e.budget)}
                  </td>
                  <td class="text-right font-mono">${Utils.formatNumber(e.attendeeCount)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderTimelineView = (events) => {
    if (events.length === 0) {
      return renderEmptyState();
    }

    return `
      <div class="events-timeline">
        ${events.map(e => {
          const statusInfo = Utils.EVENT_STATUSES[e.status] || { label: e.status, cssClass: 'tag-neutral' };
          const priorityInfo = Utils.PRIORITIES[e.priority] || { label: e.priority, cssClass: 'tag-neutral' };
          const dateStr = Utils.formatDate(e.date);
          const timeStr = e.startTime ? `${e.startTime}${e.endTime ? ' - ' + e.endTime : ''}` : '';

          return `
            <div class="timeline-item">
              <div class="timeline-dot ${e.status}"></div>
              <div class="timeline-card" data-event-id="${e.id}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-2); flex-wrap: wrap; gap: var(--space-2);">
                  <div style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-tertiary); display: flex; align-items: center; gap: 8px;">
                    <span>📅 ${dateStr}</span>
                    ${timeStr ? `<span>⏰ ${timeStr}</span>` : ''}
                  </div>
                  <div style="display: flex; gap: var(--space-2);">
                    <span class="tag ${statusInfo.cssClass}">${statusInfo.label}</span>
                    <span class="tag ${priorityInfo.cssClass}">Ưu tiên ${priorityInfo.label}</span>
                  </div>
                </div>
                <h3 style="font-size: var(--text-md); font-weight: var(--weight-bold); color: var(--text-primary); margin-bottom: var(--space-2);">
                  ${Utils.escapeHtml(e.name)}
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-2); font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--space-2);">
                  <div>📍 Địa điểm: ${Utils.escapeHtml(e.address || 'Chưa xác định')}</div>
                  <div>💰 Kinh phí: <strong class="font-mono" style="color: var(--text-primary);">${Utils.formatVND(e.budget)}</strong></div>
                  <div>👥 Khách dự kiến: <strong class="font-mono" style="color: var(--text-primary);">${Utils.formatNumber(e.attendeeCount)} người</strong></div>
                </div>
                ${e.plan ? `
                  <div style="background: rgba(255,255,255,0.02); border-left: 3px solid var(--border-default); padding: var(--space-2) var(--space-3); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-size: var(--text-xs); color: var(--text-tertiary); max-height: 50px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                    ${Utils.escapeHtml(e.plan)}
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  };

  const renderEmptyState = () => {
    return `
      <div class="empty-state" style="padding: var(--space-8) 0;">
        <div class="empty-state-icon"></div>
        <div class="empty-state-title">Chưa có sự kiện nào</div>
        <div class="empty-state-desc">Hãy thêm sự kiện mới để bắt đầu sắp xếp lịch trình.</div>
      </div>
    `;
  };

  // ── Event Binding ──

  const bindEvents = () => {
    // Tab Switches
    container.querySelector('#tabListBtn')?.addEventListener('click', () => {
      activeTab = 'list';
      renderPage();
    });

    container.querySelector('#tabTimelineBtn')?.addEventListener('click', () => {
      activeTab = 'timeline';
      renderPage();
    });

    // Search input
    const searchEl = container.querySelector('#eventSearch');
    if (searchEl) {
      searchEl.addEventListener('input', Utils.debounce((e) => {
        filters.search = e.target.value;
        renderPage();
      }, 250));
    }

    // Status filter
    container.querySelector('#eventStatusFilter')?.addEventListener('change', (e) => {
      filters.status = e.target.value;
      renderPage();
    });

    // Type filter
    container.querySelector('#eventTypeFilter')?.addEventListener('change', (e) => {
      filters.type = e.target.value;
      renderPage();
    });

    // Add Event
    container.querySelector('#addEventBtn')?.addEventListener('click', () => {
      openEventModal();
    });

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

    // Row / Card Click to Edit
    container.querySelectorAll('.clickable-row, .timeline-card').forEach(el => {
      el.addEventListener('click', () => {
        const eventId = el.dataset.eventId;
        const event = Store.events.getById(eventId);
        if (event) openEventModal(event);
      });
    });
  };

  // ── Modals ──

  const openEventModal = (event = null) => {
    const isEdit = !!event;
    const title = isEdit ? 'Chỉnh sửa sự kiện' : 'Thêm sự kiện mới';

    const content = `
      <div class="form-group">
        <label class="form-label">Tên sự kiện <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="name" 
               value="${isEdit ? Utils.escapeHtml(event.name) : ''}" placeholder="Ví dụ: Workshop Marketing T6/2026">
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Kiểu sự kiện</label>
          <select class="form-select" data-field="type">
            ${Object.entries(Utils.EVENT_TYPES).map(([k, v]) => 
              `<option value="${k}" ${(isEdit ? event.type : 'workshop') === k ? 'selected' : ''}>${v}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ngày tổ chức <span style="color:var(--danger-400);">*</span></label>
          <input type="date" class="form-input" data-field="date" 
                 value="${isEdit ? event.date : Utils.getDefaultDateForMonth(currentMonth)}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Giờ bắt đầu</label>
          <input type="time" class="form-input" data-field="startTime" 
                 value="${isEdit ? (event.startTime || '') : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Giờ kết thúc</label>
          <input type="time" class="form-input" data-field="endTime" 
                 value="${isEdit ? (event.endTime || '') : ''}">
        </div>
      </div>

      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Trạng thái</label>
          <select class="form-select" data-field="status">
            ${Object.entries(Utils.EVENT_STATUSES).map(([k, v]) => 
              `<option value="${k}" ${(isEdit ? event.status : 'planning') === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Độ ưu tiên</label>
          <select class="form-select" data-field="priority">
            ${Object.entries(Utils.PRIORITIES).map(([k, v]) => 
              `<option value="${k}" ${(isEdit ? event.priority : 'medium') === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Kinh phí (VNĐ)</label>
          <input type="number" class="form-input" data-field="budget" 
                 value="${isEdit ? (event.budget || 0) : 0}" min="0" placeholder="Kinh phí dự kiến">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Số khách dự kiến</label>
          <input type="number" class="form-input" data-field="attendeeCount" 
                 value="${isEdit ? (event.attendeeCount || 0) : 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Địa chỉ tổ chức</label>
          <input type="text" class="form-input" data-field="address" 
                 value="${isEdit ? Utils.escapeHtml(event.address || '') : ''}" placeholder="Số nhà, đường, quận, thành phố...">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Kế hoạch chi tiết</label>
        <textarea class="form-textarea" data-field="plan" style="height: 80px;" placeholder="Outline chương trình...">${isEdit ? Utils.escapeHtml(event.plan || '') : ''}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Danh sách khách mời (mỗi khách một dòng)</label>
        <textarea class="form-textarea" data-field="guestList" style="height: 80px;" placeholder="Họ tên - Số điện thoại - Đơn vị...">${isEdit ? Utils.escapeHtml(event.guestList || '') : ''}</textarea>
      </div>

      ${isEdit ? `
        <div style="text-align: left; margin-top: var(--space-2);">
          <button class="btn btn-danger btn-sm" id="deleteEventBtn">
            ${Utils.icons.trash}
            <span>Xóa sự kiện</span>
          </button>
        </div>
      ` : ''}
    `;

    Modal.open({
      title,
      content,
      size: 'lg',
      saveLabel: isEdit ? 'Cập nhật' : 'Tạo mới',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.name || !formData.name.trim()) {
          Toast.error('Vui lòng nhập tên sự kiện');
          return;
        }
        if (!formData.date) {
          Toast.error('Vui lòng chọn ngày tổ chức');
          return;
        }

        const budgetNum = parseFloat(formData.budget) || 0;
        const attendeeNum = parseInt(formData.attendeeCount) || 0;

        const eventData = {
          name: formData.name.trim(),
          type: formData.type,
          date: formData.date,
          startTime: formData.startTime,
          endTime: formData.endTime,
          status: formData.status,
          priority: formData.priority,
          address: formData.address.trim(),
          budget: budgetNum,
          attendeeCount: attendeeNum,
          plan: formData.plan.trim(),
          guestList: formData.guestList.trim()
        };

        if (isEdit) {
          Store.events.update(event.id, eventData);
          syncEventExpense(event.id, eventData);
          Toast.success('Đã cập nhật sự kiện');
        } else {
          const newEvent = Store.events.create(eventData);
          if (budgetNum > 0) {
            syncEventExpense(newEvent.id, eventData);
          }
          Toast.success('Đã thêm sự kiện mới');
        }

        Modal.close();
        renderPage();
      }
    });

    // Delete confirmation
    if (isEdit) {
      setTimeout(() => {
        document.getElementById('deleteEventBtn')?.addEventListener('click', () => {
          Modal.close();
          Modal.confirm({
            title: 'Xóa sự kiện',
            message: `Bạn có chắc chắn muốn xóa sự kiện "${Utils.escapeHtml(event.name)}"? Điều này cũng sẽ tự động xóa khoản chi phí liên quan.`,
            icon: '🗑️',
            onConfirm: () => {
              // Remove expense linked
              const expenses = Store.expenses.getAll();
              const linkedExpense = expenses.find(exp => exp.eventId === event.id);
              if (linkedExpense) {
                Store.expenses.remove(linkedExpense.id);
              }

              Store.events.remove(event.id);
              Toast.success('Đã xóa sự kiện thành công');
              renderPage();
            }
          });
        });
      }, 50);
    }
  };

  // ── Sync Event Budget to Expense module ──
  const syncEventExpense = (eventId, eventData) => {
    const expenses = Store.expenses.getAll();
    const linkedExpense = expenses.find(exp => exp.eventId === eventId);
    
    const budgetVal = parseFloat(eventData.budget) || 0;
    
    if (linkedExpense) {
      if (budgetVal > 0) {
        // Update linked expense
        Store.expenses.update(linkedExpense.id, {
          date: eventData.date,
          description: `Kinh phí sự kiện: ${eventData.name}`,
          amount: budgetVal,
          notes: `Được cập nhật tự động từ module Sự kiện`
        });
      } else {
        // If budget is updated to 0, delete the linked expense
        Store.expenses.remove(linkedExpense.id);
      }
    } else if (budgetVal > 0) {
      // Create new linked expense
      Store.expenses.create({
        date: eventData.date,
        category: 'event',
        description: `Kinh phí sự kiện: ${eventData.name}`,
        amount: budgetVal,
        notes: `Được tạo tự động từ module Sự kiện`,
        eventId: eventId
      });
    }
  };

  return { render };
})();

App.registerPage('events', EventsPage);
