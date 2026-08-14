/* ═══════════════════════════════════════════
   MARKETING HUB - Multi-page schedule helpers
   Pure batch logic shared by the browser UI and Node tests.
   ═══════════════════════════════════════════ */

(function exposeScheduleBatch(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ScheduleBatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const cloneMediaItems = (mediaItems = []) => mediaItems.map(item => ({ ...item }));

  const validateSelection = ({
    fanpages = [],
    mediaItems = [],
    publishMode = 'live',
    remoteAvailable = false
  } = {}) => {
    if (!fanpages.length) return ['Vui lòng chọn ít nhất một fanpage hoặc tài khoản'];

    const errors = [];
    const facebookPages = fanpages.filter(page => page.platform === 'facebook');
    const facebookNames = facebookPages.map(page => page.name).join(', ');
    const instagramPages = fanpages.filter(page => page.platform === 'instagram');
    const instagramNames = instagramPages.map(page => page.name).join(', ');

    if (facebookPages.length && mediaItems.length === 0) {
      errors.push(`${facebookNames}: Facebook yêu cầu ít nhất một ảnh hoặc video`);
    }
    if (instagramPages.length && mediaItems.length === 0) {
      errors.push(`${instagramNames}: Instagram yêu cầu ít nhất một ảnh hoặc video có URL công khai`);
    } else if (instagramPages.length && mediaItems.some(item => !/^https?:\/\//i.test(item.url || ''))) {
      errors.push(`${instagramNames}: Instagram chỉ nhận media có URL công khai`);
    }

    if (publishMode === 'safe_test' && !remoteAvailable) {
      errors.push('Đăng thử cần backend đang hoạt động để kiểm tra với Meta');
    }
    if (publishMode === 'safe_test') {
      const unsupported = fanpages.filter(page => !['facebook', 'instagram'].includes(page.platform));
      if (unsupported.length) {
        errors.push(`Đăng thử an toàn chưa hỗ trợ: ${unsupported.map(page => page.name).join(', ')}`);
      }
    }

    return errors;
  };

  const buildEntries = ({
    fanpages = [],
    content = '',
    scheduledAt = '',
    date = '',
    mediaItems = [],
    publishMode = 'live',
    approvalStatus = 'pending',
    campaignId = ''
  } = {}) => fanpages.map(fanpage => ({
    fanpage,
    payload: {
      fanpageId: fanpage.id,
      title: content.slice(0, 80),
      content,
      date,
      scheduledAt,
      mediaUrl: /^data:/i.test(mediaItems[0]?.url || '') ? '' : (mediaItems[0]?.url || ''),
      mediaItems: cloneMediaItems(mediaItems),
      status: 'scheduled',
      source: 'scheduled',
      campaignId,
      approvalStatus: publishMode === 'safe_test' ? 'approved' : approvalStatus,
      publishMode
    }
  }));

  // Deliberately sequential: social providers rate-limit bursts, and a failure
  // on one page must not prevent the remaining independent schedules.
  const execute = async (entries = [], handler) => {
    const succeeded = [];
    const failed = [];
    for (const entry of entries) {
      try {
        const value = await handler(entry);
        succeeded.push({ entry, value });
      } catch (error) {
        failed.push({ entry, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    return { succeeded, failed };
  };

  return { validateSelection, buildEntries, execute };
}));
