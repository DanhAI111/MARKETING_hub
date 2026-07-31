import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import { APP_COLLECTIONS as WORKER_COLLECTIONS } from '../worker/repository.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('server and worker repositories whitelist marketingPlans', () => {
  const require = createRequire(import.meta.url);
  const { APP_COLLECTIONS: serverCollections } = require('../server/repository.js');

  assert.ok(serverCollections.includes('marketingPlans'));
  assert.ok(WORKER_COLLECTIONS.includes('marketingPlans'));
});

test('local store exposes CRUD for marketing plans', () => {
  const source = read('../js/store.js');
  const values = new Map();
  const context = vm.createContext({
    console,
    Date,
    Math,
    Blob,
    URL,
    FileReader: class {},
    window: { RemoteStore: { available: false } },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  vm.runInContext(`${source}\n;globalThis.__Store = Store;`, context);
  const store = context.__Store;

  const plan = store.marketingPlans.create({ name: 'Kế hoạch test', inputs: {}, result: {} });
  assert.equal(store.marketingPlans.getById(plan.id).name, 'Kế hoạch test');
  store.marketingPlans.update(plan.id, { name: 'Kế hoạch mới' });
  assert.equal(store.marketingPlans.getById(plan.id).name, 'Kế hoạch mới');
  store.marketingPlans.remove(plan.id);
  assert.equal(store.marketingPlans.getAll().length, 0);
});

test('both API runtimes and the static UI expose the planner feature', () => {
  const server = read('../server/index.js');
  const worker = read('../worker/index.js');
  const api = read('../js/api.js');
  const app = read('../js/app.js');
  const sidebar = read('../js/components/sidebar.js');
  const html = read('../manage_MKT.html');

  for (const source of [server, worker]) {
    assert.match(source, /\/api\/marketing-plans\/compute/);
    assert.match(source, /\/api\/marketing-plans\/ai-suggest/);
    assert.match(source, /ai-suggest[\s\S]*limit:\s*20/);
  }
  assert.match(api, /computeMarketingPlan/);
  assert.match(api, /suggestMarketingAllocation/);
  assert.match(app, /planner:\s*\{\s*title:\s*'Kế hoạch doanh thu'/);
  assert.match(sidebar, /\{\s*id:\s*'planner'/);
  assert.match(html, /css\/planner\.css/);
  assert.match(html, /js\/pages\/planner\.js/);
});

test('Anthropic key examples stay empty and Worker config contains only the model', () => {
  assert.match(read('../.env.example'), /^ANTHROPIC_API_KEY=$/m);
  assert.match(read('../.dev.vars.example'), /^ANTHROPIC_API_KEY=$/m);
  assert.doesNotMatch(read('../wrangler.jsonc'), /ANTHROPIC_API_KEY/);
  assert.match(read('../wrangler.jsonc'), /"ANTHROPIC_MODEL":\s*"claude-opus-5"/);
});
