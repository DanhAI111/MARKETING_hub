const normalizeKey = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const ALIASES = {
  id: ['id', 'post id', 'postid', 'stt', 'so thu tu', 'số thứ tự', 'ma', 'mã', 'ma bai', 'mã bài', 'key'],
  title: ['title', 'tieu de', 'tiêu đề', 'chu de', 'chủ đề', 'topic'],
  content: [
    'content', 'noi dung', 'nội dung', 'noi dung bai dang', 'nội dung bài đăng',
    'caption', 'post', 'bai dang', 'bài đăng', 'bai viet', 'bài viết', 'copy',
    'text', 'mo ta', 'mô tả'
  ],
  fanpage: [
    'fanpage', 'page', 'ten page', 'tên page', 'fan page', 'facebook page',
    'tai khoan', 'tài khoản', 'account', 'kenh', 'kênh', 'kenh dang',
    'kênh đăng', 'page dang', 'page đăng', 'nhan hang', 'nhãn hàng',
    'brand', 'thuong hieu', 'thương hiệu'
  ],
  scheduled: [
    'scheduledat', 'scheduled at', 'schedule', 'datetime', 'thoi gian',
    'thời gian', 'thoi gian dang', 'thời gian đăng', 'lich dang',
    'lịch đăng', 'ngay gio', 'ngày giờ', 'ngay gio dang', 'ngày giờ đăng'
  ],
  date: ['date', 'ngay', 'ngày', 'ngay dang', 'ngày đăng', 'ngay len bai', 'ngày lên bài'],
  time: ['time', 'gio', 'giờ', 'gio dang', 'giờ đăng', 'khung gio', 'khung giờ'],
  media: [
    'media', 'image', 'anh', 'ảnh', 'hinh', 'hình', 'url anh', 'url ảnh',
    'link anh', 'link ảnh', 'link hinh', 'link hình', 'photo', 'video',
    'asset', 'creative'
  ]
};

const getRowValue = (row, aliases) => {
  const normalizedAliases = aliases.map(normalizeKey);
  const entries = Object.entries(row).map(([key, value]) => [normalizeKey(key), value]);
  const exact = entries.find(([key]) => normalizedAliases.includes(key));
  if (exact) return String(exact[1] || '').trim();
  const idAliases = ALIASES.id.map(normalizeKey);
  const entry = entries.find(([key]) => {
    if (aliases !== ALIASES.id && idAliases.includes(key)) return false;
    const normalized = normalizeKey(key);
    return normalizedAliases.some((alias) => alias.length >= 4 && normalized.includes(alias));
  });
  return entry ? String(entry[1] || '').trim() : '';
};

// Header cells are short labels. A data row's content blob can be thousands of
// chars long and coincidentally contain alias substrings ("post", "page",
// "content"…), which would let a data row outscore the real header and shift
// every column. Only allow fuzzy substring matching on header-length cells.
const HEADER_CELL_MAXLEN = 40;
const scoreHeaders = (headers, aliases) => {
  const normalizedAliases = aliases.map(normalizeKey);
  return headers.some((header) => normalizedAliases.some((alias) =>
    header === alias || (alias.length >= 4 && header.length <= HEADER_CELL_MAXLEN && header.includes(alias))
  )) ? 1 : 0;
};

const parseRecords = (text, delimiter) => {
  const records = [];
  let record = [];
  let current = '';
  let inQuotes = false;
  const input = String(text || '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (inQuotes && input[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      record.push(current.trim());
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && input[index + 1] === '\n') index++;
      record.push(current.trim());
      if (record.some((value) => value)) records.push(record);
      record = [];
      current = '';
    } else {
      current += char;
    }
  }
  record.push(current.trim());
  if (record.some((value) => value)) records.push(record);
  return records;
};

const detectDelimiter = (line) => {
  const candidates = [',', '\t', ';'];
  return candidates.sort((a, b) => line.split(b).length - line.split(a).length)[0];
};

const parseRows = (text) => {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  const records = parseRecords(clean, detectDelimiter(clean.split(/\r?\n/)[0] || ','));
  if (records.length < 2) return [];
  let headerIndex = 0;
  let bestScore = -1;
  records.slice(0, 12).forEach((record, index) => {
    const headers = record.map(normalizeKey);
    const score = scoreHeaders(headers, ALIASES.content) * 3
      + scoreHeaders(headers, ALIASES.scheduled) * 3
      + scoreHeaders(headers, ALIASES.date) * 2
      + scoreHeaders(headers, ALIASES.time) * 2
      + scoreHeaders(headers, ALIASES.fanpage) * 2
      + scoreHeaders(headers, ALIASES.media)
      + scoreHeaders(headers, ALIASES.title);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  });
  const headers = records[headerIndex];
  return records.slice(headerIndex + 1).map((values, index) => {
    const row = { __sheetRowNumber: headerIndex + index + 2 };
    headers.forEach((header, columnIndex) => { row[header] = values[columnIndex] || ''; });
    return row;
  }).filter((row) => Object.entries(row).some(([key, value]) => key !== '__sheetRowNumber' && String(value).trim()));
};

