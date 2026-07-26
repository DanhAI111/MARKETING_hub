// Runtime-agnostic repository helpers shared by server/repository.js (Node,
// require) and worker/repository.js (Cloudflare, import). Pure functions and
// constants only — no DB handle, crypto, or env coupling. Row shapes are
// identical across the SQLite/D1/Postgres drivers, so mapping lives here.

const APP_COLLECTIONS = [
  'tasks',
  'events',
  'expenses',
  'adReports',
  'employees',
  'monthlyTargets',
  'recurringExpenses',
  'campaigns'
];
const APP_SINGLETONS = ['customCategories'];
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

const now = () => new Date().toISOString();

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const fanpageFromRow = (row, { includeToken = false } = {}) => {
  if (!row) return null;
  const fanpage = {
    id: row.id,
    platform: row.platform,
    name: row.name,
    link: row.link || '',
    imageUrl: row.imageUrl || '',
    metaPageId: row.metaPageId || '',
    instagramBusinessId: row.instagramBusinessId || '',
    connected: !!row.connected,
    crossPostInstagram: !!row.crossPostInstagram,
    lastSyncedAt: row.lastSyncedAt || '',
    syncStatus: row.syncStatus || '',
    syncError: row.syncError || '',
    kpis: parseJson(row.kpis, {}),
    deletedAt: row.deletedAt || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
  if (includeToken) fanpage.pageAccessTokenEncrypted = row.pageAccessTokenEncrypted || '';
  return fanpage;
};

const postFromRow = (row) => row && ({
  id: row.id,
  fanpageId: row.fanpageId,
  externalPostId: row.externalPostId || '',
  title: row.title,
  content: row.content || '',
  date: row.date,
  scheduledAt: row.scheduledAt || '',
  publishedAt: row.publishedAt || '',
  permalink: row.permalink || '',
  mediaUrl: row.mediaUrl || '',
  mediaItems: parseJson(row.mediaItems, []),
  publishError: row.publishError || '',
  sheetUrl: row.sheetUrl || '',
  sheetRowKey: row.sheetRowKey || '',
  sheetDefaultFanpageId: row.sheetDefaultFanpageId || '',
  campaignId: row.campaignId || '',
  engagement: parseJson(row.engagement, null),
  approvalStatus: row.approvalStatus || 'approved',
  source: row.source,
  status: row.status,
  deletedAt: row.deletedAt || '',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const appItemFromRow = (row) => row && parseJson(row.data, null);

module.exports = {
  APP_COLLECTIONS,
  APP_SINGLETONS,
  APPROVAL_STATUSES,
  now,
  parseJson,
  fanpageFromRow,
  postFromRow,
  appItemFromRow
};
