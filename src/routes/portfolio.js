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

// ── Stress test: shock de mercado con betas (cálculo local, sin IA) ──
// GET /api/portfolio/stress?shock=-20 → pérdida estimada por posición,
// impacto total y concentración por sector.
router.get('/stress', async (req, res) => {
  try {
    const shockPct = Number(req.query.shock ?? -20);
    if (!Number.isFinite(shockPct) || shockPct > 0 || shockPct < -90) {
      return res.status(400).json({ error: 'shock debe estar entre -90 y 0 (ej: -20)' });
    }
    const { getSupabaseAdmin } = require('../services/supabase');
    const admin = getSupabaseAdmin();
    const positions = await getPortfolio(req.user.id);
    if (!positions.length) {
      return res.json({ shock_pct: shockPct, positions: [], total_value: 0, total_loss: 0, total_loss_pct: 0, warnings: [] });
    }

    const tickers = [...new Set(positions.map((p) => p.ticker))];
    const { data: funds } = await admin.from('ticker_fundamentals').select('ticker, price, beta, sector').in('ticker', tickers);
    const byTicker = Object.fromEntries((funds || []).map((f) => [f.ticker, f]));

    let totalValue = 0;
    let totalLoss = 0;
    const sectorValue = {};
    const rows = positions.map((p) => {
      const f = byTicker[p.ticker] || {};
      const beta = typeof f.beta === 'number' ? f.beta : 1;
      const price = Number(f.price) || Number(p.avg_price);
      const value = Number(p.shares) * price;
      const lossPct = (shockPct * beta) / 100;
      const loss = value * lossPct;
      totalValue += value;
      totalLoss += loss;
      const sector = f.sector || 'General';
      sectorValue[sector] = (sectorValue[sector] || 0) + value;
      return {
        ticker: p.ticker,
        shares: Number(p.shares),
        price: Math.round(price * 100) / 100,
        value: Math.round(value * 100) / 100,
        beta,
        est_loss_pct: Math.round(lossPct * 10000) / 100,
        est_loss: Math.round(loss * 100) / 100,
        sector,
        beta_missing: f.beta == null,
      };
    });

    const warnings = [];
    for (const [sector, value] of Object.entries(sectorValue)) {
      const pct = totalValue ? (value / totalValue) * 100 : 0;
      if (pct >= 50) warnings.push(`Concentración alta en ${sector}: ${pct.toFixed(0)}% de la cartera`);
      else if (pct >= 35) warnings.push(`Exposición relevante en ${sector}: ${pct.toFixed(0)}% de la cartera`);
    }
    const avgBeta = totalValue
      ? rows.reduce((s, r) => s + r.beta * r.value, 0) / totalValue
      : 1;
    if (avgBeta > 1.2) warnings.push(`Beta media ${avgBeta.toFixed(2)}: la cartera amplifica las caídas del mercado`);
    if (rows.some((r) => r.beta_missing)) warnings.push('Algunos tickers sin beta: se asumió beta = 1 (estimación aproximada)');
    if (!Object.keys(byTicker).length) warnings.push('Sin datos de mercado cacheados: el scan diario aún no se ejecutó');

    res.json({
      shock_pct: shockPct,
      positions: rows,
      total_value: Math.round(totalValue * 100) / 100,
      total_loss: Math.round(totalLoss * 100) / 100,
      total_loss_pct: totalValue ? Math.round((totalLoss / totalValue) * 10000) / 100 : 0,
      avg_beta: Math.round(avgBeta * 100) / 100,
      warnings,
    });
  } catch (err) {
    res.status(500).json({ error: 'Stress test no disponible ahora mismo' });
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