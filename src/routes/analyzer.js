const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getAllIndices } = require('../services/marketDataService');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const router = Router();

router.post('/analyze', optionalAuth, async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker || typeof ticker !== 'string' || ticker.length > 10) {
      return res.status(400).json({ error: 'Ticker válido requerido (ej: SAN, AAPL, MSFT)' });
    }

    const upperTicker = ticker.toUpperCase().trim();
    logger.info(`Stock analysis requested for ${upperTicker}`);

    const markets = await getAllIndices();
    const marketContext = markets.map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');

    const prompt = `Analiza la acción ${upperTicker} con estilo profesional tipo WarrenAI.

CONTEXTO DE MERCADO ACTUAL:
${marketContext}

FORMATO DE RESPUESTA (en español, profesional, conciso):

### 🚀 Momentum y tendencia

[2-3 líneas sobre el momentum actual de ${upperTicker}, si está cerca de máximos/mínimos, y la tendencia general]

### 📈 ¿Fundamentos sólidos?

- **PER:** [evaluación basada en el sector]
- **ROE:** [evaluación de eficiencia]
- **Crecimiento:** [tendencia de ingresos y beneficios]
- **Dividendo:** [rentabilidad y consistencia]

### 📊 Análisis técnico

[2-3 líneas sobre tendencia, RSI, medias móviles, soportes/resistencias]

### ⚖️ ¿Qué vigilar ahora?

- **Pro:** [2-3 puntos positivos clave]
- **Contra:** [2-3 riesgos o puntos negativos]
- **Precio objetivo:** [estimación basada en analistas]

### 🧠 ChessInvest Take

[2-3 párrafos con tu conclusión profesional: valoración general, perfil de inversor adecuado, nivel de vigilancia necesario. Sé directo y honesto sobre riesgos.]

*Este contenido es solo para fines informativos y no constituye asesoramiento de inversión.*`;

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      system: 'Eres un analista financiero experto estilo WarrenAI. Responde siempre en español. Sé profesional, directo y honesto sobre riesgos. Usa datos reales del contexto proporcionado. Formato markdown limpio con emojis de sección.',
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      return res.status(502).json({ error: 'Análisis IA no disponible temporalmente' });
    }

    res.json({
      ticker: upperTicker,
      analysis: aiResponse.content[0].text,
      data: {
        marketContext: marketContext,
      },
    });
  } catch (err) {
    logger.error(`Stock analysis error: ${err.message}`);
    res.status(500).json({ error: 'Análisis fallido', details: err.message });
  }
});

module.exports = router;
