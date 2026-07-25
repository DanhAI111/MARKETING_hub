const TASK_STATUS_LABELS = {
  pending: 'Cho xu ly',
  'in-progress': 'Dang lam',
  review: 'Cho duyet',
  completed: 'Hoan thanh'
};

const PRIORITY_LABELS = {
  low: 'Thap',
  medium: 'Trung binh',
  high: 'Cao'
};

const ACTION_LABELS = {
  created: 'duoc tao',
  updated: 'duoc cap nhat',
  deleted: 'da bi xoa'
};

const FIELD_LABELS = {
  title: 'Tieu de',
  partner: 'Doi tac',
  assignee: 'Nguoi thuc hien',
  priority: 'Uu tien',
  deadline: 'Han chot',
  status: 'Trang thai',
  notes: 'Ghi chu'
};

const TRACKED_FIELDS = Object.keys(FIELD_LABELS);

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const fieldValue = (field, value) => {
  if (value === undefined || value === null || value === '') return 'Trong';
  if (field === 'status') return TASK_STATUS_LABELS[value] || value;
  if (field === 'priority') return PRIORITY_LABELS[value] || value;
  return String(value);
};

const taskTitle = (task) => task?.title || 'Cong viec';

const taskUrl = (baseUrl = '') => {
  const clean = String(baseUrl || '').replace(/\/+$/, '');
  return clean ? `${clean}/#tasks` : '';
};

const employeeByAssignee = (employees = [], assignee = '') => {
  const name = normalizeName(assignee);
  if (!name) return null;
  return employees.find((employee) => normalizeName(employee.name) === name) || null;
};

export const resolveTaskEmails = (task = {}, employees = []) => {
  const emails = new Set();
  if (isValidEmail(task.assigneeEmail)) emails.add(normalizeEmail(task.assigneeEmail));
  if (isValidEmail(task.assignee)) emails.add(normalizeEmail(task.assignee));
  const employee = employeeByAssignee(employees, task.assignee);
  if (isValidEmail(employee?.email)) emails.add(normalizeEmail(employee.email));
  return [...emails];
};

export const getTaskNotificationRecipients = ({ task = {}, previousTask = null, employees = [] } = {}) => {
  const recipients = new Set(resolveTaskEmails(task, employees));
  if (previousTask) {
    resolveTaskEmails(previousTask, employees).forEach((email) => recipients.add(email));
  }
  return [...recipients];
};

export const getTaskChanges = (task = {}, previousTask = null) => {
  if (!previousTask) return [];
  return TRACKED_FIELDS
    .filter((field) => String(task[field] ?? '') !== String(previousTask[field] ?? ''))
    .map((field) => ({
      field,
      label: FIELD_LABELS[field],
      before: fieldValue(field, previousTask[field]),
      after: fieldValue(field, task[field])
    }));
};

