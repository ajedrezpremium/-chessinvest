const { getUserProfile } = require('../services/supabaseAuth');

async function requireAdminAsync(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  // Trust role from JWT if present (admin set in user_metadata)
  if (req.user.role === 'admin') {
    req.userRole = 'admin';
    return next();
  }

  try {
    const user = await getUserProfile(req.user.id);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.userRole = user.role;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Admin check failed' });
  }
}

module.exports = { requireAdmin: requireAdminAsync };
