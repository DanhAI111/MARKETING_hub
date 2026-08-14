import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const workerSource = fs.readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

test('scheduled worker isolates publishing from maintenance workloads', () => {
  assert.match(workerSource, /const publisher = await processScheduledPosts\(repo, meta\)/);
  assert.match(workerSource, /if \(publisher\.processed === 0\)/);
  assert.match(workerSource, /maintenanceSlot/);
  assert.match(workerSource, /maintenanceSlot === 0/);
  assert.match(workerSource, /maintenanceSlot === 2/);
  assert.match(workerSource, /maintenanceSlot === 4/);
  assert.doesNotMatch(workerSource, /const tasks = \[\s*syncLinkedScheduleSheets/);
  assert.doesNotMatch(workerSource, /const tasks = \[\s*processScheduledPosts\(repo, meta\)/);
});

test('both API runtimes validate platform media before persisting post mutations', () => {
  for (const source of [workerSource, serverSource]) {
    assert.match(source, /assertPostMediaForPlatform/);
    assert.match(source, /getFanpage\(mutation\.fanpageId\)/);
  }
});

test('worker exposes a post-specific retry endpoint and never auto-publishes from generic post updates', () => {
  assert.match(workerSource, /pathname\.match\(\/\^\\\/api\\\/posts\\\/\(\[\^\/\]\+\)\\\/retry\$\//);
  assert.doesNotMatch(workerSource, /method === 'PUT'[\s\S]{0,900}context\.waitUntil\(processScheduledPosts/);
});

test('Node server exposes the same post-specific retry contract without generic auto-publish side effects', () => {
  assert.match(serverSource, /app\.post\('\/api\/posts\/:id\/retry'/);
  assert.doesNotMatch(serverSource, /publishSoon/);
});

test('health reports build identity and durable publisher heartbeat/failure state', () => {
  for (const source of [workerSource, serverSource]) {
    assert.match(source, /buildSha/);
    assert.match(source, /lastPublishHeartbeat/);
    assert.match(source, /lastPublishFailure/);
  }
});

test('repository includes a CI workflow that runs tests and deployment validation', () => {
  const workflowUrl = new URL('../.github/workflows/ci.yml', import.meta.url);
  assert.equal(fs.existsSync(workflowUrl), true);
  const workflow = fs.readFileSync(workflowUrl, 'utf8');
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run deploy:check/);
});

test('the production deploy command always routes through the build-SHA wrapper', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts.deploy, 'npm run build:assets && node scripts/deploy-worker.cjs');
});

test('worker and server publishing queues use the shared bounded-concurrency helper', () => {
  assert.match(workerSource, /processWithConcurrency\(duePosts/);
  assert.match(serverSource, /processWithConcurrency\(duePosts/);
});

test('processWithConcurrency runs three posts at once and preserves result order', async () => {
  const { processWithConcurrency } = require('../shared/publish-queue.cjs');
  let active = 0;
  let maxActive = 0;
  const completed = [];
  const delays = [35, 5, 20, 1, 10];

  const results = await processWithConcurrency(delays, async (delay, index) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, delay));
    completed.push(index);
    active--;
    return `post-${index}`;
  }, 3);

  assert.equal(maxActive, 3);
  assert.notDeepEqual(completed, [0, 1, 2, 3, 4]);
  assert.deepEqual(results, ['post-0', 'post-1', 'post-2', 'post-3', 'post-4']);
});

test('processWithConcurrency handles empty and iterable queues with a safe minimum limit', async () => {
  const { processWithConcurrency } = require('../shared/publish-queue.cjs');
  let calls = 0;
  assert.deepEqual(await processWithConcurrency([], async () => calls++), []);
  assert.equal(calls, 0);

  let active = 0;
  let maxActive = 0;
  const results = await processWithConcurrency(new Set([1, 2, 3]), async value => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  }, 'invalid');

  assert.equal(maxActive, 1);
  assert.deepEqual(results, [2, 4, 6]);
});
