const { Router } = require('express');
const { getDb } = require('../services/database');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);

// ── Watchlist ──

router.get('/watchlist', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT id, ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC').all(req.user.id);
  res.json({ watchlist: items });
});

router.post('/watchlist', (req, res) => {
  const { ticker } = req.body;
  if (!ticker || typeof ticker !== 'string' || ticker.length > 10) {
    return res.status(400).json({ error: 'Valid ticker required' });
  }
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO watchlist (user_id, ticker) VALUES (?, ?)').run(req.user.id, ticker.toUpperCase());
    res.status(201).json({ id: result.lastInsertRowid, ticker: ticker.toUpperCase() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ticker already in watchlist' });
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

router.delete('/watchlist/:ticker', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM watchlist WHERE user_id = ? AND ticker = ?').run(req.user.id, req.params.ticker.toUpperCase());
  if (result.changes === 0) return res.status(404).json({ error: 'Ticker not in watchlist' });
  res.json({ success: true });
});

// ── Portfolio ──

router.get('/portfolio', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT id, ticker, shares, avg_price, added_at FROM portfolio WHERE user_id = ? ORDER BY added_at DESC').all(req.user.id);
  res.json({ portfolio: items });
});

router.post('/portfolio', (req, res) => {
  const { ticker, shares, avg_price } = req.body;
  if (!ticker || !shares || !avg_price || shares <= 0 || avg_price <= 0) {
    return res.status(400).json({ error: 'Valid ticker, shares (>0) and avg_price (>0) required' });
  }
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO portfolio (user_id, ticker, shares, avg_price) VALUES (?, ?, ?, ?)').run(req.user.id, ticker.toUpperCase(), Number(shares), Number(avg_price));
    res.status(201).json({ id: result.lastInsertRowid, ticker: ticker.toUpperCase(), shares: Number(shares), avg_price: Number(avg_price) });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      db.prepare('UPDATE portfolio SET shares = ?, avg_price = ? WHERE user_id = ? AND ticker = ?').run(Number(shares), Number(avg_price), req.user.id, ticker.toUpperCase());
      return res.json({ ticker: ticker.toUpperCase(), shares: Number(shares), avg_price: Number(avg_price), updated: true });
    }
    res.status(500).json({ error: 'Failed to add to portfolio' });
  }
});

router.put('/portfolio/:ticker', (req, res) => {
  const { shares, avg_price } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM portfolio WHERE user_id = ? AND ticker = ?').get(req.user.id, req.params.ticker.toUpperCase());
  if (!existing) return res.status(404).json({ error: 'Ticker not in portfolio' });
  db.prepare('UPDATE portfolio SET shares = ?, avg_price = ? WHERE user_id = ? AND ticker = ?').run(Number(shares), Number(avg_price), req.user.id, req.params.ticker.toUpperCase());
  res.json({ ticker: req.params.ticker.toUpperCase(), shares: Number(shares), avg_price: Number(avg_price) });
});

router.delete('/portfolio/:ticker', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM portfolio WHERE user_id = ? AND ticker = ?').run(req.user.id, req.params.ticker.toUpperCase());
  if (result.changes === 0) return res.status(404).json({ error: 'Ticker not in portfolio' });
  res.json({ success: true });
});

// ── Recommendation History ──

router.get('/recommendations', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT * FROM recommendation_history WHERE user_id = ? ORDER BY generated_at DESC LIMIT 100').all(req.user.id);
  res.json({ recommendations: items });
});

router.get('/recommendations/recent', (_req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT * FROM recommendation_history ORDER BY generated_at DESC LIMIT 20').all();
  res.json({ recommendations: items });
});

module.exports = router;
