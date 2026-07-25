/* ═══════════════════════════════════════════
   MARKETING HUB - Modal Component
   ═══════════════════════════════════════════ */

const Modal = (() => {
  let activeModal = null;
  let escHandler = null;

  const open = ({ title, content, size = '', onSave, onClose, saveLabel = 'Lưu', showFooter = true }) => {
    close(); // Close any existing modal

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modalOverlay';

    overlay.innerHTML = `
      <div class="modal ${size === 'lg' ? 'modal-lg' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-header">
          <h3 class="modal-title" id="modalTitle">${typeof Utils !== 'undefined' ? Utils.escapeHtml(title) : title}</h3>
          <button class="modal-close" id="modalClose" aria-label="Đóng">
            ${Utils.icons.close}
          </button>
        </div>
        <div class="modal-body">
          ${typeof content === 'string' ? content : ''}
        </div>
        ${showFooter ? `
          <div class="modal-footer">
            <button class="btn btn-secondary" id="modalCancel">Hủy</button>
            <button class="btn btn-primary" id="modalSave">${saveLabel}</button>
          </div>
        ` : ''}
      </div>
    `;

    document.body.appendChild(overlay);
    activeModal = overlay;

    // If content is a DOM element, append it
    if (typeof content !== 'string' && content instanceof HTMLElement) {
      overlay.querySelector('.modal-body').appendChild(content);
    }

    // Focus first input
    setTimeout(() => {
      const firstInput = overlay.querySelector('input, select, textarea');
      if (firstInput) firstInput.focus();
    }, 100);

    // Events
    overlay.querySelector('#modalClose')?.addEventListener('click', () => {
      close();
      onClose?.();
    });
    overlay.querySelector('#modalCancel')?.addEventListener('click', () => {
      close();
      onClose?.();
    });
    overlay.querySelector('#modalSave')?.addEventListener('click', () => {
      onSave?.();
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close();
        onClose?.();
      }
    });

    // Keydown: Escape closes; Tab is trapped inside the dialog so focus can't
    // escape to the background. Handler is removed in close() regardless of how
    // the modal is dismissed, so the document-level listener never accumulates.
    escHandler = (e) => {
      if (e.key === 'Escape') {
        close();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && activeModal) {
        const focusable = activeModal.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', escHandler);

    return overlay;
  };

  const close = () => {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    if (activeModal) {
      activeModal.remove();
      activeModal = null;
    }
  };

  const confirm = ({ title = 'Xác nhận', message, icon = Utils.icons.warning, onConfirm, confirmLabel = 'Xác nhận', confirmClass = 'btn-danger' }) => {
    const content = `
      <div class="confirm-body">
        <div class="confirm-icon">${icon}</div>
        <p class="confirm-text">${message}</p>
      </div>
    `;

    open({
      title,
      content,
      showFooter: false,
      onClose: () => {}
    });

    // Add custom footer
    const modalBody = activeModal.querySelector('.modal-body');
    const actions = document.createElement('div');
    actions.className = 'confirm-actions';
    actions.innerHTML = `
      <button class="btn btn-secondary" id="confirmCancel">Hủy</button>
      <button class="btn ${confirmClass}" id="confirmOk">${confirmLabel}</button>
    `;
    modalBody.appendChild(actions);

    actions.querySelector('#confirmCancel').addEventListener('click', close);
    actions.querySelector('#confirmOk').addEventListener('click', () => {
      close();
      onConfirm?.();
    });
  };

  const getFormData = () => {
    if (!activeModal) return {};
    const data = {};
    activeModal.querySelectorAll('[data-field]').forEach(el => {
      const field = el.dataset.field;
      if (el.type === 'checkbox') {
        data[field] = el.checked;
      } else {
        data[field] = el.value;
      }
    });
    return data;
  };

  return { open, close, confirm, getFormData };
})();
