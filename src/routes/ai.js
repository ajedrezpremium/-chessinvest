const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getSupabaseAdmin } = require('../services/supabase');
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

async function saveRecommendations(userId, text) {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const acciones = parsed.acciones || [];
    if (!acciones.length) return;

    const admin = getSupabaseAdmin();
    if (!admin) return;

    const rows = acciones.map((a) => ({
      user_id: userId,
      ticker: a.ticker,
      score: a.puntuacion,
      reason: a.razon,
      catalyst: a.catalizador,
      risk: a.riesgo,
      sector: a.sector,
      price_at_recommendation: a.precio,
    }));

    const { error } = await admin.from('recommendation_history').insert(rows);
    if (error) throw error;
    logger.info(`Saved ${acciones.length} recommendations for user ${userId}`);
  } catch {
    // Silently fail - saving history is best-effort
  }
}

module.exports = router;
