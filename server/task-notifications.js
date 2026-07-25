const email = require('./email');

const shared = import('../shared/task-notifications.mjs');

const appUrl = () => process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`;

const sendTaskNotification = async (repo, { action, task, previousTask = null, actorEmail = '' }) => {
  const helpers = await shared;
  const employees = await repo.listAppItems('employees');
  const recipients = helpers.getTaskNotificationRecipients({ task, previousTask, employees });
  if (!recipients.length) return { skipped: true, reason: 'no-recipients' };
  const message = helpers.buildTaskNotificationEmail({ action, task, previousTask, actorEmail, appUrl: appUrl() });
  return email.sendEmail({ ...message, to: recipients });
};

const sendDailyTaskSummaryIfDue = async (repo) => {
  if (process.env.TASK_DAILY_SUMMARY_ENABLED !== '1') return { skipped: true, reason: 'disabled' };
  const hour = Number(process.env.TASK_DAILY_SUMMARY_HOUR || 8);
  // Interpret HOUR in a fixed offset (default UTC+7, Vietnam) so the summary fires
  // at the same wall-clock time on Node and the Worker, regardless of host TZ.
  const offset = Number(process.env.TASK_DAILY_SUMMARY_UTC_OFFSET || 7);
  const now = new Date();
  const local = new Date(now.getTime() + offset * 3600 * 1000);
  if (local.getUTCHours() !== hour) return { skipped: true, reason: 'not-due' };
  const key = `lastDailyTaskSummary:${local.toISOString().slice(0, 10)}`;
  if (await repo.getState(key)) return { skipped: true, reason: 'already-sent' };

  const helpers = await shared;
  const [tasks, employees] = await Promise.all([
    repo.listAppItems('tasks'),
    repo.listAppItems('employees')
  ]);
  const openTasks = tasks.filter((task) => task.status !== 'completed');
  const byEmail = new Map();
  for (const task of openTasks) {
    for (const recipient of helpers.resolveTaskEmails(task, employees)) {
      if (!byEmail.has(recipient)) byEmail.set(recipient, []);
      byEmail.get(recipient).push(task);
    }
  }
  let sent = 0;
  for (const [recipient, assignedTasks] of byEmail.entries()) {
    const message = helpers.buildDailyTaskSummaryEmail({
      assignee: assignedTasks[0]?.assignee || '',
      tasks: assignedTasks,
      appUrl: appUrl()
    });
    await email.sendEmail({ ...message, to: [recipient] });
    sent += 1;
  }
  await repo.saveState(key, { sent, createdAt: new Date().toISOString() });
  return { sent };
};

module.exports = { sendTaskNotification, sendDailyTaskSummaryIfDue };
