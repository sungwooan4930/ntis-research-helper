// lib/ratelimit.js — 의존성 없는 in-memory 고정창 per-IP rate limiter
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: message || '요청이 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    return next();
  };
}

module.exports = rateLimit;
