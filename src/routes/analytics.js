const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePlan } = require('../middleware/subscription');
const { getTechnicalAnalysis, fetchHistoricalData } = require('../services/technicalAnalysis');

const router = Router();

router.get('/technical/:ticker', requireAuth, requirePlan('pro'), async (req, res) => {
  try {
    const analysis = await getTechnicalAnalysis(req.params.ticker.toUpperCase());
    if (analysis.error) return res.status(400).json(analysis);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get technical analysis', details: err.message });
  }
});

router.get('/historical/:ticker', requireAuth, async (req, res) => {
  try {
    const { period = '3mo', interval = '1d' } = req.query;
    const data = await fetchHistoricalData(req.params.ticker.toUpperCase(), period, interval);
    if (!data) return res.status(400).json({ error: 'No historical data available' });
    res.json({ ticker: req.params.ticker.toUpperCase(), period, interval, data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get historical data', details: err.message });
  }
});

router.get('/quick/:ticker', requireAuth, async (req, res) => {
  try {
    const analysis = await getTechnicalAnalysis(req.params.ticker.toUpperCase());
    if (analysis.error) return res.status(400).json(analysis);

    const quick = {
      ticker: analysis.ticker,
      currentPrice: analysis.currentPrice,
      signal: analysis.signal,
      rsi: analysis.indicators.rsi,
      macd: analysis.indicators.macd,
      sma20: analysis.indicators.sma.sma20,
      sma50: analysis.indicators.sma.sma50,
    };

    res.json(quick);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get quick analysis', details: err.message });
  }
});

module.exports = router;
