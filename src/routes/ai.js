const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getDb } = require('../services/database');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const router = Router();

router.post('/anthropic', optionalAuth, async (req, res) => {
  try {
    const { status, data } = await callAI(req.body);
    const text = data?.content?.[0]?.text || '';

    if (req.user && text.includes('acciones')) {
      saveRecommendations(req.user.id, text);
    }

    res.status(status).json(data);
  } catch (err) {
    logger.error(`AI proxy error: ${err.message}`);
    res.status(502).json({ error: 'AI service temporarily unavailable' });
  }
});

function saveRecommendations(userId, text) {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const acciones = parsed.acciones || [];
    if (!acciones.length) return;

    const db = getDb();
    const insert = db.prepare(
      'INSERT INTO recommendation_history (user_id, ticker, score, reason, catalyst, risk, sector, price_at_recommendation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const tx = db.transaction((items) => {
      for (const a of items) {
        insert.run(userId, a.ticker, a.puntuacion, a.razon, a.catalizador, a.riesgo, a.sector, a.precio);
      }
    });

    tx(acciones);
    logger.info(`Saved ${acciones.length} recommendations for user ${userId}`);
  } catch {
    // Silently fail - saving history is best-effort
  }
}

module.exports = router;
