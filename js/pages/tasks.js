/* ═══════════════════════════════════════════
   MARKETING HUB - Tasks (Kanban Board) Page
   Drag & Drop task management
   ═══════════════════════════════════════════ */

const TasksPage = (() => {
  let container = null;
  let filters = { search: '', priority: '', assignee: '' };

  // ── Column definitions ──
  const COLUMNS = [
    { status: 'pending',     label: 'Chờ xử lý',  dotClass: 'pending' },
    { status: 'in-progress', label: 'Đang làm',    dotClass: 'in-progress' },
    { status: 'review',      label: 'Chờ duyệt',   dotClass: 'review' },
    { status: 'completed',   label: 'Hoàn thành',   dotClass: 'completed' }
  ];

  // ── Helpers ──

  const getFilteredTasks = () => {
    let tasks = Store.tasks.getAll();
    const q = filters.search.toLowerCase().trim();
    if (q) {
      tasks = tasks.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.partner || '').toLowerCase().includes(q) ||
        (t.assignee || '').toLowerCase().includes(q)
      );
    }
    if (filters.priority) {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }
    if (filters.assignee) {
      tasks = tasks.filter(t => t.assignee === filters.assignee);
    }
    return tasks;
  };

  const getUniqueAssignees = () => {
    const all = Store.tasks.getAll();
    const set = new Set(all.map(t => t.assignee).filter(Boolean));
    Store.employees.getAll().forEach(emp => {
      if (emp.name) set.add(emp.name);
    });
    return [...set].sort();
  };

  const isOverdue = (task) => {
    return task.deadline && task.status !== 'completed' && Utils.isPast(task.deadline);
  };

  const isEventOverdue = (event) => {
    return event.date
      && !['completed', 'cancelled'].includes(event.status)
      && Utils.isPast(event.date);
  };

  const getTaskTimelineState = (task) => {
    if (task.status === 'completed') return 'completed';
    if (isOverdue(task)) return 'overdue';
    if (task.status === 'in-progress' || task.status === 'review') return 'active';
    return 'upcoming';
  };

  const getEventTimelineState = (event) => {
    if (event.status === 'completed') return 'completed';
    if (event.status === 'cancelled') return 'cancelled';
    if (isEventOverdue(event)) return 'overdue';
    if (event.status === 'ongoing' || event.status === 'preparing') return 'active';
    return 'upcoming';
  };

  const getTimelineIcon = (type, state) => {
    if (state === 'completed') return Utils.icons.check;
    if (state === 'overdue') return Utils.icons.warning;
    if (type === 'event') return Utils.icons.events;
    if (state === 'active') return Utils.icons.clock;
    return Utils.icons.calendar;
  };

  const renderTaskTimeline = (tasks) => {
    const events = Store.events.getAll();
    const taskItems = tasks
      .filter(task => task.deadline)
      .map(task => {
        const state = getTaskTimelineState(task);
        const statusInfo = Utils.TASK_STATUSES[task.status] || Utils.TASK_STATUSES.pending;
        const priorityInfo = Utils.PRIORITIES[task.priority] || Utils.PRIORITIES.medium;
        const daysLeft = Utils.daysUntil(task.deadline);
        const timeLabel = task.status === 'completed'
          ? 'Đã hoàn thành'
          : daysLeft < 0
            ? `Quá ${Math.abs(daysLeft)} ngày`
            : daysLeft === 0
              ? 'Hôm nay'
              : daysLeft === 1
                ? 'Còn 1 ngày'
                : `Còn ${daysLeft} ngày`;

        return {
          type: 'task',
          id: task.id,
          date: task.deadline,
          title: task.title,
          state,
          meta: `${statusInfo.label}${task.assignee ? ` · ${task.assignee}` : ''}`,
          statusLabel: timeLabel,
          statusClass: priorityInfo.cssClass
        };
      });
    const eventItems = events
      .filter(event => event.date)
      .map(event => {
        const state = getEventTimelineState(event);
        const statusInfo = Utils.EVENT_STATUSES[event.status] || { label: event.status || 'Sự kiện', cssClass: 'tag-neutral' };
        const timeStr = event.startTime ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}` : '';
        const eventType = Utils.EVENT_TYPES[event.type] || 'Sự kiện';
        const daysLeft = Utils.daysUntil(event.date);
        const timeLabel = event.status === 'completed'
          ? 'Đã hoàn thành'
          : event.status === 'cancelled'
            ? 'Đã hủy'
            : daysLeft < 0
              ? `Quá ${Math.abs(daysLeft)} ngày`
              : daysLeft === 0
                ? 'Hôm nay'
                : daysLeft === 1
                  ? 'Còn 1 ngày'
                  : `Còn ${daysLeft} ngày`;

        return {
          type: 'event',
          id: event.id,
          date: event.date,
          title: event.name,
          state,
          meta: `${eventType}${timeStr ? ` · ${timeStr}` : ''}`,
          statusLabel: timeLabel,
          statusClass: statusInfo.cssClass
        };
      });
    const timelineItems = [...taskItems, ...eventItems].sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate) return byDate;
      if (a.type !== b.type) return a.type === 'event' ? -1 : 1;
      return (a.title || '').localeCompare(b.title || '');
    });
    const completedCount = timelineItems.filter(item => item.state === 'completed').length;
    const overdueCount = timelineItems.filter(item => item.state === 'overdue').length;
    const totalCount = timelineItems.length;
    const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
    const openItems = timelineItems.filter(item => !['completed', 'cancelled'].includes(item.state));
    const lastOpenItem = openItems[openItems.length - 1];
    const footerText = (() => {
      if (overdueCount > 0) return `${overdueCount} mốc quá hạn cần xử lý`;
      if (lastOpenItem) {
        const daysLeft = Utils.daysUntil(lastOpenItem.date);
        if (daysLeft === 0) return `Mốc cuối đến hạn hôm nay (${Utils.formatDate(lastOpenItem.date)})`;
        if (daysLeft === 1) return `Còn 1 ngày đến mốc cuối (${Utils.formatDate(lastOpenItem.date)})`;
        return `Còn ${daysLeft} ngày đến mốc cuối (${Utils.formatDate(lastOpenItem.date)})`;
      }
      if (timelineItems.length > 0) return 'Tất cả mốc thời gian đã hoàn thành';
      return 'Thêm hạn chót công việc hoặc sự kiện để hiển thị timeline';
    })();

    return `
      <section class="task-timeline-card" aria-label="Timeline tổng hợp">
        <div class="task-timeline-header">
          <div class="task-timeline-heading">
            <h2>Timeline tổng hợp</h2>
            <p>Theo dõi trực quan deadline công việc và lịch sự kiện trên cùng một trục thời gian.</p>
          </div>
          <div class="task-timeline-summary">
            <span class="task-timeline-pill success">${completedCount}/${totalCount} mốc hoàn thành</span>
            <span class="task-timeline-pill danger">${overdueCount} quá hạn</span>
            <span class="task-timeline-pill info">${tasks.length} công việc · ${events.length} sự kiện</span>
          </div>
        </div>
        ${timelineItems.length > 0 ? `
          <div class="task-timeline-scroll">
            <div class="task-timeline-track" style="--task-timeline-progress:${progress}%;">
              <div class="task-timeline-line" aria-hidden="true"><span></span></div>
              ${timelineItems.map(item => `
                  <button type="button"
                          class="task-timeline-node ${item.type} ${item.state}"
                          ${item.type === 'task' ? `data-timeline-task-id="${item.id}"` : `data-timeline-event-id="${item.id}"`}
                          title="${Utils.escapeHtml(item.title)}">
                    <span class="task-timeline-date">${Utils.formatDateShort(item.date)}</span>
                    <span class="task-timeline-dot">${getTimelineIcon(item.type, item.state)}</span>
                    <span class="task-timeline-kind">${item.type === 'task' ? 'Công việc' : 'Sự kiện'}</span>
                    <span class="task-timeline-title">${Utils.escapeHtml(item.title)}</span>
                    <span class="task-timeline-meta">${Utils.escapeHtml(item.meta)}</span>
                    <span class="task-timeline-status ${item.statusClass}">${item.statusLabel}</span>
                  </button>
                `).join('')}
            </div>
          </div>
        ` : `
          <div class="task-timeline-empty">
            ${Utils.icon('calendar', 'icon-sm')}
            <span>Chưa có công việc hoặc sự kiện nào có mốc thời gian.</span>
          </div>
        `}
        <div class="task-timeline-footer">
          ${Utils.icon('clock', 'icon-sm')}
          <span>${footerText}</span>
        </div>
      </section>
    `;
  };

  // ── Render ──

  const render = (el) => {
    container = el;
    filters = { search: '', priority: '', assignee: '' };
    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    const allTasks = getFilteredTasks();
    const assignees = getUniqueAssignees();

    container.innerHTML = `
      ${renderTaskTimeline(allTasks)}

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-input-wrapper">
            ${Utils.icons.search}
            <input type="text" class="search-input" id="taskSearch"
                   placeholder="Tìm công việc..." value="${Utils.escapeHtml(filters.search)}">
          </div>
          <select class="filter-select" id="taskPriorityFilter">
            <option value="">Tất cả ưu tiên</option>
            ${Object.entries(Utils.PRIORITIES).map(([k, v]) =>
              `<option value="${k}" ${filters.priority === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
          <select class="filter-select" id="taskAssigneeFilter">
            <option value="">Tất cả người</option>
            ${assignees.map(a =>
              `<option value="${Utils.escapeHtml(a)}" ${filters.assignee === a ? 'selected' : ''}>${Utils.escapeHtml(a)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-primary" id="addTaskBtn">
            ${Utils.icons.plus}
            <span>Thêm công việc</span>
          </button>
        </div>
      </div>

      <!-- Kanban Board -->
      <div class="kanban-board" id="kanbanBoard">
        ${COLUMNS.map(col => {
          const colTasks = allTasks.filter(t => t.status === col.status);
          return `
            <div class="kanban-column" data-status="${col.status}">
              <div class="kanban-column-header">
                <div class="kanban-column-title">
                  <span class="kanban-column-dot ${col.dotClass}"></span>
                  <span>${col.label}</span>
                </div>
                <span class="kanban-column-count">${colTasks.length}</span>
              </div>
              <div class="kanban-column-body" data-status="${col.status}">
                ${colTasks.map(task => renderCard(task)).join('')}
                <button class="kanban-add-btn" data-add-status="${col.status}">
                  ${Utils.icons.plus}
                  <span>Thêm</span>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindEvents();
  };

  const renderCard = (task) => {
    const overdue = isOverdue(task);
    const priorityInfo = Utils.PRIORITIES[task.priority] || Utils.PRIORITIES.medium;
    const deadlineLabel = task.deadline ? Utils.formatDateShort(task.deadline) : '';
    const daysLeft = task.deadline ? Utils.daysUntil(task.deadline) : null;
    let deadlineExtra = '';
    if (daysLeft !== null && task.status !== 'completed') {
      if (daysLeft < 0) deadlineExtra = ` (quá ${Math.abs(daysLeft)} ngày)`;
      else if (daysLeft === 0) deadlineExtra = ' (hôm nay)';
      else if (daysLeft === 1) deadlineExtra = ' (mai)';
    }

    return `
      <div class="kanban-card ${overdue ? 'kanban-card-overdue' : ''}"
           draggable="true"
           data-task-id="${task.id}"
           style="${overdue ? 'border-color: var(--danger-500); box-shadow: 0 0 0 1px rgba(239,68,68,0.2);' : ''}">
        <div class="kanban-card-title">${Utils.escapeHtml(task.title)}</div>
        ${task.partner ? `<div class="kanban-card-partner">${Utils.escapeHtml(task.partner)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2);">
          <span class="tag ${priorityInfo.cssClass}">${priorityInfo.label}</span>
        </div>
        <div class="kanban-card-footer">
          ${task.assignee
            ? `<span class="kanban-card-assignee">${Utils.icon('user', '')} ${Utils.escapeHtml(task.assignee)}</span>`
            : '<span></span>'
          }
          ${deadlineLabel
            ? `<span class="kanban-card-deadline ${overdue ? 'overdue' : ''}">${deadlineLabel}${deadlineExtra}</span>`
            : ''
          }
        </div>
      </div>
    `;
  };

  // ── Events ──

  const bindEvents = () => {
    // Search
    const searchEl = container.querySelector('#taskSearch');
    if (searchEl) {
      searchEl.addEventListener('input', Utils.debounce((e) => {
        filters.search = e.target.value;
        renderPage();
      }, 250));
    }

    // Priority filter
    container.querySelector('#taskPriorityFilter')?.addEventListener('change', (e) => {
      filters.priority = e.target.value;
      renderPage();
    });

    // Assignee filter
    container.querySelector('#taskAssigneeFilter')?.addEventListener('change', (e) => {
      filters.assignee = e.target.value;
      renderPage();
    });

    // Add task button (toolbar)
    container.querySelector('#addTaskBtn')?.addEventListener('click', () => {
      openTaskModal();
    });

    // Add buttons inside columns
    container.querySelectorAll('[data-add-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        openTaskModal(null, btn.dataset.addStatus);
      });
    });

    // Click card to edit
    container.querySelectorAll('.kanban-card, .task-timeline-node').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.kanban-add-btn')) return;
        const eventId = item.dataset.timelineEventId;
        if (eventId) {
          const event = Store.events.getById(eventId);
          if (event?.date) Utils.setReportingMonth(event.date.slice(0, 7));
          App.navigate('events');
          if (typeof EventsPage !== 'undefined' && EventsPage.openEventById) {
            EventsPage.openEventById(eventId);
          }
          return;
        }
        const taskId = item.dataset.taskId || item.dataset.timelineTaskId;
        const task = Store.tasks.getById(taskId);
        if (task) openTaskModal(task);
      });
    });

    // ── Drag and Drop ──
    setupDragDrop();
  };

  const setupDragDrop = () => {
    const cards = container.querySelectorAll('.kanban-card[draggable="true"]');
    const bodies = container.querySelectorAll('.kanban-column-body');

    let draggedId = null;

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedId = card.dataset.taskId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedId);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        draggedId = null;
        bodies.forEach(b => b.classList.remove('drag-over'));
      });
    });

    bodies.forEach(body => {
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        body.classList.add('drag-over');
      });

      body.addEventListener('dragleave', (e) => {
        // Only remove if truly leaving the body
        if (!body.contains(e.relatedTarget)) {
          body.classList.remove('drag-over');
        }
      });

      body.addEventListener('drop', (e) => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const newStatus = body.dataset.status;
        if (!taskId || !newStatus) return;

        const task = Store.tasks.getById(taskId);
        if (task && task.status !== newStatus) {
          Store.tasks.update(taskId, { status: newStatus });
          const statusLabel = Utils.TASK_STATUSES[newStatus]?.label || newStatus;
          Toast.success(`Đã chuyển sang "${statusLabel}"`);
          renderPage();
          Sidebar.updateBadge?.();
        }
      });
    });
  };

  // ── Modal ──

  const openTaskModal = (task = null, presetStatus = '') => {
    const isEdit = !!task;
    const title = isEdit ? 'Chỉnh sửa công việc' : 'Thêm công việc mới';
    const employees = Store.employees.getAll();
    const currentAssignee = isEdit ? (task.assignee || '') : '';
    const hasCurrentAssignee = currentAssignee
      && !employees.some(emp => emp.name === currentAssignee);
    const findEmployeeByName = (name) => employees.find(emp => emp.name === name) || null;

    const content = `
      <div class="form-group">
        <label class="form-label">Tiêu đề <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="title"
               value="${isEdit ? Utils.escapeHtml(task.title) : ''}" placeholder="Nhập tiêu đề công việc">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Đối tác</label>
          <input type="text" class="form-input" data-field="partner"
                 value="${isEdit ? Utils.escapeHtml(task.partner || '') : ''}" placeholder="Tên đối tác">
        </div>
        <div class="form-group">
          <label class="form-label">Người thực hiện</label>
          <select class="form-select" data-field="assignee">
            <option value="">Chưa phân công</option>
            ${hasCurrentAssignee ? `
              <option value="${Utils.escapeHtml(currentAssignee)}" selected>${Utils.escapeHtml(currentAssignee)} hiện tại${task.assigneeEmail ? ` · ${Utils.escapeHtml(task.assigneeEmail)}` : ''}</option>
            ` : ''}
            ${employees.map(emp => `
              <option value="${Utils.escapeHtml(emp.name)}" ${currentAssignee === emp.name ? 'selected' : ''}>
                ${Utils.escapeHtml(emp.avatar || '👤')} ${Utils.escapeHtml(emp.name)}${emp.role ? ` — ${Utils.escapeHtml(emp.role)}` : ''}${emp.email ? ` · ${Utils.escapeHtml(emp.email)}` : ''}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Ưu tiên</label>
          <select class="form-select" data-field="priority">
            ${Object.entries(Utils.PRIORITIES).map(([k, v]) =>
              `<option value="${k}" ${(isEdit ? task.priority : 'medium') === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Hạn chót</label>
          <input type="date" class="form-input" data-field="deadline"
                 value="${isEdit ? (task.deadline || '') : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Trạng thái</label>
          <select class="form-select" data-field="status">
            ${Object.entries(Utils.TASK_STATUSES).map(([k, v]) =>
              `<option value="${k}" ${(isEdit ? task.status : (presetStatus || 'pending')) === k ? 'selected' : ''}>${v.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Ghi chú</label>
        <textarea class="form-textarea" data-field="notes" placeholder="Ghi chú thêm...">${isEdit ? Utils.escapeHtml(task.notes || '') : ''}</textarea>
      </div>
      ${isEdit ? `
        <div style="text-align:left;margin-top:var(--space-2);">
          <button class="btn btn-danger btn-sm" id="deleteTaskBtn">
            ${Utils.icons.trash}
            <span>Xóa công việc</span>
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
        const data = Modal.getFormData();
        const selectedEmployee = findEmployeeByName(data.assignee);
        data.assigneeEmail = selectedEmployee?.email || (data.assignee === currentAssignee ? (task?.assigneeEmail || '') : '');
        if (!data.title || !data.title.trim()) {
          Toast.error('Vui lòng nhập tiêu đề công việc');
          return;
        }
        if (isEdit) {
          Store.tasks.update(task.id, data);
          Toast.success('Đã cập nhật công việc');
        } else {
          Store.tasks.create(data);
          Toast.success('Đã thêm công việc mới');
        }
        Modal.close();
        renderPage();
        Sidebar.updateBadge?.();
      }
    });

    // Delete button
    if (isEdit) {
      setTimeout(() => {
        document.getElementById('deleteTaskBtn')?.addEventListener('click', () => {
          Modal.close();
          Modal.confirm({
            title: 'Xóa công việc',
            message: `Bạn có chắc muốn xóa công việc "${Utils.escapeHtml(task.title)}"?`,
            icon: '🗑️',
            onConfirm: () => {
              Store.tasks.remove(task.id);
              Toast.success('Đã xóa công việc');
              renderPage();
              Sidebar.updateBadge?.();
            }
          });
        });
      }, 50);
    }
  };

  return { render };
})();

App.registerPage('tasks', TasksPage);