const matchFanpage = (fanpages, value, defaultFanpageId) => {
  const fallback = defaultFanpageId ? fanpages.find((fanpage) => fanpage.id === defaultFanpageId) : null;
  if (!value.trim()) return fallback;
  const needle = normalizeKey(value);
  return fanpages.find((fanpage) => fanpage.id === value)
    || fanpages.find((fanpage) => normalizeKey(fanpage.name) === needle)
    || fanpages.find((fanpage) => normalizeKey(fanpage.name).includes(needle) || needle.includes(normalizeKey(fanpage.name)))
    || fanpages.find((fanpage) => (fanpage.link || '').toLowerCase().includes(value.toLowerCase()))
    || null;
};

const normalizeMediaUrl = (rawUrl = '') => {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)drive\.google\.com$|(^|\.)drive\.usercontent\.google\.com$/i.test(url.hostname)) return rawUrl;
    const fileId = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id');
    return fileId
      ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`
      : rawUrl;
  } catch {
    return rawUrl;
  }
};

const parseMedia = (raw = '') => String(raw || '')
  .split(/[\n;,|]+/)
  .map((value) => value.trim())
  .filter(Boolean)
  .slice(0, 10)
  .map((rawUrl) => {
    const url = normalizeMediaUrl(rawUrl);
    const name = rawUrl.split('/').pop() || 'Media URL';
    const type = /\.(mp4|mov|m4v|avi|webm|mkv)(?:$|[?#])/i.test(`${url} ${name}`) ? 'video' : 'image';
    return { type, url, name };
  });

const withOffset = (year, month, day, hour, minute, timezoneOffset) => {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${timezoneOffset}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateAtOffset = (date, timezoneOffset) => {
  const match = String(timezoneOffset).match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return date.toISOString().slice(0, 10);
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString().slice(0, 10);
};

const parseDateTime = (scheduledRaw, dateRaw, timeRaw, timezoneOffset) => {
  const raw = [scheduledRaw, [dateRaw, timeRaw].filter(Boolean).join(' ')].find(Boolean);
  if (!raw) return null;
  const normalized = String(raw).trim().replace(/\s+/g, ' ');
  let match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (match) return withOffset(match[1], match[2], match[3], match[4] || 0, match[5] || 0, timezoneOffset);
  match = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) return withOffset(match[3], match[2], match[1], match[4] || 0, match[5] || 0, timezoneOffset);
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseScheduleSheet = (text, {
  fanpages = [],
  defaultFanpageId = '',
  timezoneOffset = '+07:00'
} = {}) => parseRows(text).map((row) => {
  const explicitId = getRowValue(row, ALIASES.id);
  const title = getRowValue(row, ALIASES.title);
  const content = getRowValue(row, ALIASES.content);
  const fanpageText = getRowValue(row, ALIASES.fanpage);
  const scheduledRaw = getRowValue(row, ALIASES.scheduled);
  const dateRaw = getRowValue(row, ALIASES.date);
  const timeRaw = getRowValue(row, ALIASES.time);
  const mediaRaw = getRowValue(row, ALIASES.media);
  if (![title, content, fanpageText, scheduledRaw, dateRaw, timeRaw, mediaRaw].some(Boolean)) return null;
  const fanpage = matchFanpage(fanpages, fanpageText, defaultFanpageId);
  const scheduledDate = parseDateTime(
    scheduledRaw,
    dateRaw,
    timeRaw,
    timezoneOffset
  );
  const mediaItems = parseMedia(mediaRaw);
  const errors = [];
  if (!fanpage) errors.push('Không tìm thấy fanpage');
  if (!content.trim()) errors.push('Thiếu nội dung');
  if (!scheduledDate) errors.push('Thời gian không hợp lệ');
  if (fanpage?.platform === 'instagram' && mediaItems.some((item) => item.type === 'video')) {
    errors.push('Instagram chưa hỗ trợ video/Reels');
  }
  return {
    valid: errors.length === 0,
    errors,
    sheetRowKey: explicitId ? `id:${explicitId.trim().toLowerCase()}` : `row:${row.__sheetRowNumber}`,
    fanpageId: fanpage?.id || '',
    title: title.trim() || content.trim().slice(0, 80),
    content: content.trim(),
    date: scheduledDate ? dateAtOffset(scheduledDate, timezoneOffset) : '',
    scheduledAt: scheduledDate?.toISOString() || '',
    mediaItems
  };
}).filter(Boolean);
