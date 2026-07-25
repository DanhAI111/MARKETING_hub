import { sendEmail } from './email.js';
import {
  buildDailyTaskSummaryEmail,
  buildTaskNotificationEmail,
  getTaskNotificationRecipients,
  resolveTaskEmails
} from '../shared/task-notifications.mjs';

const appUrl = (env, origin = '') => env.PUBLIC_BASE_URL || origin || 'https://marketing-hub.workers.dev';

export const sendTaskNotification = async (env, repo, { action, task, previousTask = null, actorEmail = '', origin = '' }) => {
  const employees = await repo.listAppItems('employees');
  const recipients = getTaskNotificationRecipients({ task, previousTask, employees });
  if (!recipients.length) return { skipped: true, reason: 'no-recipients' };
  const message = buildTaskNotificationEmail({ action, task, previousTask, actorEmail, appUrl: appUrl(env, origin) });
  return sendEmail(env, { ...message, to: recipients });
};

export const sendDailyTaskSummaryIfDue = async (env, repo, scheduledTime = Date.now()) => {
  if (env.TASK_DAILY_SUMMARY_ENABLED !== '1') return { skipped: true, reason: 'disabled' };
  const hour = Number(env.TASK_DAILY_SUMMARY_HOUR || 8);
  // Interpret HOUR in a fixed offset (default UTC+7, Vietnam) so the summary fires
  // at the same wall-clock time on Node and the Worker, regardless of host TZ.
  const offset = Number(env.TASK_DAILY_SUMMARY_UTC_OFFSET || 7);
  const local = new Date(new Date(scheduledTime).getTime() + offset * 3600 * 1000);
  if (local.getUTCHours() !== hour) return { skipped: true, reason: 'not-due' };
  const key = `lastDailyTaskSummary:${local.toISOString().slice(0, 10)}`;
  if (await repo.getState(key)) return { skipped: true, reason: 'already-sent' };

  const [tasks, employees] = await Promise.all([
    repo.listAppItems('tasks'),
    repo.listAppItems('employees')
  ]);
  const byEmail = new Map();
  for (const task of tasks.filter((item) => item.status !== 'completed')) {
    for (const recipient of resolveTaskEmails(task, employees)) {
      if (!byEmail.has(recipient)) byEmail.set(recipient, []);
      byEmail.get(recipient).push(task);
    }
  }
  let sent = 0;
  for (const [recipient, assignedTasks] of byEmail.entries()) {
    const message = buildDailyTaskSummaryEmail({
      assignee: assignedTasks[0]?.assignee || '',
      tasks: assignedTasks,
      appUrl: appUrl(env)
    });
    await sendEmail(env, { ...message, to: [recipient] });
    sent += 1;
  }
  await repo.saveState(key, { sent, createdAt: new Date().toISOString() });
  return { sent };
};
