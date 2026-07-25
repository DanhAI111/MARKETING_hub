import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const uiFiles = [
  '../manage_MKT.html',
  '../js/app.js',
  '../js/utils.js',
  '../js/components/modal.js',
  '../js/components/sidebar.js',
  '../js/components/toast.js',
  '../js/pages/dashboard.js',
  '../js/pages/content.js',
  '../js/pages/scheduled.js',
  '../js/pages/tasks.js',
  '../js/pages/events.js',
  '../js/pages/campaigns.js',
  '../js/pages/expenses.js',
  '../js/pages/ads.js',
  '../js/pages/settings.js',
  '../css/base.css',
  '../css/components.css',
  '../css/dashboard.css',
  '../css/layout.css',
  '../css/pages.css',
  '../css/variables.css',
];

const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

test('application-authored UI contains no emoji glyphs', () => {
  const findings = [];

  uiFiles.forEach((relativePath) => {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      const matches = line.match(emojiPattern);
      if (matches) findings.push(`${relativePath}:${index + 1}: ${matches.join(' ')}`);
    });
  });

  assert.deepEqual(findings, []);
});
