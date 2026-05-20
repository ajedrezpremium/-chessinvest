const { Router } = require('express');
const { run, get } = require('../services/database');
const { hashPassword, verifyPassword, signToken } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existing) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    const hash = hashPassword(password);
    const result = await run('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)', [email, username, hash]);
    await run('INSERT INTO subscriptions (user_id, plan, status) VALUES (?, ?, ?)', [result.lastID, 'free', 'active']);
    await run('INSERT INTO user_settings (user_id) VALUES (?)', [result.lastID]);
    const user = { id: result.lastID, email, username };
    const token = signToken(user);

    res.status(201).json({ token, user: { id: user.id, email: user.email, username: user.username, plan: 'free' } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const sub = await get('SELECT plan, status FROM subscriptions WHERE user_id = ?', [user.id]);
    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: sub?.plan || 'free',
        subscriptionStatus: sub?.status || 'active',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await get('SELECT id, email, username, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const sub = await get('SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = ?', [req.user.id]);
  const settings = await get('SELECT theme, language, timezone FROM user_settings WHERE user_id = ?', [req.user.id]);
  const watchlistCount = (await get('SELECT COUNT(*) as count FROM watchlist WHERE user_id = ?', [req.user.id])).count;
  const portfolioCount = (await get('SELECT COUNT(*) as count FROM portfolio WHERE user_id = ?', [req.user.id])).count;

  res.json({
    ...user,
    plan: sub?.plan || 'free',
    subscriptionStatus: sub?.status || 'active',
    subscriptionEnd: sub?.current_period_end,
    theme: settings?.theme || 'dark',
    language: settings?.language || 'es',
    timezone: settings?.timezone || 'Europe/Madrid',
    watchlistCount,
    portfolioCount,
  });
});

module.exports = router;
