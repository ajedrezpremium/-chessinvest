const { Router } = require('express');
const { run, get, all } = require('../services/database');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);

// ── Watchlist ──

router.get('/watchlist', async (req, res) => {
  const items = await all('SELECT id, ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC', [req.user.id]);
  res.json({ watchlist: items });
});

router.post('/watchlist', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker || typeof ticker !== 'string' || ticker.length > 10) {
    return res.status(400).json({ error: 'Valid ticker required' });
  }
  try {
    const result = await run('INSERT INTO watchlist (user_id, ticker) VALUES (?, ?)', [req.user.id, ticker.toUpperCase()]);
    res.status(201).json({ id: result.lastID, ticker: ticker.toUpperCase() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ticker already in watchlist' });
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

router.delete('/watchlist/:ticker', async (req, res) => {
  const result = await run('DELETE FROM watchlist WHERE user_id = ? AND ticker = ?', [req.user.id, req.params.ticker.toUpperCase()]);
  if (result.changes === 0) return res.status(404).json({ error: 'Ticker not in watchlist' });
  res.json({ success: true });
});

// ── Portfolio ──

router.get('/portfolio', async (req, res) => {
  const items = await all('SELECT id, ticker, shares, avg_price, added_at FROM portfolio WHERE user_id = ? ORDER BY added_at DESC', [req.user.id]);
  res.json({ portfolio: items });
});

router.post('/portfolio', async (req, res) => {
  const { ticker, shares, avg_price } = req.body;
  if (!ticker || !shares || !avg_price || shares <= 0 || avg_price <= 0) {
    return res.status(400).json({ error: 'Valid ticker, shares (>0) and avg_price (>0) required' });
  }
  try {
    const result = await run('INSERT INTO portfolio (user_id, ticker, shares, avg_price) VALUES (?, ?, ?, ?)', [req.user.id, ticker.toUpperCase(), Number(shares), Number(avg_price)]);
    res.status(201).json({ id: result.lastID, ticker: ticker.toUpperCase(), shares: Number(shares), avg_price: Number(avg_price) });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      await run('UPDATE portfolio SET shares = ?, avg_price = ? WHERE user_id = ? AND ticker = ?', [Number(shares), Number(avg_price), req.user.id, ticker.toUpperCase()]);
      return res.json({ ticker: ticker.toUpperCase(), shares: Number(shares), avg_price: Number(avg_price), updated: true });
    }
    res.status(500).json({ error: 'Failed to add to portfolio' });
  }
});

router.put('/portfolio/:ticker', async (req, res) => {
  const { shares, avg_price } = req.body;
  const existing = await get('SELECT id FROM portfolio WHERE user_id = ? AND ticker = ?', [req.user.id, req.params.ticker.toUpperCase()]);
  if (!existing) return res.status(404).json({ error: 'Ticker not in portfolio' });
  await run('UPDATE portfolio SET shares = ?, avg_price = ? WHERE user_id = ? AND ticker = ?', [Number(shares), Number(avg_price), req.user.id, req.params.ticker.toUpperCase()]);
  res.json({ ticker: req.params.ticker.toUpperCase(), shares: Number(shares), avg_price: Number(avg_price) });
});

router.delete('/portfolio/:ticker', async (req, res) => {
  const result = await run('DELETE FROM portfolio WHERE user_id = ? AND ticker = ?', [req.user.id, req.params.ticker.toUpperCase()]);
  if (result.changes === 0) return res.status(404).json({ error: 'Ticker not in portfolio' });
  res.json({ success: true });
});

// ── Recommendation History ──

router.get('/recommendations', async (req, res) => {
  const items = await all('SELECT * FROM recommendation_history WHERE user_id = ? ORDER BY generated_at DESC LIMIT 100', [req.user.id]);
  res.json({ recommendations: items });
});

router.get('/recommendations/recent', async (_req, res) => {
  const items = await all('SELECT * FROM recommendation_history ORDER BY generated_at DESC LIMIT 20');
  res.json({ recommendations: items });
});

module.exports = router;
