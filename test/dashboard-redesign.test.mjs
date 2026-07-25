import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboardSource = fs.readFileSync(
  new URL('../js/pages/dashboard.js', import.meta.url),
  'utf8'
);
const dashboardStyles = fs.readFileSync(
  new URL('../css/dashboard.css', import.meta.url),
  'utf8'
);
const dashboardChart = fs.readFileSync(
  new URL('../js/components/chart.js', import.meta.url),
  'utf8'
);

test('dashboard implements the selected adaptive spotlight structure', () => {
  [
    'Hiệu suất nội dung',
    'Hiệu suất theo nền tảng',
    'Chiến dịch nổi bật',
    'Hôm nay',
    'Lịch đăng hôm nay',
    'Chờ duyệt',
    'Sự kiện sắp tới',
    'Chi phí quảng cáo',
    'Tổng chi phí tháng',
    'Chiến dịch đang chạy'
  ].forEach((label) => {
    assert.match(dashboardSource, new RegExp(label));
  });

  assert.match(dashboardSource, /id="dashboardPerformanceChart"/);
  assert.match(dashboardSource, /\[7,\s*28,\s*90\]/);
  assert.match(dashboardSource, /data-dashboard-range=/);
  assert.match(dashboardSource, /data-post-id=/);
  assert.match(dashboardSource, /data-task-id=/);
});

test('dashboard motion is purposeful and respects reduced-motion preferences', () => {
  assert.match(dashboardStyles, /@keyframes dashboardReveal/);
  assert.match(dashboardStyles, /@keyframes dashboardChartDraw/);
  assert.match(dashboardStyles, /@keyframes dashboardLivePulse/);
  assert.match(dashboardStyles, /cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
  assert.match(dashboardStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(dashboardStyles, /animation-duration:\s*0\.01ms/);
});

test('dashboard keeps responsive layouts for tablet and mobile', () => {
  assert.match(dashboardStyles, /@media \(max-width:\s*1180px\)/);
  assert.match(dashboardStyles, /@media \(max-width:\s*760px\)/);
  assert.match(dashboardStyles, /\.dashboard-focus-grid/);
  assert.match(dashboardStyles, /\.dashboard-today-panel/);
});

test('dashboard uses the available desktop width and keeps dense labels readable', () => {
  assert.match(
    dashboardStyles,
    /\.dashboard-shell\s*\{[\s\S]*?max-width:\s*none/
  );
  assert.match(
    dashboardStyles,
    /\.dashboard-metric-copy\s*>\s*span\s*\{[\s\S]*?font-size:\s*0\.9rem/
  );
  assert.match(
    dashboardStyles,
    /\.dashboard-schedule-row strong,[\s\S]*?font-size:\s*0\.95rem/
  );
});

test('dashboard reserves a separate top lane for the legend and chart labels', () => {
  assert.match(dashboardSource, /padding:\s*\{\s*top:\s*56/);
  assert.match(dashboardChart, /top:\s*options\.padding\?\.top\s*\?\?\s*20/);
  assert.match(
    dashboardStyles,
    /\.dashboard-chart-legend\s*\{[\s\S]*?left:\s*60px[\s\S]*?flex-wrap:\s*wrap/
  );
});

test('dashboard stacks dense secondary panels before their text can collide', () => {
  assert.match(
    dashboardStyles,
    /@media \(max-width:\s*900px\)[\s\S]*?\.dashboard-today-panel\s*\{[\s\S]*?display:\s*block/
  );
  assert.match(
    dashboardStyles,
    /grid-template-areas:\s*"platform progress"\s*"reach engagement"/
  );
});
