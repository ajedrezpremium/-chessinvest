const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getWatchlist,
  getPortfolio,
  select,
  insert,
  update,
  remove,
} = require('../services/supabaseDb');

const router = Router();

router.use(requireAuth);

// ── Watchlist ──

router.get('/watchlist', async (req, res) => {
  try {
    const items = await getWatchlist(req.user.id);
    res.json({ watchlist: items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get watchlist' });
  }
});

router.post('/watchlist', async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker || typeof ticker !== 'string' || ticker.length > 10) {
      return res.status(400).json({ error: 'Valid ticker required' });
    }
    const item = await insert('watchlist', {
      user_id: req.user.id,
      ticker: ticker.toUpperCase(),
    });
    res.status(201).json({ id: item.id, ticker: item.ticker });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ticker already in watchlist' });
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

router.delete('/watchlist/:ticker', async (req, res) => {
  try {
    const result = await remove('watchlist', req.params.ticker.toUpperCase(), 'ticker');
    // Note: remove by ticker not id, need custom query
    // For now, use a different approach
    const { getSupabaseAdmin } = require('../services/supabase');
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('watchlist')
      .delete()
      .eq('user_id', req.user.id)
      .eq('ticker', req.params.ticker.toUpperCase());
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

// ── Portfolio ──

router.get('/portfolio', async (req, res) => {
  try {
    const items = await getPortfolio(req.user.id);
    res.json({ portfolio: items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

router.post('/portfolio', async (req, res) => {
  try {
    const { ticker, shares, avg_price } = req.body;
    if (!ticker || !shares || !avg_price || shares <= 0 || avg_price <= 0) {
      return res.status(400).json({ error: 'Valid ticker, shares (>0) and avg_price (>0) required' });
    }
    try {
      const item = await insert('portfolio', {
        user_id: req.user.id,
        ticker: ticker.toUpperCase(),
        shares: Number(shares),
        avg_price: Number(avg_price),
      });
      res.status(201).json({
        id: item.id,
        ticker: item.ticker,
        shares: item.shares,
        avg_price: item.avg_price,
      });
    } catch (err) {
      if (err.code === '23505') {
        // Update existing
        const item = await update('portfolio', ticker.toUpperCase(), {
          shares: Number(shares),
          avg_price: Number(avg_price),
        }, 'ticker');
        return res.json({
          ticker: item.ticker,
          shares: item.shares,
          avg_price: item.avg_price,
          updated: true,
        });
      }
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to add to portfolio' });
  }
});

router.put('/portfolio/:ticker', async (req, res) => {
  try {
    const { shares, avg_price } = req.body;
    const item = await update('portfolio', req.params.ticker.toUpperCase(), {
      shares: Number(shares),
      avg_price: Number(avg_price),
    }, 'ticker');
    if (!item) return res.status(404).json({ error: 'Ticker not in portfolio' });
    res.json({ ticker: item.ticker, shares: item.shares, avg_price: item.avg_price });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update portfolio' });
  }
});

router.delete('/portfolio/:ticker', async (req, res) => {
  try {
    const { getSupabaseAdmin } = require('../services/supabase');
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('portfolio')
      .delete()
      .eq('user_id', req.user.id)
      .eq('ticker', req.params.ticker.toUpperCase());
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from portfolio' });
  }
});

// ── Recommendation History ──

router.get('/recommendations', async (req, res) => {
  try {
    const items = await select('recommendation_history', { user_id: req.user.id }, {
      order: { column: 'generated_at', ascending: false },
      limit: 100,
    });
    res.json({ recommendations: items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

router.get('/recommendations/recent', async (_req, res) => {
  try {
    const items = await select('recommendation_history', {}, {
      order: { column: 'generated_at', ascending: false },
      limit: 20,
    });
    res.json({ recommendations: items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

module.exports = router;