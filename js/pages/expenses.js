/* ═══════════════════════════════════════════
   MARKETING HUB - Expenses Page
   Expense tracking and month-to-month analysis
   ═══════════════════════════════════════════ */

const ExpensesPage = (() => {
  let container = null;
  let currentMonth = Utils.getReportingMonth();
  let selectedCategory = '';
  let activeTab = 'expenses'; // 'expenses' | 'recurring'

  // ── Image Compression ──

  const compressImage = (file, maxSizeKB = 500) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Scale down if needed
          const maxDim = 1200;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Try decreasing quality until under maxSizeKB
          let quality = 0.8;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          while (dataUrl.length > maxSizeKB * 1024 * 1.37 && quality > 0.1) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ── Render ──

  const render = (el) => {
    container = el;
    currentMonth = Utils.getReportingMonth();
    selectedCategory = '';

    // Auto-generate recurring expenses for current month
    const generated = Store.recurringExpenses.generateForMonth(currentMonth);
    if (generated > 0) {
      Toast.success(`Đã tự động tạo ${generated} khoản chi phí định kỳ`);
    }

    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    container.innerHTML = `
      ${renderBudgetAlerts()}

      <!-- Tab Navigation -->
      <div style="display: flex; gap: var(--space-2); margin-bottom: var(--space-5); border-bottom: 1px solid var(--border-subtle); padding-bottom: var(--space-1);">
        <button class="btn ${activeTab === 'expenses' ? 'btn-primary' : 'btn-ghost'}" id="tabExpenses" style="border-radius: var(--radius-md) var(--radius-md) 0 0;">
          💸 Chi phí
        </button>
        <button class="btn ${activeTab === 'recurring' ? 'btn-primary' : 'btn-ghost'}" id="tabRecurring" style="border-radius: var(--radius-md) var(--radius-md) 0 0;">
          ${Utils.icons.repeat} Chi phí định kỳ
        </button>
      </div>

      ${activeTab === 'expenses' ? renderExpensesTab() : renderRecurringTab()}
    `;

    if (activeTab === 'expenses') {
      const allExpenses = Store.expenses.getByMonth(currentMonth);
      drawCategoryDonut(allExpenses);
      drawMonthlyBarChart();
    }

    bindEvents();
  };

  // ── B3: Budget Alert Bars ──

  const renderBudgetAlerts = () => {
    const target = Store.monthlyTargets.getByMonth(currentMonth);
    if (!target) return '';

    const categoryBudgetMap = {
      ads: target.adsBudget,
      event: target.eventBudget,
      content: target.contentBudget,
      kol: target.kolBudget,
      print: target.printBudget,
      other: target.otherBudget
    };

    const alerts = [];
    Object.entries(categoryBudgetMap).forEach(([cat, budget]) => {
      if (!budget || budget <= 0) return;
      const spent = Store.expenses.getTotalByCategoryAndMonth(cat, currentMonth);
      const pct = (spent / budget) * 100;
      if (pct >= 90) {
        const catInfo = Utils.getCategoryInfo(cat);
        const isOver = pct >= 100;
        alerts.push({
          cat,
          catInfo,
          spent,
          budget,
          pct,
          isOver
        });
      }
    });

    // Also check total budget
    if (target.totalBudget && target.totalBudget > 0) {
      const totalSpent = Store.expenses.getTotalByMonth(currentMonth);
      const totalPct = (totalSpent / target.totalBudget) * 100;
      if (totalPct >= 90) {
        alerts.unshift({
          cat: '_total',
          catInfo: { name: 'Tổng ngân sách', icon: '💰', color: '#ef4444' },
          spent: totalSpent,
          budget: target.totalBudget,
          pct: totalPct,
          isOver: totalPct >= 100
        });
      }
    }

    if (alerts.length === 0) return '';

    return `
      <div style="margin-bottom: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2);">
        ${alerts.map(a => `
          <div style="
            background: ${a.isOver ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)'};
            border: 1px solid ${a.isOver ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'};
            border-radius: var(--radius-md);
            padding: var(--space-3) var(--space-4);
          ">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2);">
              <div style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-semibold); color: ${a.isOver ? 'var(--danger-400)' : 'var(--warning-400)'};">
                ${a.isOver ? '🚨' : '⚠️'} ${a.catInfo.icon} ${a.catInfo.name}
                — ${a.isOver ? 'Vượt ngân sách!' : 'Sắp hết ngân sách!'}
              </div>
              <span style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-secondary);">
                ${Utils.formatVND(a.spent)} / ${Utils.formatVND(a.budget)} (${a.pct.toFixed(1)}%)
              </span>
            </div>
            <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
              <div style="
                height: 100%;
                width: ${Math.min(a.pct, 100)}%;
                background: ${a.isOver ? 'var(--danger-400)' : 'var(--warning-400)'};
                border-radius: 3px;
                transition: width 0.3s ease;
              "></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };

  // ── Expenses Tab ──

  const renderExpensesTab = () => {
    const allExpenses = Store.expenses.getByMonth(currentMonth);
    const filteredExpenses = selectedCategory
      ? allExpenses.filter(e => e.category === selectedCategory)
      : allExpenses;

    const total = Store.expenses.getTotalByMonth(currentMonth);
    const prevMonth = Utils.getPrevMonth(currentMonth);
    const prevTotal = Store.expenses.getTotalByMonth(prevMonth);

    // Calculate percentage change
    let percentChange = 0;
    let changeLabel = '';
    let changeClass = '';

    if (prevTotal > 0) {
      percentChange = ((total - prevTotal) / prevTotal) * 100;
      if (percentChange > 0) {
        changeLabel = `↑ Tăng ${percentChange.toFixed(1)}% so với tháng trước`;
        changeClass = 'text-danger'; // Expenses increase is bad
      } else if (percentChange < 0) {
        changeLabel = `↓ Giảm ${Math.abs(percentChange).toFixed(1)}% so với tháng trước`;
        changeClass = 'text-success'; // Expenses decrease is good
      } else {
        changeLabel = 'Không thay đổi so với tháng trước';
        changeClass = 'text-secondary';
      }
    } else {
      changeLabel = total > 0 ? 'Tháng trước không có chi phí' : 'Không có chi phí';
      changeClass = 'text-secondary';
    }

    return `
      <!-- Monthly summary row -->
      <div class="expense-summary-cards">
        <div class="stat-card" style="grid-column: span 3; display: flex; align-items: center; justify-content: space-between; padding: var(--space-5);">
          <div>
            <div class="stat-card-label" style="font-size: var(--text-md);">Tổng chi phí tháng này</div>
            <div class="stat-card-value" style="font-size: var(--text-3xl); margin: var(--space-2) 0;">${Utils.formatVND(total)}</div>
            <div class="${changeClass}" style="font-size: var(--text-sm); font-weight: var(--weight-medium); display: flex; align-items: center; gap: 4px;">
              ${changeLabel}
            </div>
          </div>
          <div class="stat-card-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--success-400); width: 64px; height: 64px; border-radius: var(--radius-xl); font-size: 1.8rem;">
            💸
          </div>
        </div>
      </div>

      <!-- Category Cards Grid -->
      <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--space-3); margin-bottom: var(--space-5); overflow-x: auto; padding-bottom: 4px;">
        ${Object.entries(Utils.EXPENSE_CATEGORIES).map(([cat, info]) => {
          const catTotal = Store.expenses.getTotalByCategoryAndMonth(cat, currentMonth);
          const isSelected = selectedCategory === cat;
          return `
            <div class="expense-category-card" data-category="${cat}" style="cursor: pointer; min-width: 140px; border-color: ${isSelected ? info.color : ''}; background: ${isSelected ? info.color + '10' : ''}">
              <div class="expense-category-icon" style="background: ${info.color}20; color: ${info.color}; font-size: 1.1rem; width: 36px; height: 36px; border-radius: var(--radius-md);">
                ${info.icon}
              </div>
              <div class="expense-category-info">
                <div class="expense-category-name" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${info.name}</div>
                <div class="expense-category-amount" style="font-size: var(--text-sm); font-weight: var(--weight-semibold); margin-top: 2px;">${Utils.formatVNDCompact(catTotal)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Charts Section -->
      <div class="dashboard-grid" style="margin-bottom: var(--space-5);">
        <!-- Category breakdown (Donut) -->
        <div class="card span-2">
          <div class="card-header">
            <div>
              <div class="card-title">Donut Chart — Cơ cấu chi phí</div>
              <div class="card-subtitle">Chi tiết phân bổ các danh mục chi tiêu</div>
            </div>
          </div>
          <div class="card-body">
            <div class="donut-chart-wrapper">
              <div class="donut-chart">
                <canvas id="categoryDonutCanvas"></canvas>
              </div>
              <div class="donut-legend" id="categoryLegend" style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);">
                <!-- Rendered dynamically -->
              </div>
            </div>
          </div>
        </div>

        <!-- Monthly Trends (Bar) -->
        <div class="card span-2">
          <div class="card-header">
            <div>
              <div class="card-title">Bar Chart — Chi phí 6 tháng gần nhất</div>
              <div class="card-subtitle">Xu hướng tổng chi tiêu qua các tháng</div>
            </div>
          </div>
          <div class="card-body">
            <div class="chart-container">
              <canvas id="expensesTrendBarCanvas"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Data Table Toolbar -->
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

          <!-- Category filter select -->
          <select class="filter-select" id="tableCategoryFilter">
            <option value="">Tất cả danh mục</option>
            ${Object.entries(Utils.EXPENSE_CATEGORIES).map(([k, v]) =>
              `<option value="${k}" ${selectedCategory === k ? 'selected' : ''}>${v.name}</option>`
            ).join('')}
          </select>
        </div>

        <div class="toolbar-right">
          <button class="btn btn-secondary" id="exportExcelBtn">
            ${Utils.icons.download}
            <span>Xuất Excel</span>
          </button>
          <button class="btn btn-primary" id="addExpenseBtn">
            ${Utils.icons.plus}
            <span>Thêm Chi Phí</span>
          </button>
        </div>
      </div>

      <!-- Detailed list table -->
      <div class="table-container" style="margin-bottom: var(--space-5);">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Danh mục</th>
              <th>Mô tả</th>
              <th class="text-right">Số tiền</th>
              <th>Ghi chú</th>
              <th style="width: 100px;" class="text-center">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${filteredExpenses.length === 0 ? `
              <tr>
                <td colspan="6" class="text-center" style="color: var(--text-tertiary); padding: var(--space-6) 0;">
                  Không tìm thấy khoản chi phí nào trong tháng này.
                </td>
              </tr>
            ` : filteredExpenses.map(e => {
              const catInfo = Utils.getCategoryInfo(e.category);
              const hasAttachment = !!(e.attachment && e.attachment.data);
              return `
                <tr>
                  <td style="white-space: nowrap; font-family: var(--font-mono);">${Utils.formatDateShort(e.date)}</td>
                  <td>
                    <span class="tag" style="background: ${catInfo.color}15; color: ${catInfo.color}; border: 1px solid ${catInfo.color}30; display: inline-flex; align-items: center; gap: 4px;">
                      ${catInfo.icon} ${catInfo.name}
                    </span>
                  </td>
                  <td style="font-weight: var(--weight-medium); color: var(--text-primary);">
                    ${Utils.escapeHtml(e.description)}
                    ${hasAttachment ? `<span class="view-attachment-btn" data-id="${e.id}" style="cursor: pointer; margin-left: 4px;" title="Xem đính kèm">📎</span>` : ''}
                  </td>
                  <td class="text-right font-mono" style="font-weight: var(--weight-semibold); color: var(--text-primary);">${Utils.formatVND(e.amount)}</td>
                  <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${Utils.escapeHtml(e.notes || '')}">
                    ${Utils.escapeHtml(e.notes || '—')}
                  </td>
                  <td class="text-center">
                    <div style="display: flex; gap: var(--space-1); justify-content: center;">
                      <button class="btn btn-icon btn-ghost btn-sm edit-expense-btn" data-id="${e.id}" data-tooltip="Chỉnh sửa">
                        ${Utils.icons.edit}
                      </button>
                      <button class="btn btn-icon btn-ghost btn-sm delete-expense-btn" data-id="${e.id}" data-tooltip="Xóa">
                        ${Utils.icons.trash}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          ${filteredExpenses.length > 0 ? `
            <tfoot>
              <tr style="background: var(--bg-table-header); font-weight: var(--weight-bold); border-top: 2px solid var(--border-default);">
                <td colspan="3" class="text-right" style="color: var(--text-primary);">TỔNG CỘNG:</td>
                <td class="text-right font-mono" style="color: var(--primary-400); font-size: var(--text-md);">${Utils.formatVND(filteredExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0))}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          ` : ''}
        </table>
      </div>
    `;
  };

  // ── D1: Recurring Expenses Tab ──

  const renderRecurringTab = () => {
    const templates = Store.recurringExpenses.getAll();

    return `
      <div class="toolbar" style="margin-bottom: var(--space-4);">
        <div class="toolbar-left">
          <h3 style="font-size: var(--text-lg); font-weight: var(--weight-semibold); color: var(--text-primary); margin: 0;">
            ${Utils.icons.repeat} Danh sách chi phí định kỳ
          </h3>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-primary" id="addRecurringBtn">
            ${Utils.icons.plus}
            <span>Thêm mẫu định kỳ</span>
          </button>
        </div>
      </div>

      <div class="table-container" style="margin-bottom: var(--space-5);">
        <table class="data-table">
          <thead>
            <tr>
              <th>Mô tả</th>
              <th>Danh mục</th>
              <th class="text-right">Số tiền</th>
              <th>Ghi chú</th>
              <th class="text-center" style="width: 100px;">Trạng thái</th>
              <th class="text-center" style="width: 100px;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${templates.length === 0 ? `
              <tr>
                <td colspan="6" class="text-center" style="color: var(--text-tertiary); padding: var(--space-6) 0;">
                  Chưa có chi phí định kỳ nào. Nhấn "Thêm mẫu định kỳ" để tạo mới.
                </td>
              </tr>
            ` : templates.map(tpl => {
              const catInfo = Utils.getCategoryInfo(tpl.category);
              const isActive = tpl.active !== false;
              return `
                <tr style="${!isActive ? 'opacity: 0.5;' : ''}">
                  <td style="font-weight: var(--weight-medium); color: var(--text-primary);">${Utils.escapeHtml(tpl.description)}</td>
                  <td>
                    <span class="tag" style="background: ${catInfo.color}15; color: ${catInfo.color}; border: 1px solid ${catInfo.color}30; display: inline-flex; align-items: center; gap: 4px;">
                      ${catInfo.icon} ${catInfo.name}
                    </span>
                  </td>
                  <td class="text-right font-mono" style="font-weight: var(--weight-semibold); color: var(--text-primary);">${Utils.formatVND(tpl.amount)}</td>
                  <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${Utils.escapeHtml(tpl.notes || '')}">
                    ${Utils.escapeHtml(tpl.notes || '—')}
                  </td>
                  <td class="text-center">
                    <button class="btn btn-sm toggle-recurring-btn ${isActive ? 'btn-success' : 'btn-ghost'}" data-id="${tpl.id}" style="font-size: var(--text-xs); padding: 4px 12px; border-radius: var(--radius-full);">
                      ${isActive ? '✅ Hoạt động' : '⏸️ Tạm dừng'}
                    </button>
                  </td>
                  <td class="text-center">
                    <div style="display: flex; gap: var(--space-1); justify-content: center;">
                      <button class="btn btn-icon btn-ghost btn-sm edit-recurring-btn" data-id="${tpl.id}" data-tooltip="Chỉnh sửa">
                        ${Utils.icons.edit}
                      </button>
                      <button class="btn btn-icon btn-ghost btn-sm delete-recurring-btn" data-id="${tpl.id}" data-tooltip="Xóa">
                        ${Utils.icons.trash}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          ${templates.length > 0 ? `
            <tfoot>
              <tr style="background: var(--bg-table-header); font-weight: var(--weight-bold); border-top: 2px solid var(--border-default);">
                <td colspan="2" class="text-right" style="color: var(--text-primary);">TỔNG HÀNG THÁNG (đang hoạt động):</td>
                <td class="text-right font-mono" style="color: var(--primary-400); font-size: var(--text-md);">
                  ${Utils.formatVND(templates.filter(t => t.active !== false).reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0))}
                </td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          ` : ''}
        </table>
      </div>
    `;
  };

  // ── Charts Rendering ──

  const drawCategoryDonut = (expenses) => {
    const canvas = document.getElementById('categoryDonutCanvas');
    if (!canvas) return;

    const chartData = [];
    const legendItems = [];
    const categories = Object.keys(Utils.EXPENSE_CATEGORIES);

    categories.forEach(cat => {
      const info = Utils.getCategoryInfo(cat);
      const amount = expenses.filter(e => e.category === cat).reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
      if (amount > 0) {
        chartData.push({ label: info.name, value: amount, color: info.color });
        legendItems.push({ name: info.name, icon: info.icon, color: info.color, amount });
      }
    });

    const totalVal = chartData.reduce((s, d) => s + d.value, 0);

    Chart.drawDonut(canvas, chartData, {
      size: 160,
      centerText: Utils.formatVNDCompact(totalVal),
      centerSubtext: 'Tổng chi tiêu'
    });

    // Populate Legend
    const legendEl = document.getElementById('categoryLegend');
    if (legendEl) {
      if (legendItems.length === 0) {
        legendEl.innerHTML = '<div style="color: var(--text-tertiary); font-size: var(--text-sm); grid-column: span 2; text-align: center;">Chưa có chi phí</div>';
      } else {
        legendEl.innerHTML = legendItems.map(item => `
          <div class="donut-legend-item">
            <div class="donut-legend-dot" style="background: ${item.color}"></div>
            <span class="donut-legend-label">${item.icon} ${item.name}</span>
            <span class="donut-legend-value" style="margin-left: 8px;">${Utils.formatVNDCompact(item.amount)}</span>
          </div>
        `).join('');
      }
    }
  };

  const drawMonthlyBarChart = () => {
    const canvas = document.getElementById('expensesTrendBarCanvas');
    if (!canvas) return;

    // Last 6 months list
    const months = [];
    let cur = currentMonth;
    for (let i = 0; i < 6; i++) {
      months.unshift(cur);
      cur = Utils.getPrevMonth(cur);
    }

    const data = months.map(m => {
      const value = Store.expenses.getTotalByMonth(m);
      const parts = m.split('-');
      const label = `T${parseInt(parts[1])}/${parts[0].slice(2)}`;
      return {
        label,
        value,
        color: m === currentMonth ? '#7c3aed' : '#5b21b6'
      };
    });

    Chart.drawBar(canvas, data, {
      height: 220
    });
  };

  // ── Bind Events ──

  const bindEvents = () => {
    // Tab switching
    container.querySelector('#tabExpenses')?.addEventListener('click', () => {
      activeTab = 'expenses';
      renderPage();
    });
    container.querySelector('#tabRecurring')?.addEventListener('click', () => {
      activeTab = 'recurring';
      renderPage();
    });

    if (activeTab === 'expenses') {
      bindExpensesEvents();
    } else {
      bindRecurringEvents();
    }
  };

  const bindExpensesEvents = () => {
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

    // Category Card filter toggle
    container.querySelectorAll('.expense-category-card').forEach(card => {
      card.addEventListener('click', () => {
        const cat = card.dataset.category;
        if (selectedCategory === cat) {
          selectedCategory = ''; // toggle off
        } else {
          selectedCategory = cat;
        }
        renderPage();
      });
    });

    // Toolbar Category filter select
    container.querySelector('#tableCategoryFilter')?.addEventListener('change', (e) => {
      selectedCategory = e.target.value;
      renderPage();
    });

    // Add Expense button
    container.querySelector('#addExpenseBtn')?.addEventListener('click', () => {
      openExpenseModal();
    });

    // Export button
    container.querySelector('#exportExcelBtn')?.addEventListener('click', () => {
      const expenses = Store.expenses.getByMonth(currentMonth);
      if (expenses.length === 0) {
        Toast.error('Không có dữ liệu để xuất Excel');
        return;
      }

      const formatted = expenses.map(e => ({
        date: e.date,
        category: Utils.getCategoryInfo(e.category).name,
        description: e.description,
        amount: parseFloat(e.amount) || 0,
        notes: e.notes || ''
      }));

      Utils.exportExcel(
        formatted,
        `Bao_cao_chi_phi_${currentMonth}`,
        ['date', 'category', 'description', 'amount', 'notes'],
        ['Ngày', 'Danh mục', 'Mô tả', 'Số tiền (VNĐ)', 'Ghi chú']
      );
      Toast.success('Đã tải xuống tệp Excel báo cáo');
    });

    // Row edit / delete
    container.querySelectorAll('.edit-expense-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const exp = Store.expenses.getById(id);
        if (exp) openExpenseModal(exp);
      });
    });

    container.querySelectorAll('.delete-expense-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const exp = Store.expenses.getById(id);
        if (!exp) return;

        Modal.confirm({
          title: 'Xóa khoản chi phí',
          message: `Bạn có chắc chắn muốn xóa khoản chi "${Utils.escapeHtml(exp.description)}"?`,
          icon: '🗑️',
          onConfirm: () => {
            Store.expenses.remove(id);
            Toast.success('Đã xóa khoản chi phí');
            renderPage();
          }
        });
      });
    });

    // View attachment
    container.querySelectorAll('.view-attachment-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const exp = Store.expenses.getById(id);
        if (exp && exp.attachment) {
          openAttachmentViewer(exp.attachment);
        }
      });
    });
  };

  const bindRecurringEvents = () => {
    // Add recurring
    container.querySelector('#addRecurringBtn')?.addEventListener('click', () => {
      openRecurringModal();
    });

    // Toggle active/inactive
    container.querySelectorAll('.toggle-recurring-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const tpl = Store.recurringExpenses.getById(id);
        if (!tpl) return;
        const newActive = tpl.active === false ? true : false;
        Store.recurringExpenses.update(id, { active: newActive });
        Toast.success(newActive ? 'Đã kích hoạt chi phí định kỳ' : 'Đã tạm dừng chi phí định kỳ');
        renderPage();
      });
    });

    // Edit recurring
    container.querySelectorAll('.edit-recurring-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const tpl = Store.recurringExpenses.getById(id);
        if (tpl) openRecurringModal(tpl);
      });
    });

    // Delete recurring
    container.querySelectorAll('.delete-recurring-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const tpl = Store.recurringExpenses.getById(id);
        if (!tpl) return;

        Modal.confirm({
          title: 'Xóa chi phí định kỳ',
          message: `Bạn có chắc chắn muốn xóa mẫu "${Utils.escapeHtml(tpl.description)}"? Các khoản chi đã tạo trước đó sẽ không bị ảnh hưởng.`,
          icon: '🗑️',
          onConfirm: () => {
            Store.recurringExpenses.remove(id);
            Toast.success('Đã xóa mẫu chi phí định kỳ');
            renderPage();
          }
        });
      });
    });
  };

  // ── Modals ──

  const openExpenseModal = (expense = null) => {
    const isEdit = !!expense;
    const title = isEdit ? 'Chỉnh sửa khoản chi phí' : 'Thêm khoản chi phí mới';
    const existingAttachment = isEdit && expense.attachment ? expense.attachment : null;

    // Track attachment state outside form data
    let pendingAttachment = existingAttachment ? { ...existingAttachment } : null;

    const content = `
      <div class="form-group">
        <label class="form-label">Mô tả khoản chi <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="description"
               value="${isEdit ? Utils.escapeHtml(expense.description) : ''}" placeholder="Ví dụ: Chạy quảng cáo Fanpage ABC">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Danh mục chi phí <span style="color:var(--danger-400);">*</span></label>
          <select class="form-select" data-field="category">
            ${Object.entries(Utils.EXPENSE_CATEGORIES).map(([k, v]) =>
              `<option value="${k}" ${(isEdit ? expense.category : 'ads') === k ? 'selected' : ''}>${v.icon} ${v.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ngày chi <span style="color:var(--danger-400);">*</span></label>
          <input type="date" class="form-input" data-field="date"
                 value="${isEdit ? expense.date : Utils.getDefaultDateForMonth(currentMonth)}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Số tiền chi tiêu (VNĐ) <span style="color:var(--danger-400);">*</span></label>
        <input type="number" class="form-input" data-field="amount"
               value="${isEdit ? expense.amount : 0}" min="1">
      </div>

      <div class="form-group">
        <label class="form-label">Ghi chú</label>
        <textarea class="form-textarea" data-field="notes" style="height: 60px;" placeholder="Ghi chú thêm (Hóa đơn, hình thức thanh toán...)...">${isEdit ? Utils.escapeHtml(expense.notes || '') : ''}</textarea>
      </div>

      <!-- D2: Attachment -->
      <div class="form-group">
        <label class="form-label">Hóa đơn / Biên lai đính kèm</label>
        <div style="display: flex; align-items: center; gap: var(--space-3);">
          <label style="
            display: inline-flex; align-items: center; gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            border: 1px dashed var(--border-default);
            border-radius: var(--radius-md);
            cursor: pointer; font-size: var(--text-sm); color: var(--text-secondary);
            transition: all 0.2s;
          ">
            ${Utils.icons.upload} Chọn tệp
            <input type="file" id="attachmentInput" accept="image/jpeg,image/png,application/pdf" style="display: none;">
          </label>
          <span id="attachmentFileName" style="font-size: var(--text-xs); color: var(--text-tertiary);">
            ${existingAttachment ? Utils.escapeHtml(existingAttachment.name) : 'Chưa chọn tệp'}
          </span>
          ${existingAttachment ? `<button type="button" id="removeAttachmentBtn" class="btn btn-ghost btn-sm" style="color: var(--danger-400); font-size: var(--text-xs);">Xóa</button>` : ''}
        </div>
        <div id="attachmentPreview" style="margin-top: var(--space-2);">
          ${existingAttachment ? renderAttachmentPreview(existingAttachment) : ''}
        </div>
      </div>
    `;

    const overlay = Modal.open({
      title,
      content,
      size: 'lg',
      saveLabel: isEdit ? 'Cập nhật' : 'Tạo mới',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.description || !formData.description.trim()) {
          Toast.error('Vui lòng nhập mô tả khoản chi');
          return;
        }
        if (!formData.date) {
          Toast.error('Vui lòng chọn ngày chi');
          return;
        }

        const amountVal = parseFloat(formData.amount) || 0;
        if (amountVal <= 0) {
          Toast.error('Số tiền chi tiêu phải lớn hơn 0');
          return;
        }

        const expData = {
          description: formData.description.trim(),
          category: formData.category,
          date: formData.date,
          amount: amountVal,
          notes: formData.notes.trim(),
          attachment: pendingAttachment || null
        };

        if (isEdit) {
          // Keep linked eventId if it has one
          if (expense.eventId) {
            expData.eventId = expense.eventId;
          }
          if (expense.recurringId) {
            expData.recurringId = expense.recurringId;
          }
          Store.expenses.update(expense.id, expData);
          Toast.success('Đã cập nhật khoản chi');
        } else {
          Store.expenses.create(expData);
          Toast.success('Đã ghi nhận khoản chi');
        }

        Modal.close();
        renderPage();
      }
    });

    // Bind attachment events after modal is open
    setTimeout(() => {
      const fileInput = document.getElementById('attachmentInput');
      const preview = document.getElementById('attachmentPreview');
      const fileName = document.getElementById('attachmentFileName');
      const removeBtn = document.getElementById('removeAttachmentBtn');

      if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          const maxSize = 10 * 1024 * 1024; // 10MB raw max
          if (file.size > maxSize) {
            Toast.error('Tệp quá lớn, vui lòng chọn tệp nhỏ hơn 10MB');
            return;
          }

          try {
            if (file.type === 'application/pdf') {
              // Read PDF as base64 directly
              const reader = new FileReader();
              reader.onload = (ev) => {
                pendingAttachment = {
                  name: file.name,
                  type: file.type,
                  data: ev.target.result
                };
                if (fileName) fileName.textContent = file.name;
                if (preview) preview.innerHTML = renderAttachmentPreview(pendingAttachment);
                addRemoveButton();
              };
              reader.readAsDataURL(file);
            } else {
              // Image - compress
              const compressedData = await compressImage(file);
              pendingAttachment = {
                name: file.name,
                type: 'image/jpeg',
                data: compressedData
              };
              if (fileName) fileName.textContent = file.name;
              if (preview) preview.innerHTML = renderAttachmentPreview(pendingAttachment);
              addRemoveButton();
            }
          } catch (err) {
            Toast.error('Không thể đọc tệp');
            console.error('Attachment error:', err);
          }
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          pendingAttachment = null;
          if (fileName) fileName.textContent = 'Chưa chọn tệp';
          if (preview) preview.innerHTML = '';
          removeBtn.remove();
        });
      }

      function addRemoveButton() {
        const existing = document.getElementById('removeAttachmentBtn');
        if (existing) {
          existing.addEventListener('click', () => {
            pendingAttachment = null;
            if (fileName) fileName.textContent = 'Chưa chọn tệp';
            if (preview) preview.innerHTML = '';
            existing.remove();
          });
          return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'removeAttachmentBtn';
        btn.className = 'btn btn-ghost btn-sm';
        btn.style.cssText = 'color: var(--danger-400); font-size: var(--text-xs);';
        btn.textContent = 'Xóa';
        btn.addEventListener('click', () => {
          pendingAttachment = null;
          if (fileName) fileName.textContent = 'Chưa chọn tệp';
          if (preview) preview.innerHTML = '';
          btn.remove();
        });
        if (fileName && fileName.parentNode) {
          fileName.parentNode.appendChild(btn);
        }
      }
    }, 150);
  };

  const renderAttachmentPreview = (attachment) => {
    if (!attachment || !attachment.data) return '';

    if (attachment.type === 'application/pdf') {
      return `
        <div style="
          display: inline-flex; align-items: center; gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: rgba(239, 68, 68, 0.1);
          border-radius: var(--radius-md);
          font-size: var(--text-sm); color: var(--text-secondary);
        ">
          📄 ${Utils.escapeHtml(attachment.name)}
        </div>
      `;
    }

    return `
      <img src="${attachment.data}" alt="Preview"
        style="max-width: 200px; max-height: 150px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); object-fit: cover; cursor: pointer;"
        onclick="(function(el){ var m = document.createElement('div'); m.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;'; m.onclick=function(){m.remove();}; var img=document.createElement('img'); img.src=el.src; img.style.cssText='max-width:90vw;max-height:90vh;border-radius:8px;'; m.appendChild(img); document.body.appendChild(m); })(this)"
      >
    `;
  };

  const openAttachmentViewer = (attachment) => {
    if (!attachment || !attachment.data) return;

    let viewContent = '';
    if (attachment.type === 'application/pdf') {
      viewContent = `
        <div style="text-align: center; padding: var(--space-4);">
          <div style="font-size: 4rem; margin-bottom: var(--space-3);">📄</div>
          <p style="color: var(--text-secondary); margin-bottom: var(--space-3);">${Utils.escapeHtml(attachment.name)}</p>
          <a href="${attachment.data}" download="${Utils.escapeHtml(attachment.name)}" class="btn btn-primary">
            ${Utils.icons.download} Tải xuống PDF
          </a>
        </div>
      `;
    } else {
      viewContent = `
        <div style="text-align: center;">
          <img src="${attachment.data}" alt="${Utils.escapeHtml(attachment.name)}"
            style="max-width: 100%; max-height: 70vh; border-radius: var(--radius-md);">
          <p style="color: var(--text-tertiary); margin-top: var(--space-2); font-size: var(--text-sm);">${Utils.escapeHtml(attachment.name)}</p>
        </div>
      `;
    }

    Modal.open({
      title: '📎 Hóa đơn / Biên lai',
      content: viewContent,
      size: 'lg',
      showFooter: false
    });
  };

  // ── D1: Recurring Expense Modal ──

  const openRecurringModal = (template = null) => {
    const isEdit = !!template;
    const title = isEdit ? 'Chỉnh sửa chi phí định kỳ' : 'Thêm chi phí định kỳ mới';

    const content = `
      <div class="form-group">
        <label class="form-label">Mô tả <span style="color:var(--danger-400);">*</span></label>
        <input type="text" class="form-input" data-field="description"
               value="${isEdit ? Utils.escapeHtml(template.description) : ''}" placeholder="Ví dụ: Thuê hosting, Phí phần mềm...">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Danh mục <span style="color:var(--danger-400);">*</span></label>
          <select class="form-select" data-field="category">
            ${Object.entries(Utils.EXPENSE_CATEGORIES).map(([k, v]) =>
              `<option value="${k}" ${(isEdit ? template.category : 'other') === k ? 'selected' : ''}>${v.icon} ${v.name}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Số tiền (VNĐ) <span style="color:var(--danger-400);">*</span></label>
          <input type="number" class="form-input" data-field="amount"
                 value="${isEdit ? template.amount : 0}" min="1">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Ghi chú</label>
        <textarea class="form-textarea" data-field="notes" style="height: 60px;" placeholder="Ghi chú thêm...">${isEdit ? Utils.escapeHtml(template.notes || '') : ''}</textarea>
      </div>
    `;

    Modal.open({
      title,
      content,
      saveLabel: isEdit ? 'Cập nhật' : 'Tạo mới',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.description || !formData.description.trim()) {
          Toast.error('Vui lòng nhập mô tả chi phí');
          return;
        }

        const amountVal = parseFloat(formData.amount) || 0;
        if (amountVal <= 0) {
          Toast.error('Số tiền phải lớn hơn 0');
          return;
        }

        const tplData = {
          description: formData.description.trim(),
          category: formData.category,
          amount: amountVal,
          notes: formData.notes.trim()
        };

        if (isEdit) {
          Store.recurringExpenses.update(template.id, tplData);
          Toast.success('Đã cập nhật mẫu chi phí định kỳ');
        } else {
          tplData.active = true;
          Store.recurringExpenses.create(tplData);
          Toast.success('Đã tạo mẫu chi phí định kỳ');
        }

        Modal.close();
        renderPage();
      }
    });
  };

  return { render };
})();

App.registerPage('expenses', ExpensesPage);
