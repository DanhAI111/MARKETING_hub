/* ═══════════════════════════════════════════
   MARKETING HUB - Ads Performance Page
   Track advertising spend, conversions, CPC, ROAS
   ═══════════════════════════════════════════ */

const AdsPage = (() => {
  let container = null;
  let currentMonth = Utils.getReportingMonth();
  let selectedPlatform = '';
  let selectedFanpage = '';
  let activeTab = 'summary'; // 'summary' or 'history'
  let compareMode = false; // C1: Month-over-month comparison toggle

  // ── Column auto-detection keywords ──
  const COLUMN_KEYWORDS = {
    date: ['date', 'ngày', 'ngay', 'day', 'thời gian', 'thoi gian', 'reporting', 'ngày báo cáo', 'ngay bao cao'],
    spend: ['spend', 'chi tiêu', 'chi tieu', 'chi phí', 'chi phi', 'cost', 'amount spent', 'amount_spent', 'số tiền', 'so tien', 'ngân sách', 'ngan sach'],
    reach: ['reach', 'tiếp cận', 'tiep can', 'lượt tiếp cận', 'luot tiep can', 'people reached'],
    impressions: ['impression', 'hiển thị', 'hien thi', 'lượt hiển thị', 'luot hien thi', 'views', 'lượt xem'],
    clicks: ['click', 'lượt click', 'luot click', 'link click', 'link_click', 'nhấp', 'nhap'],
    messages: ['message', 'tin nhắn', 'tin nhan', 'messaging', 'conversation', 'cuộc trò chuyện'],
    conversions: ['conversion', 'chuyển đổi', 'chuyen doi', 'purchase', 'lead', 'result', 'kết quả', 'ket qua'],
    engagement: ['engagement', 'tương tác', 'tuong tac', 'reaction', 'post_engagement', 'lượt tương tác'],
    revenue: ['revenue', 'doanh thu', 'doanh_thu', 'sales', 'purchase value', 'conversion_value', 'giá trị']
  };

  const IMPORT_FIELDS = [
    { key: 'date', label: 'Ngày', required: true },
    { key: 'spend', label: 'Chi tiêu (₫)', required: true },
    { key: 'reach', label: 'Lượt tiếp cận', required: false },
    { key: 'impressions', label: 'Lượt hiển thị', required: false },
    { key: 'clicks', label: 'Clicks', required: false },
    { key: 'messages', label: 'Tin nhắn', required: false },
    { key: 'conversions', label: 'Chuyển đổi', required: false },
    { key: 'engagement', label: 'Tương tác', required: false },
    { key: 'revenue', label: 'Doanh thu', required: false }
  ];

  // ── Render ──

  const render = (el) => {
    container = el;
    currentMonth = Utils.getReportingMonth();
    selectedPlatform = '';
    selectedFanpage = '';
    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    const reports = getFilteredReports();
    const fanpages = Store.fanpages.getAll();
    const stats = calculateStats(reports);

    // C1: Previous month stats for comparison
    const prevMonth = Utils.getPrevMonth(currentMonth);
    const prevReports = compareMode ? Store.adReports.getByMonth(prevMonth) : [];
    const prevStats = compareMode ? calculateStats(prevReports) : null;

    // Filter fanpages by platform if selected
    const dropdownFanpages = selectedPlatform 
      ? fanpages.filter(f => f.platform === selectedPlatform)
      : fanpages;

    container.innerHTML = `
      <!-- Overview KPI Cards -->
      <div class="ads-metric-cards">
        <div class="ads-metric-card spend">
          <div class="stat-card-label">Tổng chi tiêu Ads</div>
          <div class="stat-card-value">${Utils.formatVND(stats.spend)}</div>
          ${compareMode && prevStats ? renderMoMDelta(stats.spend, prevStats.spend, true) : `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Tháng ${currentMonth.split('-')[1]}</div>`}
        </div>
        <div class="ads-metric-card reach">
          <div class="stat-card-label">Tổng lượt tiếp cận</div>
          <div class="stat-card-value">${Utils.formatNumber(stats.reach)}</div>
          ${compareMode && prevStats ? renderMoMDelta(stats.reach, prevStats.reach) : `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Lượt tiếp cận</div>`}
        </div>
        <div class="ads-metric-card conversions">
          <div class="stat-card-label">Tổng chuyển đổi</div>
          <div class="stat-card-value">${Utils.formatNumber(stats.conversions)}</div>
          ${compareMode && prevStats ? renderMoMDelta(stats.conversions, prevStats.conversions) : `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Số chuyển đổi thành công</div>`}
        </div>
        <div class="ads-metric-card roas">
          <div class="stat-card-label">ROAS trung bình</div>
          <div class="stat-card-value ${stats.roas >= 1.5 ? 'text-success' : stats.roas > 0 ? 'text-warning' : ''}">${stats.roas.toFixed(2)}x</div>
          ${compareMode && prevStats ? renderMoMDelta(stats.roas, prevStats.roas) : `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Doanh thu / Chi phí</div>`}
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
          <select class="filter-select" id="platformFilter">
            <option value="">Tất cả nền tảng</option>
            ${Object.entries(Utils.PLATFORMS)
              .filter(([k]) => k === 'facebook' || k === 'instagram') // Ads are usually on FB/IG
              .map(([k, v]) => `<option value="${k}" ${selectedPlatform === k ? 'selected' : ''}>${v.name}</option>`)
              .join('')}
          </select>

          <!-- Fanpage Filter -->
          <select class="filter-select" id="fanpageFilter">
            <option value="">Tất cả Fanpage</option>
            ${dropdownFanpages.map(fp => 
              `<option value="${fp.id}" ${selectedFanpage === fp.id ? 'selected' : ''}>${Utils.escapeHtml(fp.name)}</option>`
            ).join('')}
          </select>
        </div>

        <div class="toolbar-right">
          <button class="btn ${compareMode ? 'btn-primary' : 'btn-secondary'}" id="toggleCompareBtn" style="${compareMode ? '' : 'opacity: 0.75;'}">
            ${Utils.icons.ads}
            <span>So sánh tháng trước</span>
          </button>
          <button class="btn btn-secondary" id="importFileBtn" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.25); color: var(--success-400);">
            ${Utils.icons.upload}
            <span>Tải lên File</span>
          </button>
          <button class="btn btn-primary" id="addAdReportBtn">
            ${Utils.icons.plus}
            <span>Nhập thủ công</span>
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs" style="margin-bottom: var(--space-4);">
        <button class="tab-item ${activeTab === 'summary' ? 'active' : ''}" id="tabSummaryBtn">Hiệu quả Fanpage</button>
        <button class="tab-item ${activeTab === 'history' ? 'active' : ''}" id="tabHistoryBtn">Lịch sử báo cáo</button>
      </div>

      <!-- Tab Content -->
      <div id="adsContent">
        ${activeTab === 'summary' ? renderSummaryView(reports, fanpages, prevStats) : renderHistoryView(reports, fanpages)}
      </div>
    `;

    if (activeTab === 'summary') {
      drawTrendLineChart(reports);
    }

    bindEvents();
  };

  // ── C1: MoM Delta Renderer ──

  const renderMoMDelta = (current, previous, invertColor = false) => {
    if (previous === 0 && current === 0) {
      return `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">— so với tháng trước</div>`;
    }
    if (previous === 0) {
      return `<div style="font-size: 11px; color: var(--success-400); margin-top: 4px;">↑ mới</div>`;
    }
    const pctChange = ((current - previous) / previous) * 100;
    const isUp = pctChange >= 0;
    // For spend, going up is bad (red), going down is good (green) when invertColor=true
    const color = invertColor
      ? (isUp ? 'var(--danger-400)' : 'var(--success-400)')
      : (isUp ? 'var(--success-400)' : 'var(--danger-400)');
    const arrow = isUp ? '↑' : '↓';
    const fmtPct = Math.abs(pctChange).toFixed(1);
    return `<div style="font-size: 11px; color: ${color}; margin-top: 4px; font-weight: var(--weight-medium);">${arrow} ${fmtPct}%</div>`;
  };

  // ── Helpers ──

  const getFilteredReports = () => {
    let list = Store.adReports.getByMonth(currentMonth);
    
    if (selectedFanpage) {
      list = list.filter(r => r.fanpageId === selectedFanpage);
    } else if (selectedPlatform) {
      const platformFpIds = Store.fanpages.getAll()
        .filter(fp => fp.platform === selectedPlatform)
        .map(fp => fp.id);
      list = list.filter(r => platformFpIds.includes(r.fanpageId));
    }
    
    return list.sort((a, b) => b.date.localeCompare(a.date)); // Newest date first
  };

  const calculateStats = (reports) => {
    const totalSpend = reports.reduce((sum, r) => sum + (parseFloat(r.spend) || 0), 0);
    const totalReach = reports.reduce((sum, r) => sum + (parseInt(r.reach) || 0), 0);
    const totalConversions = reports.reduce((sum, r) => sum + (parseInt(r.conversions) || 0), 0);
    const totalRevenue = reports.reduce((sum, r) => sum + (parseFloat(r.revenue) || 0), 0);
    const totalClicks = reports.reduce((sum, r) => sum + (parseInt(r.clicks) || 0), 0);
    const totalImpressions = reports.reduce((sum, r) => sum + (parseInt(r.impressions) || 0), 0);
    const totalMessages = reports.reduce((sum, r) => sum + (parseInt(r.messages) || 0), 0);
    const totalEngagement = reports.reduce((sum, r) => sum + (parseInt(r.engagement) || 0), 0);

    return {
      spend: totalSpend,
      reach: totalReach,
      impressions: totalImpressions,
      clicks: totalClicks,
      messages: totalMessages,
      conversions: totalConversions,
      engagement: totalEngagement,
      revenue: totalRevenue,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      costPerMessage: totalMessages > 0 ? totalSpend / totalMessages : 0,
      roas: totalSpend > 0 ? totalRevenue / totalSpend : 0
    };
  };

  // ── Render Views ──

  const renderSummaryView = (reports, fanpages, prevStats) => {
    // Group reports by Fanpage
    const fanpagesToRender = selectedFanpage 
      ? fanpages.filter(f => f.id === selectedFanpage)
      : (selectedPlatform ? fanpages.filter(f => f.platform === selectedPlatform) : fanpages);

    // Filter out fanpages that are not FB or IG
    const targetFanpages = fanpagesToRender.filter(f => f.platform === 'facebook' || f.platform === 'instagram');

    if (reports.length === 0) {
      return `
        <div class="ads-empty-workspace">
          <section class="ads-empty-analysis">
            <div class="queue-header">
              <div>
                <div class="panel-kicker">Performance trend</div>
                <h2>Xu hướng hiệu quả Ads</h2>
                <p>Biểu đồ sẽ tự động hiển thị sau khi có dữ liệu báo cáo đầu tiên.</p>
              </div>
            </div>
            <div class="queue-empty">
              <span>${Utils.icons.ads}</span>
              <strong>Chưa có dữ liệu báo cáo quảng cáo</strong>
              <p>Tải file từ nền tảng quảng cáo hoặc nhập báo cáo ngày để bắt đầu phân tích.</p>
            </div>
          </section>
          <aside class="context-rail ads-readiness-rail">
            <div class="context-rail-heading">
              <span>Sẵn sàng phân tích</span>
              <span class="live-indicator">Live</span>
            </div>
            <section class="context-block">
              <div class="context-block-title">Nguồn dữ liệu</div>
              <div class="context-metric-row"><span>Fanpage đã chọn</span><strong>${selectedFanpage ? 1 : targetFanpages.length}</strong></div>
              <div class="context-metric-row"><span>Báo cáo tháng này</span><strong>0</strong></div>
              <div class="context-metric-row"><span>So sánh kỳ trước</span><strong>${compareMode ? 'Bật' : 'Tắt'}</strong></div>
            </section>
            <section class="context-block">
              <div class="context-block-title">Bước tiếp theo</div>
              <div class="context-empty">Dùng “Tải lên File” để nhập nhanh hoặc “Nhập thủ công” cho báo cáo đầu tiên.</div>
            </section>
          </aside>
        </div>
      `;
    }

    // C2: Get budget target for the month
    const monthTargets = Store.monthlyTargets.getByMonth(currentMonth);
    const totalBudget = monthTargets?.adsBudget || 0;

    const rowsData = targetFanpages.map(fp => {
      const fpReports = reports.filter(r => r.fanpageId === fp.id);
      return {
        fp,
        stats: calculateStats(fpReports)
      };
    }).filter(row => row.stats.spend > 0 || row.stats.reach > 0); // Only show fanpages with active spend/data

    // C2: Calculate per-fanpage budget (split evenly if no per-fanpage budget)
    const fpBudget = rowsData.length > 0 && totalBudget > 0 ? totalBudget / rowsData.length : 0;

    const grandStats = calculateStats(reports);

    return `
      <!-- Line Chart -->
      <div class="card" style="margin-bottom: var(--space-5);">
        <div class="card-header">
          <div>
            <div class="card-title">Line Chart — Xu hướng chi tiêu Ads hàng ngày</div>
            <div class="card-subtitle">Xu hướng chi tiêu tích lũy theo ngày trong tháng</div>
          </div>
        </div>
        <div class="card-body">
          <div class="chart-container" style="height: 220px;">
            <canvas id="adsDailySpendCanvas"></canvas>
          </div>
        </div>
      </div>

      <!-- Comparison Table -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Bảng so sánh hiệu quả chiến dịch các Fanpage</div>
        </div>
        <div class="card-body table-container" style="padding: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fanpage</th>
                <th class="text-right">Spend</th>
                <th class="text-right">Reach</th>
                <th class="text-right">Impressions</th>
                <th class="text-right">Clicks</th>
                <th class="text-right">CPC</th>
                <th class="text-right">CPM</th>
                <th class="text-right">Messages</th>
                <th class="text-right">Cost/Msg</th>
                <th class="text-right">Conversions</th>
                <th class="text-right">Engagement</th>
                <th class="text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              ${rowsData.length === 0 ? `
                <tr>
                  <td colspan="12" class="text-center" style="color: var(--text-tertiary); padding: var(--space-4) 0;">
                    Không có dữ liệu chi tiêu ads cho các fanpage này.
                  </td>
                </tr>
              ` : rowsData.map(row => {
                const plat = Utils.getPlatformInfo(row.fp.platform);
                // C2: Budget progress bar calculation
                const spendRatio = fpBudget > 0 ? (row.stats.spend / fpBudget) * 100 : 0;
                const progressColor = spendRatio > 100 ? 'var(--danger-400)' : spendRatio >= 80 ? 'var(--warning-400)' : 'var(--success-400)';
                return `
                  <tr>
                    <td style="font-weight: var(--weight-medium); color: var(--text-primary); white-space: nowrap;">
                      <div><span style="margin-right: 4px;">${plat.icon}</span> ${Utils.escapeHtml(row.fp.name)}</div>
                      ${fpBudget > 0 ? `
                        <div style="margin-top: 4px;">
                          <div style="height: 4px; border-radius: 2px; background: var(--bg-elevated); width: 100%; overflow: hidden;">
                            <div style="height: 100%; border-radius: 2px; background: ${progressColor}; width: ${Math.min(spendRatio, 100)}%; transition: width 0.3s ease;"></div>
                          </div>
                          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">${spendRatio.toFixed(0)}% ngân sách</div>
                        </div>
                      ` : ''}
                    </td>
                    <td class="text-right font-mono" style="color: var(--text-primary); font-weight: var(--weight-semibold);">${Utils.formatVNDCompact(row.stats.spend)}</td>
                    <td class="text-right font-mono">${Utils.formatNumberCompact(row.stats.reach)}</td>
                    <td class="text-right font-mono">${Utils.formatNumberCompact(row.stats.impressions)}</td>
                    <td class="text-right font-mono">${Utils.formatNumber(row.stats.clicks)}</td>
                    <td class="text-right font-mono">${Utils.formatVNDCompact(row.stats.cpc)}</td>
                    <td class="text-right font-mono">${Utils.formatVNDCompact(row.stats.cpm)}</td>
                    <td class="text-right font-mono">${Utils.formatNumber(row.stats.messages)}</td>
                    <td class="text-right font-mono">${Utils.formatVNDCompact(row.stats.costPerMessage)}</td>
                    <td class="text-right font-mono">${Utils.formatNumber(row.stats.conversions)}</td>
                    <td class="text-right font-mono">${Utils.formatNumberCompact(row.stats.engagement)}</td>
                    <td class="text-right font-mono" style="font-weight: var(--weight-semibold); color: ${row.stats.roas >= 1.5 ? 'var(--success-400)' : 'var(--text-primary)'}">${row.stats.roas.toFixed(2)}x</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            ${rowsData.length > 0 ? `
              <tfoot>
                <tr style="background: var(--bg-table-header); font-weight: var(--weight-bold); border-top: 2px solid var(--border-default);">
                  <td>TỔNG CỘNG / TB:</td>
                  <td class="text-right font-mono" style="color: var(--primary-400);">${Utils.formatVND(grandStats.spend)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(grandStats.reach)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(grandStats.impressions)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(grandStats.clicks)}</td>
                  <td class="text-right font-mono">${Utils.formatVND(grandStats.cpc)}</td>
                  <td class="text-right font-mono">${Utils.formatVND(grandStats.cpm)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(grandStats.messages)}</td>
                  <td class="text-right font-mono">${Utils.formatVND(grandStats.costPerMessage)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(grandStats.conversions)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(grandStats.engagement)}</td>
                  <td class="text-right font-mono" style="color: var(--success-400);">${grandStats.roas.toFixed(2)}x</td>
                </tr>
              </tfoot>
            ` : ''}
          </table>
        </div>
      </div>

      <!-- C3: Fanpage Comparison Chart -->
      ${rowsData.length > 1 ? renderFanpageComparisonChart(rowsData) : ''}
    `;
  };

  // ── C3: Fanpage Comparison Chart (horizontal CSS bars) ──

  const renderFanpageComparisonChart = (rowsData) => {
    // Sort by spend descending
    const sorted = [...rowsData].sort((a, b) => b.stats.spend - a.stats.spend);
    const maxSpend = Math.max(...sorted.map(r => r.stats.spend)) || 1;
    const maxReach = Math.max(...sorted.map(r => r.stats.reach)) || 1;
    const maxConversions = Math.max(...sorted.map(r => r.stats.conversions)) || 1;

    const renderBar = (value, max, color, label) => {
      const pct = max > 0 ? (value / max) * 100 : 0;
      return `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
          <div style="flex: 1; height: 18px; border-radius: 3px; background: var(--bg-elevated); overflow: hidden; position: relative;">
            <div style="height: 100%; border-radius: 3px; background: ${color}; width: ${pct}%; transition: width 0.3s ease; min-width: ${pct > 0 ? '2px' : '0'};"></div>
          </div>
          <span class="font-mono" style="font-size: 11px; color: var(--text-secondary); min-width: 70px; text-align: right;">${label}</span>
        </div>
      `;
    };

    return `
      <div class="card" style="margin-top: var(--space-5);">
        <div class="card-header">
          <div class="card-title">So sánh hiệu quả giữa các Fanpage</div>
        </div>
        <div class="card-body">
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-5);">
            <!-- Spend column -->
            <div>
              <div style="font-size: var(--text-xs); color: var(--text-muted); font-weight: var(--weight-semibold); text-transform: uppercase; margin-bottom: var(--space-3); letter-spacing: 0.5px;">Chi tiêu</div>
              ${sorted.map(row => {
                const plat = Utils.getPlatformInfo(row.fp.platform);
                return `
                  <div style="margin-bottom: var(--space-3);">
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      <span>${plat.icon}</span> ${Utils.escapeHtml(row.fp.name)}
                    </div>
                    ${renderBar(row.stats.spend, maxSpend, '#6a4cf5', Utils.formatVNDCompact(row.stats.spend))}
                  </div>
                `;
              }).join('')}
            </div>
            <!-- Reach column -->
            <div>
              <div style="font-size: var(--text-xs); color: var(--text-muted); font-weight: var(--weight-semibold); text-transform: uppercase; margin-bottom: var(--space-3); letter-spacing: 0.5px;">Tiếp cận</div>
              ${sorted.map(row => {
                const plat = Utils.getPlatformInfo(row.fp.platform);
                return `
                  <div style="margin-bottom: var(--space-3);">
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      <span>${plat.icon}</span> ${Utils.escapeHtml(row.fp.name)}
                    </div>
                    ${renderBar(row.stats.reach, maxReach, '#0099ff', Utils.formatNumberCompact(row.stats.reach))}
                  </div>
                `;
              }).join('')}
            </div>
            <!-- Conversions column -->
            <div>
              <div style="font-size: var(--text-xs); color: var(--text-muted); font-weight: var(--weight-semibold); text-transform: uppercase; margin-bottom: var(--space-3); letter-spacing: 0.5px;">Chuyển đổi</div>
              ${sorted.map(row => {
                const plat = Utils.getPlatformInfo(row.fp.platform);
                return `
                  <div style="margin-bottom: var(--space-3);">
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      <span>${plat.icon}</span> ${Utils.escapeHtml(row.fp.name)}
                    </div>
                    ${renderBar(row.stats.conversions, maxConversions, '#ff5577', Utils.formatNumber(row.stats.conversions))}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  };

  const renderHistoryView = (reports, fanpages) => {
    if (reports.length === 0) {
      return `
        <div class="empty-state" style="padding: var(--space-8) 0;">
          <div class="empty-state-icon"></div>
          <div class="empty-state-title">Chưa có bản ghi nào</div>
          <div class="empty-state-desc">Danh sách trống. Nhấp "Nhập Báo Cáo" để thêm mới báo cáo hàng ngày.</div>
        </div>
      `;
    }

    return `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Fanpage</th>
              <th class="text-right">Chi tiêu</th>
              <th class="text-right">Lượt Clicks</th>
              <th class="text-right">Tin nhắn</th>
              <th class="text-right">Chuyển đổi</th>
              <th class="text-right">Doanh thu</th>
              <th style="width: 80px;" class="text-center">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${reports.map(r => {
              const fp = fanpages.find(f => f.id === r.fanpageId) || { name: 'Fanpage đã xóa', platform: 'facebook' };
              const plat = Utils.getPlatformInfo(fp.platform);
              return `
                <tr>
                  <td style="white-space: nowrap; font-family: var(--font-mono);">${Utils.formatDateShort(r.date)}</td>
                  <td style="font-weight: var(--weight-medium); color: var(--text-primary);">
                    <span style="margin-right: 4px;">${plat.icon}</span> ${Utils.escapeHtml(fp.name)}
                  </td>
                  <td class="text-right font-mono" style="font-weight: var(--weight-semibold); color: var(--text-primary);">${Utils.formatVND(r.spend)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(r.clicks)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(r.messages)}</td>
                  <td class="text-right font-mono">${Utils.formatNumber(r.conversions)}</td>
                  <td class="text-right font-mono">${Utils.formatVND(r.revenue)}</td>
                  <td class="text-center">
                    <div style="display: flex; gap: var(--space-1); justify-content: center;">
                      <button class="btn btn-icon btn-ghost btn-sm edit-report-btn" data-id="${r.id}" data-tooltip="Chỉnh sửa">
                        ${Utils.icons.edit}
                      </button>
                      <button class="btn btn-icon btn-ghost btn-sm delete-report-btn" data-id="${r.id}" data-tooltip="Xóa">
                        ${Utils.icons.trash}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  // ── Draw Daily Spend Line Chart ──

  const drawTrendLineChart = (reports) => {
    const canvas = document.getElementById('adsDailySpendCanvas');
    if (!canvas) return;

    // Get number of days in the current selected month
    const parts = currentMonth.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const lastDay = new Date(year, month + 1, 0).getDate();

    const labels = [];
    const spendData = [];

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${currentMonth}-${String(d).padStart(2, '0')}`;
      labels.push(`${d}`);
      
      const dayReports = reports.filter(r => r.date === dateStr);
      const spendSum = dayReports.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
      spendData.push(spendSum);
    }

    Chart.drawLine(
      canvas, 
      [{ label: 'Chi tiêu (₫)', data: spendData, color: '#6a4cf5', fill: true }], 
      { labels }
    );
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

    // Platform Filter
    container.querySelector('#platformFilter')?.addEventListener('change', (e) => {
      selectedPlatform = e.target.value;
      selectedFanpage = ''; // Reset selected fanpage when platform changes
      renderPage();
    });

    // Fanpage Filter
    container.querySelector('#fanpageFilter')?.addEventListener('change', (e) => {
      selectedFanpage = e.target.value;
      renderPage();
    });

    // C1: Toggle MoM comparison
    container.querySelector('#toggleCompareBtn')?.addEventListener('click', () => {
      compareMode = !compareMode;
      renderPage();
    });

    // Add Report Button
    container.querySelector('#addAdReportBtn')?.addEventListener('click', () => {
      openAdReportModal();
    });

    // Import File Button
    container.querySelector('#importFileBtn')?.addEventListener('click', () => {
      openImportFileModal();
    });

    // Tabs
    container.querySelector('#tabSummaryBtn')?.addEventListener('click', () => {
      activeTab = 'summary';
      renderPage();
    });

    container.querySelector('#tabHistoryBtn')?.addEventListener('click', () => {
      activeTab = 'history';
      renderPage();
    });

    // Row Actions in History View
    container.querySelectorAll('.edit-report-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const report = Store.adReports.getById(id);
        if (report) openAdReportModal(report);
      });
    });

    container.querySelectorAll('.delete-report-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const report = Store.adReports.getById(id);
        if (!report) return;

        Modal.confirm({
          title: 'Xóa báo cáo quảng cáo',
          message: `Bạn có chắc chắn muốn xóa bản ghi quảng cáo ngày ${Utils.formatDateShort(report.date)}?`,
          icon: Utils.icons.trash,
          onConfirm: () => {
            Store.adReports.remove(id);
            Toast.success('Đã xóa báo cáo quảng cáo');
            renderPage();
          }
        });
      });
    });


  };

  // ── Modals ──

  const openAdReportModal = (report = null) => {
    const isEdit = !!report;
    const title = isEdit ? 'Chỉnh sửa báo cáo quảng cáo' : 'Nhập báo cáo quảng cáo ngày';

    // Active advertising fanpages
    const fanpages = Store.fanpages.getAll().filter(fp => fp.platform === 'facebook' || fp.platform === 'instagram');

    if (fanpages.length === 0) {
      Toast.error('Vui lòng thêm Fanpage (Facebook/Instagram) trong Lịch đăng bài trước!');
      return;
    }

    const content = `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Chọn Fanpage <span style="color:var(--danger-400);">*</span></label>
          <select class="form-select" data-field="fanpageId">
            ${fanpages.map(fp => 
              `<option value="${fp.id}" ${(isEdit ? report.fanpageId : '') === fp.id ? 'selected' : ''}>${Utils.escapeHtml(fp.name)} (${fp.platform.toUpperCase()})</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ngày báo cáo <span style="color:var(--danger-400);">*</span></label>
          <input type="date" class="form-input" data-field="date" 
                 value="${isEdit ? report.date : Utils.getDefaultDateForMonth(currentMonth)}">
        </div>
      </div>

      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Chi tiêu (VNĐ) <span style="color:var(--danger-400);">*</span></label>
          <input type="number" class="form-input" data-field="spend" value="${isEdit ? report.spend : 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Lượt tiếp cận (Reach)</label>
          <input type="number" class="form-input" data-field="reach" value="${isEdit ? report.reach : 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Lượt hiển thị (Impressions)</label>
          <input type="number" class="form-input" data-field="impressions" value="${isEdit ? report.impressions : 0}" min="0">
        </div>
      </div>

      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Lượt clicks vào link</label>
          <input type="number" class="form-input" data-field="clicks" value="${isEdit ? report.clicks : 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Số tin nhắn mới (Messages)</label>
          <input type="number" class="form-input" data-field="messages" value="${isEdit ? report.messages : 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Số chuyển đổi (Conversions)</label>
          <input type="number" class="form-input" data-field="conversions" value="${isEdit ? report.conversions : 0}" min="0">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Số lượt tương tác bài viết</label>
          <input type="number" class="form-input" data-field="engagement" value="${isEdit ? report.engagement : 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Doanh thu đem lại (để tính ROAS)</label>
          <input type="number" class="form-input" data-field="revenue" value="${isEdit ? report.revenue : 0}" min="0" placeholder="Có thể bỏ trống">
        </div>
      </div>

      ${Utils.campaignPickerHtml(isEdit ? (report.campaignId || '') : '')}
    `;

    Modal.open({
      title,
      content,
      size: 'lg',
      saveLabel: isEdit ? 'Cập nhật' : 'Ghi nhận',
      onSave: () => {
        const formData = Modal.getFormData();
        if (!formData.fanpageId) {
          Toast.error('Vui lòng chọn Fanpage');
          return;
        }
        if (!formData.date) {
          Toast.error('Vui lòng chọn ngày báo cáo');
          return;
        }

        const spendVal = parseFloat(formData.spend) || 0;
        const reachVal = parseInt(formData.reach) || 0;
        const impressionsVal = parseInt(formData.impressions) || 0;
        const clicksVal = parseInt(formData.clicks) || 0;
        const messagesVal = parseInt(formData.messages) || 0;
        const conversionsVal = parseInt(formData.conversions) || 0;
        const engagementVal = parseInt(formData.engagement) || 0;
        const revenueVal = parseFloat(formData.revenue) || 0;

        const reportData = {
          fanpageId: formData.fanpageId,
          date: formData.date,
          spend: spendVal,
          reach: reachVal,
          impressions: impressionsVal,
          clicks: clicksVal,
          messages: messagesVal,
          conversions: conversionsVal,
          engagement: engagementVal,
          revenue: revenueVal,
          campaignId: formData.campaignId || ''
        };

        if (isEdit) {
          Store.adReports.update(report.id, reportData);
          
          // Sync to Expense table automatically if there is a linked expense
          syncAdsExpense(report.id, reportData);
          
          Toast.success('Đã cập nhật báo cáo quảng cáo');
        } else {
          const newReport = Store.adReports.create(reportData);
          
          // Generate automatic expense entry for ads spend
          syncAdsExpense(newReport.id, reportData);
          
          Toast.success('Đã thêm báo cáo quảng cáo mới');
        }

        Modal.close();
        renderPage();
      }
    });
  };

  // ── Sync Daily Ads Spend to Expense Table ──
  const syncAdsExpense = (reportId, reportData) => {
    const expenses = Store.expenses.getAll();
    const linkedExpense = expenses.find(exp => exp.adReportId === reportId);
    const fp = Store.fanpages.getById(reportData.fanpageId) || { name: 'Fanpage' };

    const spendVal = parseFloat(reportData.spend) || 0;

    if (linkedExpense) {
      if (spendVal > 0) {
        Store.expenses.update(linkedExpense.id, {
          date: reportData.date,
          description: `Chi phí chạy Ads: ${fp.name}`,
          amount: spendVal,
          notes: `Cập nhật tự động từ module Ads`
        });
      } else {
        Store.expenses.remove(linkedExpense.id);
      }
    } else if (spendVal > 0) {
      Store.expenses.create({
        date: reportData.date,
        category: 'ads',
        description: `Chi phí chạy Ads: ${fp.name}`,
        amount: spendVal,
        notes: `Tạo tự động từ module Ads`,
        adReportId: reportId
      });
    }
  };

  // ── Import File from Google Sheets (CSV) ──

  const openImportFileModal = () => {
    const fanpages = Store.fanpages.getAll().filter(fp =>
      fp.platform === 'facebook' || fp.platform === 'instagram'
    );

    if (fanpages.length === 0) {
      Toast.error('Vui lòng thêm Fanpage (Facebook/Instagram) trong Lịch đăng bài trước!');
      return;
    }

    let parsedRows = [];
    let fileHeaders = [];
    let colMap = {};

    const content = `
      <div class="form-group">
        <label class="form-label">Chọn Fanpage áp dụng <span style="color:var(--danger-400);">*</span></label>
        <select class="form-select" id="importFanpageId">
          ${fanpages.map(fp =>
            `<option value="${fp.id}">${Utils.escapeHtml(fp.name)} (${(fp.platform || '').toUpperCase()})</option>`
          ).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Tải lên file báo cáo từ Google Sheets <span style="color:var(--danger-400);">*</span></label>
        <div id="importDropZone" style="border: 2px dashed var(--border-default); border-radius: var(--radius-lg); padding: var(--space-8) var(--space-4); text-align: center; cursor: pointer; transition: all 0.2s ease; background: var(--bg-input);">
          <input type="file" id="importFileInput" accept=".csv,.tsv,.txt" style="display:none;">
          <div class="import-dropzone-icon">${Utils.icons.upload}</div>
          <div style="font-size: var(--text-sm); color: var(--text-secondary); font-weight: var(--weight-medium);">
            Click để chọn file hoặc kéo thả vào đây
          </div>
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-top: var(--space-2);">
            Google Sheets → File → Tải xuống → Giá trị được phân tách bằng dấu phẩy (.csv)
          </div>
        </div>
      </div>

      <div id="importFileStatus" style="display:none; margin-bottom: var(--space-4); padding: var(--space-3); border-radius: var(--radius-md); background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2);">
      </div>

      <div id="importPreviewArea" style="display:none;"></div>
    `;

    Modal.open({
      title: 'Tải lên báo cáo từ Google Sheets',
      content,
      size: 'lg',
      saveLabel: 'Nhập dữ liệu',
      onSave: () => { executeImport(); }
    });

    // Set up event handlers after modal renders
    setTimeout(() => {
      const dropZone = document.getElementById('importDropZone');
      const fileInput = document.getElementById('importFileInput');
      if (!dropZone || !fileInput) return;

      // Click to open file dialog
      dropZone.addEventListener('click', () => fileInput.click());

      // Drag-and-drop
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary-500)';
        dropZone.style.background = 'rgba(124, 58, 237, 0.06)';
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--border-default)';
        dropZone.style.background = 'var(--bg-input)';
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border-default)';
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
      });

      // File input change
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelect(file);
      });
    }, 100);

    // ── Handle file selection ──
    const handleFileSelect = (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const { headers, rows } = parseCSVContent(text);

          if (headers.length === 0 || rows.length === 0) {
            Toast.error('File không có dữ liệu hoặc định dạng không hợp lệ');
            return;
          }

          fileHeaders = headers;
          parsedRows = rows;
          colMap = autoDetectColumns(headers);

          // Show file status
          const statusEl = document.getElementById('importFileStatus');
          if (statusEl) {
            statusEl.style.display = 'flex';
            statusEl.style.alignItems = 'center';
            statusEl.style.gap = 'var(--space-2)';
            statusEl.innerHTML = `
              <span class="ui-inline-icon" style="color: var(--success-400);">${Utils.icons.check}</span>
              <div>
                <div style="font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--text-primary);">${Utils.escapeHtml(file.name)}</div>
                <div style="font-size: var(--text-xs); color: var(--text-tertiary);">${rows.length} dòng dữ liệu · ${headers.length} cột</div>
              </div>
            `;
          }

          // Update drop zone
          const dz = document.getElementById('importDropZone');
          if (dz) {
            dz.style.borderColor = 'var(--success-500)';
            dz.style.background = 'rgba(16, 185, 129, 0.05)';
            dz.style.padding = 'var(--space-4)';
            dz.innerHTML = `
              <div style="display: flex; align-items: center; gap: var(--space-3); justify-content: center;">
                <span class="ui-inline-icon">${Utils.icons.fileText}</span>
                <span style="font-size: var(--text-sm); color: var(--success-400); font-weight: var(--weight-medium);">${Utils.escapeHtml(file.name)}</span>
                <span style="font-size: var(--text-xs); color: var(--text-muted);">(click để đổi file)</span>
              </div>
            `;
          }

          // Render preview
          renderImportPreview();
        } catch (err) {
          Toast.error('Lỗi đọc file: ' + err.message);
          console.error('File parse error:', err);
        }
      };
      reader.readAsText(file, 'UTF-8');
    };

    // ── Parse CSV content ──
    const parseCSVContent = (text) => {
      // Remove BOM
      text = text.replace(/^\uFEFF/, '');

      // Detect delimiter
      const firstLine = text.split('\n')[0] || '';
      let delimiter = ',';
      const tabCount = (firstLine.match(/\t/g) || []).length;
      const semiCount = (firstLine.match(/;/g) || []).length;
      const commaCount = (firstLine.match(/,/g) || []).length;
      if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
      else if (semiCount > commaCount) delimiter = ';';

      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return { headers: [], rows: [] };

      const headers = parseCSVLine(lines[0], delimiter);
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], delimiter);
        if (values.some(v => v.trim())) {
          const row = {};
          headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
          rows.push(row);
        }
      }

      return { headers, rows };
    };

    // ── Parse single CSV line (handles quoted fields) ──
    const parseCSVLine = (line, delimiter) => {
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
      return result.map(v => v.replace(/^"|"$/g, ''));
    };

    // ── Auto-detect column mapping ──
    const autoDetectColumns = (headers) => {
      const mapping = {};

      headers.forEach((header, idx) => {
        const normalized = header.toLowerCase().trim()
          .replace(/[_\-\.]/g, ' ')
          .replace(/\s+/g, ' ');

        for (const [field, keywords] of Object.entries(COLUMN_KEYWORDS)) {
          if (mapping[field] !== undefined) continue;

          for (const kw of keywords) {
            if (normalized.includes(kw.toLowerCase()) ||
                normalized === kw.toLowerCase()) {
              mapping[field] = idx;
              break;
            }
          }
        }
      });

      return mapping;
    };

    // ── Render preview + column mapping ──
    const renderImportPreview = () => {
      const previewArea = document.getElementById('importPreviewArea');
      if (!previewArea) return;
      previewArea.style.display = 'block';

      const previewRows = parsedRows.slice(0, 5);
      const detectedCount = Object.keys(colMap).length;

      previewArea.innerHTML = `
        <div style="border-top: 1px solid var(--border-subtle); padding-top: var(--space-4); margin-bottom: var(--space-4);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3);">
            <div style="font-weight: var(--weight-semibold); color: var(--text-primary); font-size: var(--text-md);">
              <span class="ui-label-with-icon"><span class="ui-inline-icon">${Utils.icons.repeat}</span>Ghép cột dữ liệu</span>
            </div>
            <div style="font-size: var(--text-xs); padding: 3px 10px; border-radius: var(--radius-full); background: ${detectedCount >= 2 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)'}; color: ${detectedCount >= 2 ? 'var(--success-400)' : 'var(--warning-400)'}; font-weight: var(--weight-medium);">
              Tự động nhận diện ${detectedCount}/${IMPORT_FIELDS.length} cột
            </div>
          </div>
          <div style="font-size: var(--text-xs); color: var(--text-tertiary); margin-bottom: var(--space-3);">
            Hệ thống tự động nhận diện tên cột (Tiếng Việt & English). Bạn có thể điều chỉnh nếu cần.
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3);">
            ${IMPORT_FIELDS.map(f => {
              const isDetected = colMap[f.key] !== undefined;
              return `
                <div class="form-group" style="margin-bottom: var(--space-2);">
                  <label class="form-label" style="font-size: 11px; display: flex; align-items: center; gap: 4px;">
                    ${isDetected ? `<span class="ui-inline-icon" style="color:var(--success-400);">${Utils.icons.check}</span>` : ''}
                    ${f.label}
                    ${f.required ? '<span style="color:var(--danger-400);">*</span>' : ''}
                  </label>
                  <select class="form-select" data-map-field="${f.key}" style="font-size: var(--text-xs); padding: 6px 28px 6px 8px;">
                    <option value="-1">— Bỏ qua —</option>
                    ${fileHeaders.map((h, i) =>
                      `<option value="${i}" ${colMap[f.key] === i ? 'selected' : ''}>${Utils.escapeHtml(h)}</option>`
                    ).join('')}
                  </select>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="margin-bottom: var(--space-3);">
          <div style="font-weight: var(--weight-semibold); color: var(--text-primary); margin-bottom: var(--space-2); font-size: var(--text-sm);">
            <span class="ui-label-with-icon"><span class="ui-inline-icon">${Utils.icons.search}</span>Xem trước dữ liệu (${Math.min(5, parsedRows.length)} / ${parsedRows.length} dòng)</span>
          </div>
          <div style="overflow-x: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); max-height: 200px;">
            <table class="data-table" style="font-size: 11px;">
              <thead>
                <tr>
                  <th style="padding: 6px 8px; position: sticky; top: 0;">#</th>
                  ${fileHeaders.map(h => `<th style="padding: 6px 8px; white-space: nowrap; position: sticky; top: 0;">${Utils.escapeHtml(h)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${previewRows.map((row, i) => `
                  <tr>
                    <td style="padding: 4px 8px; color: var(--text-muted);">${i + 1}</td>
                    ${fileHeaders.map(h => `<td style="padding: 4px 8px; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis;">${Utils.escapeHtml(row[h] || '')}</td>`).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Listen for mapping changes
      previewArea.querySelectorAll('[data-map-field]').forEach(sel => {
        sel.addEventListener('change', () => {
          const field = sel.dataset.mapField;
          const idx = parseInt(sel.value);
          if (idx >= 0) {
            colMap[field] = idx;
          } else {
            delete colMap[field];
          }
        });
      });
    };

    // ── Parse date string to YYYY-MM-DD ──
    const parseDateValue = (val) => {
      if (!val) return null;
      val = val.trim();

      // YYYY-MM-DD
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(val)) {
        const parts = val.split('-');
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }

      // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
      let m = val.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
      if (m) {
        const day = m[1].padStart(2, '0');
        const month = m[2].padStart(2, '0');
        return `${m[3]}-${month}-${day}`;
      }

      // YYYY/MM/DD
      m = val.match(/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
      if (m) {
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      }

      // Try native Date as last resort
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }

      return null;
    };

    // ── Parse numeric value (handles VN format: 1.234.567,89) ──
    const parseNumericValue = (val) => {
      if (!val) return 0;
      val = String(val).trim();
      // Remove currency symbols and spaces
      val = val.replace(/[₫đ$€¥£\s]/gi, '');

      // Handle mixed separators
      if (val.includes('.') && val.includes(',')) {
        if (val.lastIndexOf(',') > val.lastIndexOf('.')) {
          // Vietnamese: 1.234.567,89 → comma is decimal
          val = val.replace(/\./g, '').replace(',', '.');
        } else {
          // English: 1,234,567.89 → dot is decimal
          val = val.replace(/,/g, '');
        }
      } else if (val.includes(',') && !val.includes('.')) {
        // Single comma: could be thousands or decimal
        if (/,\d{3}$/.test(val)) {
          val = val.replace(/,/g, ''); // Thousands separator
        } else {
          val = val.replace(',', '.'); // Decimal separator
        }
      }

      const num = parseFloat(val);
      return isNaN(num) ? 0 : Math.abs(num);
    };

    // ── Execute import ──
    const executeImport = () => {
      // Validate required columns
      if (parsedRows.length === 0) {
        Toast.error('Vui lòng tải lên file trước');
        return;
      }

      // Re-read mapping from selects in case user changed them
      document.querySelectorAll('[data-map-field]').forEach(sel => {
        const field = sel.dataset.mapField;
        const idx = parseInt(sel.value);
        if (idx >= 0) {
          colMap[field] = idx;
        } else {
          delete colMap[field];
        }
      });

      if (colMap.date === undefined) {
        Toast.error('Vui lòng chọn cột "Ngày" trong phần ghép cột');
        return;
      }
      if (colMap.spend === undefined) {
        Toast.error('Vui lòng chọn cột "Chi tiêu" trong phần ghép cột');
        return;
      }

      const fanpageId = document.getElementById('importFanpageId')?.value;
      if (!fanpageId) {
        Toast.error('Vui lòng chọn Fanpage');
        return;
      }

      let importCount = 0;
      let skipCount = 0;

      parsedRows.forEach(row => {
        const dateVal = parseDateValue(row[fileHeaders[colMap.date]]);
        if (!dateVal) { skipCount++; return; }

        const getValue = (field) => {
          if (colMap[field] === undefined) return 0;
          return parseNumericValue(row[fileHeaders[colMap[field]]]);
        };

        const reportData = {
          fanpageId,
          date: dateVal,
          spend: getValue('spend'),
          reach: getValue('reach'),
          impressions: getValue('impressions'),
          clicks: getValue('clicks'),
          messages: getValue('messages'),
          conversions: getValue('conversions'),
          engagement: getValue('engagement'),
          revenue: getValue('revenue')
        };

        const newReport = Store.adReports.create(reportData);

        // Auto-sync to expense if there's spend
        if (reportData.spend > 0) {
          syncAdsExpense(newReport.id, reportData);
        }

        importCount++;
      });

      Modal.close();

      if (importCount > 0) {
        Toast.success(`Đã nhập thành công ${importCount} bản ghi${skipCount > 0 ? ` (bỏ qua ${skipCount} dòng lỗi)` : ''}`);
      } else {
        Toast.error(`Không thể nhập dữ liệu. Bỏ qua ${skipCount} dòng do lỗi định dạng ngày.`);
      }

      renderPage();
    };
  };

  return { render };
})();

App.registerPage('ads', AdsPage);
