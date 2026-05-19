const { Router } = require('express');
const { getAllIndices, getIndexById, getMarketsByRegion } = require('../services/marketDataService');
const logger = require('../services/logger');

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const grouped = await getMarketsByRegion();
    res.json({ regions: grouped });
  } catch (err) {
    next(err);
  }
});

router.get('/flat', async (_req, res, next) => {
  try {
    const markets = await getAllIndices();
    res.json({ markets });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const market = await getIndexById(req.params.id);
    if (!market) return res.status(404).json({ error: 'Market not found' });
    res.json(market);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
