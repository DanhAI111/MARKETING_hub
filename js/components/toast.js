/* ═══════════════════════════════════════════
   MARKETING HUB - Toast Notification Component
   ═══════════════════════════════════════════ */

const Toast = (() => {
  let container = null;

  const init = () => {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toastContainer';
      document.body.appendChild(container);
    }
  };

  const show = (message, type = 'info', duration = 3000) => {
    init();

    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Messages are always plain text (often backend error strings). Escape so a
    // reflected value in an error message can't inject markup.
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ'}</span>
      <span class="toast-message">${Utils.escapeHtml(message)}</span>
      <button class="toast-close">${Utils.icons.close}</button>
    `;

    container.appendChild(toast);

    toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));

    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }

    return toast;
  };

  const removeToast = (toast) => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 200);
  };

  const success = (msg) => show(msg, 'success');
  const error = (msg) => show(msg, 'error');
  const warning = (msg) => show(msg, 'warning');
  const info = (msg) => show(msg, 'info');

  return { show, success, error, warning, info };
})();
