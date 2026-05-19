const { Router } = require('express');
const { fetchStockData, buildAnalysisPrompt } = require('../services/stockAnalyzer');
const { callAI } = require('../services/aiProvider');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const router = Router();

router.post('/analyze', optionalAuth, async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker || typeof ticker !== 'string' || ticker.length > 10) {
      return res.status(400).json({ error: 'Valid ticker required' });
    }

    const upperTicker = ticker.toUpperCase();
    logger.info(`Stock analysis requested for ${upperTicker}`);

    const data = await fetchStockData(upperTicker);

    if (!data.quote && !data.modules) {
      return res.status(404).json({ error: `No data found for ${upperTicker}. Check the ticker symbol.` });
    }

    const prompt = buildAnalysisPrompt(upperTicker, data);

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      system: 'Eres un analista financiero experto estilo WarrenAI. Responde siempre en español. Sé profesional, directo y honesto sobre riesgos. Usa datos reales, no inventes cifras. Formato markdown limpio con emojis de sección.',
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      return res.status(502).json({ error: 'AI analysis failed' });
    }

    res.json({
      ticker: upperTicker,
      analysis: aiResponse.content[0].text,
      data: {
        price: data.quote?.regularMarketPrice,
        change: data.quote?.regularMarketChange,
        changePercent: data.quote?.regularMarketChangePercent,
        marketCap: data.quote?.marketCap,
        volume: data.quote?.regularMarketVolume,
      },
    });
  } catch (err) {
    logger.error(`Stock analysis error: ${err.message}`);
    res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});

module.exports = router;
