import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboardSource = fs.readFileSync(new URL('../js/pages/dashboard.js', import.meta.url), 'utf8');

test('dashboard scheduled thumbnails use the first image media item and a display-safe preview URL', () => {
  assert.match(dashboardSource, /post\?\.mediaItems/);
  assert.match(dashboardSource, /item\.type !== 'video'/);
  assert.match(dashboardSource, /MediaGallery\.previewUrl/);
});

test('dashboard scheduled and approval thumbnails fall back to a local image when remote preview fails', () => {
  assert.match(dashboardSource, /data-dashboard-image-fallback/);
  assert.match(dashboardSource, /bindDashboardImageFallbacks\(container\)/);
  assert.match(dashboardSource, /addEventListener\('error'/);
  assert.match(dashboardSource, /dashboard-schedule-thumb/);
  assert.match(dashboardSource, /dashboard-approval-thumb/);
});
