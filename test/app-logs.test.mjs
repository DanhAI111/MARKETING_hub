import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeLogDetails, normalizeLogFilters, prepareLogEntry } = require('../shared/app-logs.cjs');

test('application logs recursively redact secrets and sensitive URL parameters', () => {
  const sanitized = sanitizeLogDetails({
    authorization: 'Bearer secret',
    nested: { access_token: 'meta-token', cookie: 'session=secret', safe: 'kept' },
    url: 'https://graph.facebook.com/v23.0/me?access_token=secret&fields=id',
    message: 'useful'
  });

  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.equal(sanitized.nested.access_token, '[REDACTED]');
  assert.equal(sanitized.nested.cookie, '[REDACTED]');
  assert.equal(sanitized.nested.safe, 'kept');
  assert.doesNotMatch(sanitized.url, /secret/);
  assert.match(sanitized.url, /access_token=%5BREDACTED%5D/);
});

test('application log messages redact bearer credentials and token parameters', () => {
  const entry = prepareLogEntry({
    message: 'Request failed: Authorization: Bearer top-secret access_token=meta-secret'
  });
  assert.doesNotMatch(entry.message, /top-secret|meta-secret/);
  assert.match(entry.message, /\[REDACTED\]/);
});

test('application log filters enforce seven-day range and bounded page size', () => {
  const now = Date.parse('2026-08-14T10:00:00.000Z');
  const filters = normalizeLogFilters({
    from: '2025-01-01T00:00:00.000Z',
    to: '2027-01-01T00:00:00.000Z',
    limit: '1000',
    level: 'ERROR',
    component: 'publisher'
  }, now);

  assert.equal(filters.to, '2026-08-14T10:00:00.000Z');
  assert.equal(filters.from, '2026-08-07T10:00:00.000Z');
  assert.equal(filters.limit, 100);
  assert.equal(filters.level, 'error');
});

test('menu, page and both API runtimes expose application logs without Sheet scheduling', () => {
  const sidebar = fs.readFileSync(new URL('../js/components/sidebar.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../manage_MKT.html', import.meta.url), 'utf8');
  const worker = fs.readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const content = fs.readFileSync(new URL('../js/pages/content.js', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../js/pages/settings.js', import.meta.url), 'utf8');

  assert.match(sidebar, /id:\s*'logs'.*icon:\s*'fileText'/);
  assert.match(html, /js\/pages\/logs\.js/);
  for (const source of [worker, server]) {
    assert.match(source, /\/api\/app-logs/);
    assert.match(source, /\/api\/posts\/:?[^'\s]*publish-attempts|publish-attempts/);
    assert.doesNotMatch(source, /syncLinkedScheduleSheets|sheet-schedules|google-sheets\/csv/);
  }
  assert.doesNotMatch(content, /sheetScheduleChoice|openScheduleSheetImportModal|Nhập từ Google Sheets/);
  assert.doesNotMatch(settings, /fpCrossPostInstagram|Đăng đồng thời sang Instagram/);
});

test('retired Sheet scheduling leaves no runtime, repository, or queue UI hooks', () => {
  const workerRepository = fs.readFileSync(new URL('../worker/repository.js', import.meta.url), 'utf8');
  const serverRepository = fs.readFileSync(new URL('../server/repository.js', import.meta.url), 'utf8');
  const scheduledPage = fs.readFileSync(new URL('../js/pages/scheduled.js', import.meta.url), 'utf8');

  for (const source of [workerRepository, serverRepository]) {
    assert.doesNotMatch(source, /listSheetSyncPosts/);
  }
  assert.doesNotMatch(scheduledPage, /sheetSync|syncSheets|Đồng bộ Sheet/);
});

test('Worker records scheduled publisher failures in the application log', () => {
  const worker = fs.readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

  assert.match(worker, /event:\s*'scheduled_publish_failed'/);
  assert.match(worker, /component:\s*'cron'/);
});
