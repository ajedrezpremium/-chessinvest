const { Router } = require('express');
const { run, get } = require('../services/database');
const { hashPassword, verifyPassword, signToken, createTokens, refreshAccessToken, createPasswordReset, resetPassword } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const router = Router();

router.post('/register', (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existing) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    const hash = hashPassword(password);
    const result = run('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)', [email, username, hash]);
    run('INSERT INTO subscriptions (user_id, plan, status) VALUES (?, ?, ?)', [result.lastID, 'free', 'active']);
    run('INSERT INTO user_settings (user_id) VALUES (?)', [result.lastID]);
    const user = { id: result.lastID, email, username };
    const { accessToken, refreshToken } = createTokens(user);

    res.status(201).json({ token: accessToken, refreshToken, user: { id: user.id, email: user.email, username: user.username, plan: 'free' } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const sub = get('SELECT plan, status FROM subscriptions WHERE user_id = ?', [user.id]);
    const { accessToken, refreshToken } = createTokens(user);
    res.json({
      token: accessToken,
      refreshToken,
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

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const result = refreshAccessToken(refreshToken);
  if (!result) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  res.json({ token: result.accessToken, user: result.user });
});

router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const token = createPasswordReset(email);
  if (!token) return res.json({ ok: true }); // Don't reveal if email exists

  logger.info(`Password reset requested for ${email}`);
  res.json({ ok: true });
});

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const ok = resetPassword(token, password);
  if (!ok) return res.status(400).json({ error: 'Invalid or expired reset token' });

  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = get('SELECT id, email, username, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const sub = get('SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = ?', [req.user.id]);
  const settings = get('SELECT theme, language, timezone FROM user_settings WHERE user_id = ?', [req.user.id]);

  res.json({
    ...user,
    plan: sub?.plan || 'free',
    subscriptionStatus: sub?.status || 'active',
    subscriptionEnd: sub?.current_period_end,
    theme: settings?.theme || 'dark',
    language: settings?.language || 'es',
    timezone: settings?.timezone || 'Europe/Madrid',
  });
});

module.exports = router;
