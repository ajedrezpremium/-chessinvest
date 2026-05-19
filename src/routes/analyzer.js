const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getAllIndices } = require('../services/marketDataService');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const INVESTMENT_WISDOM = [
  "La regla nº1 es no perder dinero. La regla nº2 es no olvidar la regla nº1. — Warren Buffett",
  "El mercado es un dispositivo para transferir dinero del impaciente al paciente. — Warren Buffett",
  "Compra empresas, no acciones. — Peter Lynch",
  "El inversor inteligente es un realista que vende a los optimistas y compra a los pesimistas. — Benjamin Graham",
  "La diversificación es protección contra la ignorancia. — Warren Buffett",
  "No intentes comprar en el mínimo y vender en el máximo. Eso es imposible. — Peter Lynch",
  "El riesgo viene de no saber lo que estás haciendo. — Warren Buffett",
  "Invierte en negocios que entiendas. — Warren Buffett",
  "La paciencia es la virtud más importante del inversor. — Benjamin Graham",
  "El mercado de valores es un mecanismo para transferir riqueza de los activos a los impacientes. — Warren Buffett",
  "No sigas a la multitud. Haz tu propia investigación. — Peter Lynch",
  "La volatilidad no es riesgo. El riesgo es la posibilidad de pérdida permanente. — Seth Klarman",
  "El mejor momento para plantar un árbol fue hace 20 años. El segundo mejor momento es ahora. — Proverbio chino (aplica a invertir)",
  "No apuestes contra América. — Warren Buffett",
  "El interés compuesto es la octava maravilla del mundo. — Albert Einstein",
];

const router = Router();

router.post('/analyze', optionalAuth, async (req, res) => {
  try {
    const { ticker, mode } = req.body;

    if (mode === 'chat') {
      return handleChat(req, res);
    }

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

[2-3 líneas sobre el momentum actual de ${upperTicker}]

### 📈 ¿Fundamentos sólidos?

- **PER:** [evaluación]
- **ROE:** [evaluación]
- **Crecimiento:** [tendencia]
- **Dividendo:** [rentabilidad]

### 📊 Análisis técnico

[Tendencia, RSI, medias móviles]

### ⚖️ ¿Qué vigilar ahora?

- **Pro:** [2-3 puntos positivos]
- **Contra:** [2-3 riesgos]

### 🧠 ChessInvest Take

[Conclusión profesional honesta sobre riesgos y oportunidades]

*Este contenido es solo informativo y no constituye asesoramiento de inversión.*`;

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      system: 'Eres un analista financiero experto estilo WarrenAI. Responde en español. Sé profesional y honesto sobre riesgos.',
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      return res.status(200).json({
        ticker: upperTicker,
        analysis: generateFallbackAnalysis(upperTicker),
        data: { marketContext },
        fallback: true,
      });
    }

    res.json({
      ticker: upperTicker,
      analysis: aiResponse.content[0].text,
      data: { marketContext },
    });
  } catch (err) {
    logger.error(`Stock analysis error: ${err.message}`);
    res.status(200).json({
      ticker: req.body?.ticker?.toUpperCase() || 'UNKNOWN',
      analysis: generateFallbackAnalysis(req.body?.ticker || 'STOCK'),
      error: err.message,
      fallback: true,
    });
  }
});

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    const markets = await getAllIndices();
    const marketContext = markets.slice(0, 6).map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');

    const wisdom = INVESTMENT_WISDOM[Math.floor(Math.random() * INVESTMENT_WISDOM.length)];

    const prompt = `Eres "ChessInvest Amigo", un amigo íntimo que es experto en inversiones. Tu estilo es cercano, sabio y directo, como hablar con Warren Buffett tomando un café.

CONTEXTO DE MERCADO: ${marketContext}

SABIDURÍA DEL DÍA: ${wisdom}

PREGUNTA DEL USUARIO: "${message}"

Responde en español, de forma conversacional pero profesional. Incluye:
1. Una respuesta directa a su pregunta
2. Un consejo práctico basado en la sabiduría de grandes inversores
3. Contexto del mercado actual si es relevante
4. Una pregunta de seguimiento para mantener la conversación

Sé cálido pero honesto sobre riesgos. Nunca des consejos específicos de compra/venta.`;

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.8,
      system: 'Eres ChessInvest Amigo, un amigo experto en inversiones. Conversacional, sabio, directo.',
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      return res.json({
        response: generateChatFallback(message),
        wisdom,
        fallback: true,
      });
    }

    res.json({
      response: aiResponse.content[0].text,
      wisdom,
    });
  } catch (err) {
    logger.error(`Chat error: ${err.message}`);
    res.json({
      response: generateChatFallback(req.body?.message || ''),
      error: err.message,
      fallback: true,
    });
  }
});

function generateFallbackAnalysis(ticker) {
  return `### 🚀 Análisis de ${ticker}

**Nota:** Estamos obteniendo datos en tiempo real. Mientras tanto, aquí tienes un análisis basado en principios fundamentales:

### 📈 Lo que sabemos
- ${ticker} cotiza en mercados globales con liquidez suficiente
- El entorno actual favorece la selectividad y la calidad
- La diversificación sigue siendo la mejor protección

### ⚖️ Puntos a considerar
- **Pro:** Exposición a sectores en crecimiento, liquidez, transparencia
- **Contra:** Volatilidad del mercado, riesgo macroeconómico, dependencia de resultados

### 🧠 ChessInvest Take
Antes de invertir en ${ticker}, pregúntate: ¿entiendo este negocio? ¿Estoy comprando por análisis o por FOMO? ¿Puedo mantener esta posición si baja un 20%?

*Datos en tiempo real disponibles cuando configuremos la API key.*`;
}

function generateChatFallback(message) {
  const wisdom = INVESTMENT_WISDOM[Math.floor(Math.random() * INVESTMENT_WISDOM.length)];
  return `Gran pregunta. Como decía Buffett: "${wisdom.split('—')[0].trim()}"

Mi consejo: enfócate en lo que puedes controlar — tu horizonte temporal, tu diversificación, y tus emociones. El mercado hará lo que haga, pero tú decides cómo reaccionar.

¿Quieres que profundicemos en algún aspecto específico?`;
}

module.exports = router;
