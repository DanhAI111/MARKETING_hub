const buckets = new Map();

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown')
  .split(',')[0]
  .trim();

const checkRateLimit = (req, name, { limit, windowSeconds }) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % windowSeconds);
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
