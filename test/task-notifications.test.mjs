import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskNotificationEmail,
  getTaskChanges,
  getTaskNotificationRecipients,
  resolveTaskEmails
} from '../shared/task-notifications.mjs';

test('task notification recipients resolve current and previous assignee emails', () => {
  const employees = [
    { name: 'Minh', email: 'minh@gmail.com' },
    { name: 'Hoa', email: 'hoa@gmail.com' }
  ];
  const recipients = getTaskNotificationRecipients({
    task: { title: 'Banner', assignee: 'Hoa' },
    previousTask: { title: 'Banner', assignee: 'Minh' },
    employees
  });
  assert.deepEqual(recipients.sort(), ['hoa@gmail.com', 'minh@gmail.com']);
});

test('task notification recipients use stored assigneeEmail when the employee name no longer matches', () => {
  assert.deepEqual(
    resolveTaskEmails({ assignee: 'Old name', assigneeEmail: 'old@gmail.com' }, []),
    ['old@gmail.com']
  );
});

test('task notification email includes changed fields', () => {
  const previousTask = { title: 'Content', status: 'pending', priority: 'medium', deadline: '2026-06-22', assignee: 'Minh' };
  const task = { ...previousTask, status: 'in-progress', deadline: '2026-06-23' };
  const changes = getTaskChanges(task, previousTask);
  assert.deepEqual(changes.map((change) => change.field), ['deadline', 'status']);
  const message = buildTaskNotificationEmail({ action: 'updated', task, previousTask, actorEmail: 'admin@example.com', appUrl: 'https://app.example' });
  assert.match(message.subject, /Content/);
  assert.match(message.text, /Han chot: 2026-06-22 -> 2026-06-23/);
  assert.match(message.html, /https:\/\/app\.example\/#tasks/);
});
