/* ═══════════════════════════════════════════
   MARKETING HUB - Utility Functions
   Format, Export, Import helpers
   ═══════════════════════════════════════════ */

const Utils = (() => {

  // ── Currency Format ──
  const formatVND = (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0 ₫';
    return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' ₫';
  };

  const formatVNDCompact = (amount) => {
    if (!amount || isNaN(amount)) return '0';
    if (amount >= 1000000000) return (amount / 1000000000).toFixed(1) + ' tỷ';
    if (amount >= 1000000) return (amount / 1000000).toFixed(1) + ' tr';
    if (amount >= 1000) return (amount / 1000).toFixed(0) + 'k';
    return amount.toString();
  };

  // ── Number Format ──
  const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return new Intl.NumberFormat('vi-VN').format(num);
  };

  const formatNumberCompact = (num) => {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatPercent = (value, decimals = 1) => {
    if (value === null || value === undefined || isNaN(value)) return '0%';
    return value.toFixed(decimals) + '%';
  };

  const formatRatio = (value) => {
    if (!value || isNaN(value)) return '0.00x';
    return value.toFixed(2) + 'x';
  };

  // ── Date Format ──
  const MONTHS_VI = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const DAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  const formatDateShort = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const formatMonthYear = (monthStr) => {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    return `${MONTHS_VI[parseInt(month) - 1]} ${year}`;
  };

  const getCurrentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const getPrevMonth = (monthStr) => {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const getNextMonth = (monthStr) => {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const getReportingMonth = () => Store.settings.get('reportingMonth') || getCurrentMonth();

  const setReportingMonth = (monthStr) => {
    Store.settings.set('reportingMonth', monthStr || getCurrentMonth());
  };

  const getDefaultDateForMonth = (monthStr) => {
    const month = monthStr || getReportingMonth();
    const today = new Date().toISOString().split('T')[0];
    return today.startsWith(month) ? today : `${month}-01`;
  };

  const isToday = (dateStr) => {
    if (!dateStr) return false;
    return dateStr === new Date().toISOString().split('T')[0];
  };

  const isPast = (dateStr) => {
    if (!dateStr) return false;
    return dateStr < new Date().toISOString().split('T')[0];
  };

  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Chào buổi sáng';
    if (hour < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  };

  // ── Platform helpers ──
  const PLATFORMS = {
    facebook: { name: 'Facebook', icon: '', color: '#1877f2', cssClass: 'facebook' },
    instagram: { name: 'Instagram', icon: '', color: '#e1306c', cssClass: 'instagram' },
    threads: { name: 'Threads', icon: '', color: '#ffffff', cssClass: 'threads' },
    tiktok: { name: 'TikTok', icon: '', color: '#00f2ea', cssClass: 'tiktok' },
    zalo: { name: 'Zalo OA', icon: '', color: '#0068ff', cssClass: 'zalo' }
  };

  const getPlatformInfo = (platform) => PLATFORMS[platform] || { name: platform, icon: '', color: '#64748b', cssClass: '' };

  // ── Expense Categories ──
  // Framer gradient family (violet/magenta/orange/coral/blue) — series identity
  // always pairs with the legend + direct labels the charts already render.
  const DEFAULT_EXPENSE_CATEGORIES = {
    ads: { name: 'Chi phí Ads', icon: '', color: '#6a4cf5' },
    event: { name: 'Tổ chức sự kiện', icon: '', color: '#0099ff' },
    content: { name: 'Sản xuất nội dung', icon: '', color: '#d44df0' },
    kol: { name: 'KOL/Influencer', icon: '', color: '#ff7a3d' },
    print: { name: 'In ấn', icon: '', color: '#ff5577' },
    other: { name: 'Phát sinh khác', icon: '', color: '#999999' }
  };

  const getExpenseCategories = () => {
    const custom = Store.customCategories.getAll();
    return custom || DEFAULT_EXPENSE_CATEGORIES;
  };

  // Proxy for backward compatibility
  const EXPENSE_CATEGORIES = new Proxy({}, {
    get: (_, key) => getExpenseCategories()[key],
    ownKeys: () => Object.keys(getExpenseCategories()),
    has: (_, key) => key in getExpenseCategories(),
    getOwnPropertyDescriptor: (_, key) => {
      const cats = getExpenseCategories();
      if (key in cats) return { enumerable: true, configurable: true, value: cats[key] };
    }
  });

  const getCategoryInfo = (category) => {
    const cats = getExpenseCategories();
    return cats[category] || { name: category, icon: '', color: '#64748b' };
  };

  // ── Event Types ──
  const EVENT_TYPES = {
    'workshop': 'Workshop',
    'seminar': 'Seminar',
    'team-building': 'Team Building',
    'exhibition': 'Triển lãm',
    'launch': 'Ra mắt SP',
    'other': 'Khác'
  };

  // ── Status helpers ──
  const EVENT_STATUSES = {
    'planning': { label: 'Lên kế hoạch', cssClass: 'tag-status-planning' },
    'preparing': { label: 'Đang chuẩn bị', cssClass: 'tag-status-preparing' },
    'ongoing': { label: 'Đang diễn ra', cssClass: 'tag-status-ongoing' },
    'completed': { label: 'Hoàn thành', cssClass: 'tag-status-completed' },
    'cancelled': { label: 'Đã hủy', cssClass: 'tag-status-cancelled' }
  };

  const TASK_STATUSES = {
    'pending': { label: 'Chờ xử lý', column: 0 },
    'in-progress': { label: 'Đang làm', column: 1 },
    'review': { label: 'Chờ duyệt', column: 2 },
    'completed': { label: 'Hoàn thành', column: 3 }
  };

  const PRIORITIES = {
    'high': { label: 'Cao', cssClass: 'tag-priority-high' },
    'medium': { label: 'Trung bình', cssClass: 'tag-priority-medium' },
    'low': { label: 'Thấp', cssClass: 'tag-priority-low' }
  };

  const POST_STATUSES = {
    scheduled: { label: 'Chờ đăng', className: 'tag-warning' },
    publishing: { label: 'Đang đăng', className: 'tag-info' },
    published: { label: 'Đã đăng', className: 'tag-success' },
    failed: { label: 'Lỗi đăng', className: 'tag-danger' }
  };

  const getPostStatus = (status, fallback = 'published') => POST_STATUSES[status] || POST_STATUSES[fallback];

  const APPROVAL_STATUSES = {
    pending: { label: 'Chờ duyệt', className: 'tag-warning' },
    approved: { label: 'Đã duyệt', className: 'tag-success' },
    rejected: { label: 'Từ chối', className: 'tag-danger' }
  };

  const getApprovalStatus = (status, fallback = 'approved') => (
    APPROVAL_STATUSES[status] || APPROVAL_STATUSES[fallback]
  );

  const CAMPAIGN_STATUSES = {
    active: { label: 'Đang chạy', cssClass: 'tag-status-ongoing' },
    planning: { label: 'Lên kế hoạch', cssClass: 'tag-status-planning' },
    paused: { label: 'Tạm dừng', cssClass: 'tag-status-preparing' },
    completed: { label: 'Đã kết thúc', cssClass: 'tag-status-completed' }
  };

  // Reusable campaign picker for member forms (posts/ads/events/expenses).
  // Returns a labelled form-group; read the value with data-field="campaignId".
  const campaignPickerHtml = (selectedId = '') => {
    const campaigns = typeof Store !== 'undefined' ? Store.campaigns.getAll() : [];
    return `
      <div class="form-group">
        <label class="form-label">Chiến dịch</label>
        <select class="form-select" data-field="campaignId">
          <option value="">— Không thuộc chiến dịch —</option>
          ${campaigns.map(c => `<option value="${escapeHtml(c.id)}" ${selectedId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>`;
  };

  // ── KPI Color ──
  const getKpiColor = (percentage) => {
    if (percentage >= 80) return 'success';
    if (percentage >= 50) return 'warning';
    return 'danger';
  };

  // ── Export to CSV ──
  const exportCSV = (data, filename, headers) => {
    const csvHeader = headers.join(',');
    const csvRows = data.map(row =>
      headers.map(h => {
        const val = row[h] ?? '';
        return typeof val === 'string' && (val.includes(',') || val.includes('"'))
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(',')
    );
    const csv = [csvHeader, ...csvRows].join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, filename + '.csv');
  };

  // ── Export to Excel (Simple) ──
  const exportExcel = (data, filename, headers, headerLabels) => {
    // Simple HTML table to .xls (works with Excel)
    let table = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table>';
    table += '<tr>' + (headerLabels || headers).map(h => `<th style="background:#7c3aed;color:white;font-weight:bold;padding:8px;">${h}</th>`).join('') + '</tr>';
    data.forEach(row => {
      table += '<tr>' + headers.map(h => `<td style="padding:6px;border:1px solid #ddd;">${row[h] ?? ''}</td>`).join('') + '</tr>';
    });
    table += '</table></body></html>';
    const blob = new Blob([table], { type: 'application/vnd.ms-excel;charset=utf-8' });
    downloadBlob(blob, filename + '.xls');
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Parse CSV (RFC 4180: quoted fields may contain commas, newlines, "" ) ──
  // Symmetric with exportCSV, which quotes fields containing , or " and escapes " as "".
  const parseCSV = (text) => {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else { field += c; }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => cell.trim() !== ''));
  };

  // ── Import CSV ──
  const importCSV = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const matrix = parseCSV(e.target.result);
          if (matrix.length < 2) { resolve([]); return; }
          const headers = matrix[0].map(h => h.trim());
          const rows = matrix.slice(1).map((values) => {
            const row = {};
            headers.forEach((h, idx) => { row[h] = (values[idx] ?? '').trim(); });
            return row;
          });
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  // ── Debounce ──
  const debounce = (fn, ms = 300) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  // ── Sanitize HTML ──
  const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  // ── SVG Icons (inline) ──
  const icons = {
    dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    content: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    tasks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
    events: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
    expenses: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
    ads: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10"/><path d="M20.49 15a9 9 0 01-14.85 3.36L1 14"/></svg>`,
    filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    moreVertical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,
    trendUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    trendDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
    logo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    mapPin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
    fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    repeat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
    megaphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a2 2 0 002 2h3l6 4V5L8 9H5a2 2 0 00-2 2z"/><path d="M18 9a4 4 0 010 6"/><path d="M20.5 6.5a7 7 0 010 11"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>`,
    printer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/><path d="M18 12h.01"/></svg>`,
    receipt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .67V2l-3 2-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>`,
  };

  const categoryIconMap = {
    ads: icons.megaphone,
    event: icons.calendar,
    content: icons.image,
    kol: icons.user,
    print: icons.printer,
    other: icons.receipt
  };

  const getExpenseCategoryIcon = (category) => {
    // The interface uses one coherent SVG icon set. Ignore legacy/custom emoji
    // values that may still exist in stored category records.
    return categoryIconMap[category] || icons.expenses;
  };

  const icon = (name, className = '') => {
    return `<span class="icon ${className}">${icons[name] || ''}</span>`;
  };

  // Bind an activation handler to a non-button clickable element so keyboard
  // users (Enter/Space) can trigger it, not just mouse clicks. Pair with
  // tabindex="0" role="button" on the element.
  const onActivate = (el, handler) => {
    if (!el) return;
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler(e);
      }
    });
  };

  // Sanitize a user-supplied URL for use in an href. Blocks javascript:, data:,
  // and other dangerous schemes; forces http(s). Returns '#' when unsafe/empty.
  // The result is still escapeHtml'd by callers before interpolation.
  const safeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '#';
    if (/^https?:\/\//i.test(raw)) return raw;
    // A bare scheme (javascript:, data:, vbscript:, mailto:, tel:, …) is unsafe here.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '#';
    // Scheme-less (e.g. "example.com/x") → assume https.
    return `https://${raw}`;
  };

  return {
    formatVND, formatVNDCompact, formatNumber, formatNumberCompact,
    formatPercent, formatRatio,
    formatDate, formatDateShort, formatMonthYear,
    getCurrentMonth, getPrevMonth, getNextMonth, getReportingMonth, setReportingMonth, getDefaultDateForMonth,
    isToday, isPast, daysUntil, getGreeting,
    MONTHS_VI, DAYS_VI,
    PLATFORMS, getPlatformInfo,
    EXPENSE_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, getExpenseCategories, getCategoryInfo, getExpenseCategoryIcon,
    EVENT_TYPES, EVENT_STATUSES, TASK_STATUSES, PRIORITIES, POST_STATUSES, getPostStatus,
    APPROVAL_STATUSES, getApprovalStatus, CAMPAIGN_STATUSES, campaignPickerHtml,
    getKpiColor,
    exportCSV, exportExcel, importCSV, downloadBlob,
    debounce, escapeHtml, safeUrl, onActivate,
    icons, icon
  };
})();
