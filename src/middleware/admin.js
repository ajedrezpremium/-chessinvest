const { get } = require('../services/database');

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row || row.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.userRole = row.role;
    next();
  });
}

function requireAdminAsync(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  (async () => {
    try {
      const user = await get('SELECT role FROM users WHERE id = ?', [req.user.id]);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      req.userRole = user.role;
      next();
    } catch (err) {
      res.status(500).json({ error: 'Admin check failed' });
    }
  })();
}

module.exports = { requireAdmin: requireAdminAsync };
