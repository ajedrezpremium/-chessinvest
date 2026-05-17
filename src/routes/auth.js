const { Router } = require('express');
const { getDb } = require('../services/database');
const { hashPassword, verifyPassword, signToken } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

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

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(409).json({ error: 'Email or username already exists' });
    }

    const hash = hashPassword(password);
    const result = db.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)').run(email, username, hash);
    const user = { id: result.lastInsertRowid, email, username };
    const token = signToken(user);

    res.status(201).json({ token, user: { id: user.id, email: user.email, username: user.username } });
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

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, username, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const watchlistCount = db.prepare('SELECT COUNT(*) as count FROM watchlist WHERE user_id = ?').get(req.user.id).count;
  const portfolioCount = db.prepare('SELECT COUNT(*) as count FROM portfolio WHERE user_id = ?').get(req.user.id).count;

  res.json({ ...user, watchlistCount, portfolioCount });
});

module.exports = router;
