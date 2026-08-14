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
const PUBLISH_MODES = new Set(['live', 'safe_test']);

const now = () => new Date().toISOString();

const POST_RETENTION_MONTHS = 2;

// Subtract calendar months without JavaScript's end-of-month rollover (for
// example, March 31 -> March 3 when February has fewer days). The returned ISO
// timestamp is shared by Node, D1 queries, and Meta ingestion.
const getPostRetentionCutoff = (reference) => {
  // Default retention is day-based so all requests made during one day share
  // the same boundary. Supplying a reference preserves its exact time for
  // deterministic jobs/tests.
  const defaultReference = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const input = reference ?? defaultReference;
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid post retention reference date');
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() - POST_RETENTION_MONTHS;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const cutoff = new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(date.getUTCDate(), lastTargetDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));
  return cutoff.toISOString();
};

const isWithinPostRetention = (publishedAt, cutoff = getPostRetentionCutoff()) => {
  const timestamp = new Date(publishedAt).getTime();
  const cutoffTimestamp = new Date(cutoff).getTime();
  return Number.isFinite(timestamp)
    && Number.isFinite(cutoffTimestamp)
    && timestamp >= cutoffTimestamp;
};

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const normalizePostMutation = (input = {}, existing = null) => {
  const publishMode = existing?.publishMode === 'safe_test' || input.publishMode === 'safe_test'
    ? 'safe_test'
    : 'live';
  if (publishMode !== 'safe_test') return { ...input, publishMode };
  const requestedStatus = ['scheduled', 'failed'].includes(input.status) ? input.status : '';
  return {
    ...input,
    publishMode: 'safe_test',
    approvalStatus: 'approved',
    status: requestedStatus || existing?.status || 'scheduled'
  };
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
    crossPostInstagram: false,
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
  publishMode: PUBLISH_MODES.has(row.publishMode) ? row.publishMode : 'live',
  testedAt: row.testedAt || '',
  testResult: parseJson(row.testResult, null),
  igContainerId: row.igContainerId || '',
  source: row.source,
  status: row.status,
  publishStage: row.publishStage || '',
  publishAttemptCount: Number(row.publishAttemptCount || 0),
  publishNextAttemptAt: row.publishNextAttemptAt || '',
  publishLastErrorCode: row.publishLastErrorCode || '',
  publishLastError: row.publishLastError || '',
  deletedAt: row.deletedAt || '',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const publishJobFromRow = (row) => row && ({
  postId: row.postId,
  platform: row.platform || '',
  stage: row.stage || 'queued',
  resolvedMedia: parseJson(row.resolvedMedia, []),
  childContainerIds: parseJson(row.childContainerIds, []),
  parentContainerId: row.parentContainerId || '',
  leaseToken: row.leaseToken || '',
  leaseUntil: row.leaseUntil || '',
  attemptCount: Number(row.attemptCount || 0),
  nextAttemptAt: row.nextAttemptAt || '',
  lastErrorCode: row.lastErrorCode || '',
  lastError: row.lastError || '',
  lastErrorAt: row.lastErrorAt || '',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const publishAttemptFromRow = (row) => row && ({
  id: row.id,
  postId: row.postId,
  stage: row.stage,
  outcome: row.outcome,
  errorCode: row.errorCode || '',
  errorMessage: row.errorMessage || '',
  createdAt: row.createdAt
});

const appItemFromRow = (row) => row && parseJson(row.data, null);

module.exports = {
  APP_COLLECTIONS,
  APP_SINGLETONS,
  APPROVAL_STATUSES,
  PUBLISH_MODES,
  POST_RETENTION_MONTHS,
  now,
  getPostRetentionCutoff,
  isWithinPostRetention,
  parseJson,
  normalizePostMutation,
  fanpageFromRow,
  postFromRow,
  publishJobFromRow,
  publishAttemptFromRow,
  appItemFromRow
};
