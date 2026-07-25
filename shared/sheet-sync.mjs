import { parseScheduleSheet } from './schedule-sheet.mjs';

const sourceConfigsFromPosts = (posts) => {
  const configs = new Map();
  posts.forEach((post) => {
    if (!post.sheetUrl || configs.has(post.sheetUrl)) return;
    configs.set(post.sheetUrl, {
      sourceUrl: post.sheetUrl,
      defaultFanpageId: post.sheetDefaultFanpageId || ''
    });
  });
  return [...configs.values()];
};

export const syncScheduleSheets = async ({
  repo,
  fetchCsv,
  sourceUrl = '',
  defaultFanpageId = '',
  timezoneOffset = '+07:00'
}) => {
  const posts = await repo.listPosts();
  const configs = sourceUrl
    ? [{ sourceUrl, defaultFanpageId }]
    : sourceConfigsFromPosts(posts);
  const result = { sources: configs.length, created: 0, updated: 0, skipped: 0, invalid: 0, details: [] };
  const linkedPosts = new Map(posts
    .filter((post) => post.sheetUrl && post.sheetRowKey)
    .map((post) => [`${post.sheetUrl}\n${post.sheetRowKey}`, post]));
  const adoptedPostIds = new Set();
  const fanpages = await repo.listFanpages();

  for (const config of configs) {
    try {
      const text = await fetchCsv(config.sourceUrl);
      const items = parseScheduleSheet(text, {
        fanpages,
        defaultFanpageId: config.defaultFanpageId,
        timezoneOffset
      });
      const detail = { sourceUrl: config.sourceUrl, rows: items.length, created: 0, updated: 0, skipped: 0, invalid: 0 };

      for (const item of items) {
        if (!item.valid) {
          detail.invalid++;
          result.invalid++;
          continue;
        }
        const key = `${config.sourceUrl}\n${item.sheetRowKey}`;
        const linked = linkedPosts.get(key);
        const matchingLegacy = !linked && posts.find((post) =>
          !post.sheetUrl
          && !adoptedPostIds.has(post.id)
          && post.fanpageId === item.fanpageId
          && post.scheduledAt === item.scheduledAt
          && String(post.content || '').trim() === item.content
        );
        const adoptable = matchingLegacy && !['published', 'publishing'].includes(matchingLegacy.status)
          ? matchingLegacy
          : null;
        if (matchingLegacy && ['published', 'publishing'].includes(matchingLegacy.status)) {
          const saved = await repo.upsertPost({
            ...matchingLegacy,
            id: matchingLegacy.id,
            sheetUrl: config.sourceUrl,
            sheetRowKey: item.sheetRowKey,
            sheetDefaultFanpageId: config.defaultFanpageId || ''
          });
          adoptedPostIds.add(matchingLegacy.id);
          linkedPosts.set(key, saved);
          detail.skipped++;
          result.skipped++;
          continue;
        }
        const existing = linked || adoptable;
        if (existing && ['published', 'publishing'].includes(existing.status)) {
          detail.skipped++;
          result.skipped++;
          continue;
        }
        const saved = await repo.upsertPost({
          ...(existing ? { id: existing.id } : {}),
          fanpageId: item.fanpageId,
          title: item.title,
          content: item.content,
          date: item.date,
          scheduledAt: item.scheduledAt,
          publishedAt: '',
          permalink: '',
          mediaUrl: item.mediaItems[0]?.url || '',
          mediaItems: item.mediaItems,
          publishError: '',
          sheetUrl: config.sourceUrl,
          sheetRowKey: item.sheetRowKey,
          sheetDefaultFanpageId: config.defaultFanpageId || '',
          source: 'scheduled-sheet',
          status: 'scheduled'
        });
        if (adoptable) adoptedPostIds.add(adoptable.id);
        linkedPosts.set(key, saved);
        if (existing) {
          detail.updated++;
          result.updated++;
        } else {
          detail.created++;
          result.created++;
        }
      }
      if (sourceUrl && detail.created + detail.updated + detail.skipped === 0) {
        const error = new Error(detail.invalid
          ? `Không có dòng hợp lệ để liên kết (${detail.invalid} dòng lỗi).`
          : 'Google Sheets không có dòng lịch đăng.');
        error.status = 400;
        throw error;
      }
      result.details.push(detail);
    } catch (error) {
      if (sourceUrl) throw error;
      result.details.push({ sourceUrl: config.sourceUrl, error: error.message || 'Không thể đồng bộ Sheet' });
    }
  }
  return result;
};