export const buildTaskNotificationEmail = ({ action, task = {}, previousTask = null, actorEmail = '', appUrl = '' } = {}) => {
  const actionLabel = ACTION_LABELS[action] || ACTION_LABELS.updated;
  const title = taskTitle(task || previousTask);
  const subject = `[Marketing Hub] Cong viec ${actionLabel}: ${title}`;
  const url = taskUrl(appUrl);
  const changes = getTaskChanges(task, previousTask);
  const lines = [
    `Cong viec "${title}" ${actionLabel}.`,
    actorEmail ? `Nguoi thao tac: ${actorEmail}` : '',
    '',
    `Trang thai: ${fieldValue('status', task.status)}`,
    `Uu tien: ${fieldValue('priority', task.priority)}`,
    `Han chot: ${fieldValue('deadline', task.deadline)}`,
    `Nguoi thuc hien: ${fieldValue('assignee', task.assignee)}`,
    task.partner ? `Doi tac: ${task.partner}` : '',
    task.notes ? `Ghi chu: ${task.notes}` : '',
    changes.length ? '' : '',
    changes.length ? 'Noi dung thay doi:' : '',
    ...changes.map((change) => `- ${change.label}: ${change.before} -> ${change.after}`),
    url ? '' : '',
    url ? `Mo Marketing Hub: ${url}` : ''
  ].filter((line, index, all) => line || (all[index - 1] && all[index + 1]));

  const details = [
    ['Trang thai', fieldValue('status', task.status)],
    ['Uu tien', fieldValue('priority', task.priority)],
    ['Han chot', fieldValue('deadline', task.deadline)],
    ['Nguoi thuc hien', fieldValue('assignee', task.assignee)],
    ['Doi tac', task.partner || 'Trong']
  ];

  const html = `<!doctype html>
<html lang="vi">
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;margin:0 0 12px;">Cong viec ${escapeHtml(actionLabel)}</h1>
    <p style="font-size:16px;line-height:1.5;margin:0 0 18px;"><strong>${escapeHtml(title)}</strong></p>
    ${actorEmail ? `<p style="margin:0 0 18px;color:#475569;">Nguoi thao tac: ${escapeHtml(actorEmail)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e2e8f0;">
      ${details.map(([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;width:150px;">${escapeHtml(label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(value)}</td>
        </tr>`).join('')}
    </table>
    ${task.notes ? `<p style="white-space:pre-wrap;line-height:1.5;margin:18px 0 0;">${escapeHtml(task.notes)}</p>` : ''}
    ${changes.length ? `
      <h2 style="font-size:16px;margin:22px 0 8px;">Noi dung thay doi</h2>
      <ul style="margin:0;padding-left:20px;line-height:1.6;">
        ${changes.map((change) => `<li><strong>${escapeHtml(change.label)}:</strong> ${escapeHtml(change.before)} -> ${escapeHtml(change.after)}</li>`).join('')}
      </ul>` : ''}
    ${url ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;">Mo Marketing Hub</a></p>` : ''}
  </div>
</body>
</html>`;

  return { subject, text: lines.join('\n'), html };
};

export const buildDailyTaskSummaryEmail = ({ assignee = '', tasks = [], appUrl = '' } = {}) => {
  const subject = `[Marketing Hub] Tong hop ${tasks.length} cong viec dang mo`;
  const url = taskUrl(appUrl);
  const sorted = [...tasks].sort((a, b) => String(a.deadline || '9999-12-31').localeCompare(String(b.deadline || '9999-12-31')));
  const lines = [
    assignee ? `Xin chao ${assignee},` : 'Xin chao,',
    '',
    `Ban dang co ${sorted.length} cong viec chua hoan thanh:`,
    ...sorted.map((task) => `- ${task.title || 'Cong viec'} | ${fieldValue('status', task.status)} | han: ${fieldValue('deadline', task.deadline)} | uu tien: ${fieldValue('priority', task.priority)}`),
    url ? '' : '',
    url ? `Mo Marketing Hub: ${url}` : ''
  ].filter((line, index, all) => line || (all[index - 1] && all[index + 1]));
  const html = `<!doctype html>
<html lang="vi">
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;margin:0 0 12px;">Tong hop cong viec</h1>
    <p style="line-height:1.5;margin:0 0 18px;">${assignee ? `Xin chao ${escapeHtml(assignee)}, ` : ''}ban dang co <strong>${sorted.length}</strong> cong viec chua hoan thanh.</p>
    <ul style="margin:0;padding-left:20px;line-height:1.7;">
      ${sorted.map((task) => `<li><strong>${escapeHtml(task.title || 'Cong viec')}</strong> - ${escapeHtml(fieldValue('status', task.status))} - han: ${escapeHtml(fieldValue('deadline', task.deadline))}</li>`).join('')}
    </ul>
    ${url ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700;">Mo Marketing Hub</a></p>` : ''}
  </div>
</body>
</html>`;
  return { subject, text: lines.join('\n'), html };
};
