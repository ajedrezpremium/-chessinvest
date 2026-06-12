const { run, saveDb } = require('./database');
const logger = require('./logger');

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

function checkUsageLimit(userId, maxTokens = 50000) {
  if (!userId) return true;
  const used = getDailyUsage(userId);
  return used < maxTokens;
}

module.exports = { trackUsage, getDailyUsage, checkUsageLimit };
