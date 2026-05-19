const { Router } = require('express');
const { getAllIndices, getIndexById, getMarketsByRegion } = require('../services/marketDataService');
const logger = require('../services/logger');

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const grouped = await getMarketsByRegion();
    if (!grouped || Object.keys(grouped).length === 0) {
      logger.warn('No market data available, returning empty regions');
      return res.json({ regions: {} });
    }
    res.json({ regions: grouped });
  } catch (err) {
    logger.error(`Markets route error: ${err.message}`);
    res.status(500).json({ error: 'Market data unavailable', details: err.message });
  }
});

router.get('/flat', async (_req, res) => {
  try {
    const markets = await getAllIndices();
    res.json({ markets });
  } catch (err) {
    logger.error(`Flat markets error: ${err.message}`);
    res.json({ markets: [] });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const market = await getIndexById(req.params.id);
    if (!market) return res.status(404).json({ error: 'Market not found' });
    res.json(market);
  } catch (err) {
    logger.error(`Market detail error: ${err.message}`);
    res.status(500).json({ error: 'Market data unavailable' });
  }
});

module.exports = router;
