/* ═══════════════════════════════════════════
   MARKETING HUB - Dashboard Page
   Overview widgets and KPI summary
   ═══════════════════════════════════════════ */

const DashboardPage = (() => {
  let selectedRange = 28;
  let resizeHandler = null;
  let documentClickHandler = null;

  const render = (container) => {
    const currentMonth = Utils.getReportingMonth();
    const fanpages = Store.fanpages.getAll();
    const postsThisMonth = Store.posts.getByMonth(currentMonth);
    const scheduledPosts = Store.posts.getScheduled();
    const totalPostKpi = fanpages.reduce((sum, fp) => sum + (parseInt(fp.kpis?.[currentMonth]) || 0), 0);
    const events = Store.events.getByMonth(currentMonth);
    const upcomingEvents = Store.events.getUpcoming(3);
    const activeCampaigns = Store.campaigns.getAll().filter(c => c.status === 'active');
    const totalExpenses = Store.expenses.getTotalByMonth(currentMonth);
    const adAggregated = Store.adReports.getAggregatedByMonth(currentMonth);
    const adReports = Store.adReports.getByMonth(currentMonth);
    const allTasks = Store.tasks.getAll();
    const pendingTasks = allTasks
      .filter(t => t.status !== 'completed')
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
      });
    const adsSpend = adAggregated ? adAggregated.spend : 0;
    const monthlyTarget = Store.monthlyTargets.getByMonth(currentMonth);
    const pendingApprovals = scheduledPosts.filter(post => post.approvalStatus === 'pending');
    const today = new Date();
    const userName = window.RemoteStore?.currentUser?.name || '';
    const firstName = userName ? userName.trim().split(/\s+/).slice(-2).join(' ') : '';
    const reach = adAggregated?.reach || 0;
    const engagement = adAggregated?.engagement || 0;
    const clicks = adAggregated?.clicks || 0;
    const ctr = adAggregated?.impressions
      ? (clicks / adAggregated.impressions) * 100
      : 0;

    container.innerHTML = `
      <div class="dashboard-shell">
        <header class="dashboard-welcome dashboard-motion" style="--motion-index: 0">
          <div>
            <h2>Xin chào${firstName ? `, ${Utils.escapeHtml(firstName)}` : ''}</h2>
            <p>Tổng quan marketing <span aria-hidden="true">•</span> ${Utils.formatMonthYear(currentMonth)}</p>
          </div>
          <div class="dashboard-toolbar">
            <div class="month-picker" aria-label="Chọn tháng báo cáo">
              <button class="month-picker-btn" id="dashboardPrevMonthBtn" aria-label="Tháng trước">
                ${Utils.icons.chevronLeft}
              </button>
              <span class="month-picker-label">${Utils.formatMonthYear(currentMonth)}</span>
              <button class="month-picker-btn" id="dashboardNextMonthBtn" aria-label="Tháng sau">
                ${Utils.icons.chevronRight}
              </button>
            </div>
            <div class="dashboard-filter">
              <button class="btn btn-secondary btn-sm" id="dashboardFilterBtn" aria-haspopup="true" aria-expanded="false">
                ${Utils.icons.filter} Bộ lọc ${Utils.icons.chevronRight}
              </button>
              <div class="dashboard-filter-menu" id="dashboardFilterMenu" hidden>
                <button type="button" data-filter="all" class="is-active">Tất cả nền tảng</button>
                <button type="button" data-filter="content">Nội dung</button>
                <button type="button" data-filter="ads">Quảng cáo</button>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="btnExportMonthlyReport" title="Xuất báo cáo tháng dạng CSV">
              ${Utils.icons.download} Xuất báo cáo tháng
            </button>
          </div>
        </header>

        <div class="dashboard-focus-grid">
          <section class="dashboard-focus-panel dashboard-motion" style="--motion-index: 1" aria-labelledby="dashboardPerformanceTitle">
            <div class="dashboard-panel-heading">
              <div>
                <div class="dashboard-title-row">
                  <h3 id="dashboardPerformanceTitle">Hiệu suất nội dung</h3>
                  <span class="dashboard-live-indicator" title="Dữ liệu đang hoạt động" aria-label="Dữ liệu đang hoạt động"></span>
                </div>
                <p>${formatMonthRange(currentMonth, selectedRange)}</p>
              </div>
              <div class="dashboard-range-tabs" aria-label="Khoảng thời gian">
                ${[7, 28, 90].map(range => `
                  <button type="button" data-dashboard-range="${range}" class="${selectedRange === range ? 'is-active' : ''}">
                    ${range} ngày
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="dashboard-metric-strip">
              ${renderMetric('Bài đăng', postsThisMonth.length, 'content', '#60a5fa', 'number')}
              ${renderMetric('Lượt tiếp cận', reach, 'target', '#8b5cf6', 'compact')}
              ${renderMetric('Lượt tương tác', engagement, 'ads', '#2dd4bf', 'compact')}
              ${renderMetric('Tỷ lệ tương tác', ctr, 'trendUp', '#d44df0', 'percent')}
              ${renderMetric('Lượt click', clicks, 'cursor', '#ff7a66', 'compact')}
            </div>

            <div class="dashboard-chart-wrap">
              <div class="dashboard-chart-legend" aria-hidden="true">
                <span class="violet">Lượt tiếp cận</span>
                <span class="cyan">Lượt tương tác</span>
                <span class="gray">Lượt click</span>
              </div>
              <canvas id="dashboardPerformanceChart" aria-label="Biểu đồ hiệu suất nội dung"></canvas>
              <div class="dashboard-chart-empty" id="dashboardChartEmpty" ${adReports.length ? 'hidden' : ''}>
                <span>Chưa có dữ liệu hiệu suất trong tháng này</span>
                <button type="button" data-navigate="ads">Thêm báo cáo quảng cáo</button>
              </div>
            </div>

            <div class="dashboard-focus-lower">
              <div class="dashboard-platforms">
                <div class="dashboard-subheading">Hiệu suất theo nền tảng</div>
                ${renderPlatformPerformance(fanpages, currentMonth)}
              </div>
              <div class="dashboard-featured-campaign">
                <div class="dashboard-subheading">Chiến dịch nổi bật</div>
                ${renderFeaturedCampaign(activeCampaigns)}
              </div>
            </div>
          </section>

          <aside class="dashboard-today-panel dashboard-motion" style="--motion-index: 2" aria-labelledby="dashboardTodayTitle">
            <div class="dashboard-today-header">
              <h3 id="dashboardTodayTitle">Hôm nay</h3>
              <p>${formatToday(today)}</p>
            </div>
            <section class="dashboard-today-section">
              <div class="dashboard-today-section-title">
                <span>Lịch đăng hôm nay</span>
                <span class="dashboard-count-badge">${Math.min(scheduledPosts.length, 3)}</span>
              </div>
              ${renderTodaySchedule(scheduledPosts)}
              <button class="dashboard-text-link" type="button" data-navigate="scheduled">Xem lịch đầy đủ ${Utils.icons.chevronRight}</button>
            </section>
            <section class="dashboard-today-section">
              <div class="dashboard-today-section-title">
                <span>Chờ duyệt</span>
                <span class="dashboard-count-badge">${pendingApprovals.length + pendingTasks.length}</span>
              </div>
              ${renderApprovalQueue(pendingApprovals, pendingTasks)}
              <button class="dashboard-text-link" type="button" data-navigate="tasks">Xem tất cả ${Utils.icons.chevronRight}</button>
            </section>
            <section class="dashboard-today-section">
              <div class="dashboard-today-section-title">
                <span>Sự kiện sắp tới</span>
                <span class="dashboard-count-badge">${upcomingEvents.length}</span>
              </div>
              ${renderCompactEvents(upcomingEvents)}
              <button class="dashboard-text-link" type="button" data-navigate="events">Xem lịch đầy đủ ${Utils.icons.chevronRight}</button>
            </section>
          </aside>
        </div>

        <div class="dashboard-bottom-grid">
          <section class="dashboard-budget-panel dashboard-motion" style="--motion-index: 3">
            ${renderBudgetOverview(monthlyTarget, totalExpenses, adsSpend, currentMonth)}
          </section>
          <section class="dashboard-campaign-panel dashboard-motion" style="--motion-index: 4">
            ${renderCampaignOverview(activeCampaigns)}
          </section>
        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      drawPerformanceChart(currentMonth, selectedRange);
      drawBudgetDonut(monthlyTarget, totalExpenses, adsSpend);
      animateDashboardValues(container);
    });
    attachEventHandlers(container, currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated);

    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = Utils.debounce(() => {
      drawPerformanceChart(currentMonth, selectedRange);
      drawBudgetDonut(monthlyTarget, totalExpenses, adsSpend);
    }, 180);
    window.addEventListener('resize', resizeHandler);
  };

  const formatMonthRange = (currentMonth, range) => {
    const [year, month] = currentMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const endDay = currentMonth === Utils.getCurrentMonth()
      ? Math.min(new Date().getDate(), lastDay)
      : lastDay;
    const startDay = Math.max(1, endDay - Math.min(range, lastDay) + 1);
    const pad = value => String(value).padStart(2, '0');
    return `${pad(startDay)}.${pad(month)}.${year} — ${pad(endDay)}.${pad(month)}.${year}`;
  };

  const formatToday = (date) => {
    const dayNames = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    return `${dayNames[date.getDay()]}, ${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
  };

  const formatMetricValue = (value, format) => {
    if (format === 'compact') return Utils.formatNumberCompact(value);
    if (format === 'percent') return Utils.formatPercent(value);
    if (format === 'currency') return Utils.formatVNDCompact(value);
    return Utils.formatNumber(Math.round(value));
  };

  const renderMetric = (label, value, iconName, color, format = 'number') => {
    const icon = Utils.icons[iconName] || Utils.icons.target;
    return `
      <div class="dashboard-metric">
        <span class="dashboard-metric-icon" style="--metric-color: ${color}">${icon}</span>
        <span class="dashboard-metric-copy">
          <span>${label}</span>
          <strong data-dashboard-value="${Number(value) || 0}" data-dashboard-format="${format}">${formatMetricValue(Number(value) || 0, format)}</strong>
        </span>
      </div>
    `;
  };

  const renderPlatformPerformance = (fanpages, currentMonth) => {
    if (!fanpages.length) {
      return `
        <div class="dashboard-inline-empty">
          <span>Chưa có fanpage để so sánh.</span>
          <button type="button" data-navigate="settings">Thêm fanpage</button>
        </div>
      `;
    }

    const rows = fanpages.slice(0, 4).map(fanpage => {
      const platform = Utils.getPlatformInfo(fanpage.platform);
      const reports = Store.adReports.getByFanpageAndMonth(fanpage.id, currentMonth);
      const reach = reports.reduce((sum, report) => sum + (parseInt(report.reach) || 0), 0);
      const engagement = reports.reduce((sum, report) => sum + (parseInt(report.engagement) || 0), 0);
      const impressions = reports.reduce((sum, report) => sum + (parseInt(report.impressions) || 0), 0);
      const clicks = reports.reduce((sum, report) => sum + (parseInt(report.clicks) || 0), 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      return { fanpage, platform, reach, engagement, ctr };
    });
    const maxReach = Math.max(...rows.map(row => row.reach), 1);

    return `
      <div class="dashboard-platform-list">
        ${rows.map((row, index) => `
          <button type="button" class="dashboard-platform-row" data-navigate="ads" style="--motion-index: ${index + 5}">
            <span class="dashboard-platform-name">
              <span class="dashboard-platform-mark" style="--platform-color: ${row.platform.color}"></span>
              <span>${Utils.escapeHtml(row.fanpage.name || row.platform.name)}</span>
            </span>
            <span class="dashboard-platform-progress" aria-hidden="true">
              <span style="width: ${Math.max(row.reach > 0 ? 12 : 0, Math.round((row.reach / maxReach) * 100))}%; --platform-color: ${row.platform.color}"></span>
            </span>
            <span><small>Lượt tiếp cận</small><strong>${Utils.formatNumberCompact(row.reach)}</strong></span>
            <span><small>Tương tác</small><strong>${Utils.formatNumberCompact(row.engagement)}</strong></span>
            <span><small>CTR</small><strong>${Utils.formatPercent(row.ctr)}</strong></span>
          </button>
        `).join('')}
      </div>
    `;
  };

  const renderFeaturedCampaign = (campaigns) => {
    if (!campaigns.length) {
      return `
        <div class="dashboard-feature-empty">
          <img src="assets/mkt-hub-redesign/event-workshop.png" alt="" loading="lazy">
          <div>
            <strong>Chưa có chiến dịch đang chạy</strong>
            <span>Tạo chiến dịch để theo dõi hiệu suất tập trung.</span>
          </div>
          <button type="button" data-navigate="campaigns">Tạo chiến dịch</button>
        </div>
      `;
    }

    const campaign = campaigns[0];
    const stats = Store.campaigns.getStats(campaign.id);
    return `
      <button type="button" class="dashboard-feature-card" data-campaign-id="${campaign.id}">
        <div class="dashboard-feature-card-head">
          <img src="assets/mkt-hub-redesign/event-workshop.png" alt="" loading="lazy">
          <div>
            <strong>${Utils.escapeHtml(campaign.name)}</strong>
            <span>${campaign.startDate ? Utils.formatDate(campaign.startDate) : 'Đang theo dõi'}${campaign.endDate ? ` — ${Utils.formatDate(campaign.endDate)}` : ''}</span>
          </div>
          <span class="dashboard-status-live"><i></i> Đang chạy</span>
        </div>
        <div class="dashboard-feature-stats">
          <span><small>Lượt tiếp cận</small><strong>${Utils.formatNumberCompact(stats.reach || 0)}</strong></span>
          <span><small>Chi tiêu</small><strong>${Utils.formatVNDCompact(stats.totalSpend)}</strong></span>
          <span><small>ROAS</small><strong>${Utils.formatRatio(stats.roas)}</strong></span>
        </div>
        <span class="dashboard-feature-action">Xem chi tiết ${Utils.icons.chevronRight}</span>
      </button>
    `;
  };

  const getPostImage = (post, index) => {
    const raw = String(post?.mediaUrl || '').trim();
    if (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) return Utils.escapeHtml(raw);
    const fallbacks = [
      'assets/mkt-hub-redesign/content-facebook.png',
      'assets/mkt-hub-redesign/content-tiktok.png',
      'assets/mkt-hub-redesign/event-workshop.png'
    ];
    return fallbacks[index % fallbacks.length];
  };

  const getPostTime = (post) => {
    if (post.scheduledAt) {
      const date = new Date(post.scheduledAt);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }
    return post.time || '—';
  };

  const renderTodaySchedule = (posts) => {
    const sorted = [...posts]
      .sort((a, b) => String(a.scheduledAt || a.date || '').localeCompare(String(b.scheduledAt || b.date || '')))
      .slice(0, 3);
    if (!sorted.length) {
      return '<div class="dashboard-compact-empty">Chưa có bài nào trong lịch đăng.</div>';
    }

    return `
      <div class="dashboard-schedule-list">
        ${sorted.map((post, index) => {
          const fanpage = Store.fanpages.getById(post.fanpageId);
          const platform = Utils.getPlatformInfo(fanpage?.platform);
          return `
            <button type="button" class="dashboard-schedule-row" data-post-id="${post.id}">
              <time>${getPostTime(post)}</time>
              <img src="${getPostImage(post, index)}" alt="" loading="lazy">
              <span>
                <strong>${Utils.escapeHtml(post.title || post.content || 'Bài đăng chưa đặt tiêu đề')}</strong>
                <small>${Utils.escapeHtml(platform.name || 'Nội dung')} · ${post.status === 'failed' ? 'Cần xử lý' : 'Đã lên lịch'}</small>
              </span>
              <i style="--platform-color: ${platform.color || '#8b5cf6'}"></i>
            </button>
          `;
        }).join('')}
      </div>
    `;
  };

  const renderApprovalQueue = (posts, tasks) => {
    const postRows = posts.slice(0, 2).map((post, index) => {
      const fanpage = Store.fanpages.getById(post.fanpageId);
      const platform = Utils.getPlatformInfo(fanpage?.platform);
      return `
        <div class="dashboard-approval-row" data-post-id="${post.id}">
          <img src="${getPostImage(post, index)}" alt="" loading="lazy">
          <span>
            <strong>${Utils.escapeHtml(post.title || post.content || 'Nội dung chờ duyệt')}</strong>
            <small>${Utils.escapeHtml(platform.name || 'Bài đăng')} · Chờ duyệt</small>
          </span>
          <span class="dashboard-approval-actions">
            <button type="button" class="approve" data-approval-action="approved" data-post-id="${post.id}">Duyệt</button>
            <button type="button" data-approval-action="rejected" data-post-id="${post.id}">Từ chối</button>
          </span>
        </div>
      `;
    });

    const taskRows = tasks.slice(0, Math.max(0, 2 - postRows.length)).map(task => `
      <button type="button" class="dashboard-approval-row is-task" data-task-id="${task.id}">
        <span class="dashboard-task-icon">${Utils.icons.tasks}</span>
        <span>
          <strong>${Utils.escapeHtml(task.title)}</strong>
          <small>${task.assignee ? `Phụ trách: ${Utils.escapeHtml(task.assignee)}` : 'Công việc cần xử lý'}</small>
        </span>
        <span class="dashboard-task-priority ${Utils.escapeHtml(task.priority || 'low')}">${Utils.PRIORITIES[task.priority]?.label || 'Thấp'}</span>
      </button>
    `);

    if (!postRows.length && !taskRows.length) {
      return '<div class="dashboard-compact-empty">Không có nội dung hoặc công việc chờ duyệt.</div>';
    }
    return `<div class="dashboard-approval-list">${[...postRows, ...taskRows].join('')}</div>`;
  };

  const renderCompactEvents = (events) => {
    if (!events.length) {
      return '<div class="dashboard-compact-empty">Chưa có sự kiện sắp tới.</div>';
    }

    return `
      <div class="dashboard-compact-events">
        ${events.slice(0, 2).map(event => `
          <button type="button" data-event-id="${event.id}">
            <img src="assets/mkt-hub-redesign/event-workshop.png" alt="" loading="lazy">
            <span>
              <strong>${Utils.escapeHtml(event.name)}</strong>
              <small>${Utils.formatDate(event.date)}${event.startTime ? ` · ${Utils.escapeHtml(event.startTime)}` : ''}</small>
              <small>${event.address ? Utils.escapeHtml(event.address) : 'Đang cập nhật địa điểm'}</small>
            </span>
            ${Utils.icons.calendar}
          </button>
        `).join('')}
      </div>
    `;
  };

  const renderBudgetOverview = (monthlyTarget, totalExpenses, adsSpend, currentMonth) => {
    const budget = parseFloat(monthlyTarget?.totalBudget) || 0;
    const combinedSpend = totalExpenses + adsSpend;
    const percent = budget > 0 ? Math.round((combinedSpend / budget) * 100) : 0;
    const daysInMonth = new Date(
      Number(currentMonth.split('-')[0]),
      Number(currentMonth.split('-')[1]),
      0
    ).getDate();
    return `
      <div class="dashboard-budget-block">
        <div class="dashboard-subheading">Chi phí quảng cáo</div>
        <div class="dashboard-budget-content">
          <div>
            <strong class="dashboard-budget-value">${Utils.formatVNDCompact(adsSpend)}</strong>
            <span class="dashboard-budget-trend">${adsSpend > 0 ? 'Dữ liệu tháng hiện tại' : 'Chưa có chi tiêu ads'}</span>
            <div class="dashboard-budget-progress"><span style="width: ${Math.min(percent, 100)}%"></span></div>
            <small>${budget > 0 ? `${percent}% ngân sách đã sử dụng` : 'Chưa đặt ngân sách tháng'}</small>
            <p>Ngân sách tháng: <strong>${budget > 0 ? Utils.formatVNDCompact(budget) : '—'}</strong></p>
          </div>
          <div class="dashboard-budget-donut"><canvas id="dashboardBudgetDonut" aria-label="Cơ cấu chi phí tháng"></canvas></div>
        </div>
      </div>
      <div class="dashboard-total-cost">
        <div class="dashboard-subheading">Tổng chi phí tháng</div>
        <strong>${Utils.formatVNDCompact(combinedSpend)}</strong>
        <span>Chi phí trung bình / ngày <b>${Utils.formatVNDCompact(combinedSpend / daysInMonth)}</b></span>
        <div class="dashboard-cost-bars" aria-hidden="true">
          ${Array.from({ length: 16 }, (_, index) => `<i style="--bar-index:${index}; height:${18 + ((index * 13) % 42)}%"></i>`).join('')}
        </div>
        <button type="button" data-navigate="expenses">Xem báo cáo chi tiết</button>
      </div>
    `;
  };

  const renderCampaignOverview = (campaigns) => {
    return `
      <div class="dashboard-panel-heading">
        <div>
          <h3>Chiến dịch đang chạy</h3>
          <p>${campaigns.length} chiến dịch đang hoạt động</p>
        </div>
        <span class="dashboard-count-badge">${campaigns.length}</span>
      </div>
      ${campaigns.length ? `
        <div class="dashboard-campaign-list">
          ${campaigns.slice(0, 4).map((campaign, index) => {
            const stats = Store.campaigns.getStats(campaign.id);
            return `
              <button type="button" data-campaign-id="${campaign.id}">
                <img src="${index % 2 ? 'assets/mkt-hub-redesign/content-tiktok.png' : 'assets/mkt-hub-redesign/content-facebook.png'}" alt="" loading="lazy">
                <span><strong>${Utils.escapeHtml(campaign.name)}</strong><small>${stats.postCount} bài · ${stats.adCount} ads</small></span>
                <em><i></i> Đang chạy</em>
                <b>${Utils.formatVNDCompact(stats.totalSpend)}</b>
                <small>${Utils.formatRatio(stats.roas)}</small>
              </button>
            `;
          }).join('')}
        </div>
      ` : '<div class="dashboard-compact-empty dashboard-campaign-empty">Chưa có chiến dịch đang chạy.</div>'}
      <button class="dashboard-panel-footer-link" type="button" data-navigate="campaigns">Xem tất cả chiến dịch</button>
    `;
  };

  const buildPerformanceSeries = (currentMonth, range) => {
    const reports = Store.adReports.getByMonth(currentMonth);
    const [year, month] = currentMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const currentDay = currentMonth === Utils.getCurrentMonth()
      ? Math.min(new Date().getDate(), lastDay)
      : lastDay;
    const days = Math.max(1, Math.min(range, currentDay));
    const startDay = Math.max(1, currentDay - days + 1);
    const byDate = {};
    reports.forEach(report => {
      if (!byDate[report.date]) byDate[report.date] = { reach: 0, engagement: 0, clicks: 0 };
      byDate[report.date].reach += parseInt(report.reach) || 0;
      byDate[report.date].engagement += parseInt(report.engagement) || 0;
      byDate[report.date].clicks += parseInt(report.clicks) || 0;
    });

    const labels = [];
    const reach = [];
    const engagement = [];
    const clicks = [];
    for (let day = startDay; day <= currentDay; day += 1) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      labels.push(`${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`);
      reach.push(byDate[date]?.reach || 0);
      engagement.push(byDate[date]?.engagement || 0);
      clicks.push(byDate[date]?.clicks || 0);
    }
    return { labels, reach, engagement, clicks };
  };

  const drawPerformanceChart = (currentMonth, range) => {
    const canvas = document.getElementById('dashboardPerformanceChart');
    if (!canvas) return;
    const series = buildPerformanceSeries(currentMonth, range);
    Chart.drawLine(canvas, [
      { data: series.reach, color: '#a855f7', fill: true },
      { data: series.engagement, color: '#2dd4bf', fill: false },
      { data: series.clicks, color: '#7a7f87', fill: false }
    ], {
      labels: series.labels,
      height: Math.max(220, canvas.parentElement.clientHeight),
      padding: { top: 56, right: 20, bottom: 40, left: 60 }
    });
  };

  const drawBudgetDonut = (monthlyTarget, totalExpenses, adsSpend) => {
    const canvas = document.getElementById('dashboardBudgetDonut');
    if (!canvas) return;
    const combinedSpend = totalExpenses + adsSpend;
    const budget = parseFloat(monthlyTarget?.totalBudget) || combinedSpend;
    const remaining = Math.max(0, budget - combinedSpend);
    Chart.drawDonut(canvas, [
      { value: adsSpend, color: '#8b5cf6' },
      { value: totalExpenses, color: '#2dd4bf' },
      { value: remaining, color: '#32343a' }
    ], { size: 118 });
  };

  const animateDashboardValues = (container) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    container.querySelectorAll('[data-dashboard-value]').forEach(element => {
      const target = Number(element.dataset.dashboardValue) || 0;
      const format = element.dataset.dashboardFormat || 'number';
      const duration = 720;
      const start = performance.now();
      const tick = now => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = formatMetricValue(target * eased, format);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
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
      const imageUrl = (fp.imageUrl || '').trim();
      const kpiTarget = fp.kpis?.[currentMonth] || 0;
      const posted = Store.posts.getCountByFanpageAndMonth(fp.id, currentMonth);
      const percent = kpiTarget > 0 ? Math.round((posted / kpiTarget) * 100) : 0;
      const colorClass = Utils.getKpiColor(percent);

      return `
        <div class="kpi-item">
          <div class="kpi-platform-icon ${platform.cssClass}">
            ${imageUrl ? `
              <img src="${Utils.escapeHtml(imageUrl)}" alt="${Utils.escapeHtml(fp.name)}" loading="lazy" onerror="this.parentElement.classList.add('is-fallback'); this.remove();">
            ` : ''}
            <span class="kpi-platform-fallback">${platform.icon}</span>
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
        legendItems.push({ name: catInfo.name, icon: Utils.getExpenseCategoryIcon(cat, catInfo), color: catInfo.color, amount });
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
            <span class="donut-legend-label"><span class="expense-inline-icon">${item.icon}</span> ${Utils.escapeHtml(item.name)}</span>
            <span class="donut-legend-value">${Utils.formatVNDCompact(item.amount)}</span>
          </div>
        `).join('');
      }
    }
  };

  // ── Active Campaigns ──
  const renderActiveCampaigns = (campaigns) => {
    if (campaigns.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-icon"></div>
          <div class="empty-state-title">Chưa có chiến dịch</div>
          <div class="empty-state-desc">Tạo chiến dịch để gom bài đăng, ads & chi phí</div>
        </div>
      `;
    }

    return '<div class="event-widget-list">' + campaigns.slice(0, 5).map(c => {
      const stats = Store.campaigns.getStats(c.id);
      const budget = parseFloat(c.budget) || 0;
      const percent = budget > 0 ? Math.round((stats.totalSpend / budget) * 100) : 0;
      const barColor = percent > 100 ? 'var(--danger-400)' : percent > 90 ? 'var(--warning-400)' : 'var(--success-400)';

      return `
        <div class="event-widget-item" data-campaign-id="${c.id}" tabindex="0" role="button" aria-label="Xem chiến dịch">
          <div class="event-widget-info">
            <div class="event-widget-name">${Utils.escapeHtml(c.name)}</div>
            <div class="event-widget-meta">
              ${stats.postCount} bài • ${stats.adCount} ads • ${Utils.formatVNDCompact(stats.totalSpend)}${budget > 0 ? ` / ${Utils.formatVNDCompact(budget)}` : ''}
            </div>
            ${budget > 0 ? `
              <div class="progress-bar-container" style="height: 5px; margin-top: 4px;">
                <div class="progress-bar-fill" style="width: ${Math.min(percent, 100)}%; background: ${barColor};"></div>
              </div>
            ` : ''}
          </div>
          ${stats.adSpend > 0 ? `<span class="tag tag-status-ongoing">ROAS ${Utils.formatRatio(stats.roas)}</span>` : ''}
        </div>
      `;
    }).join('') + '</div>';
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
        <div class="event-widget-item" data-event-id="${event.id}" tabindex="0" role="button" aria-label="Xem sự kiện">
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
        <div class="task-widget-item priority-${priority}" data-task-id="${task.id}" style="${overdueStyle}" tabindex="0" role="button" aria-label="Xem công việc">
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

      if (sparkSpend) Chart.drawSparkline(sparkSpend, spendData, '#6a4cf5');
      if (sparkReach) Chart.drawSparkline(sparkReach, reachData, '#0099ff');
      if (sparkConversions) Chart.drawSparkline(sparkConversions, convData, '#ff5577');
      if (sparkCpc) Chart.drawSparkline(sparkCpc, cpcData, '#ff7a3d');
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
  const attachEventHandlers = (container, currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated) => {
    container.querySelectorAll('[data-navigate]').forEach(element => {
      element.addEventListener('click', () => App.navigate(element.dataset.navigate));
    });
    container.querySelectorAll('[data-event-id]').forEach(element => {
      element.addEventListener('click', () => App.navigate('events'));
    });
    container.querySelectorAll('[data-campaign-id]').forEach(element => {
      element.addEventListener('click', () => App.navigate('campaigns'));
    });
    container.querySelectorAll('[data-task-id]').forEach(element => {
      element.addEventListener('click', () => App.navigate('tasks'));
    });
    container.querySelectorAll('.dashboard-schedule-row[data-post-id]').forEach(element => {
      element.addEventListener('click', () => App.navigate('scheduled'));
    });

    container.querySelectorAll('[data-dashboard-range]').forEach(button => {
      button.addEventListener('click', () => {
        selectedRange = Number(button.dataset.dashboardRange) || 28;
        render(container);
      });
    });

    container.querySelectorAll('[data-approval-action]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const postId = button.dataset.postId;
        const approvalStatus = button.dataset.approvalAction;
        if (!postId || !approvalStatus) return;
        Store.posts.update(postId, { approvalStatus });
        Toast.success(approvalStatus === 'approved' ? 'Đã duyệt bài đăng.' : 'Đã từ chối bài đăng.');
        render(container);
      });
    });

    const filterButton = container.querySelector('#dashboardFilterBtn');
    const filterMenu = container.querySelector('#dashboardFilterMenu');
    filterButton?.addEventListener('click', event => {
      event.stopPropagation();
      const shouldOpen = filterMenu.hasAttribute('hidden');
      filterMenu.toggleAttribute('hidden', !shouldOpen);
      filterButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    });
    filterMenu?.querySelectorAll('[data-filter]').forEach(button => {
      button.addEventListener('click', () => {
        filterMenu.querySelectorAll('[data-filter]').forEach(item => item.classList.remove('is-active'));
        button.classList.add('is-active');
        container.querySelector('.dashboard-shell')?.setAttribute('data-dashboard-filter', button.dataset.filter);
        filterMenu.setAttribute('hidden', '');
        filterButton?.setAttribute('aria-expanded', 'false');
      });
    });

    if (documentClickHandler) document.removeEventListener('click', documentClickHandler);
    documentClickHandler = event => {
      if (!filterMenu || !filterButton || filterMenu.hasAttribute('hidden')) return;
      if (filterMenu.contains(event.target) || filterButton.contains(event.target)) return;
      filterMenu.setAttribute('hidden', '');
      filterButton.setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('click', documentClickHandler);

    container.querySelector('#btnExportMonthlyReport')?.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMonthlyReport(currentMonth, fanpages, postsThisMonth, events, totalExpenses, adsSpend, adAggregated);
    });

    container.querySelector('#dashboardPrevMonthBtn')?.addEventListener('click', () => {
      Utils.setReportingMonth(Utils.getPrevMonth(currentMonth));
      render(container);
    });

    container.querySelector('#dashboardNextMonthBtn')?.addEventListener('click', () => {
      Utils.setReportingMonth(Utils.getNextMonth(currentMonth));
      render(container);
    });
  };

  return { render };

})();

App.registerPage('dashboard', DashboardPage);
