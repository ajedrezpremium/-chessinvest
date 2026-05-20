const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { get, all, run } = require('../services/database');
const { hashPassword } = require('../services/auth');

const router = Router();

// Protect all admin routes
router.use(requireAuth);
router.use(requireAdmin);

// ── Dashboard Stats ───────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const totalUsers = (await get('SELECT COUNT(*) as count FROM users')).count;
    const totalSubscriptions = (await get("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'")).count;
    const totalGoals = (await get('SELECT COUNT(*) as count FROM goals')).count;
    const totalIdeas = (await get('SELECT COUNT(*) as count FROM investment_ideas')).count;
    const totalAlerts = (await get('SELECT COUNT(*) as count FROM price_alerts WHERE active = 1')).count;
    const totalWatchlist = (await get('SELECT COUNT(*) as count FROM watchlist')).count;
    const totalPortfolio = (await get('SELECT COUNT(*) as count FROM portfolio')).count;

    const usersByPlan = await all(`
      SELECT s.plan, COUNT(*) as count
      FROM subscriptions s
      GROUP BY s.plan
    `);

    const recentUsers = await all(`
      SELECT id, email, username, role, created_at
      FROM users ORDER BY created_at DESC LIMIT 10
    `);

    const revenue = await all(`
      SELECT s.plan, COUNT(*) as count
      FROM subscriptions s
      WHERE s.status = 'active' AND s.plan != 'free'
      GROUP BY s.plan
    `);

    const estimatedMRR = revenue.reduce((sum, r) => {
      const prices = { basic: 4.99, pro: 14.99, premium: 49.99 };
      return sum + (r.count * (prices[r.plan] || 0));
    }, 0);

    res.json({
      totalUsers,
      totalSubscriptions,
      totalGoals,
      totalIdeas,
      totalAlerts,
      totalWatchlist,
      totalPortfolio,
      usersByPlan,
      recentUsers,
      estimatedMRR: Math.round(estimatedMRR * 100) / 100,
      revenue,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get admin stats', details: err.message });
  }
});

// ── User Management ───────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;

    const where = search
      ? 'WHERE email LIKE ? OR username LIKE ?'
      : '';
    const params = search ? [`%${search}%`, `%${search}%`] : [];

    const users = await all(`
      SELECT u.id, u.email, u.username, u.role, u.first_name, u.last_name, u.avatar, u.created_at,
             s.plan, s.status as sub_status
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), offset]);

    const total = (await get(`SELECT COUNT(*) as count FROM users ${where}`, params)).count;

    res.json({ users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get users', details: err.message });
  }
});

router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin', 'moderator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    await run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role', details: err.message });
  }
});

router.put('/users/:id/plan', async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['free', 'basic', 'pro', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    await run("UPDATE subscriptions SET plan = ?, status = 'active', updated_at = datetime('now') WHERE user_id = ?", [plan, req.params.id]);
    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan', details: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    await run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
});

// ── Subscriptions ─────────────────────────────────────────

router.get('/subscriptions', async (req, res) => {
  try {
    const subs = await all(`
      SELECT s.*, u.email, u.username
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.updated_at DESC
      LIMIT 50
    `);
    res.json(subs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get subscriptions', details: err.message });
  }
});

// ── Incidents / Support Tickets ───────────────────────────

router.get('/incidents', async (req, res) => {
  try {
    const incidents = await all(`
      SELECT id, user_id, type, subject, description, status, priority, created_at, updated_at
      FROM incidents
      ORDER BY
        CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        created_at DESC
    `);
    res.json(incidents);
  } catch (err) {
    res.json([]);
  }
});

router.post('/incidents', async (req, res) => {
  try {
    const { user_id, type, subject, description, priority } = req.body;
    const result = await run(
      'INSERT INTO incidents (user_id, type, subject, description, priority, status) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, type || 'support', subject, description, priority || 'medium', 'open'],
    );
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [result.lastID]);
    res.status(201).json(incident);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create incident', details: err.message });
  }
});

router.put('/incidents/:id', async (req, res) => {
  try {
    const { status, priority, admin_notes } = req.body;
    await run(
      'UPDATE incidents SET status = COALESCE(?, status), priority = COALESCE(?, priority), admin_notes = COALESCE(?, admin_notes), updated_at = datetime(\'now\') WHERE id = ?',
      [status, priority, admin_notes, req.params.id],
    );
    const incident = await get('SELECT * FROM incidents WHERE id = ?', [req.params.id]);
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update incident', details: err.message });
  }
});

// ── Emails / Newsletter ───────────────────────────────────

router.get('/emails', async (req, res) => {
  try {
    const emails = await all(`
      SELECT id, subject, type, status, sent_count, created_at
      FROM email_campaigns
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json(emails);
  } catch (err) {
    res.json([]);
  }
});

router.post('/emails', async (req, res) => {
  try {
    const { subject, content, type, target_plan } = req.body;
    const result = await run(
      'INSERT INTO email_campaigns (subject, content, type, target_plan, status) VALUES (?, ?, ?, ?, ?)',
      [subject, content, type || 'newsletter', target_plan || 'all', 'draft'],
    );
    const email = await get('SELECT * FROM email_campaigns WHERE id = ?', [result.lastID]);
    res.status(201).json(email);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create email campaign', details: err.message });
  }
});

// ── System Health ─────────────────────────────────────────

router.get('/health', async (req, res) => {
  try {
    const dbSize = (await get("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")).size;
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    res.json({
      uptime: Math.round(uptime),
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
      },
      dbSize: Math.round(dbSize / 1024) + 'KB',
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get health', details: err.message });
  }
});

module.exports = router;
