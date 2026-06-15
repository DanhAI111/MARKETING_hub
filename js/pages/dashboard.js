/* ═══════════════════════════════════════════
   MARKETING HUB - Dashboard Page
   Overview widgets and KPI summary
   ═══════════════════════════════════════════ */

const DashboardPage = (() => {

  const render = (container) => {
    const currentMonth = Utils.getReportingMonth();
    const fanpages = Store.fanpages.getAll();
    const postsThisMonth = Store.posts.getByMonth(currentMonth);
    const totalPostKpi = fanpages.reduce((sum, fp) => sum + (parseInt(fp.kpis?.[currentMonth]) || 0), 0);
    const events = Store.events.getByMonth(currentMonth);
    const upcomingEvents = Store.events.getUpcoming(5);
    const totalExpenses = Store.expenses.getTotalByMonth(currentMonth);
    const adAggregated = Store.adReports.getAggregatedByMonth(currentMonth);
    const allTasks = Store.tasks.getAll();
    const pendingTasks = allTasks
      .filter(t => t.status !== 'completed')
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      });

    // Calculate ads spend this month
    const adsSpend = adAggregated ? adAggregated.spend : 0;

    // Overdue tasks
    const overdueTasks = Store.tasks.getOverdue();
    const overdueIds = new Set(overdueTasks.map(t => t.id));

    // Posting rate today
    const fanpagesPostedToday = Store.posts.getFanpagesWithPostToday();
    const postingRate = fanpages.length > 0
      ? Math.round((fanpagesPostedToday.length / fanpages.length) * 100)
      : 0;

    // Top fanpage by ROAS
    const topFanpage = getTopFanpageByROAS(fanpages, currentMonth);

    // Budget target
    const monthlyTarget = Store.monthlyTargets.getByMonth(currentMonth);

    container.innerHTML = `
      <!-- Welcome Section -->
      <div class="dashboard-welcome">
        <div>
          <h2>Hello, Admin</h2>
          <p>Here is your marketing overview for ${Utils.formatMonthYear(currentMonth)}.</p>
        </div>
        <div style="display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;">
          <div class="month-picker">
            <button class="month-picker-btn" id="dashboardPrevMonthBtn">
              ${Utils.icons.chevronLeft}
            </button>
            <span class="month-picker-label">
              ${Utils.formatMonthYear(currentMonth)}
            </span>
            <button class="month-picker-btn" id="dashboardNextMonthBtn">
              ${Utils.icons.chevronRight}
            </button>
          </div>
          <button class="btn btn-primary btn-sm" id="btnExportMonthlyReport" title="Xuất báo cáo tháng dạng CSV">
            ${Utils.icons.download} Xuất báo cáo tháng
          </button>
        </div>
      </div>

      <!-- Quick Stats -->
      <div class="quick-stats">
        <div class="stat-card" id="statPosts">
          <div class="stat-card-icon" style="background: var(--primary-50); color: var(--primary-600);">
            ${Utils.icons.content}
          </div>
          <div class="stat-card-label">Tổng bài đã đăng / KPI</div>
          <div class="stat-card-value">${Utils.formatNumber(postsThisMonth.length)}/${Utils.formatNumber(totalPostKpi)} bài</div>
        </div>
        <div class="stat-card" id="statEvents">
          <div class="stat-card-icon" style="background: var(--primary-50); color: var(--primary-600);">
            ${Utils.icons.events}
          </div>
          <div class="stat-card-label">Tổng sự kiện tháng báo cáo</div>
          <div class="stat-card-value">${Utils.formatNumber(events.length)}</div>
        </div>
        <div class="stat-card" id="statAdsSpend">
          <div class="stat-card-icon" style="background: var(--primary-50); color: var(--primary-600);">
            ${Utils.icons.ads}
          </div>
          <div class="stat-card-label">Tổng chi tiêu ads tháng</div>
          <div class="stat-card-value">${Utils.formatVNDCompact(adsSpend)}</div>
        </div>
        <div class="stat-card" id="statExpenses">
          <div class="stat-card-icon" style="background: var(--primary-50); color: var(--primary-600);">
            ${Utils.icons.expenses}
          </div>
          <div class="stat-card-label">Tổng chi phí tháng</div>
          <div class="stat-card-value">${Utils.formatVNDCompact(totalExpenses)}</div>
        </div>
      </div>

      <!-- Insight Widgets Row -->
      <div class="quick-stats" style="grid-template-columns: repeat(3, 1fr); gap: var(--space-4); margin-top: var(--space-4);">
        ${renderTopFanpageWidget(topFanpage)}
        ${renderPostingRateWidget(fanpagesPostedToday.length, fanpages.length, postingRate)}
        ${renderBudgetGaugeWidget(monthlyTarget, totalExpenses, adsSpend)}
      </div>

      <!-- Dashboard Grid -->
      <div class="dashboard-grid">

        <!-- KPI Content Widget (span-2) -->
        <div class="card span-2" id="kpiWidget">
          <div class="card-header">
            <div>
              <div class="card-title">KPI Content</div>
              <div class="card-subtitle">${Utils.formatMonthYear(currentMonth)} — Tiến độ đăng bài các fanpage</div>
            </div>
          </div>
          <div class="card-body" id="kpiContent">
            ${renderKpiContent(fanpages, currentMonth)}
          </div>
        </div>

        <!-- Chi Phí Tháng Widget -->
        <div class="card span-2" id="expenseWidget">
          <div class="card-header">
            <div>
              <div class="card-title">Chi Phí Tháng</div>
              <div class="card-subtitle">${Utils.formatMonthYear(currentMonth)}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="donut-chart-wrapper" id="expenseChartWrapper">
              <div class="donut-chart">
                <canvas id="expenseDonutCanvas"></canvas>
              </div>
              <div class="donut-legend" id="expenseLegend">
              </div>
            </div>
          </div>
        </div>

        <!-- Sự Kiện Sắp Tới Widget -->
        <div class="card span-2" id="eventsWidget">
          <div class="card-header">
            <div>
              <div class="card-title">Sự Kiện Sắp Tới</div>
              <div class="card-subtitle">${upcomingEvents.length} sự kiện sắp diễn ra</div>
            </div>
          </div>
          <div class="card-body">
            ${renderUpcomingEvents(upcomingEvents)}
          </div>
        </div>

        <!-- Công Việc Cần Xử Lý Widget -->
        <div class="card span-2" id="tasksWidget">
          <div class="card-header">
            <div>
              <div class="card-title">Công Việc Cần Xử Lý</div>
              <div class="card-subtitle">${pendingTasks.length} công việc chưa hoàn thành${overdueTasks.length > 0 ? ' • <span style="color: var(--danger-400);">' + overdueTasks.length + ' quá hạn</span>' : ''}</div>
            </div>
          </div>
          <div class="card-body">
            ${renderPendingTasks(pendingTasks, overdueIds)}
          </div>
        </div>

        <!-- Hiệu Quả Ads Widget (span-4) -->
        <div class="card span-4" id="adsWidget">
          <div class="card-header">
            <div>
              <div class="card-title">Hiệu Quả Ads</div>
              <div class="card-subtitle">${Utils.formatMonthYear(currentMonth)} — Tổng quan quảng cáo</div>
            </div>
          </div>
          <div class="card-body">
            ${renderAdsOverview(adAggregated, currentMonth)}
          </div>
        </div>

      </div>
    `;

    // Draw expense donut chart
    drawExpenseDonut(currentMonth);

    // Draw ads sparklines
    drawAdsSparklines(currentMonth);

    // Attach click handlers for navigation
    attachEventHandlers(currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated);
  };

  // ── Top Fanpage by ROAS ──
  const getTopFanpageByROAS = (fanpages, currentMonth) => {
    let best = null;
    let bestROAS = 0;

    fanpages.forEach(fp => {
      const reports = Store.adReports.getByFanpageAndMonth(fp.id, currentMonth);
      if (reports.length === 0) return;

      const spend = reports.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
      const revenue = reports.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);
      const roas = spend > 0 ? revenue / spend : 0;

      if (roas > bestROAS) {
        bestROAS = roas;
        best = { fanpage: fp, roas: roas, spend: spend, revenue: revenue };
      }
    });

    return best;
  };

  // ── Top Fanpage Widget ──
  const renderTopFanpageWidget = (topFanpage) => {
    if (!topFanpage) {
      return `
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(236, 72, 153, 0.12); color: #ec4899;">
            ${Utils.icons.trendUp}
          </div>
          <div class="stat-card-label">Top Fanpage ROAS</div>
          <div class="stat-card-value" style="font-size: var(--text-base); color: rgba(255, 255, 255, 0.5);">Chưa có dữ liệu</div>
        </div>
      `;
    }

    const platform = Utils.getPlatformInfo(topFanpage.fanpage.platform);
    return `
      <div class="stat-card">
        <div class="stat-card-icon" style="background: rgba(236, 72, 153, 0.12); color: #ec4899;">
          ${Utils.icons.trendUp}
        </div>
        <div class="stat-card-label">Top Fanpage ROAS</div>
        <div class="stat-card-value" style="font-size: var(--text-lg);">${Utils.formatRatio(topFanpage.roas)}</div>
        <div style="font-size: var(--text-xs); color: rgba(255, 255, 255, 0.7); margin-top: 2px;">
          ${platform.icon} ${Utils.escapeHtml(topFanpage.fanpage.name)}
        </div>
      </div>
    `;
  };

  // ── Posting Rate Widget ──
  const renderPostingRateWidget = (postedCount, totalCount, rate) => {
    const rateColor = rate >= 80 ? 'var(--success-400)' : rate >= 50 ? 'var(--warning-400)' : 'var(--danger-400)';
    return `
      <div class="stat-card">
        <div class="stat-card-icon" style="background: rgba(99, 102, 241, 0.12); color: #6366f1;">
          ${Utils.icons.check}
        </div>
        <div class="stat-card-label">Tỷ lệ đăng bài hôm nay</div>
        <div class="stat-card-value" style="color: #ffffff;">${rate}%</div>
        <div style="font-size: var(--text-xs); color: rgba(255, 255, 255, 0.7); margin-top: 2px;">
          ${postedCount}/${totalCount} fanpage đã đăng
        </div>
      </div>
    `;
  };

  // ── Budget Gauge Widget ──
  const renderBudgetGaugeWidget = (monthlyTarget, totalExpenses, adsSpend) => {
    if (!monthlyTarget || !monthlyTarget.totalBudget) {
      return `
        <div class="stat-card">
          <div class="stat-card-icon" style="background: rgba(255, 255, 255, 0.1); color: #ffffff;">
            ${Utils.icons.target}
          </div>
          <div class="stat-card-label">Ngân sách tháng</div>
          <div class="stat-card-value" style="font-size: var(--text-base); color: rgba(255, 255, 255, 0.5);">Chưa đặt mục tiêu</div>
        </div>
      `;
    }

    const budget = parseFloat(monthlyTarget.totalBudget) || 0;
    const actualSpend = totalExpenses;
    const percent = budget > 0 ? Math.round((actualSpend / budget) * 100) : 0;
    const barWidth = Math.min(percent, 100);

    let barColor = 'var(--success-400)';
    let statusText = 'Trong ngân sách';
    if (percent > 100) {
      barColor = 'var(--danger-400)';
      statusText = 'Vượt ngân sách!';
    } else if (percent > 90) {
      barColor = 'var(--warning-400)';
      statusText = 'Sắp hết ngân sách';
    }

    return `
      <div class="stat-card">
        <div class="stat-card-icon" style="background: rgba(255, 255, 255, 0.1); color: #ffffff;">
          ${Utils.icons.target}
        </div>
        <div class="stat-card-label">Ngân sách tháng</div>
        <div class="stat-card-value" style="font-size: var(--text-lg); color: #ffffff;">${percent}%</div>
        <div style="width: 100%; margin-top: 6px;">
          <div class="progress-bar-container" style="height: 6px;">
            <div class="progress-bar-fill" style="width: ${barWidth}%; background: ${barColor};"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: var(--text-xs); color: rgba(255, 255, 255, 0.7);">
            <span>${Utils.formatVNDCompact(actualSpend)} / ${Utils.formatVNDCompact(budget)}</span>
            <span style="color: ${barColor};">${statusText}</span>
          </div>
        </div>
      </div>
    `;
  };

  // ── KPI Content ──
  const renderKpiContent = (fanpages, currentMonth) => {
    if (fanpages.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <div class="empty-state-title">Chưa có fanpage</div>
          <div class="empty-state-desc">Thêm fanpage để theo dõi KPI nội dung</div>
        </div>
      `;
    }

    return fanpages.map(fp => {
      const platform = Utils.getPlatformInfo(fp.platform);
      const kpiTarget = fp.kpis?.[currentMonth] || 0;
      const posted = Store.posts.getCountByFanpageAndMonth(fp.id, currentMonth);
      const percent = kpiTarget > 0 ? Math.round((posted / kpiTarget) * 100) : 0;
      const colorClass = Utils.getKpiColor(percent);

      return `
        <div class="kpi-item">
          <div class="kpi-platform-icon ${platform.cssClass}">
            ${platform.icon}
          </div>
          <div class="kpi-info">
            <div class="kpi-name">${Utils.escapeHtml(fp.name)}</div>
            <div class="kpi-stats">
              <span>${posted}/${kpiTarget} bài</span>
              <span>•</span>
              <span class="tag tag-${fp.platform}">${platform.name}</span>
            </div>
          </div>
          <div class="kpi-progress">
            <div class="progress-bar-container">
              <div class="progress-bar-fill ${colorClass}" style="width: ${Math.min(percent, 100)}%"></div>
            </div>
          </div>
          <div class="kpi-percentage ${colorClass}">
            ${percent}%
          </div>
        </div>
      `;
    }).join('');
  };

  // ── Expense Donut ──
  const drawExpenseDonut = (currentMonth) => {
    const canvas = document.getElementById('expenseDonutCanvas');
    if (!canvas) return;

    const categories = Object.keys(Utils.EXPENSE_CATEGORIES);
    const chartData = [];
    const legendItems = [];

    categories.forEach(cat => {
      const catInfo = Utils.getCategoryInfo(cat);
      const amount = Store.expenses.getTotalByCategoryAndMonth(cat, currentMonth);
      if (amount > 0) {
        chartData.push({ label: catInfo.name, value: amount, color: catInfo.color });
        legendItems.push({ name: catInfo.name, icon: catInfo.icon, color: catInfo.color, amount });
      }
    });

    const total = chartData.reduce((s, d) => s + d.value, 0);

    Chart.drawDonut(canvas, chartData, {
      size: 160,
      centerText: Utils.formatVNDCompact(total),
      centerSubtext: 'Tổng chi phí'
    });

    // Render legend
    const legendEl = document.getElementById('expenseLegend');
    if (legendEl) {
      if (legendItems.length === 0) {
        legendEl.innerHTML = '<div style="color: var(--text-tertiary); font-size: var(--text-sm);">Chưa có chi phí</div>';
      } else {
        legendEl.innerHTML = legendItems.map(item => `
          <div class="donut-legend-item">
            <div class="donut-legend-dot" style="background: ${item.color}"></div>
            <span class="donut-legend-label">${item.icon} ${item.name}</span>
            <span class="donut-legend-value">${Utils.formatVNDCompact(item.amount)}</span>
          </div>
        `).join('');
      }
    }
  };

  // ── Upcoming Events ──
  const renderUpcomingEvents = (events) => {
    if (events.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <div class="empty-state-title">Không có sự kiện sắp tới</div>
          <div class="empty-state-desc">Thêm sự kiện để theo dõi lịch trình</div>
        </div>
      `;
    }

    return '<div class="event-widget-list">' + events.map(event => {
      const d = new Date(event.date + 'T00:00:00');
      const day = String(d.getDate()).padStart(2, '0');
      const monthShort = `Th${d.getMonth() + 1}`;
      const statusInfo = Utils.EVENT_STATUSES[event.status] || { label: event.status, cssClass: 'tag-neutral' };

      return `
        <div class="event-widget-item" data-event-id="${event.id}">
          <div class="event-date-box">
            <div class="event-date-day">${day}</div>
            <div class="event-date-month">${monthShort}</div>
          </div>
          <div class="event-widget-info">
            <div class="event-widget-name">${Utils.escapeHtml(event.name)}</div>
            <div class="event-widget-meta">
              ${event.startTime || ''} ${event.address ? '• ' + Utils.escapeHtml(event.address) : ''}
            </div>
          </div>
          <span class="tag ${statusInfo.cssClass}">${statusInfo.label}</span>
        </div>
      `;
    }).join('') + '</div>';
  };

  // ── Pending Tasks (with overdue highlighting) ──
  const renderPendingTasks = (tasks, overdueIds) => {
    if (tasks.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <div class="empty-state-title">Tuyệt vời!</div>
          <div class="empty-state-desc">Không có công việc cần xử lý</div>
        </div>
      `;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const displayTasks = tasks.slice(0, 6);

    return displayTasks.map(task => {
      const priority = task.priority || 'low';
      const deadlineStr = task.deadline ? Utils.formatDateShort(task.deadline) : '';
      const isOverdue = task.deadline && task.deadline < todayStr && task.status !== 'completed';
      const statusInfo = Utils.TASK_STATUSES[task.status] || { label: task.status };

      // Calculate overdue days
      let overdueDays = 0;
      if (isOverdue) {
        const deadlineDate = new Date(task.deadline + 'T00:00:00');
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0);
        overdueDays = Math.floor((todayDate - deadlineDate) / (1000 * 60 * 60 * 24));
      }

      const overdueStyle = isOverdue
        ? 'background: rgba(239, 68, 68, 0.08); border-left: 3px solid var(--danger-400); padding-left: calc(var(--space-3) - 3px);'
        : '';

      return `
        <div class="task-widget-item priority-${priority}" data-task-id="${task.id}" style="${overdueStyle}">
          <div class="task-widget-info">
            <div class="task-widget-title">${Utils.escapeHtml(task.title)}</div>
            <div class="task-widget-meta">
              ${task.assignee ? `<span>${Utils.icon('user', 'icon-xs')} ${Utils.escapeHtml(task.assignee)}</span>` : ''}
              ${deadlineStr ? `<span class="task-widget-deadline ${isOverdue ? 'overdue' : ''}">${Utils.icon('clock', 'icon-xs')} ${deadlineStr}</span>` : ''}
              ${isOverdue ? `<span style="color: var(--danger-400); font-size: 10px; font-weight: 600;">Quá hạn ${overdueDays} ngày</span>` : ''}
              <span class="tag tag-${priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'success'}" style="font-size: 10px; padding: 1px 6px;">
                ${Utils.PRIORITIES[priority]?.label || priority}
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('') + (tasks.length > 6 ? `
      <div style="text-align: center; margin-top: var(--space-3);">
        <button class="btn btn-ghost btn-sm" onclick="App.navigate('tasks')">
          Xem tất cả ${tasks.length} công việc →
        </button>
      </div>
    ` : '');
  };

  // ── Ads Overview ──
  const renderAdsOverview = (adData, currentMonth) => {
    if (!adData) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <div class="empty-state-title">Chưa có dữ liệu ads</div>
          <div class="empty-state-desc">Thêm báo cáo quảng cáo để xem hiệu quả</div>
        </div>
      `;
    }

    return `
      <div class="ads-metric-cards" style="margin-bottom: 0;">
        <div class="ads-metric-card spend">
          <div class="stat-card-label">Chi tiêu Ads</div>
          <div class="stat-card-value" style="font-size: var(--text-xl);">${Utils.formatVNDCompact(adData.spend)}</div>
          <canvas class="sparkline" id="sparkSpend"></canvas>
        </div>
        <div class="ads-metric-card reach">
          <div class="stat-card-label">Lượt tiếp cận</div>
          <div class="stat-card-value" style="font-size: var(--text-xl);">${Utils.formatNumberCompact(adData.reach)}</div>
          <canvas class="sparkline" id="sparkReach"></canvas>
        </div>
        <div class="ads-metric-card conversions">
          <div class="stat-card-label">Chuyển đổi</div>
          <div class="stat-card-value" style="font-size: var(--text-xl);">${Utils.formatNumber(adData.conversions)}</div>
          <canvas class="sparkline" id="sparkConversions"></canvas>
        </div>
        <div class="ads-metric-card roas">
          <div class="stat-card-label">CPC trung bình</div>
          <div class="stat-card-value" style="font-size: var(--text-xl);">${Utils.formatVNDCompact(adData.cpc)}</div>
          <canvas class="sparkline" id="sparkCpc"></canvas>
        </div>
      </div>
    `;
  };

  // ── Draw Ads Sparklines ──
  const drawAdsSparklines = (currentMonth) => {
    const reports = Store.adReports.getByMonth(currentMonth);
    if (reports.length === 0) return;

    // Group reports by date
    const byDate = {};
    reports.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = { spend: 0, reach: 0, conversions: 0, clicks: 0 };
      byDate[r.date].spend += parseFloat(r.spend) || 0;
      byDate[r.date].reach += parseInt(r.reach) || 0;
      byDate[r.date].conversions += parseInt(r.conversions) || 0;
      byDate[r.date].clicks += parseInt(r.clicks) || 0;
    });

    const dates = Object.keys(byDate).sort();
    const spendData = dates.map(d => byDate[d].spend);
    const reachData = dates.map(d => byDate[d].reach);
    const convData = dates.map(d => byDate[d].conversions);
    const cpcData = dates.map(d => byDate[d].clicks > 0 ? byDate[d].spend / byDate[d].clicks : 0);

    // Draw sparklines with a slight delay for DOM rendering
    requestAnimationFrame(() => {
      const sparkSpend = document.getElementById('sparkSpend');
      const sparkReach = document.getElementById('sparkReach');
      const sparkConversions = document.getElementById('sparkConversions');
      const sparkCpc = document.getElementById('sparkCpc');

      if (sparkSpend) Chart.drawSparkline(sparkSpend, spendData, '#7c3aed');
      if (sparkReach) Chart.drawSparkline(sparkReach, reachData, '#3b82f6');
      if (sparkConversions) Chart.drawSparkline(sparkConversions, convData, '#10b981');
      if (sparkCpc) Chart.drawSparkline(sparkCpc, cpcData, '#f59e0b');
    });
  };

  // ── Export Monthly Report CSV ──
  const exportMonthlyReport = (currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated) => {
    const rows = [];
    const headers = ['Hạng mục', 'Chi tiết', 'Giá trị'];

    // Section 1: Summary KPIs
    rows.push({ 'Hạng mục': '=== TỔNG QUAN KPI ===', 'Chi tiết': '', 'Giá trị': '' });
    rows.push({ 'Hạng mục': 'Tổng bài đăng', 'Chi tiết': Utils.formatMonthYear(currentMonth), 'Giá trị': postsThisMonth.length });
    rows.push({ 'Hạng mục': 'Tổng sự kiện', 'Chi tiết': '', 'Giá trị': events.length });
    rows.push({ 'Hạng mục': 'Tổng chi phí', 'Chi tiết': '', 'Giá trị': totalExpenses });
    rows.push({ 'Hạng mục': 'Tổng chi tiêu ads', 'Chi tiết': '', 'Giá trị': adsSpend });
    if (adAggregated) {
      rows.push({ 'Hạng mục': 'Lượt tiếp cận', 'Chi tiết': '', 'Giá trị': adAggregated.reach });
      rows.push({ 'Hạng mục': 'Chuyển đổi', 'Chi tiết': '', 'Giá trị': adAggregated.conversions });
      rows.push({ 'Hạng mục': 'CPC trung bình', 'Chi tiết': '', 'Giá trị': adAggregated.cpc ? Math.round(adAggregated.cpc) : 0 });
    }

    // Section 2: Per-fanpage ad performance
    rows.push({ 'Hạng mục': '', 'Chi tiết': '', 'Giá trị': '' });
    rows.push({ 'Hạng mục': '=== HIỆU QUẢ ADS THEO FANPAGE ===', 'Chi tiết': '', 'Giá trị': '' });
    fanpages.forEach(fp => {
      const fpReports = Store.adReports.getByFanpageAndMonth(fp.id, currentMonth);
      if (fpReports.length === 0) return;
      const fpSpend = fpReports.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
      const fpRevenue = fpReports.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);
      const fpReach = fpReports.reduce((s, r) => s + (parseInt(r.reach) || 0), 0);
      const fpConversions = fpReports.reduce((s, r) => s + (parseInt(r.conversions) || 0), 0);
      const fpRoas = fpSpend > 0 ? (fpRevenue / fpSpend).toFixed(2) : '0';
      rows.push({
        'Hạng mục': fp.name,
        'Chi tiết': `Spend: ${fpSpend} | Reach: ${fpReach} | Conv: ${fpConversions} | ROAS: ${fpRoas}x`,
        'Giá trị': fpSpend
      });
    });

    // Section 3: Expense breakdown by category
    rows.push({ 'Hạng mục': '', 'Chi tiết': '', 'Giá trị': '' });
    rows.push({ 'Hạng mục': '=== CHI PHÍ THEO DANH MỤC ===', 'Chi tiết': '', 'Giá trị': '' });
    const categories = Object.keys(Utils.EXPENSE_CATEGORIES);
    categories.forEach(cat => {
      const catInfo = Utils.getCategoryInfo(cat);
      const amount = Store.expenses.getTotalByCategoryAndMonth(cat, currentMonth);
      if (amount > 0) {
        rows.push({ 'Hạng mục': catInfo.name, 'Chi tiết': cat, 'Giá trị': amount });
      }
    });

    Utils.exportCSV(rows, `bao-cao-thang-${currentMonth}`, headers);
    Toast.success('Đã xuất báo cáo tháng thành công!');
  };

  // ── Event Handlers ──
  const attachEventHandlers = (currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated) => {
    // Click on stat cards to navigate
    document.getElementById('statPosts')?.addEventListener('click', () => App.navigate('content'));
    document.getElementById('statEvents')?.addEventListener('click', () => App.navigate('events'));
    document.getElementById('statAdsSpend')?.addEventListener('click', () => App.navigate('ads'));
    document.getElementById('statExpenses')?.addEventListener('click', () => App.navigate('expenses'));

    // Click on events to navigate
    document.querySelectorAll('.event-widget-item').forEach(el => {
      el.addEventListener('click', () => App.navigate('events'));
    });

    // Click on tasks to navigate
    document.querySelectorAll('.task-widget-item').forEach(el => {
      el.addEventListener('click', () => App.navigate('tasks'));
    });

    // Export monthly report button
    document.getElementById('btnExportMonthlyReport')?.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMonthlyReport(currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated);
    });

    document.getElementById('dashboardPrevMonthBtn')?.addEventListener('click', () => {
      Utils.setReportingMonth(Utils.getPrevMonth(currentMonth));
      render(container);
    });

    document.getElementById('dashboardNextMonthBtn')?.addEventListener('click', () => {
      Utils.setReportingMonth(Utils.getNextMonth(currentMonth));
      render(container);
    });
  };

  return { render };

})();

App.registerPage('dashboard', DashboardPage);
