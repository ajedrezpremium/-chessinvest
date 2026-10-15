const { getSupabaseAdmin } = require('../services/supabase');
const { getUserSubscription } = require('../services/supabaseAuth');
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

const AGENT_ENDPOINTS = [
  '/api/stockbroker/chat',
  '/api/stockbroker/chat/stream',
  '/api/analyzer/analyze',
  '/api/analyzer/chat',
];

async function getPlanDailyLimit(userId) {
  if (!userId) return { tokens: DAILY_TOKEN_LIMITS.free, requests: DAILY_REQUEST_LIMITS.free };
  try {
    const sub = await getUserSubscription(userId);
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
      const tokensIn = Math.round(JSON.stringify(req.body || {}).length / 4);
      const tokensOut = Math.round(JSON.stringify(body || {}).length / 4);
      const admin = getSupabaseAdmin();
      if (admin) {
        admin.from('usage_tracking').insert({
          user_id: userId,
          endpoint: req.originalUrl || req.path,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
        }).then(() => {}).catch((e) => logger.debug(`usage insert failed: ${e.message}`));
      }
    } catch {}
    return originalJson(body);
  };
  next();
}

async function getDailyUsage(userId) {
  if (!userId) return 0;
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return 0;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from('usage_tracking')
      .select('tokens_in, tokens_out')
      .eq('user_id', userId)
      .gte('created_at', cutoff);
    if (error) throw error;
    return (data || []).reduce((s, r) => s + (r.tokens_in || 0) + (r.tokens_out || 0), 0);
  } catch {
    return 0;
  }
}

async function getDailyRequestCount(userId) {
  if (!userId) return 0;
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return 0;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from('usage_tracking')
      .select('endpoint')
      .eq('user_id', userId)
      .gte('created_at', cutoff)
      .in('endpoint', AGENT_ENDPOINTS);
    if (error) throw error;
    return data?.length || 0;
  } catch {
    return 0;
  }
}

async function checkUsageLimit(userId) {
  if (!userId) return { allowed: true };
  const limits = await getPlanDailyLimit(userId);
  const [usedTokens, usedRequests] = await Promise.all([
    getDailyUsage(userId),
    getDailyRequestCount(userId),
  ]);

  if (usedTokens >= limits.tokens) {
    return { allowed: false, reason: 'token', used: usedTokens, max: limits.tokens };
  }
  if (usedRequests >= limits.requests) {
    return { allowed: false, reason: 'request', used: usedRequests, max: limits.requests };
  }
  return { allowed: true, used: usedTokens, max: limits.tokens, requests: { used: usedRequests, max: limits.requests } };
}

async function dailyUsageLimiter(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();

  try {
    const result = await checkUsageLimit(userId);
    if (!result.allowed) {
      const msg = result.reason === 'token'
        ? `Límite diario de tokens alcanzado (${result.used.toLocaleString()}/${result.max.toLocaleString()}). Mejora tu plan en /pricing`
        : `Límite diario de consultas alcanzado (${result.used}/${result.max}). Mejora tu plan en /pricing`;
      logger.warn(`Daily limit exceeded for user ${userId}: ${result.reason} ${result.used}/${result.max}`);
      return res.status(429).json({ error: msg, limitExceeded: true, dailyUsage: result });
    }
  } catch (err) {
    logger.warn(`Usage check failed (allow): ${err.message}`);
  }

  next();
}

module.exports = { trackUsage, getDailyUsage, checkUsageLimit, dailyUsageLimiter, getPlanDailyLimit };
