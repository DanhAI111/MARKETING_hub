/* Revenue-driven marketing planner. Vanilla UI; calculations stay on the API. */
const PlannerPage = (() => {
  const ALLOCATION_LABELS = {
    core: 'Cốt lõi',
    brand: 'Xây dựng thương hiệu',
    newStrategy: 'Chiến lược mới',
    experiment: 'Thử nghiệm',
    digital: 'Digital',
    traditional: 'Traditional',
    seoSocial: 'SEO & Social',
    digitalAds: 'Digital Ads',
    emailAuto: 'Email / Automation',
    martech: 'Martech',
    fair: 'Hội chợ / Triển lãm',
    printing: 'In ấn',
    pressOOH: 'Báo chí / OOH',
    abm: 'ABM',
    influencer: 'Influencer',
    roadshow: 'Roadshow',
    chatbot: 'Chatbot AI',
    podcast: 'Podcast',
    gift: 'Quà tặng',
    metaAds: 'Meta Ads',
    tiktok: 'TikTok',
    facebookOrganic: 'Facebook Organic',
    googleAds: 'Google Ads',
    linkedin: 'LinkedIn',
    zalo: 'Zalo',
    partners: 'Đối tác',
    customerService: 'Khách hàng & dịch vụ',
    promo: 'Khuyến mãi',
    educational: 'Nội dung giáo dục',
    brandStory: 'Câu chuyện thương hiệu'
  };
  const TIER_LABELS = {
    tier1: 'Tầng 1 · Mục đích',
    tier2: 'Tầng 2 · Nhóm hạng mục',
    tier3: 'Tầng 3 · Loại kênh'
  };
  const GROUP_LABELS = {
    core: 'Cốt lõi',
    newStrategy: 'Chiến lược mới',
    experiment: 'Thử nghiệm'
  };
  const MEDIUM_LABELS = { digital: 'Digital', traditional: 'Traditional' };
  const COLORS = ['#6a4cf5', '#d44df0', '#ff7a3d', '#ff5577', '#0099ff'];
  const PERIOD_LABELS = { month: 'theo tháng', quarter: 'theo quý', year: 'theo năm' };
  const WEIGHT_GROUP_LABELS = {
    tier1: 'Tầng 1', tier2: 'Tầng 2', tier3: 'Tầng 3',
    tier4: 'Hạng mục chi tiết', channels: 'Kênh', content: 'Nội dung'
  };
  const WEIGHT_TOTAL_TOLERANCE = 0.1; // percent points; mirrors engine WEIGHT_TOLERANCE (0.001 ratio)

  let container = null;
  let result = null;
  let currentInputs = null;
  let currentWeights = null;
  let aiSuggestion = null;
  let selectedPlanId = '';
  let busy = false;

  const numberValue = (id, label, { optional = false } = {}) => {
    const raw = container.querySelector(`#${id}`)?.value.trim() || '';
    if (!raw && optional) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${label} phải là số hợp lệ.`);
    return value;
  };

  const collectInputs = () => {
    const targetRevenue = numberValue('plannerTargetRevenue', 'Doanh thu mục tiêu', { optional: true });
    const prevRevenue = numberValue('plannerPrevRevenue', 'Doanh thu năm trước', { optional: true });
    const growthPercent = numberValue('plannerGrowth', 'Tăng trưởng');
    const mktRatio = numberValue('plannerMktRatio', 'Tỷ lệ marketing') / 100;
    const aov = numberValue('plannerAov', 'AOV');
    const sqlPerLead = numberValue('plannerSqlPerLead', 'Tỷ lệ SQL/Lead') / 100;
    const orderPerSql = numberValue('plannerOrderPerSql', 'Tỷ lệ Đơn hàng/SQL') / 100;
    const monthlyMoM = numberValue('plannerMom', 'Tăng trưởng theo tháng') / 100;
    const grossMarginPct = numberValue('plannerGrossMargin', 'Biên lợi nhuận gộp', { optional: true });
    const retentionPct = numberValue('plannerRetention', 'Tỷ lệ giữ chân', { optional: true });
    const purchaseFrequency = numberValue('plannerPurchaseFreq', 'Số đơn/khách', { optional: true });
    const industry = container.querySelector('#plannerIndustry')?.value.trim() || '';
    const goal = container.querySelector('#plannerGoal')?.value.trim() || '';
    const period = container.querySelector('#plannerPeriod')?.value || 'year';

    if ((!targetRevenue || targetRevenue <= 0) && (!prevRevenue || prevRevenue <= 0)) {
      throw new Error('Nhập doanh thu mục tiêu hoặc doanh thu năm trước.');
    }
    if (targetRevenue !== undefined && targetRevenue <= 0) {
      throw new Error('Doanh thu mục tiêu phải lớn hơn 0.');
    }
    if (prevRevenue !== undefined && prevRevenue <= 0) {
      throw new Error('Doanh thu năm trước phải lớn hơn 0.');
    }
    if (growthPercent <= -100) throw new Error('Tăng trưởng phải lớn hơn -100%.');
    if (mktRatio <= 0 || mktRatio >= 1) throw new Error('Tỷ lệ marketing phải từ trên 0% đến dưới 100%.');
    if (aov <= 0) throw new Error('AOV phải lớn hơn 0.');
    if (sqlPerLead <= 0 || sqlPerLead > 1) throw new Error('SQL/Lead phải từ trên 0% đến 100%.');
    if (orderPerSql <= 0 || orderPerSql > 1) throw new Error('Đơn hàng/SQL phải từ trên 0% đến 100%.');
    if (monthlyMoM <= -1 || monthlyMoM > 1) throw new Error('MoM phải từ trên -100% đến 100%.');
    if (!['month', 'quarter', 'year'].includes(period)) throw new Error('Kỳ tính không hợp lệ.');
    if (grossMarginPct !== undefined && (grossMarginPct <= 0 || grossMarginPct > 100)) {
      throw new Error('Biên lợi nhuận gộp phải từ trên 0% đến 100%.');
    }
    if (retentionPct !== undefined && (retentionPct < 0 || retentionPct >= 100)) {
      throw new Error('Tỷ lệ giữ chân phải từ 0% đến dưới 100%.');
    }
    if (purchaseFrequency !== undefined && purchaseFrequency <= 0) {
      throw new Error('Số đơn/khách phải lớn hơn 0.');
    }

    return {
      ...(targetRevenue ? { targetRevenue } : {}),
      ...(prevRevenue ? { prevRevenue, growth: 1 + growthPercent / 100 } : {}),
      mktRatio,
      aov,
      sqlPerLead,
      orderPerSql,
      monthlyMoM,
      period,
      ...(grossMarginPct !== undefined ? { grossMargin: grossMarginPct / 100 } : {}),
      ...(retentionPct !== undefined ? { retentionRate: retentionPct / 100 } : {}),
      ...(purchaseFrequency !== undefined ? { purchaseFrequency } : {}),
      industry,
      goal
    };
  };

  const setBusy = (nextBusy) => {
    busy = nextBusy;
    container?.querySelectorAll('[data-planner-action]').forEach((button) => {
      button.disabled = busy || (button.id === 'plannerSaveBtn' && !result);
    });
  };

  const showFormError = (message = '') => {
    const element = container?.querySelector('#plannerFormError');
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  };

  const formatCount = (value) => Utils.formatNumber(Math.ceil(value || 0));
  const formatPercent = (ratio) => `${((ratio || 0) * 100).toFixed(1)}%`;
  const labelFor = (key) => ALLOCATION_LABELS[key] || key;

  const inputValue = (inputs, key, fallback = '') => Utils.escapeHtml(inputs?.[key] ?? fallback);

  const renderForm = () => {
    const values = currentInputs || {};
    const growthPercent = values.growth === undefined ? 10 : (values.growth - 1) * 100;
    return `
      <section class="card planner-form-card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Đầu vào kế hoạch</h2>
            <p class="card-subtitle">Có thể nhập doanh thu mục tiêu trực tiếp hoặc suy ra từ năm trước.</p>
          </div>
        </div>
        <div class="planner-form-grid">
          <label class="form-group planner-name-field">
            <span class="form-label">Tên kế hoạch</span>
            <input class="form-input" id="plannerName" maxlength="120"
              value="${Utils.escapeHtml(Store.marketingPlans.getById(selectedPlanId)?.name || '')}"
              placeholder="Ví dụ: Kế hoạch tăng trưởng 2027">
          </label>
          <label class="form-group">
            <span class="form-label">Kỳ tính</span>
            <select class="form-input" id="plannerPeriod">
              <option value="month"${values.period === 'month' ? ' selected' : ''}>Theo tháng</option>
              <option value="quarter"${values.period === 'quarter' ? ' selected' : ''}>Theo quý</option>
              <option value="year"${(values.period ?? 'year') === 'year' ? ' selected' : ''}>Theo năm</option>
            </select>
          </label>
          <label class="form-group">
            <span class="form-label">Doanh thu mục tiêu của kỳ (₫)</span>
            <input class="form-input" id="plannerTargetRevenue" type="number" min="1"
              value="${inputValue(values, 'targetRevenue')}" placeholder="Ví dụ: 1500000000">
          </label>
          <label class="form-group">
            <span class="form-label">Doanh thu kỳ trước (₫)</span>
            <input class="form-input" id="plannerPrevRevenue" type="number" min="1"
              value="${inputValue(values, 'prevRevenue', 1365000000)}">
          </label>
          <label class="form-group">
            <span class="form-label">Tăng trưởng so với kỳ trước (%)</span>
            <input class="form-input" id="plannerGrowth" type="number" min="-99" max="900" step="0.1"
              value="${Utils.escapeHtml(growthPercent)}">
          </label>
          <label class="form-group">
            <span class="form-label">Chi phí marketing / doanh thu (%)</span>
            <input class="form-input" id="plannerMktRatio" type="number" min="0.1" max="99.9" step="0.1"
              value="${Utils.escapeHtml((values.mktRatio ?? 0.4) * 100)}">
          </label>
          <label class="form-group">
            <span class="form-label">AOV · Giá trị đơn trung bình (₫)</span>
            <input class="form-input" id="plannerAov" type="number" min="1"
              value="${inputValue(values, 'aov', 15000000)}">
          </label>
          <label class="form-group">
            <span class="form-label">SQL / Lead (%)</span>
            <input class="form-input" id="plannerSqlPerLead" type="number" min="0.1" max="100" step="0.1"
              value="${Utils.escapeHtml((values.sqlPerLead ?? 0.3) * 100)}">
          </label>
          <label class="form-group">
            <span class="form-label">Đơn hàng / SQL (%)</span>
            <input class="form-input" id="plannerOrderPerSql" type="number" min="0.1" max="100" step="0.1"
              value="${Utils.escapeHtml((values.orderPerSql ?? 0.5) * 100)}">
          </label>
          <label class="form-group">
            <span class="form-label">Tăng trưởng theo tháng MoM (%)</span>
            <input class="form-input" id="plannerMom" type="number" min="-99" max="100" step="0.1"
              value="${Utils.escapeHtml((values.monthlyMoM ?? 0.05) * 100)}">
          </label>
          <label class="form-group">
            <span class="form-label">Biên lợi nhuận gộp (%)</span>
            <input class="form-input" id="plannerGrossMargin" type="number" min="0.1" max="100" step="0.1"
              value="${Utils.escapeHtml((values.grossMargin ?? 0.3) * 100)}"
              placeholder="Để trống nếu chỉ tính doanh thu">
          </label>
          <label class="form-group">
            <span class="form-label">Tỷ lệ giữ chân KH / kỳ (%)</span>
            <input class="form-input" id="plannerRetention" type="number" min="0" max="99.9" step="0.1"
              value="${Utils.escapeHtml((values.retentionRate ?? 0) * 100)}">
          </label>
          <label class="form-group">
            <span class="form-label">Số đơn / khách / kỳ</span>
            <input class="form-input" id="plannerPurchaseFreq" type="number" min="0.1" step="0.1"
              value="${Utils.escapeHtml(values.purchaseFrequency ?? 1)}">
          </label>
          <label class="form-group">
            <span class="form-label">Ngành</span>
            <input class="form-input" id="plannerIndustry" maxlength="160"
              value="${inputValue(values, 'industry')}" placeholder="Ví dụ: B2B SaaS, bán lẻ...">
          </label>
          <label class="form-group planner-goal-field">
            <span class="form-label">Mục tiêu ưu tiên</span>
            <input class="form-input" id="plannerGoal" maxlength="300"
              value="${inputValue(values, 'goal')}" placeholder="Ví dụ: Tăng khách hàng mới, mở thị trường...">
          </label>
        </div>
        <p class="form-error" id="plannerFormError" hidden></p>
        <div class="planner-actions">
          <button class="btn btn-primary" type="button" id="plannerComputeBtn" data-planner-action>
            Tính kế hoạch
          </button>
          <button class="btn btn-secondary" type="button" id="plannerAiBtn" data-planner-action>
            AI gợi ý phân bổ
          </button>
          <button class="btn btn-ghost" type="button" id="plannerSaveBtn" data-planner-action
            ${result ? '' : 'disabled'}>
            ${selectedPlanId ? 'Cập nhật kế hoạch' : 'Lưu kế hoạch'}
          </button>
        </div>
      </section>
    `;
  };

  const renderSavedPlans = () => {
    const plans = Store.marketingPlans.getAll()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (plans.length === 0) {
      return '<p class="planner-saved-empty">Chưa có kế hoạch đã lưu.</p>';
    }
    return plans.map((plan) => `
      <div class="planner-saved-item ${plan.id === selectedPlanId ? 'is-active' : ''}">
        <button type="button" class="planner-saved-load" data-plan-load="${Utils.escapeHtml(plan.id)}">
          <strong>${Utils.escapeHtml(plan.name || 'Kế hoạch chưa đặt tên')}</strong>
          <span>${Utils.formatVNDCompact(plan.result?.targetRevenue || 0)} doanh thu · ${Utils.formatDateTime(plan.updatedAt)}</span>
        </button>
        <button type="button" class="planner-saved-delete" data-plan-delete="${Utils.escapeHtml(plan.id)}"
          aria-label="Xóa kế hoạch">×</button>
      </div>
    `).join('');
  };

  const warningsMarkup = (warnings = []) => warnings.length === 0 ? '' : `
    <div class="planner-warning" role="status">
      <strong>Cần kiểm tra</strong>
      <ul>${warnings.map((warning) => `<li>${Utils.escapeHtml(warning.message || warning)}</li>`).join('')}</ul>
    </div>
  `;

  const reasonsMarkup = () => {
    if (!aiSuggestion) return '';
    const isAi = aiSuggestion.source === 'ai';
    return `
      <div class="planner-ai-note">
        <div class="planner-ai-note-title">
          <span class="tag ${isAi ? 'tag-info' : 'tag-warning'}">${isAi ? 'Gợi ý AI' : 'Công thức dự phòng'}</span>
          <strong>Lý do phân bổ</strong>
        </div>
        <ul>${(aiSuggestion.reasons || []).map((reason) => `<li>${Utils.escapeHtml(reason)}</li>`).join('')}</ul>
      </div>
    `;
  };

  const pct = (ratio) => +((ratio || 0) * 100).toFixed(4);

  // Editable weight cell. Blur/Enter recomputes; typing updates the live total badge.
  const weightInput = (group, key, ratio) => `
    <input class="form-input planner-weight-input" type="number" min="0" max="100" step="0.1"
      data-weight-group="${group}" data-weight-key="${key}"
      value="${pct(ratio)}" aria-label="Tỷ trọng ${Utils.escapeHtml(labelFor(key))}">`;

  const totalBadge = (group) => `<span class="planner-weight-total" data-weight-total="${group}"></span>`;

  const allocationRows = (allocation) => ['tier1', 'tier2', 'tier3']
    .flatMap((tier) => Object.entries(allocation[tier] || {}).map(([key, node]) => `
      <tr>
        <td><span class="planner-tier-label">${TIER_LABELS[tier]}</span></td>
        <td>${Utils.escapeHtml(labelFor(key))}</td>
        <td class="planner-weight-cell">${weightInput(tier, key, node.ratio)}</td>
        <td class="planner-number">${Utils.formatVND(node.amount)}</td>
      </tr>
    `)).join('');

  const detailRows = (allocation) => Object.entries(allocation.tier4 || {}).map(([key, node]) => `
    <tr>
      <td>${Utils.escapeHtml(labelFor(key))}</td>
      <td>${Utils.escapeHtml(GROUP_LABELS[node.group] || node.group)}</td>
      <td>${Utils.escapeHtml(MEDIUM_LABELS[node.medium] || node.medium)}</td>
      <td class="planner-weight-cell">${weightInput('tier4', key, node.ratio)}</td>
      <td class="planner-number">${Utils.formatVND(node.amount)}</td>
    </tr>
  `).join('');

  const compactAllocation = (group, title, nodes) => `
    <section class="card planner-allocation-mini">
      <div class="planner-mini-header"><h3 class="card-title">${title}</h3>${totalBadge(group)}</div>
      <div class="planner-ratio-list">
        ${Object.entries(nodes || {}).map(([key, node]) => `
          <div>
            <span>${Utils.escapeHtml(labelFor(key))}</span>
            ${weightInput(group, key, node.ratio)}
            <small>${Utils.formatVNDCompact(node.amount)}</small>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  // LTV + LTV:CAC cards — chỉ hiện khi user khai biên lợi nhuận gộp.
  const unitEconCards = (funnel) => {
    if (!(currentInputs?.grossMargin > 0)) return '';
    const ratio = funnel.ltvCacRatio;
    const tone = ratio >= 3 ? 'is-good' : ratio >= 1 ? 'is-warn' : 'is-bad';
    return `
      <article class="stat-card">
        <div class="stat-card-label">LTV · Giá trị vòng đời</div>
        <div class="stat-card-value">${Utils.formatVNDCompact(funnel.ltv)}</div>
        <div class="stat-card-desc">Biên ${formatPercent(funnel.grossMargin)} · thu hồi ${funnel.paybackPeriods.toFixed(1)} kỳ</div>
      </article>
      <article class="stat-card planner-ratio-card ${tone}">
        <div class="stat-card-label">LTV : CAC</div>
        <div class="stat-card-value">${ratio.toFixed(1)} : 1</div>
        <div class="stat-card-desc">${ratio >= 3 ? 'Khỏe (≥ 3:1)' : ratio >= 1 ? 'Cần cải thiện' : 'Lỗ mỗi khách'}</div>
      </article>
    `;
  };

  const renderOutput = () => {
    const output = container?.querySelector('#plannerOutput');
    if (!output) return;
    if (!result) {
      output.innerHTML = `
        <div class="planner-empty card">
          <strong>Bắt đầu từ mục tiêu doanh thu</strong>
          <p>Nhấn “Tính kế hoạch” để xem ngân sách, funnel, phân bổ và mục tiêu 12 tháng.</p>
        </div>
      `;
      return;
    }
    const { funnel, allocation, monthly, warnings = [] } = result;
    output.innerHTML = `
      ${warningsMarkup([...(aiSuggestion?.warnings || []), ...warnings])}
      ${reasonsMarkup()}

      <div class="planner-stat-grid">
        <article class="stat-card">
          <div class="stat-card-label">Doanh thu mục tiêu</div>
          <div class="stat-card-value">${Utils.formatVNDCompact(result.targetRevenue)}</div>
          <div class="stat-card-desc">${Utils.formatVND(result.targetRevenue)}</div>
        </article>
        <article class="stat-card">
          <div class="stat-card-label">Ngân sách marketing</div>
          <div class="stat-card-value">${Utils.formatVNDCompact(result.mktBudget)}</div>
          <div class="stat-card-desc">${formatPercent(currentInputs.mktRatio)} doanh thu</div>
        </article>
        <article class="stat-card">
          <div class="stat-card-label">Khách hàng mục tiêu</div>
          <div class="stat-card-value">${formatCount(funnel.customers)}</div>
          <div class="stat-card-desc">AOV ${Utils.formatVNDCompact(currentInputs.aov)}</div>
        </article>
        <article class="stat-card">
          <div class="stat-card-label">CAC · Chi phí tạo KH</div>
          <div class="stat-card-value">${Utils.formatVNDCompact(funnel.cac)}</div>
          <div class="stat-card-desc">${Utils.formatVND(funnel.cac)} / khách hàng</div>
        </article>
        ${unitEconCards(funnel)}
      </div>

      <div class="planner-chart-grid">
        <section class="card">
          <div class="card-header">
            <div><h3 class="card-title">Funnel mục tiêu</h3><p class="card-subtitle">Tính ngược từ doanh thu và AOV</p></div>
          </div>
          <div class="planner-chart"><canvas id="plannerFunnelChart"></canvas></div>
          <div class="planner-funnel-summary">
            <span><strong>${formatCount(funnel.leads)}</strong> Lead</span>
            <span><strong>${formatCount(funnel.sql)}</strong> SQL</span>
            <span><strong>${formatCount(funnel.customers)}</strong> Khách hàng</span>
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <div><h3 class="card-title">Ngân sách theo mục đích</h3><p class="card-subtitle">Tạo khách hàng và xây dựng thương hiệu</p></div>
          </div>
          <div class="planner-donut-wrap">
            <canvas id="plannerPurposeChart"></canvas>
            <div id="plannerPurposeLegend" class="planner-donut-legend"></div>
          </div>
        </section>
      </div>

      <section class="card planner-table-card">
        <div class="card-header">
          <h3 class="card-title">Phân bổ đa tầng</h3>
          <p class="card-subtitle">Sửa % trực tiếp; mỗi tầng phải tổng 100%.</p>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Tầng</th><th>Hạng mục</th><th>Tỷ trọng (%)</th><th class="num">Ngân sách</th></tr></thead>
            <tbody>${allocationRows(allocation)}</tbody>
          </table>
        </div>
        <div class="planner-weight-totals">
          ${['tier1', 'tier2', 'tier3'].map((g) => `<span>${WEIGHT_GROUP_LABELS[g]}: ${totalBadge(g)}</span>`).join('')}
        </div>
      </section>

      <section class="card planner-table-card">
        <div class="card-header"><h3 class="card-title">Hạng mục chi tiết</h3>${totalBadge('tier4')}</div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Hạng mục</th><th>Nhóm</th><th>Kênh</th><th>Tỷ trọng (%)</th><th class="num">Ngân sách</th></tr></thead>
            <tbody>${detailRows(allocation)}</tbody>
          </table>
        </div>
      </section>

      <div class="planner-compact-grid">
        ${compactAllocation('channels', 'Phân bổ theo kênh', allocation.channels)}
        ${compactAllocation('content', 'Phân bổ nội dung', allocation.content)}
      </div>

      <section class="card planner-table-card">
        <div class="card-header">
          <div><h3 class="card-title">Kế hoạch ${monthly.length} tháng · ${PERIOD_LABELS[result.period] || 'theo năm'}</h3><p class="card-subtitle">MoM ${formatPercent(currentInputs.monthlyMoM)}</p></div>
        </div>
        <div class="table-container">
          <table class="data-table">
            <thead><tr><th>Tháng</th><th class="num">Mục tiêu doanh thu</th><th class="num">Ngân sách marketing</th><th class="num">Tỷ lệ MKT</th></tr></thead>
            <tbody>
              ${monthly.map((row) => `
                <tr>
                  <td>Tháng ${row.month}</td>
                  <td class="planner-number">${Utils.formatVND(row.revenueTarget)}</td>
                  <td class="planner-number">${Utils.formatVND(row.budget)}</td>
                  <td class="planner-number">${formatPercent(row.budget / row.revenueTarget)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
    drawCharts();
    bindWeightInputs();
  };

  const drawCharts = () => {
    if (!result) return;
    Chart.drawBar(container.querySelector('#plannerFunnelChart'), [
      { label: 'Lead', value: result.funnel.leads, color: COLORS[0] },
      { label: 'SQL', value: result.funnel.sql, color: COLORS[1] },
      { label: 'Khách hàng', value: result.funnel.customers, color: COLORS[4] }
    ], { height: 230, padding: { left: 54, bottom: 40 } });

    const tier1 = Object.entries(result.allocation.tier1);
    Chart.drawDonut(container.querySelector('#plannerPurposeChart'), tier1.map(([key, node], index) => ({
      label: labelFor(key),
      value: node.amount,
      color: COLORS[index]
    })), { size: 170, centerText: Utils.formatVNDCompact(result.mktBudget), centerSubtext: 'Tổng MKT' });
    const legend = container.querySelector('#plannerPurposeLegend');
    if (legend) {
      legend.innerHTML = tier1.map(([key, node], index) => `
        <div><i style="background:${COLORS[index]}"></i><span>${Utils.escapeHtml(labelFor(key))}</span><strong>${formatPercent(node.ratio)}</strong></div>
      `).join('');
    }
  };

  // Reads the edited % back into an engine weights object (ratios 0–1).
  const readWeightsFromDom = () => {
    const weights = {};
    container.querySelectorAll('.planner-weight-input').forEach((input) => {
      const group = input.dataset.weightGroup;
      const key = input.dataset.weightKey;
      const value = Number(input.value);
      if (!group || !key || !Number.isFinite(value)) return;
      weights[group] = weights[group] || {};
      weights[group][key] = value / 100;
    });
    return weights;
  };

  // Live per-group total badges — flags any group whose % don't sum to 100.
  const refreshWeightTotals = () => {
    const totals = {};
    container.querySelectorAll('.planner-weight-input').forEach((input) => {
      const group = input.dataset.weightGroup;
      const value = Number(input.value);
      if (!group || !Number.isFinite(value)) return;
      totals[group] = (totals[group] || 0) + value;
    });
    container.querySelectorAll('[data-weight-total]').forEach((badge) => {
      const group = badge.dataset.weightTotal;
      const total = totals[group] || 0;
      const ok = Math.abs(total - 100) <= WEIGHT_TOTAL_TOLERANCE;
      badge.textContent = `${total.toFixed(1)}%`;
      badge.classList.toggle('is-invalid', !ok);
      badge.classList.toggle('is-valid', ok);
      badge.title = ok
        ? 'Tổng tỷ trọng hợp lệ (100%).'
        : `Tổng nhóm ${WEIGHT_GROUP_LABELS[group] || group} là ${total.toFixed(1)}%, cần bằng 100%.`;
    });
  };

  const bindWeightInputs = () => {
    container.querySelectorAll('.planner-weight-input').forEach((input) => {
      input.addEventListener('input', refreshWeightTotals);
      input.addEventListener('change', () => compute(readWeightsFromDom()));
    });
    refreshWeightTotals();
  };

  const compute = async (weights = currentWeights) => {
    showFormError();
    try {
      const inputs = collectInputs();
      setBusy(true);
      const computed = await RemoteStore.computeMarketingPlan(inputs, weights);
      currentInputs = inputs;
      currentWeights = computed.weights;
      result = computed;
      renderOutput();
      renderSavedSection();
      return computed;
    } catch (error) {
      console.error('Planner compute failed:', error);
      showFormError(error.message || 'Không thể tính kế hoạch.');
      Toast.error(error.message || 'Không thể tính kế hoạch.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const suggestWithAi = async () => {
    showFormError();
    try {
      const inputs = collectInputs();
      setBusy(true);
      const suggestion = await RemoteStore.suggestMarketingAllocation(inputs);
      aiSuggestion = suggestion;
      currentWeights = suggestion.weights;
      currentInputs = inputs;
      const computed = await RemoteStore.computeMarketingPlan(inputs, currentWeights);
      result = computed;
      renderOutput();
      renderSavedSection();
      if (suggestion.source === 'ai') {
        Toast.success('Đã áp dụng gợi ý phân bổ từ AI.');
      } else {
        Toast.warning('Chưa có kết nối AI; đang dùng công thức phân bổ dự phòng.');
      }
    } catch (error) {
      console.error('Planner AI suggestion failed:', error);
      showFormError(error.message || 'Không thể lấy gợi ý phân bổ.');
      Toast.error(error.message || 'Không thể lấy gợi ý phân bổ.');
    } finally {
      setBusy(false);
    }
  };

  const savePlan = () => {
    if (!result || !currentInputs) {
      Toast.warning('Hãy tính kế hoạch trước khi lưu.');
      return;
    }
    const normalizedName = container.querySelector('#plannerName')?.value.trim() || '';
    if (!normalizedName) {
      showFormError('Nhập tên kế hoạch trước khi lưu.');
      Toast.error('Nhập tên kế hoạch trước khi lưu.');
      return;
    }
    const payload = { name: normalizedName, inputs: currentInputs, result };
    if (selectedPlanId) {
      Store.marketingPlans.update(selectedPlanId, payload);
      Toast.success('Đã cập nhật kế hoạch.');
    } else {
      const saved = Store.marketingPlans.create(payload);
      selectedPlanId = saved.id;
      Toast.success('Đã lưu kế hoạch.');
    }
    renderSavedSection();
  };

  const fillForm = (inputs = {}, name = '') => {
    const values = {
      plannerName: name,
      plannerTargetRevenue: inputs.targetRevenue ?? '',
      plannerPrevRevenue: inputs.prevRevenue ?? '',
      plannerGrowth: inputs.growth === undefined ? 10 : (inputs.growth - 1) * 100,
      plannerMktRatio: (inputs.mktRatio ?? 0.4) * 100,
      plannerAov: inputs.aov ?? 15000000,
      plannerSqlPerLead: (inputs.sqlPerLead ?? 0.3) * 100,
      plannerOrderPerSql: (inputs.orderPerSql ?? 0.5) * 100,
      plannerMom: (inputs.monthlyMoM ?? 0.05) * 100,
      plannerGrossMargin: (inputs.grossMargin ?? 0.3) * 100,
      plannerRetention: (inputs.retentionRate ?? 0) * 100,
      plannerPurchaseFreq: inputs.purchaseFrequency ?? 1,
      plannerIndustry: inputs.industry ?? '',
      plannerGoal: inputs.goal ?? ''
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = container.querySelector(`#${id}`);
      if (element) element.value = value;
    });
  };

  const loadPlan = (id) => {
    const plan = Store.marketingPlans.getById(id);
    if (!plan) {
      Toast.error('Không tìm thấy kế hoạch đã lưu.');
      return;
    }
    selectedPlanId = plan.id;
    currentInputs = structuredClone(plan.inputs || {});
    result = structuredClone(plan.result || null);
    currentWeights = result?.weights || null;
    aiSuggestion = null;
    fillForm(currentInputs, plan.name || '');
    renderOutput();
    renderSavedSection();
    Toast.success('Đã tải kế hoạch.');
  };

  const deletePlan = (id) => {
    const plan = Store.marketingPlans.getById(id);
    if (!plan || !window.confirm(`Xóa kế hoạch “${plan.name || 'Chưa đặt tên'}”?`)) return;
    Store.marketingPlans.remove(id);
    if (selectedPlanId === id) selectedPlanId = '';
    renderSavedSection();
    Toast.success('Đã xóa kế hoạch.');
  };

  const renderSavedSection = () => {
    const section = container?.querySelector('#plannerSavedPlans');
    if (!section) return;
    section.innerHTML = renderSavedPlans();
    section.querySelectorAll('[data-plan-load]').forEach((button) => {
      button.addEventListener('click', () => loadPlan(button.dataset.planLoad));
    });
    section.querySelectorAll('[data-plan-delete]').forEach((button) => {
      button.addEventListener('click', () => deletePlan(button.dataset.planDelete));
    });
    const saveButton = container.querySelector('#plannerSaveBtn');
    if (saveButton) {
      saveButton.disabled = busy || !result;
      saveButton.textContent = selectedPlanId ? 'Cập nhật kế hoạch' : 'Lưu kế hoạch';
    }
  };

  const bindEvents = () => {
    container.querySelector('#plannerComputeBtn')?.addEventListener('click', () => {
      aiSuggestion = null;
      currentWeights = null;
      compute(null);
    });
    container.querySelector('#plannerAiBtn')?.addEventListener('click', suggestWithAi);
    container.querySelector('#plannerSaveBtn')?.addEventListener('click', savePlan);
    renderSavedSection();
  };

  const render = (element) => {
    container = element;
    result = null;
    currentInputs = null;
    currentWeights = null;
    aiSuggestion = null;
    selectedPlanId = '';
    container.innerHTML = `
      <div class="planner-shell">
        <div class="planner-input-column">
          ${renderForm()}
          <section class="card planner-saved-card">
            <div class="card-header">
              <div><h2 class="card-title">Kế hoạch đã lưu</h2><p class="card-subtitle">Chọn để tải lại và cập nhật.</p></div>
            </div>
            <div id="plannerSavedPlans"></div>
          </section>
        </div>
        <main class="planner-output" id="plannerOutput"></main>
      </div>
    `;
    bindEvents();
    renderOutput();
  };

  return { render };
})();

App.registerPage('planner', PlannerPage);
