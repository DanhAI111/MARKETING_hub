import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const STORE_KEY = 'marketing_hub_data';

function createStore(initialData = null) {
  const storage = new Map();
  if (initialData) storage.set(STORE_KEY, JSON.stringify(initialData));

  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  const window = { RemoteStore: { available: false } };
  const context = vm.createContext({
    localStorage,
    window,
    RemoteStore: window.RemoteStore,
    console,
    Date,
    Math,
    Blob,
    URL,
    setTimeout,
    clearTimeout
  });
  const source = fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  vm.runInContext(`${source}\nglobalThis.__store = Store;`, context);
  return {
    Store: context.__store,
    read: () => JSON.parse(storage.get(STORE_KEY))
  };
}

function emptyData(overrides = {}) {
  return {
    version: 1,
    fanpages: [],
    posts: [],
    tasks: [],
    events: [],
    expenses: [],
    adReports: [],
    employees: [],
    monthlyTargets: [],
    recurringExpenses: [],
    campaigns: [],
    customCategories: null,
    settings: { currentPage: 'dashboard', currency: 'VND' },
    ...overrides
  };
}

const collections = [
  'fanpages',
  'posts',
  'tasks',
  'events',
  'expenses',
  'adReports',
  'employees',
  'monthlyTargets',
  'recurringExpenses',
  'campaigns'
];

test('seed adds a linked, marked UI sample dataset without replacing existing data', () => {
  const realTask = { id: 'real-task', title: 'Công việc thật', status: 'pending' };
  const { Store, read } = createStore(emptyData({ tasks: [realTask] }));

  const result = Store.uiSampleData.seed();
  const data = read();

  assert.equal(data.tasks.find(item => item.id === realTask.id)?.title, realTask.title);
  collections.forEach((collection) => {
    assert.ok(
      data[collection].some(item => item.uiSampleData === true),
      `${collection} should contain marked sample data`
    );
  });
  assert.ok(result.added > 0);

  const campaign = data.campaigns.find(item => item.uiSampleData === true);
  const fanpageIds = new Set(data.fanpages.filter(item => item.uiSampleData === true).map(item => item.id));
  assert.ok(data.posts.some(item => item.campaignId === campaign.id && fanpageIds.has(item.fanpageId)));
  assert.ok(data.adReports.some(item => item.campaignId === campaign.id && fanpageIds.has(item.fanpageId)));
  assert.ok(data.events.some(item => item.campaignId === campaign.id));
  assert.ok(data.expenses.some(item => item.campaignId === campaign.id));
});

test('seed is idempotent and does not overwrite a real monthly target', () => {
  const month = new Date().toISOString().slice(0, 7);
  const realTarget = { id: 'real-target', month, totalBudget: 123456 };
  const { Store, read } = createStore(emptyData({ monthlyTargets: [realTarget] }));

  Store.uiSampleData.seed();
  const first = read();
  Store.uiSampleData.seed();
  const second = read();

  collections.forEach((collection) => {
    assert.equal(second[collection].length, first[collection].length, `${collection} duplicated`);
  });
  assert.equal(second.monthlyTargets.find(item => item.id === realTarget.id)?.totalBudget, 123456);
  assert.equal(
    second.monthlyTargets.filter(item => item.month === month).length,
    1,
    'the real target must remain the only target for the current month'
  );
});

test('clear removes only sample data, including generated recurring expenses', () => {
  const realTask = { id: 'real-task', title: 'Công việc thật', status: 'pending' };
  const realExpense = { id: 'real-expense', description: 'Chi phí thật', date: '2026-07-01', amount: 1000 };
  const { Store, read } = createStore(emptyData({ tasks: [realTask], expenses: [realExpense] }));

  const seeded = Store.uiSampleData.seed();
  Store.recurringExpenses.generateForMonth(seeded.month);
  const generated = read().expenses.find(item => item.recurringId && item.uiSampleData === true);
  assert.ok(generated, 'expense generated from a sample recurring template should keep the sample marker');

  const result = Store.uiSampleData.clear();
  const data = read();

  collections.forEach((collection) => {
    assert.equal(
      data[collection].some(item => item.uiSampleData === true || String(item.id).startsWith('ui-sample-')),
      false,
      `${collection} still contains sample data`
    );
  });
  assert.equal(data.tasks.find(item => item.id === realTask.id)?.title, realTask.title);
  assert.equal(data.expenses.find(item => item.id === realExpense.id)?.description, realExpense.description);
  assert.ok(result.removed > 0);
});
