const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getAllIndices } = require('../services/marketDataService');
const { getFuturesData } = require('../services/futuresDataService');
const { optionalAuth } = require('../middleware/auth');
const { get, all } = require('../services/database');
const logger = require('../services/logger');

const router = Router();

const FUTURES_WISDOM = [
  "Los mercados de futuros son un mecanismo para transferir riqueza de los imprudentes a los disciplinados. — Paul Tudor Jones",
  "No predecir, sino reaccionar. El mercado te dice lo que quiere ser, no lo que tú quieres que sea. — Stanley Druckenmiller",
  "La preservación del capital es la regla número uno. Todo lo demás es secundario. — Ray Dalio",
  "Gestiona el riesgo primero, el beneficio vendrá solo. — Jim Simons",
  "Cuando tienes razón, apuesta fuerte. Pero primero asegúrate de tener razón. — George Soros",
  "El mejor trade es el que no haces. La paciencia es la mayor virtud del trader de futuros. — Paul Tudor Jones",
  "No confundas un mercado trending con un mercado en rango. La mayoría pierde por no saber diferenciarlos.",
  "El VIX alto es para vender, no para comprar. La volatilidad siempre mean-revierte.",
  "Los futuros recompensan la precisión quirúrgica, no la actividad frenética.",
  "El mejor indicador macro es la curva de tipos. Siempre.",
];

const FUTURES_TICKERS = {
  'ES': { name: 'S&P 500 E-mini', symbol: 'ES=F' },
  'NQ': { name: 'NASDAQ 100 E-mini', symbol: 'NQ=F' },
  'RTY': { name: 'Russell 2000', symbol: 'RTY=F' },
  'YM': { name: 'Dow Jones E-mini', symbol: 'YM=F' },
  'CL': { name: 'Crude Oil WTI', symbol: 'CL=F' },
  'GC': { name: 'Gold Futures', symbol: 'GC=F' },
  'SI': { name: 'Silver Futures', symbol: 'SI=F' },
  'HG': { name: 'Copper Futures', symbol: 'HG=F' },
  'NG': { name: 'Natural Gas', symbol: 'NG=F' },
  'ZB': { name: '30Y T-Bond', symbol: 'ZB=F' },
  'ZN': { name: '10Y T-Note', symbol: 'ZN=F' },
  '6E': { name: 'Euro FX', symbol: '6E=F' },
  '6B': { name: 'British Pound', symbol: '6B=F' },
  '6J': { name: 'Japanese Yen', symbol: '6J=F' },
};

const conversationMemory = new Map();
const MAX_CONVERSATION_HISTORY = 10;

function getConversationHistory(userId) {
  if (!userId) return [];
  return conversationMemory.get(userId) || [];
}

function addConversationMessage(userId, role, message) {
  if (!userId) return;
  let history = conversationMemory.get(userId) || [];
  history.push({ role, message, timestamp: new Date().toISOString() });
  if (history.length > MAX_CONVERSATION_HISTORY) {
    history = history.slice(-MAX_CONVERSATION_HISTORY);
  }
  conversationMemory.set(userId, history);
}

function formatConversationHistory(history) {
  if (!history.length) return '';
  return '\nHISTORIAL RECIENTE:\n' + history.map((m, i) => `${i + 1}. ${m.role === 'user' ? 'Tú' : 'AI'}: ${m.message.substring(0, 150)}${m.message.length > 150 ? '...' : ''}`).join('\n') + '\n';
}

async function getUserPortfolioContext(userId) {
  if (!userId) return null;
  try {
    const portfolio = await all('SELECT ticker, shares, avg_price FROM portfolio WHERE user_id = ? ORDER BY added_at DESC', [userId]);
    const watchlist = await all('SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at DESC', [userId]);
    if (!portfolio?.length && !watchlist?.length) return null;
    let context = '';
    if (portfolio?.length) {
      context += 'TU PORTFOLIO:\n';
      portfolio.forEach(p => { context += `- ${p.ticker}: ${p.shares} (precio medio: $${p.avg_price})\n`; });
      context += '\n';
    }
    if (watchlist?.length) {
      context += 'TU WATCHLIST:\n';
      watchlist.forEach(w => { context += `- ${w.ticker}\n`; });
      context += '\n';
    }
    return context;
  } catch (err) {
    logger.warn(`Failed to fetch portfolio context: ${err.message}`);
    return null;
  }
}

const FUTURES_PATTERN = /\b(ES|NQ|RTY|YM|CL|GC|SI|HG|NG|ZB|ZN|6E|6B|6J|VIX|DXY)\b/g;

function extractFutures(message) {
  const matches = message.toUpperCase().match(FUTURES_PATTERN) || [];
  return [...new Set(matches)].filter(m => FUTURES_TICKERS[m] || ['VIX', 'DXY'].includes(m));
}

