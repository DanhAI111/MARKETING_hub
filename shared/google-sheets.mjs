export const googleSheetCsvUrls = (inputUrl) => {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    const error = new Error('Link Google Sheets không hợp lệ');
    error.status = 400;
    throw error;
  }
  if (url.hostname !== 'docs.google.com') {
    const error = new Error('Chỉ hỗ trợ link Google Sheets từ docs.google.com');
    error.status = 400;
    throw error;
  }

  if (url.pathname.includes('/spreadsheets/') && (url.searchParams.get('output') === 'csv' || url.searchParams.get('format') === 'csv')) {
    return [url.toString()];
  }

  const publishedMatch = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([^/]+)/);
  const regularMatch = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([^/]+)/);
  if (!publishedMatch && !regularMatch) {
    const error = new Error('Không tìm thấy Google Sheets ID trong link');
    error.status = 400;
    throw error;
  }
  const hashParams = new URLSearchParams(String(url.hash || '').replace(/^#/, ''));
  const gid = url.searchParams.get('gid') || hashParams.get('gid') || '0';
  if (publishedMatch) {
    const id = publishedMatch[1];
    return [
      `https://docs.google.com/spreadsheets/d/e/${id}/pub?output=csv&gid=${encodeURIComponent(gid)}`,
      `https://docs.google.com/spreadsheets/d/e/${id}/pub?gid=${encodeURIComponent(gid)}&single=true&output=csv`
    ];
  }
  const id = regularMatch[1];
  return [
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`,
    `https://docs.google.com/spreadsheets/d/${id}/pub?output=csv&gid=${encodeURIComponent(gid)}`
  ];
};

export const fetchGoogleSheetCsvText = async (inputUrl, { signal } = {}) => {
  const headers = {
    'Accept': 'text/csv,text/plain,*/*',
    'User-Agent': 'Mozilla/5.0 MarketingHub/1.0'
  };
  let lastStatus = 0;
  let lastText = '';
  for (const csvUrl of googleSheetCsvUrls(inputUrl)) {
    const response = await fetch(csvUrl, { headers, signal });
    const text = await response.text();
    lastStatus = response.status;
    lastText = text;
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHtml = /^\s*<!doctype html|^\s*<html[\s>]/i.test(text);
    if (response.ok && text.trim() && !looksLikeHtml && !contentType.includes('text/html')) {
      return text;
    }
  }
  const error = new Error(
    lastText && /^\s*<!doctype html|^\s*<html[\s>]/i.test(lastText)
      ? 'Google trả về trang HTML thay vì CSV. Hãy dùng File > Share > Publish to web hoặc tải CSV lên trực tiếp.'
      : 'Không thể đọc Google Sheets. Hãy kiểm tra quyền chia sẻ hoặc publish sheet.'
  );
  error.status = lastStatus || 400;
  throw error;
};
