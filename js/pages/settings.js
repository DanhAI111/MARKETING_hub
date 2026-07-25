/* ═══════════════════════════════════════════
   MARKETING HUB - Settings Page
   Manage fanpages, employees, KPIs, categories
   ═══════════════════════════════════════════ */

const SettingsPage = (() => {
  let container = null;
  let activeTab = 'fanpages';

  const TABS = [
    { id: 'fanpages', label: 'Fanpage', icon: '' },
    { id: 'employees', label: 'Nhân viên', icon: '' },
    { id: 'targets', label: 'KPI & Mục tiêu', icon: '' },
    { id: 'categories', label: 'Danh mục chi phí', icon: '' },
    { id: 'general', label: 'Chung', icon: '' },
  ];

  // ── Render ──
  const render = (el) => {
    container = el;
    renderPage();
  };

  const renderPage = () => {
    if (!container) return;

    container.innerHTML = `
      <div class="settings-shell">
        <aside class="settings-tabs">
          <div class="settings-nav-label">Không gian làm việc</div>
          ${TABS.map((tab, index) => `
            <button class="settings-tab ${activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">
              <span class="settings-tab-index">0${index + 1}</span>
              <span>${tab.label}</span>
              ${Utils.icons.chevronRight}
            </button>
          `).join('')}
          <div class="settings-nav-note">
            <span class="status-pulse"></span>
            Mọi thay đổi được lưu trong không gian làm việc hiện tại.
          </div>
        </aside>
        <div class="settings-content" id="settingsContent"></div>
      </div>
    `;

    // Render active tab content
    const content = container.querySelector('#settingsContent');
    switch (activeTab) {
      case 'fanpages': renderFanpagesTab(content); break;
      case 'employees': renderEmployeesTab(content); break;
      case 'targets': renderTargetsTab(content); break;
      case 'categories': renderCategoriesTab(content); break;
      case 'general': renderGeneralTab(content); break;
    }

    // Tab switching
    container.querySelectorAll('.settings-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderPage();
      });
    });
  };

  // ═══════════════════════════════════════════
  // TAB 1: Fanpages
  // ═══════════════════════════════════════════
  const renderFanpagesTab = (content) => {
    const fanpages = Store.fanpages.getAll();

    content.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">Quản lý Fanpage</h3>
            <p class="settings-section-desc">Thêm, sửa, xóa các fanpage mà bạn quản lý.</p>
          </div>
          <button class="btn btn-primary" id="addFanpageBtn">
            ${Utils.icons.plus}
            <span>Thêm Fanpage</span>
          </button>
        </div>

        ${fanpages.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon"></div>
            <div class="empty-state-title">Chưa có Fanpage nào</div>
            <div class="empty-state-desc">Thêm fanpage để bắt đầu quản lý lịch đăng bài</div>
          </div>
        ` : `
          <div class="settings-list">
            ${fanpages.map(fp => {
              const pi = Utils.getPlatformInfo(fp.platform);
              return `
                <div class="settings-list-item">
                  ${renderFanpageAvatar(fp, pi)}
                  <div class="settings-list-item-info">
                    <div class="settings-list-item-name">${Utils.escapeHtml(fp.name)}</div>
                    <div class="settings-list-item-meta">${pi.name} ${fp.link ? '· ' + Utils.escapeHtml(fp.link) : ''}</div>
                  </div>
                  <div class="settings-list-item-actions">
                    <button class="btn-icon" data-edit-fp="${fp.id}" title="Sửa">${Utils.icons.edit}</button>
                    <button class="btn-icon danger" data-delete-fp="${fp.id}" title="Xóa">${Utils.icons.trash}</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Events
    content.querySelector('#addFanpageBtn')?.addEventListener('click', () => openFanpageModal());
    content.querySelectorAll('[data-edit-fp]').forEach(btn => {
      btn.addEventListener('click', () => openFanpageModal(btn.dataset.editFp));
    });
    content.querySelectorAll('[data-delete-fp]').forEach(btn => {
      btn.addEventListener('click', () => {
        Modal.confirm({
          title: 'Xóa fanpage',
          message: 'Xóa fanpage sẽ xóa toàn bộ bài đăng và báo cáo ads liên quan. Bạn chắc chắn?',
          onConfirm: () => {
            Store.fanpages.remove(btn.dataset.deleteFp);
            Toast.success('Đã xóa fanpage');
            Sidebar.updateBadge();
            renderPage();
          }
        });
      });
    });
  };

  const renderFanpageAvatar = (fp, platformInfo) => {
    const imageUrl = (fp.imageUrl || '').trim();
    const initial = (fp.name || platformInfo.name || 'P').trim().charAt(0).toUpperCase();
    return `
      <div class="settings-list-item-icon settings-fanpage-avatar" style="background: ${platformInfo.color}18; color: ${platformInfo.color};">
        ${imageUrl ? `
          <img src="${Utils.escapeHtml(imageUrl)}" alt="${Utils.escapeHtml(fp.name)}" loading="lazy" onerror="this.parentElement.classList.add('is-fallback'); this.remove();">
        ` : ''}
        <span class="settings-fanpage-avatar-fallback">${Utils.escapeHtml(initial)}</span>
      </div>
    `;
  };

  const openFanpageModal = (editId) => {
    const fp = editId ? Store.fanpages.getById(editId) : null;

    const platformOptions = Object.entries(Utils.PLATFORMS).map(([k, v]) =>
      `<option value="${k}" ${fp?.platform === k ? 'selected' : ''}>${v.icon} ${v.name}</option>`
    ).join('');

    Modal.open({
      title: fp ? 'Sửa Fanpage' : 'Thêm Fanpage mới',
      content: `
        <div class="form-group">
          <label class="form-label">Tên Fanpage <span style="color:var(--danger-400);">*</span></label>
          <input type="text" class="form-input" id="fpName" value="${fp ? Utils.escapeHtml(fp.name) : ''}" placeholder="VD: Công ty ABC Official">
        </div>
        <div class="form-group">
          <label class="form-label">Nền tảng <span style="color:var(--danger-400);">*</span></label>
          <select class="form-select" id="fpPlatform">${platformOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Link Fanpage</label>
          <input type="url" class="form-input" id="fpLink" value="${fp ? Utils.escapeHtml(fp.link || '') : ''}" placeholder="https://facebook.com/...">
        </div>
        <div class="form-group">
          <label class="form-label">Avatar Fanpage</label>
          <input type="url" class="form-input" id="fpImageUrl" value="${fp ? Utils.escapeHtml(fp.imageUrl || '') : ''}" placeholder="https://.../avatar.jpg">
          <div class="form-hint">Nếu đã liên kết Meta, bấm Đồng bộ ngay ở tab Lịch đăng bài để tự lấy avatar.</div>
        </div>
        <div class="form-group" id="fpCrossPostGroup" style="display: ${(fp?.platform || 'facebook') === 'facebook' ? 'block' : 'none'};">
          <label class="form-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" id="fpCrossPostInstagram" ${fp?.crossPostInstagram ? 'checked' : ''} style="width: auto;">
            <span class="ui-label-with-icon"><span class="ui-inline-icon">${Utils.icons.image}</span>Đăng đồng thời sang Instagram</span>
          </label>
          <div class="form-hint">Khi bài đăng lên Facebook, tự động đăng luôn sang tài khoản Instagram cùng trang. Instagram yêu cầu ảnh có URL công khai (không hỗ trợ bài chỉ có chữ hay video).</div>
        </div>
      `,
      saveLabel: fp ? 'Cập nhật' : 'Thêm mới',
      onSave: () => {
        const name = document.getElementById('fpName')?.value.trim();
        const platform = document.getElementById('fpPlatform')?.value;
        const link = document.getElementById('fpLink')?.value.trim();
        const imageUrl = document.getElementById('fpImageUrl')?.value.trim();
        const crossPostInstagram = platform === 'facebook' && !!document.getElementById('fpCrossPostInstagram')?.checked;
        if (!name) { Toast.error('Vui lòng nhập tên Fanpage'); return; }

        if (fp) {
          Store.fanpages.update(editId, { name, platform, link, imageUrl, crossPostInstagram });
          Toast.success('Đã cập nhật fanpage');
        } else {
          Store.fanpages.create({ name, platform, link, imageUrl, crossPostInstagram });
          Toast.success('Đã thêm fanpage mới');
        }
        Modal.close();
        Sidebar.updateBadge();
        renderPage();
      }
    });

    // Cross-post checkbox only applies to Facebook pages.
    setTimeout(() => {
      const platformSel = document.getElementById('fpPlatform');
      const group = document.getElementById('fpCrossPostGroup');
      platformSel?.addEventListener('change', () => {
        if (group) group.style.display = platformSel.value === 'facebook' ? 'block' : 'none';
      });
    }, 50);
  };

  // ═══════════════════════════════════════════
  // TAB 2: Employees
  // ═══════════════════════════════════════════
  const renderEmployeesTab = (content) => {
    const employees = Store.employees.getAll();

    content.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">Danh sách nhân viên</h3>
            <p class="settings-section-desc">Quản lý nhân viên, Gmail cá nhân và vai trò để giao việc nhanh hơn.</p>
          </div>
          <button class="btn btn-primary" id="addEmployeeBtn">
            ${Utils.icons.plus}
            <span>Thêm nhân viên</span>
          </button>
        </div>

        ${employees.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon"></div>
            <div class="empty-state-title">Chưa có nhân viên nào</div>
            <div class="empty-state-desc">Thêm nhân viên để dùng dropdown giao việc thay vì gõ tay</div>
          </div>
        ` : `
          <div class="settings-list">
            ${employees.map(emp => `
              <div class="settings-list-item">
                <div class="settings-list-item-icon">${Utils.icons.user}</div>
                <div class="settings-list-item-info">
                  <div class="settings-list-item-name">${Utils.escapeHtml(emp.name)}</div>
                  <div class="settings-list-item-meta">
                    ${Utils.escapeHtml(emp.role || 'Nhân viên')}${emp.email ? ` · ${Utils.escapeHtml(emp.email)}` : ''}
                  </div>
                </div>
                <div class="settings-list-item-actions">
                  <button class="btn-icon" data-edit-emp="${emp.id}" title="Sửa">${Utils.icons.edit}</button>
                  <button class="btn-icon danger" data-delete-emp="${emp.id}" title="Xóa">${Utils.icons.trash}</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    content.querySelector('#addEmployeeBtn')?.addEventListener('click', () => openEmployeeModal());
    content.querySelectorAll('[data-edit-emp]').forEach(btn => {
      btn.addEventListener('click', () => openEmployeeModal(btn.dataset.editEmp));
    });
    content.querySelectorAll('[data-delete-emp]').forEach(btn => {
      btn.addEventListener('click', () => {
        Modal.confirm({
          title: 'Xóa nhân viên',
          message: 'Xóa nhân viên này?',
          onConfirm: () => {
            Store.employees.remove(btn.dataset.deleteEmp);
            Toast.success('Đã xóa nhân viên');
            renderPage();
          }
        });
      });
    });
  };

  const openEmployeeModal = (editId) => {
    const emp = editId ? Store.employees.getById(editId) : null;

    Modal.open({
      title: emp ? 'Sửa nhân viên' : 'Thêm nhân viên mới',
      content: `
        <div class="form-group">
          <label class="form-label">Tên nhân viên <span style="color:var(--danger-400);">*</span></label>
          <input type="text" class="form-input" id="empName" value="${emp ? Utils.escapeHtml(emp.name) : ''}" placeholder="VD: Nguyễn Văn A">
        </div>
        <div class="form-group">
          <label class="form-label">Vị trí / Vai trò</label>
          <input type="text" class="form-input" id="empRole" value="${emp ? Utils.escapeHtml(emp.role || '') : ''}" placeholder="VD: Content Creator, Designer...">
        </div>
        <div class="form-group">
          <label class="form-label">Gmail cá nhân</label>
          <input type="email" class="form-input" id="empEmail" value="${emp ? Utils.escapeHtml(emp.email || '') : ''}" placeholder="VD: nhanvien@gmail.com" autocomplete="email">
          <div class="form-hint">Email này được dùng để đăng nhập Google và nhận thông báo công việc.</div>
        </div>
      `,
      saveLabel: emp ? 'Cập nhật' : 'Thêm mới',
      onSave: () => {
        const name = document.getElementById('empName')?.value.trim();
        const role = document.getElementById('empRole')?.value.trim();
        const email = document.getElementById('empEmail')?.value.trim();
        if (!name) { Toast.error('Vui lòng nhập tên nhân viên'); return; }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          Toast.error('Email nhân viên không hợp lệ');
          return;
        }

        if (emp) {
          Store.employees.update(editId, { name, role, email, avatar: '' });
          Toast.success('Đã cập nhật nhân viên');
        } else {
          Store.employees.create({ name, role, email, avatar: '' });
          Toast.success('Đã thêm nhân viên mới');
        }
        Modal.close();
        renderPage();
      }
    });

  };

  // ═══════════════════════════════════════════
  // TAB 3: KPI & Monthly Targets
  // ═══════════════════════════════════════════
  const renderTargetsTab = (content) => {
    const currentMonth = Utils.getCurrentMonth();
    const targets = Store.monthlyTargets.getByMonth(currentMonth) || {};

    content.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">KPI & Mục tiêu tháng ${currentMonth.split('-')[1]}/${currentMonth.split('-')[0]}</h3>
            <p class="settings-section-desc">Đặt mục tiêu hàng tháng để theo dõi hiệu quả trên Dashboard.</p>
          </div>
        </div>

        <div class="settings-form-grid">
          <div class="form-group">
            <label class="form-label">Ngân sách tổng (₫)</label>
            <input type="number" class="form-input" id="targetTotalBudget" value="${targets.totalBudget || ''}" placeholder="VD: 100000000">
            <div class="form-hint">Tổng ngân sách marketing tháng này</div>
          </div>
          <div class="form-group">
            <label class="form-label">Budget Ads (₫)</label>
            <input type="number" class="form-input" id="targetAdsBudget" value="${targets.adsBudget || ''}" placeholder="VD: 50000000">
            <div class="form-hint">Ngân sách dành cho quảng cáo</div>
          </div>
          <div class="form-group">
            <label class="form-label">Budget Sự kiện (₫)</label>
            <input type="number" class="form-input" id="targetEventBudget" value="${targets.eventBudget || ''}" placeholder="VD: 30000000">
            <div class="form-hint">Ngân sách tổ chức sự kiện</div>
          </div>
          <div class="form-group">
            <label class="form-label">Số bài đăng mục tiêu</label>
            <input type="number" class="form-input" id="targetPostsCount" value="${targets.postsCount || ''}" placeholder="VD: 100">
            <div class="form-hint">Tổng số bài đăng trên tất cả fanpage</div>
          </div>
          <div class="form-group">
            <label class="form-label">Số sự kiện mục tiêu</label>
            <input type="number" class="form-input" id="targetEventsCount" value="${targets.eventsCount || ''}" placeholder="VD: 3">
          </div>
          <div class="form-group">
            <label class="form-label">Doanh thu mục tiêu (₫)</label>
            <input type="number" class="form-input" id="targetRevenue" value="${targets.revenue || ''}" placeholder="VD: 200000000">
          </div>
        </div>

        <div style="margin-top: var(--space-4); display: flex; gap: var(--space-3); justify-content: flex-end;">
          <button class="btn btn-primary" id="saveTargetsBtn">
            ${Utils.icons.check}
            <span>Lưu mục tiêu</span>
          </button>
        </div>
      </div>
    `;

    content.querySelector('#saveTargetsBtn')?.addEventListener('click', () => {
      const data = {
        totalBudget: parseFloat(document.getElementById('targetTotalBudget')?.value) || 0,
        adsBudget: parseFloat(document.getElementById('targetAdsBudget')?.value) || 0,
        eventBudget: parseFloat(document.getElementById('targetEventBudget')?.value) || 0,
        postsCount: parseInt(document.getElementById('targetPostsCount')?.value) || 0,
        eventsCount: parseInt(document.getElementById('targetEventsCount')?.value) || 0,
        revenue: parseFloat(document.getElementById('targetRevenue')?.value) || 0,
      };
      Store.monthlyTargets.set(currentMonth, data);
      Toast.success('Đã lưu mục tiêu tháng ' + currentMonth.split('-')[1]);
    });
  };

  // ═══════════════════════════════════════════
  // TAB 4: Expense Categories
  // ═══════════════════════════════════════════
  const renderCategoriesTab = (content) => {
    const categories = Utils.getExpenseCategories();

    content.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">Danh mục chi phí</h3>
            <p class="settings-section-desc">Tùy chỉnh các danh mục chi phí. Thêm/bớt theo nhu cầu.</p>
          </div>
          <button class="btn btn-primary" id="addCategoryBtn">
            ${Utils.icons.plus}
            <span>Thêm danh mục</span>
          </button>
        </div>

        <div class="settings-list" id="categoriesList">
          ${Object.entries(categories).map(([key, cat]) => `
            <div class="settings-list-item">
              <div class="settings-list-item-icon expense-category-icon" style="background: ${cat.color}20; color: ${cat.color}; font-size: 1.1rem;">
                ${Utils.getExpenseCategoryIcon(key, cat)}
              </div>
              <div class="settings-list-item-info">
                <div class="settings-list-item-name">${Utils.escapeHtml(cat.name)}</div>
                <div class="settings-list-item-meta">Key: ${key}</div>
              </div>
              <div class="settings-list-item-actions" style="display: flex; align-items: center; gap: 4px;">
                <span class="category-color-dot" style="width: 12px; height: 12px; border-radius: 50%; background: ${cat.color};"></span>
                <button class="btn-icon" data-edit-cat="${key}" title="Sửa">${Utils.icons.edit}</button>
                ${key !== 'other' ? `<button class="btn-icon danger" data-delete-cat="${key}" title="Xóa">${Utils.icons.trash}</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <div style="margin-top: var(--space-4);">
          <button class="btn btn-secondary" id="resetCategoriesBtn" style="font-size: var(--text-xs);">
            Khôi phục mặc định
          </button>
        </div>
      </div>
    `;

    content.querySelector('#addCategoryBtn')?.addEventListener('click', () => openCategoryModal());
    content.querySelectorAll('[data-edit-cat]').forEach(btn => {
      btn.addEventListener('click', () => openCategoryModal(btn.dataset.editCat));
    });
    content.querySelectorAll('[data-delete-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cats = { ...Utils.getExpenseCategories() };
        delete cats[btn.dataset.deleteCat];
        Store.customCategories.save(cats);
        Toast.success('Đã xóa danh mục');
        renderPage();
      });
    });
    content.querySelector('#resetCategoriesBtn')?.addEventListener('click', () => {
      Modal.confirm({
        title: 'Khôi phục mặc định',
        message: 'Khôi phục danh mục chi phí về mặc định?',
        confirmClass: 'btn-primary',
        onConfirm: () => {
          Store.customCategories.save(null);
          Toast.success('Đã khôi phục mặc định');
          renderPage();
        }
      });
    });
  };

  const openCategoryModal = (editKey) => {
    const cats = Utils.getExpenseCategories();
    const cat = editKey ? cats[editKey] : null;
    const colors = ['#6a4cf5', '#d44df0', '#ff7a3d', '#ff5577', '#0099ff', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#999999'];

    Modal.open({
      title: cat ? 'Sửa danh mục' : 'Thêm danh mục mới',
      content: `
        <div class="form-group">
          <label class="form-label">Tên danh mục <span style="color:var(--danger-400);">*</span></label>
          <input type="text" class="form-input" id="catName" value="${cat ? Utils.escapeHtml(cat.name) : ''}" placeholder="VD: Phí đi lại">
        </div>
        ${!editKey ? `
          <div class="form-group">
            <label class="form-label">Key (mã) <span style="color:var(--danger-400);">*</span></label>
            <input type="text" class="form-input" id="catKey" value="" placeholder="VD: travel (không dấu, không cách)">
            <div class="form-hint">Mã dùng nội bộ, không đổi được sau khi tạo</div>
          </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">Màu sắc</label>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${colors.map(c => `
              <button type="button" class="color-pick" data-color="${c}"
                style="width: 32px; height: 32px; border-radius: 50%; background: ${c}; border: 3px solid ${(cat?.color || '#64748b') === c ? 'white' : 'transparent'}; cursor: pointer; transition: all 0.15s;">
              </button>
            `).join('')}
          </div>
          <input type="hidden" id="catColor" value="${cat?.color || '#64748b'}">
        </div>
      `,
      saveLabel: cat ? 'Cập nhật' : 'Thêm mới',
      onSave: () => {
        const name = document.getElementById('catName')?.value.trim();
        const rawColor = document.getElementById('catColor')?.value || '';
        // Color is interpolated raw into a style attribute at render — constrain to
        // a hex value so it can't break out of the attribute (XSS/CSS injection).
        const color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : '#64748b';
        const key = editKey || document.getElementById('catKey')?.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');

        if (!name) { Toast.error('Vui lòng nhập tên danh mục'); return; }
        if (!key) { Toast.error('Vui lòng nhập mã danh mục'); return; }

        const allCats = { ...Utils.getExpenseCategories() };
        allCats[key] = { name, icon: '', color };
        Store.customCategories.save(allCats);

        Modal.close();
        Toast.success(cat ? 'Đã cập nhật danh mục' : 'Đã thêm danh mục mới');
        renderPage();
      }
    });

    // Color picker interactions
    setTimeout(() => {
      document.querySelectorAll('.color-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.color-pick').forEach(b => b.style.borderColor = 'transparent');
          btn.style.borderColor = 'white';
          document.getElementById('catColor').value = btn.dataset.color;
        });
      });
    }, 100);
  };

  // ═══════════════════════════════════════════
  // TAB 5: General Settings
  // ═══════════════════════════════════════════
  const renderGeneralTab = (content) => {
    const currency = Store.settings.get('currency') || 'VND';
    const theme = App.getTheme();

    content.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">Cài đặt chung</h3>
            <p class="settings-section-desc">Tùy chỉnh ứng dụng và quản lý dữ liệu.</p>
          </div>
        </div>

        <div class="settings-form-grid" style="grid-template-columns: 1fr;">
          <div class="form-group">
            <label class="form-label ui-label-with-icon"><span class="ui-inline-icon">${Utils.icons.settings}</span>Giao diện</label>
            <select class="form-select" id="themeSelect" style="max-width: 300px;">
              <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Tối (mặc định)</option>
              <option value="light" ${theme === 'light' ? 'selected' : ''}>Sáng</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label ui-label-with-icon"><span class="ui-inline-icon">${Utils.icons.expenses}</span>Đơn vị tiền tệ</label>
            <select class="form-select" id="currencySelect" style="max-width: 300px;">
              <option value="VND" ${currency === 'VND' ? 'selected' : ''}>VNĐ (₫)</option>
              <option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD ($)</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-section" style="margin-top: var(--space-6);">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">Sao lưu & Khôi phục</h3>
            <p class="settings-section-desc">Tải xuống toàn bộ dữ liệu dưới dạng JSON hoặc khôi phục từ file backup.</p>
          </div>
        </div>

        <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
          <button class="btn btn-secondary" id="backupBtn">
            ${Utils.icons.download}
            <span>Tải xuống Backup</span>
          </button>
          <div style="position: relative;">
            <button class="btn btn-secondary" id="restoreBtnTrigger">
              ${Utils.icons.upload}
              <span>Khôi phục từ Backup</span>
            </button>
            <input type="file" id="restoreFileInput" accept=".json" style="display:none;">
          </div>
        </div>
      </div>

      <div class="settings-section" style="margin-top: var(--space-6);">
        <div class="settings-section-header">
          <div>
            <h3 class="settings-section-title">Dữ liệu mẫu</h3>
            <p class="settings-section-desc">Tạo dữ liệu demo để khám phá ứng dụng.</p>
          </div>
        </div>

        <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
          <button class="btn btn-secondary" id="seedDataBtn">
            ${Utils.icons.dashboard}
            <span>Tạo dữ liệu mẫu</span>
          </button>
          <button class="btn btn-secondary" id="clearDataBtn" style="color: var(--danger-400); border-color: rgba(239, 68, 68, 0.25);">
            Xóa toàn bộ dữ liệu
          </button>
        </div>
      </div>
    `;

    // Theme change
    content.querySelector('#themeSelect')?.addEventListener('change', (e) => {
      App.setTheme(e.target.value);
      Toast.success('Đã đổi giao diện');
    });

    // Currency change
    content.querySelector('#currencySelect')?.addEventListener('change', (e) => {
      Store.settings.set('currency', e.target.value);
      Toast.success('Đã cập nhật đơn vị tiền tệ');
    });

    // Backup
    content.querySelector('#backupBtn')?.addEventListener('click', () => {
      Store.backup();
      Toast.success('Đã tải xuống file backup');
    });

    // Restore
    content.querySelector('#restoreBtnTrigger')?.addEventListener('click', () => {
      document.getElementById('restoreFileInput')?.click();
    });
    content.querySelector('#restoreFileInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await Store.restore(file);
        Toast.success('Khôi phục dữ liệu thành công! Đang tải lại...');
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        Toast.error('Lỗi khôi phục: ' + err.message);
      }
    });

    // Seed data
    content.querySelector('#seedDataBtn')?.addEventListener('click', () => {
      Modal.confirm({
        title: 'Tạo dữ liệu mẫu',
        message: 'Tạo dữ liệu mẫu? (Sẽ không ghi đè dữ liệu hiện có)',
        confirmClass: 'btn-primary',
        onConfirm: () => {
          Store.seedDemoData();
          Toast.success('Đã tạo dữ liệu mẫu!');
          Sidebar.render();
          renderPage();
        }
      });
    });

    // Clear data
    content.querySelector('#clearDataBtn')?.addEventListener('click', () => {
      Modal.confirm({
        title: 'Xóa toàn bộ dữ liệu',
        message: 'XÓA TOÀN BỘ DỮ LIỆU? Hành động này không thể hoàn tác!',
        confirmLabel: 'Xóa hết',
        onConfirm: () => {
          localStorage.removeItem('marketing_hub_data');
          Toast.success('Đã xóa toàn bộ dữ liệu. Đang tải lại...');
          setTimeout(() => location.reload(), 1000);
        }
      });
    });
  };

  return { render };
})();

App.registerPage('settings', SettingsPage);
