// Runtime-agnostic Meta/Graph helpers shared by server/meta.js (Node) and
// worker/meta.js (Cloudflare). Every function here depends only on the global
// `fetch` and pure JS — no DB, email, or runtime-crypto coupling. Runtime-
// specific pieces (dataUrlToBlob, graphGet/graphPost wrappers) stay per-side.

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish'
];

// Drive fetches run inside the Cloudflare cron. A hung request has no built-in
// deadline, so one stuck Drive URL would consume the whole run's wall-clock and
// strand every claimed post in 'publishing'. Bound each fetch so a slow Drive
// fails a single post instead of the batch.
const DRIVE_FETCH_TIMEOUT_MS = 8000;

const fetchWithTimeout = async (url, options = {}, timeoutMs = DRIVE_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Hết thời gian tải media từ Google Drive (>${Math.round(timeoutMs / 1000)}s). Hãy thử lại hoặc kiểm tra quyền chia sẻ.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const formatMetaError = (body, fallback) => {
  const metaError = body?.error;
  if (!metaError) return fallback;
  const detail = metaError.error_user_msg || metaError.error_user_title || '';
  const message = [metaError.message, detail && detail !== metaError.message ? detail : ''].filter(Boolean).join(': ');
  const code = [metaError.code, metaError.error_subcode].filter(value => value !== undefined).join('/');
  return `${message || fallback}${code ? ` (Meta ${code})` : ''}`;
};

const getGoogleDriveFileId = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)drive\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/i.test(url.hostname)) return '';
    return url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id') || '';
  } catch {
    return '';
  }
};

const getGoogleDriveFolderId = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)drive\.google\.com$/i.test(url.hostname)) return '';
    return url.pathname.match(/\/drive\/folders\/([^/]+)/)?.[1] || '';
  } catch {
    return '';
  }
};

const normalizeMediaUrl = (rawUrl) => {
  const fileId = getGoogleDriveFileId(rawUrl);
  return fileId
    ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`
    : rawUrl;
};

const googleDriveThumbnailUrl = (fileId) =>
  `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`;

const decodeHtml = (value = '') => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');

const listGoogleDriveFolderMedia = async (folderId) => {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#grid`;
  const response = await fetchWithTimeout(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Không thể đọc folder Google Drive (HTTP ${response.status}). Hãy bật quyền "Anyone with the link".`);
  }
  const html = await response.text();
  const entries = [];
  const pattern = /<div class="flip-entry"[^>]*id="entry-([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g;
  for (const match of html.matchAll(pattern)) {
    const name = decodeHtml(match[2]).trim();
    if (!/\.(png|jpe?g|gif|webp|tiff?|heic|heif)$/i.test(name)) continue;
    entries.push({
      type: 'image',
      url: googleDriveThumbnailUrl(match[1]),
      name
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!entries.length) {
    throw new Error('Folder Google Drive không có ảnh hợp lệ hoặc chưa được chia sẻ công khai.');
  }
  return entries.slice(0, 10);
};

const filenameFromDisposition = (value = '') => {
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]); } catch { return utf8Match[1]; }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] || value.match(/filename=([^;]+)/i)?.[1]?.trim() || '';
};

const isVideoName = (value = '') => /\.(mp4|mov|m4v|avi|webm|mkv)(?:$|[?#])/i.test(value);

const getPostMessage = (post) => (post.content || post.title || '').trim();

const getMediaItems = (post) => {
  if (Array.isArray(post.mediaItems) && post.mediaItems.length) {
    return post.mediaItems.filter((item) => item?.url);
  }
  return post.mediaUrl ? [{ type: 'image', url: post.mediaUrl }] : [];
};

const resolveMediaItem = async (media) => {
  const originalUrl = media?.url || '';
  const driveFolderId = getGoogleDriveFolderId(originalUrl);
  if (driveFolderId) return listGoogleDriveFolderMedia(driveFolderId);
  const driveFileId = getGoogleDriveFileId(originalUrl);
  const resolved = { ...media, url: normalizeMediaUrl(originalUrl) };
  if (!driveFileId) {
    if (media?.type === 'video' || isVideoName(originalUrl) || isVideoName(media?.name)) resolved.type = 'video';
    return [resolved];
  }

  const response = await fetchWithTimeout(resolved.url, { method: 'HEAD', redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Không thể tải media từ Google Drive (HTTP ${response.status}). Hãy bật quyền "Anyone with the link".`);
  }
  const filename = filenameFromDisposition(response.headers.get('content-disposition') || '');
  const contentType = response.headers.get('content-type') || '';
  resolved.name = filename || resolved.name;
  resolved.type = contentType.startsWith('video/') || isVideoName(filename) ? 'video' : 'image';
  if (resolved.type === 'image') resolved.url = googleDriveThumbnailUrl(driveFileId);
  return [resolved];
};

const resolveMediaItems = async (post) => {
  const groups = await Promise.all(getMediaItems(post).map(resolveMediaItem));
  return groups.flat().slice(0, 10);
};

const getOldestSyncDate = (dates = []) => dates
  .filter(Boolean)
  .map((value) => String(value).slice(0, 10))
  .sort()[0] || '';

// Organic engagement from a Facebook post edge (reactions/comments/shares summaries).
const extractFacebookEngagement = (post = {}) => ({
  likes: post.reactions?.summary?.total_count ?? post.likes?.summary?.total_count ?? 0,
  comments: post.comments?.summary?.total_count ?? 0,
  shares: post.shares?.count ?? 0,
  reach: 0,
  updatedAt: new Date().toISOString()
});

// Instagram media insights come back as a metrics array; fold to like/comment counts.
const extractInstagramEngagement = (item = {}) => ({
  likes: item.like_count ?? 0,
  comments: item.comments_count ?? 0,
  shares: 0,
  reach: 0,
  updatedAt: new Date().toISOString()
});

module.exports = {
  GRAPH_VERSION,
  GRAPH_BASE,
  DEFAULT_SCOPES,
  formatMetaError,
  fetchWithTimeout,
  DRIVE_FETCH_TIMEOUT_MS,
  getGoogleDriveFileId,
  getGoogleDriveFolderId,
  normalizeMediaUrl,
  googleDriveThumbnailUrl,
  decodeHtml,
  listGoogleDriveFolderMedia,
  filenameFromDisposition,
  isVideoName,
  getPostMessage,
  getMediaItems,
  resolveMediaItem,
  resolveMediaItems,
  getOldestSyncDate,
  extractFacebookEngagement,
  extractInstagramEngagement
};
