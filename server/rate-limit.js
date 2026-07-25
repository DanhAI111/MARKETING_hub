const buckets = new Map();

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown')
  .split(',')[0]
  .trim();

// Evict stale buckets so the Map does not grow unbounded. Runs at most once per
// window tick, sweeping entries whose window ended more than one window ago.
let lastEvictSecond = 0;
const evictStale = (nowSeconds, windowSeconds) => {
  if (nowSeconds - lastEvictSecond < windowSeconds) return;
  lastEvictSecond = nowSeconds;
  for (const [key, value] of buckets) {
    if (nowSeconds - value.windowStart > windowSeconds * 2) buckets.delete(key);
  }
};

const checkRateLimit = (req, name, { limit, windowSeconds }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
  evictStale(nowSeconds, windowSeconds);
  const key = `${name}:${clientIp(req)}`;
  const existing = buckets.get(key);
  const next = existing?.windowStart === windowStart
    ? { windowStart, count: existing.count + 1 }
    : { windowStart, count: 1 };
  buckets.set(key, next);
  const retryAfter = Math.max(1, windowStart + windowSeconds - nowSeconds);
  return { allowed: next.count <= limit, retryAfter, count: next.count, limit };
};

const rateLimit = (name, config) => (req, res, next) => {
  const result = checkRateLimit(req, name, config);
  if (result.allowed) {
    next();
    return;
  }
  res.setHeader('Retry-After', String(result.retryAfter));
  res.status(429).json({ error: 'Rate limit exceeded', retryAfter: result.retryAfter });
};

module.exports = { checkRateLimit, rateLimit };
