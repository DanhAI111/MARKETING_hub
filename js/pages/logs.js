/* ═══════════════════════════════════════════
   MARKETING HUB - Application Logs
   ═══════════════════════════════════════════ */

const LogsPage = (() => {
  const componentOptions = ['', 'publisher', 'api', 'client', 'audit', 'meta', 'cron'];

  const toIsoRange = (period) => {
    const to = new Date();
    const duration = period === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return { from: new Date(to.getTime() - duration).toISOString(), to: to.toISOString() };
  };

  const formatJson = (value) => JSON.stringify(value ?? {}, null, 2);
  const logTime = (value) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có';
  const heartbeatAt = (health) => health?.publisher?.lastHeartbeat?.finishedAt
    || health?.publisher?.lastHeartbeat?.startedAt
    || '';

  const render = (container) => {
    let cursor = '';
    let entries = [];
    let health = null;
    let loading = false;

    container.innerHTML = `
      <div class="logs-page">
        <div class="logs-health-grid" id="logsHealth">
          <div class="logs-health-card"><span>Worker</span><strong>Đang kiểm tra</strong></div>
          <div class="logs-health-card"><span>Build SHA</span><strong>—</strong></div>
          <div class="logs-health-card"><span>Cron heartbeat</span><strong>—</strong></div>
        </div>

        <section class="card logs-panel">
          <div class="logs-filters">
            <select class="form-select" id="logsPeriod" aria-label="Khoảng thời gian">
              <option value="24h">24 giờ gần nhất</option>
              <option value="7d">7 ngày gần nhất</option>
            </select>
            <select class="form-select" id="logsLevel" aria-label="Mức log">
              <option value="">Mọi mức</option>
              <option value="error">Lỗi</option>
              <option value="warn">Cảnh báo</option>
              <option value="info">Thông tin</option>
            </select>
            <select class="form-select" id="logsComponent" aria-label="Thành phần">
              ${componentOptions.map(value => `<option value="${value}">${value || 'Mọi thành phần'}</option>`).join('')}
            </select>
            <select class="form-select" id="logsPlatform" aria-label="Nền tảng">
              <option value="">Mọi nền tảng</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
            </select>
            <input class="form-input" id="logsPostId" placeholder="Post ID" aria-label="Post ID">
            <input class="form-input" id="logsQuery" placeholder="Tìm thông báo, mã lỗi..." aria-label="Tìm log">
            <button type="button" class="btn btn-secondary" id="refreshLogsBtn">${Utils.icons.refresh}<span>Làm mới</span></button>
          </div>
          <div class="logs-list" id="logsList"></div>
          <div class="logs-footer">
            <button type="button" class="btn btn-secondary" id="loadMoreLogsBtn" hidden>Xem thêm</button>
          </div>
        </section>
      </div>
    `;

    const list = container.querySelector('#logsList');
    const moreButton = container.querySelector('#loadMoreLogsBtn');

    const selectedFilters = () => ({
      ...toIsoRange(container.querySelector('#logsPeriod').value),
      level: container.querySelector('#logsLevel').value,
      component: container.querySelector('#logsComponent').value,
      platform: container.querySelector('#logsPlatform').value,
      postId: container.querySelector('#logsPostId').value.trim(),
      q: container.querySelector('#logsQuery').value.trim(),
      limit: 50
    });

    const renderHealth = () => {
      const root = container.querySelector('#logsHealth');
      const heartbeat = heartbeatAt(health);
      const heartbeatMs = heartbeat ? Date.parse(heartbeat) : 0;
      const delayed = !heartbeatMs || Date.now() - heartbeatMs > 3 * 60 * 1000;
      root.innerHTML = `
        <div class="logs-health-card ${health?.ok ? 'is-ok' : 'is-error'}">
          <span>Worker</span><strong>${health?.ok ? 'Đang hoạt động' : 'Không phản hồi'}</strong>
        </div>
        <div class="logs-health-card"><span>Build SHA</span><strong class="mono">${Utils.escapeHtml(health?.buildSha || 'unknown')}</strong></div>
        <div class="logs-health-card ${delayed ? 'is-error' : 'is-ok'}">
          <span>Cron heartbeat</span><strong>${Utils.escapeHtml(logTime(heartbeat))}</strong>
          ${delayed ? '<small>Heartbeat chậm quá 3 phút; hãy kiểm tra Cloudflare Workers.</small>' : ''}
        </div>
      `;
    };

    const openDetails = async (entry) => {
      let attempts = [];
      if (entry.postId) attempts = await RemoteStore.loadPublishAttempts(entry.postId).catch(() => []);
      const diagnostic = { log: entry, health, publishAttempts: attempts };
      const modal = Modal.open({
        title: 'Chi tiết log', showFooter: false, size: 'lg',
        content: `
          <div class="log-detail-meta">
            <span class="log-level log-level-${Utils.escapeHtml(entry.level)}">${Utils.escapeHtml(entry.level)}</span>
            <span>${Utils.escapeHtml(logTime(entry.createdAt))}</span>
            <span>${Utils.escapeHtml(entry.component || 'app')}</span>
            ${entry.postId ? `<span class="mono">${Utils.escapeHtml(entry.postId)}</span>` : ''}
          </div>
          <pre class="log-json">${Utils.escapeHtml(formatJson(diagnostic))}</pre>
          <button type="button" class="btn btn-primary" id="copyDiagnosticBtn">${Utils.icons.fileText}<span>Sao chép gói chẩn đoán</span></button>
        `
      });
      modal.querySelector('#copyDiagnosticBtn')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(formatJson(diagnostic));
          Toast.success('Đã sao chép gói chẩn đoán');
        } catch {
          Toast.error('Không thể sao chép tự động; hãy chọn nội dung JSON thủ công');
        }
      });
    };

    const renderEntries = () => {
      if (!entries.length) {
        list.innerHTML = '<div class="logs-empty">Không có log phù hợp trong khoảng thời gian đã chọn.</div>';
        return;
      }
      list.innerHTML = entries.map((entry, index) => `
        <button type="button" class="log-row" data-log-index="${index}">
          <span class="log-level log-level-${Utils.escapeHtml(entry.level)}">${Utils.escapeHtml(entry.level)}</span>
          <span class="log-time">${Utils.escapeHtml(logTime(entry.createdAt))}</span>
          <span class="log-component">${Utils.escapeHtml(entry.component || 'app')}</span>
          <span class="log-message">${Utils.escapeHtml(entry.message || entry.event || '')}</span>
          <span class="log-context">${Utils.escapeHtml(entry.platform || '')}${entry.postId ? ` · ${Utils.escapeHtml(entry.postId.slice(0, 12))}` : ''}</span>
        </button>
      `).join('');
      list.querySelectorAll('.log-row').forEach(row => {
        row.addEventListener('click', () => openDetails(entries[Number(row.dataset.logIndex)]));
      });
    };

    const load = async ({ append = false } = {}) => {
      if (loading) return;
      loading = true;
      if (!append) {
        cursor = '';
        entries = [];
        list.innerHTML = '<div class="logs-empty">Đang tải log...</div>';
      }
      try {
        const [result, latestHealth] = await Promise.all([
          RemoteStore.loadAppLogs({ ...selectedFilters(), ...(append && cursor ? { cursor } : {}) }),
          RemoteStore.getHealth()
        ]);
        health = latestHealth;
        entries = append ? [...entries, ...(result.items || [])] : (result.items || []);
        cursor = result.nextCursor || '';
        renderHealth();
        renderEntries();
        moreButton.hidden = !cursor;
      } catch (error) {
        list.innerHTML = `<div class="logs-empty is-error">${Utils.escapeHtml(error.message || 'Không thể tải log')}</div>`;
      } finally {
        loading = false;
      }
    };

    container.querySelector('#refreshLogsBtn')?.addEventListener('click', () => load());
    moreButton?.addEventListener('click', () => load({ append: true }));
    container.querySelectorAll('#logsPeriod, #logsLevel, #logsComponent, #logsPlatform').forEach(input => {
      input.addEventListener('change', () => load());
    });
    const debouncedLoad = Utils.debounce(() => load(), 350);
    container.querySelector('#logsPostId')?.addEventListener('input', debouncedLoad);
    container.querySelector('#logsQuery')?.addEventListener('input', debouncedLoad);
    load();
  };

  return { render };
})();

App.registerPage('logs', LogsPage);
