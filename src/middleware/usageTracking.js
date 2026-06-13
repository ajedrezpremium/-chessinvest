const { run, saveDb, get } = require('../services/database');
const logger = require('../services/logger');

const DAILY_TOKEN_LIMITS = {
  free: 10000,
  basic: 50000,
  pro: 200000,
  premium: 1000000,
};

const DAILY_REQUEST_LIMITS = {
  free: 5,
  basic: 25,
  pro: 100,
  premium: 500,
};

function getPlanDailyLimit(userId) {
  if (!userId) return { tokens: DAILY_TOKEN_LIMITS.free, requests: DAILY_REQUEST_LIMITS.free };
  try {
    const sub = get('SELECT plan FROM subscriptions WHERE user_id = ?', [userId]);
    const plan = sub?.plan || 'free';
    return {
      tokens: DAILY_TOKEN_LIMITS[plan] || DAILY_TOKEN_LIMITS.free,
      requests: DAILY_REQUEST_LIMITS[plan] || DAILY_REQUEST_LIMITS.free,
    };
  } catch {
    return { tokens: DAILY_TOKEN_LIMITS.free, requests: DAILY_REQUEST_LIMITS.free };
  }
}

function trackUsage(req, _res, next) {
  const userId = req.user?.id;
  if (!userId) return next();

  const originalJson = _res.json.bind(_res);
  _res.json = function (body) {
    try {
      const tokensIn = JSON.stringify(req.body).length / 4;
      const tokensOut = JSON.stringify(body).length / 4;
      run(
        "INSERT INTO usage_tracking (user_id, endpoint, tokens_in, tokens_out) VALUES (?, ?, ?, ?)",
        [userId, req.originalUrl || req.path, Math.round(tokensIn), Math.round(tokensOut)]
      );
    } catch {}
    return originalJson(body);
  };
  next();
}

function getDailyUsage(userId) {
  if (!userId) return 0;
  try {
    const row = require('./database').all(
      "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as total FROM usage_tracking WHERE user_id = ? AND created_at >= datetime('now', '-1 day')",
      [userId]
    );
    return row?.[0]?.total || 0;
  } catch {
    return 0;
  }
}

function getDailyRequestCount(userId) {
  if (!userId) return 0;
  try {
    const row = require('./database').all(
      "SELECT COUNT(*) as total FROM usage_tracking WHERE user_id = ? AND created_at >= datetime('now', '-1 day') AND endpoint IN ('/api/stockbroker/chat', '/api/stockbroker/chat/stream', '/api/analyzer/analyze', '/api/analyzer/chat')",
      [userId]
    );
    return row?.[0]?.total || 0;
  } catch {
    return 0;
  }
}

function checkUsageLimit(userId) {
  if (!userId) return { allowed: true };
  const limits = getPlanDailyLimit(userId);
  const usedTokens = getDailyUsage(userId);
  const usedRequests = getDailyRequestCount(userId);

  if (usedTokens >= limits.tokens) {
    return { allowed: false, reason: 'token', used: usedTokens, max: limits.tokens };
  }
  if (usedRequests >= limits.requests) {
    return { allowed: false, reason: 'request', used: usedRequests, max: limits.requests };
  }
  return { allowed: true, used: usedTokens, max: limits.tokens, requests: { used: usedRequests, max: limits.requests } };
}

function dailyUsageLimiter(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();

  const result = checkUsageLimit(userId);
  if (!result.allowed) {
    const plan = getPlanDailyLimit(userId);
    const msg = result.reason === 'token'
      ? `Límite diario de tokens alcanzado (${result.used.toLocaleString()}/${result.max.toLocaleString()}). Mejora tu plan en chessinvest.onrender.com/pricing`
      : `Límite diario de consultas alcanzado (${result.used}/${result.max}). Mejora tu plan en chessinvest.onrender.com/pricing`;
    logger.warn(`Daily limit exceeded for user ${userId}: ${result.reason} ${result.used}/${result.max}`);
    return res.status(429).json({ error: msg, limitExceeded: true, dailyUsage: result });
  }

  next();
}

module.exports = { trackUsage, getDailyUsage, checkUsageLimit, dailyUsageLimiter, getPlanDailyLimit };