const FUTURES_SYSTEM_PROMPT = `Actúa como FUTURES MASTER AI, una inteligencia artificial de nivel institucional especializada en futuros financieros, índices bursátiles, materias primas, divisas, bonos, tipos de interés y criptomonedas. Eres una combinación de Ray Dalio, Jim Simons, Paul Tudor Jones, Stanley Druckenmiller y George Soros.

Tu objetivo es detectar oportunidades de inversión de alta probabilidad mediante análisis técnico, cuantitativo, macroeconómico y de sentimiento.

ESTRUCTURA OBLIGATORIA DE RESPUESTA:

### ⚡ Análisis del Activo
[Activo, contexto actual, tendencia dominante]

### 📊 Score Técnico (0-100)
Desglosar:
- Medias Móviles (20/50/100/200)
- RSI, MACD, ADX, Bandas de Bollinger
- Price Action (soportes/resistencias, máximos/mínimos)
- Volumen y Open Interest

### 🌍 Contexto Macro
[VIX, DXY, curva de tipos, impacto en el activo]

### 🎯 Recomendación
Dirección: LARGO/CORTO/NEUTRAL
Entrada: [precio o zona]
Stop Loss: [nivel]
Take Profit 1/2/3: [niveles]
Ratio R/R: [X:1]
Score: [0-100]
Confianza IA: [%]

### ⚠️ Riesgos
[2-3 riesgos específicos]

REGLAS:
1. Nunca emitir señales sin justificar con datos.
2. Mostrar siempre score numérico y nivel de confianza.
3. Priorizar preservación de capital.
4. Explicar cada recomendación con razonamiento probabilístico.
5. No sobreoperar. Si no hay oportunidad clara, decirlo.

IMPORTANTE: Si generas listas interactivas con checkboxes, incluye siempre un botón para cerrar.`;

router.get('/futures', async (_req, res) => {
  try {
    const data = await getFuturesData();
    res.json({ futures: data });
  } catch (err) {
    logger.error(`Futures data error: ${err.message}`);
    res.json({ futures: [] });
  }
});

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    const [futures, markets, portfolioContext] = await Promise.all([
      getFuturesData(),
      getAllIndices(),
      getUserPortfolioContext(req.user?.id),
    ]);

    const conversationHistory = getConversationHistory(req.user?.id);
    addConversationMessage(req.user?.id, 'user', message);

    const futuresContext = futures.map(f => `${f.name}: ${f.val} (${f.chg})`).join(', ');
    const marketContext = markets.slice(0, 6).map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');
    const wisdom = FUTURES_WISDOM[Math.floor(Math.random() * FUTURES_WISDOM.length)];
    const portfolioBlock = portfolioContext ? `\n${portfolioContext}\n` : '';
    const conversationBlock = formatConversationHistory(conversationHistory);
    const detectedFutures = extractFutures(message);

    const prompt = `DATOS DE FUTUROS EN TIEMPO REAL:\n${futuresContext}\n\nÍNDICES GLOBALES:\n${marketContext}${portfolioBlock}${conversationBlock}\n${detectedFutures.length ? `ACTIVOS DETECTADOS: ${detectedFutures.join(', ')}\n` : ''}\nSABIDURÍA DEL DÍA: ${wisdom}\n\nCONSULTA DEL USUARIO: "${message}"\n\nResponde siguiendo la estructura de FUTURES MASTER AI. Sé específico con niveles de precio, stops y targets. Usa los datos de futuros en tiempo real proporcionados arriba.`;

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      system: FUTURES_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      const fallback = generateFallback(message);
      addConversationMessage(req.user?.id, 'ai', fallback);
      return res.json({
        response: fallback,
        wisdom,
        fallback: true,
      });
    }

    addConversationMessage(req.user?.id, 'ai', aiResponse.content[0].text);

    res.json({
      response: aiResponse.content[0].text,
      wisdom,
      portfolioAware: portfolioContext ? true : false,
      futuresDetected: detectedFutures.length > 0,
    });
  } catch (err) {
    logger.error(`Stockbroker chat error: ${err.message}`);
    const fallback = generateFallback(req.body?.message || '');
    addConversationMessage(req.user?.id, 'ai', fallback);
    res.json({
      response: fallback,
      error: err.message,
      fallback: true,
    });
  }
});

function generateFallback(message) {
  return `### ⚡ Análisis de Mercado

Basado en los principios de gestión de riesgo institucional:

### 📊 Evaluación Técnica
El mercado muestra condiciones mixtas. Recomiendo cautela hasta tener confirmación direccional clara.

### 🎯 Recomendación
**Dirección:** NEUTRAL por el momento
**Score:** N/A - Sin configuración clara
**Confianza:** Baja

### ⚠️ Riesgos
- Volatilidad inesperada por eventos macro
- Liquidez reducida en sesiones intradía
- Posibles gaps en aperturas de mercado

*Recuerda: "La preservación del capital es la regla número uno." — Ray Dalio*`;
}

module.exports = router;
