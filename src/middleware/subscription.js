const { getPlanLimits } = require('../services/stripe');
const { getUserSubscription } = require('../services/supabaseAuth');
const { getSupabaseAdmin } = require('../services/supabase');

function requirePlan(minPlan) {
  const planOrder = ['free', 'basic', 'pro', 'premium'];
  const minIndex = planOrder.indexOf(minPlan);

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sub = await getUserSubscription(req.user.id);
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

    const sub = await getUserSubscription(req.user.id);
    const userPlan = sub?.plan || 'free';
    const limits = getPlanLimits(userPlan);
    const limit = limits[limitType];

    if (limit === -1) {
      req.userPlan = userPlan;
      return next();
    }

    const admin = getSupabaseAdmin();
    let currentUsage = 0;

    try {
      if (limitType === 'watchlist') {
        const { count } = await admin.from('watchlist').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id);
        currentUsage = count || 0;
      } else if (limitType === 'alerts') {
        const { count } = await admin.from('price_alerts').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('active', 1);
        currentUsage = count || 0;
      } else if (limitType === 'portfolios') {
        const { data } = await admin.from('portfolio').select('ticker').eq('user_id', req.user.id);
        currentUsage = new Set((data || []).map((r) => r.ticker)).size;
      } else {
        return next();
      }
    } catch {
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
