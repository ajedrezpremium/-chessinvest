const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserProfile } = require('../services/supabaseAuth');
const { getSnapshot, getSectors, scanFundamentals } = require('../services/fundamentalsService');
const logger = require('../services/logger');

const router = Router();

// Buscador: filtros por score, PER, dividendo, deuda, sector. Público con límite.
router.get('/', async (req, res) => {
  try {
    const data = await getSnapshot({
      minScore: req.query.min_score ?? 0,
      maxPE: req.query.max_pe ?? null,
      minDiv: req.query.min_div ?? null,
      maxDebt: req.query.max_debt ?? null,
      sector: req.query.sector || null,
      sort: req.query.sort || 'score',
      limit: req.query.limit || 50,
    });
    res.json({ count: data.rows.length, updated_at: data.updated_at, rows: data.rows });
  } catch (err) {
    logger.error(`Screener error: ${err.message}`);
    res.status(500).json({ error: 'Screener no disponible ahora mismo' });
  }
});

router.get('/sectors', async (_req, res) => {
  try {
    res.json({ sectors: await getSectors() });
  } catch {
    res.json({ sectors: [] });
  }
});

// Re-escaneo manual (admin). El scan diario va por scheduler.
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfile(req.user.id);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    // Respuesta inmediata + scan en fondo (tarda minutos)
    scanFundamentals().then(
      (r) => logger.info(`Manual screener scan done: ${r.scanned} ok`),
      (e) => logger.error(`Manual screener scan failed: ${e.message}`)
    );
    res.json({ ok: true, message: 'Scan iniciado en segundo plano' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
