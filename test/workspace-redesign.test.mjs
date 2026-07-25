import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const appSource = read('../js/app.js');
const contentSource = read('../js/pages/content.js');
const scheduledSource = read('../js/pages/scheduled.js');
const tasksSource = read('../js/pages/tasks.js');
const eventsSource = read('../js/pages/events.js');
const campaignsSource = read('../js/pages/campaigns.js');
const expensesSource = read('../js/pages/expenses.js');
const adsSource = read('../js/pages/ads.js');
const settingsSource = read('../js/pages/settings.js');
const styles = read('../css/pages.css');
const buildSource = read('../scripts/build-assets.js');

test('all non-dashboard pages receive a shared workspace identity', () => {
  assert.match(appSource, /document\.documentElement\.dataset\.page = pageId/);
  assert.match(appSource, /workspace-page workspace-\$\{pageId\}/);
  [
    'content',
    'scheduled',
    'tasks',
    'events',
    'campaigns',
    'expenses',
    'ads',
    'settings'
  ].forEach((page) => {
    assert.match(styles, new RegExp(`workspace-${page}|${page}-workspace|${page}-studio|settings-shell`));
  });
});

test('approved command-center layouts are implemented with live data', () => {
  assert.match(contentSource, /content-command-grid/);
  assert.match(contentSource, /content-publishing-queue/);
  assert.match(contentSource, /Store\.tasks\.getAll/);
  assert.match(scheduledSource, /scheduled-workspace-grid/);
  assert.match(scheduledSource, /queue-health-gauge/);
  assert.match(tasksSource, /task-workspace-grid/);
  assert.match(tasksSource, /task-context-rail/);
  assert.match(eventsSource, /events-workspace-grid/);
  assert.match(eventsSource, /event-context-rail/);
});

test('campaign, ads and settings use the approved editorial and split-pane models', () => {
  assert.match(campaignsSource, /campaign-studio/);
  assert.match(campaignsSource, /campaign-storyboard/);
  assert.match(campaignsSource, /campaign-health-rail/);
  assert.match(adsSource, /ads-empty-workspace/);
  assert.match(adsSource, /Sẵn sàng phân tích/);
  assert.match(settingsSource, /settings-shell/);
  assert.match(settingsSource, /settings-tab-index/);
});

test('workspace motion is purposeful, responsive and reduced-motion safe', () => {
  assert.match(styles, /@keyframes workspaceReveal/);
  assert.match(styles, /@keyframes workspaceItemReveal/);
  assert.match(styles, /@keyframes statusPulse/);
  assert.match(styles, /cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
  assert.match(styles, /@media \(max-width:\s*1280px\)/);
  assert.match(styles, /@media \(max-width:\s*820px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /animation:\s*none\s*!important/);
});

test('campaign brief keeps its lead icon inside a padded responsive safe area', () => {
  assert.match(
    styles,
    /\.campaign-brief-panel,[\s\S]*?padding:\s*18px/
  );
  assert.match(
    styles,
    /\.campaign-featured-title\s*\{[\s\S]*?padding:\s*14px 10px/
  );
  assert.match(
    styles,
    /\.campaign-featured-title > span:nth-child\(2\)\s*\{[\s\S]*?min-width:\s*0/
  );
  assert.match(styles, /overflow-wrap:\s*anywhere/);
});

test('responsive workspaces keep timeline, settings and chart text separated', () => {
  assert.match(styles, /grid-template-rows:\s*24px 46px 22px minmax\(36px,\s*auto\) 18px 24px/);
  assert.match(styles, /grid-template-columns:\s*repeat\(5,\s*minmax\(176px,\s*1fr\)\)/);
  assert.match(styles, /\.workspace-expenses \.donut-chart-wrapper\s*\{[\s\S]*?flex-direction:\s*column/);
});

test('static preview includes the dashboard image assets', () => {
  assert.match(
    buildSource,
    /fs\.cpSync\(path\.join\(root,\s*'assets'\),\s*path\.join\(output,\s*'assets'\)/
  );
});

test('empty-state icons keep a padded safe area inside their border', () => {
  assert.match(
    styles,
    /\.queue-empty > span\s*\{[\s\S]*?width:\s*48px[\s\S]*?padding:\s*10px/
  );
  assert.match(
    styles,
    /\.queue-empty > span svg\s*\{[\s\S]*?width:\s*20px[\s\S]*?height:\s*20px/
  );
});

test('recurring expense title constrains its icon to the shared inline icon size', () => {
  assert.match(expensesSource, /class="ui-label-with-icon recurring-list-title"/);
  assert.match(
    expensesSource,
    /<span class="ui-inline-icon">\$\{Utils\.icons\.repeat\}<\/span>/
  );
});
