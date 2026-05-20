const { getPlanLimits } = require('../services/stripe');
const { get } = require('../services/database');

function requirePlan(minPlan) {
  const planOrder = ['free', 'basic', 'pro', 'premium'];
  const minIndex = planOrder.indexOf(minPlan);

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sub = await get('SELECT plan FROM subscriptions WHERE user_id = ?', [req.user.id]);
    const userPlan = sub?.plan || 'free';
    const userIndex = planOrder.indexOf(userPlan);

    if (userIndex < minIndex) {
      return res.status(403).json({
        error: `This feature requires ${minPlan} plan or higher`,
        currentPlan: userPlan,
        requiredPlan: minPlan,
        upgradeUrl: '/pricing',
      });
    }

    req.userPlan = userPlan;
    next();
  };
}

function checkLimit(limitType) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sub = await get('SELECT plan FROM subscriptions WHERE user_id = ?', [req.user.id]);
    const userPlan = sub?.plan || 'free';
    const limits = getPlanLimits(userPlan);
    const limit = limits[limitType];

    if (limit === -1) {
      req.userPlan = userPlan;
      return next();
    }

    let currentUsage;
    switch (limitType) {
      case 'watchlist':
        currentUsage = (await get('SELECT COUNT(*) as count FROM watchlist WHERE user_id = ?', [req.user.id])).count;
        break;
      case 'alerts':
        currentUsage = (await get("SELECT COUNT(*) as count FROM price_alerts WHERE user_id = ? AND active = 1", [req.user.id])).count;
        break;
      case 'portfolios':
        currentUsage = (await get('SELECT COUNT(DISTINCT ticker) as count FROM portfolio WHERE user_id = ?', [req.user.id])).count;
        break;
      default:
        return next();
    }

    if (currentUsage >= limit) {
      return res.status(429).json({
        error: `You have reached your ${limitType} limit (${limit}/${limit})`,
        currentUsage,
        limit,
        currentPlan: userPlan,
        upgradeUrl: '/pricing',
      });
    }

    req.userPlan = userPlan;
    next();
  };
}

module.exports = { requirePlan, checkLimit };
