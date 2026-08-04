/* ═══════════════════════════════════════════
   MARKETING HUB - Media gallery helpers
   Pure preview and ordering logic shared by UI and tests.
   ═══════════════════════════════════════════ */

(function exposeMediaGallery(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MediaGallery = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const extractDriveId = (rawUrl = '') => {
    try {
      const url = new URL(rawUrl);
      const isDriveHost = /(^|\.)drive\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/i.test(url.hostname);
      if (!isDriveHost) return '';
      return url.pathname.match(/\/file\/d\/([^/]+)/)?.[1]
        || url.searchParams.get('id')
        || '';
    } catch {
      return '';
    }
  };

  const previewUrl = (rawUrl = '') => {
    const driveId = extractDriveId(rawUrl);
    return driveId
      ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1000`
      : rawUrl;
  };

  const displayName = (rawUrl = '') => {
    if (extractDriveId(rawUrl)) return 'Ảnh Google Drive';
    try {
      const url = new URL(rawUrl);
      const lastSegment = url.pathname.split('/').filter(Boolean).pop();
      return lastSegment ? decodeURIComponent(lastSegment) : url.hostname;
    } catch {
      return 'Ảnh URL';
    }
  };

  const reorder = (items = [], fromIndex, toIndex) => {
    const result = [...items];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return result;
    if (fromIndex < 0 || fromIndex >= result.length || toIndex < 0 || toIndex >= result.length || fromIndex === toIndex) {
      return result;
    }
    const [moved] = result.splice(fromIndex, 1);
    result.splice(toIndex, 0, moved);
    return result;
  };

  return { previewUrl, displayName, reorder };
}));
