'use strict';

const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_LEVELS = new Set(['info', 'warn', 'error']);
const SENSITIVE_KEY = /(access[_-]?token|authorization|cookie|csrf|password|secret|session|pageaccesstoken)/i;
const MAX_DETAILS_CHARS = 8 * 1024;

const redactUrl = (value) => {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return value;
  }
};

const redactText = (value) => String(value || '')
  .replace(/(Bearer)\s+[^\s,;]+/gi, '$1 [REDACTED]')
  .replace(/((?:access[_-]?token|authorization|cookie|csrf|password|secret|session)=)[^&\s,;]+/gi, '$1[REDACTED]');

const sanitizeLogDetails = (value, seen = new WeakSet()) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const normalized = /^https?:\/\//i.test(value) ? redactUrl(value) : redactText(value);
    return normalized.slice(0, MAX_DETAILS_CHARS);
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeLogDetails(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeLogDetails(item, seen);
  }
  return output;
};

const queryValue = (input, key) => {
  if (input?.get && typeof input.get === 'function') return input.get(key) || '';
  return input?.[key] || '';
};

const safeIso = (value, fallback) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
};

const normalizeLogFilters = (input = {}, referenceTime = Date.now()) => {
  const nowMs = Number.isFinite(Number(referenceTime)) ? Number(referenceTime) : Date.now();
  const maxTo = new Date(nowMs).toISOString();
  const requestedTo = safeIso(queryValue(input, 'to'), maxTo);
  const toMs = Math.min(Date.parse(requestedTo), nowMs);
  const earliestMs = toMs - LOG_RETENTION_MS;
  const requestedFrom = safeIso(queryValue(input, 'from'), new Date(toMs - 24 * 60 * 60 * 1000).toISOString());
  const fromMs = Math.max(Math.min(Date.parse(requestedFrom), toMs), earliestMs);
  const requestedLevel = String(queryValue(input, 'level')).toLowerCase();
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    level: LOG_LEVELS.has(requestedLevel) ? requestedLevel : '',
    component: String(queryValue(input, 'component')).trim().toLowerCase().slice(0, 50),
    platform: String(queryValue(input, 'platform')).trim().toLowerCase().slice(0, 20),
    postId: String(queryValue(input, 'postId')).trim().slice(0, 100),
    q: String(queryValue(input, 'q')).trim().slice(0, 200),
    cursor: String(queryValue(input, 'cursor')).trim().slice(0, 100),
    limit: Math.min(Math.max(Number.parseInt(queryValue(input, 'limit'), 10) || 50, 1), 100)
  };
};

const prepareLogEntry = (entry = {}) => {
  const level = LOG_LEVELS.has(String(entry.level || '').toLowerCase())
    ? String(entry.level).toLowerCase()
    : 'info';
  const details = sanitizeLogDetails(entry.details || {});
  const encoded = JSON.stringify(details);
  return {
    level,
    component: String(entry.component || 'app').trim().toLowerCase().slice(0, 50),
    event: String(entry.event || 'event').trim().slice(0, 80),
    message: redactText(entry.message).trim().slice(0, 2000),
    correlationId: String(entry.correlationId || '').trim().slice(0, 100),
    postId: String(entry.postId || '').trim().slice(0, 100),
    fanpageId: String(entry.fanpageId || '').trim().slice(0, 100),
    platform: String(entry.platform || '').trim().toLowerCase().slice(0, 20),
    details: encoded.length > MAX_DETAILS_CHARS
      ? JSON.stringify({ truncated: true, preview: encoded.slice(0, MAX_DETAILS_CHARS) })
      : encoded
  };
};

module.exports = {
  LOG_RETENTION_MS,
  sanitizeLogDetails,
  normalizeLogFilters,
  prepareLogEntry
};
