const { Router } = require('express');
const { callAI, callAIStream } = require('../services/aiProvider');
const { getAllIndices } = require('../services/marketDataService');
const { getFuturesData } = require('../services/futuresDataService');
const { getTechnicalAnalysis, formatTechnicalContext } = require('../services/technicalAnalysisService');
const { fetchEconomicCalendar, formatCalendarContext } = require('../services/economicCalendar');
const { optionalAuth } = require('../middleware/auth');
const { get, all, run } = require('../services/database');
const { saveDb } = require('../services/database');
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

const MAX_CONVERSATION_HISTORY = 20;

function getConversationHistory(userId) {
  if (!userId) return [];
  try {
    return all(
      "SELECT role, message FROM conversation_history WHERE user_id = ? AND agent = 'stockbroker' ORDER BY created_at ASC",
      [userId]
    );
  } catch (err) {
    logger.warn(`Failed to fetch conversation history: ${err.message}`);
    return [];
  }
}

function addConversationMessage(userId, role, message) {
  if (!userId) return;
  try {
    run(
      "INSERT INTO conversation_history (user_id, role, agent, message) VALUES (?, ?, 'stockbroker', ?)",
      [userId, role, message.substring(0, 500)]
    );
    // Keep only last N messages per user per agent
    const count = get(
      "SELECT COUNT(*) as cnt FROM conversation_history WHERE user_id = ? AND agent = 'stockbroker'",
      [userId]
    );
    if (count && count.cnt > MAX_CONVERSATION_HISTORY) {
      run(
        "DELETE FROM conversation_history WHERE id IN (SELECT id FROM conversation_history WHERE user_id = ? AND agent = 'stockbroker' ORDER BY created_at ASC LIMIT ?)",
        [userId, count.cnt - MAX_CONVERSATION_HISTORY]
      );
    }
    saveDb();
  } catch (err) {
    logger.warn(`Failed to save conversation message: ${err.message}`);
  }
}

function formatConversationHistory(history) {
  if (!history.length) return '';
  return '\nHISTORIAL RECIENTE:\n' + history.map((m, i) => `${i + 1}. ${m.role === 'user' ? 'Tú' : 'AI'}: ${m.message.substring(0, 200)}${m.message.length > 200 ? '...' : ''}`).join('\n') + '\n';
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
6. Usa el CALENDARIO ECONÓMICO proporcionado para contextualizar tu análisis. Eventos como Fed, CPI, NFP pueden cambiar la dirección del mercado drásticamente.
7. Si hay un evento HIGH impact cerca (🔴 HOY o ⚠️ MAÑANA), recomienda cautela y ajusta stops.

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

const FUTURES_TO_SYMBOL = {
  'ES': 'ES=F', 'NQ': 'NQ=F', 'RTY': 'RTY=F', 'YM': 'YM=F',
  'CL': 'CL=F', 'GC': 'GC=F', 'SI': 'SI=F', 'HG': 'HG=F',
  'NG': 'NG=F', 'ZB': 'ZB=F', 'ZN': 'ZN=F',
  '6E': '6E=F', '6B': '6B=F', '6J': '6J=F',
  'VIX': '^VIX', 'DXY': 'DX-Y.NYB',
};

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    const detectedFutures = extractFutures(message);
    const taSymbols = detectedFutures.map(t => FUTURES_TO_SYMBOL[t]).filter(Boolean);

    const [futures, markets, portfolioContext, calendar, ...taResults] = await Promise.all([
      getFuturesData(),
      getAllIndices(),
      getUserPortfolioContext(req.user?.id),
      fetchEconomicCalendar(),
      ...taSymbols.map(sym => getTechnicalAnalysis(sym)),
    ]);

    const conversationHistory = getConversationHistory(req.user?.id);
    addConversationMessage(req.user?.id, 'user', message);

    const futuresContext = futures.map(f => `${f.name}: ${f.val} (${f.chg})`).join(', ');
    const marketContext = markets.slice(0, 6).map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');
    const wisdom = FUTURES_WISDOM[Math.floor(Math.random() * FUTURES_WISDOM.length)];
    const portfolioBlock = portfolioContext ? `\n${portfolioContext}\n` : '';
    const conversationBlock = formatConversationHistory(conversationHistory);
    const techBlock = taResults.filter(Boolean).map(ta => `ANÁLISIS TÉCNICO REAL (${ta.symbol}):\n${formatTechnicalContext(ta)}`).join('\n\n');
    const calendarBlock = formatCalendarContext(calendar);

    const prompt = `DATOS DE FUTUROS EN TIEMPO REAL:\n${futuresContext}\n\nÍNDICES GLOBALES:\n${marketContext}${portfolioBlock}${conversationBlock}\n${detectedFutures.length ? `ACTIVOS DETECTADOS: ${detectedFutures.join(', ')}\n` : ''}${techBlock ? '\n' + techBlock + '\n' : ''}${calendarBlock ? calendarBlock + '\n' : ''}SABIDURÍA DEL DÍA: ${wisdom}\n\nCONSULTA DEL USUARIO: "${message}"\n\nResponde siguiendo la estructura de FUTURES MASTER AI. Usa los datos de ANÁLISIS TÉCNICO REAL (RSI, MACD, SMA, Bollinger) para tus cálculos. Sé específico con niveles de precio, stops y targets. El CALENDARIO ECONÓMICO arriba muestra los eventos macro que impactan los mercados. Tenlos en cuenta en tu análisis.`;

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

    const autoSignal = extractSignalFromResponse(aiResponse.content[0].text, detectedFutures);
    let signalId = null;
    if (autoSignal) {
      signalId = await autoSaveSignal(req.user?.id, autoSignal);
    }

    res.json({
      response: aiResponse.content[0].text,
      wisdom,
      portfolioAware: portfolioContext ? true : false,
      futuresDetected: detectedFutures.length > 0,
      technicalAnalysis: taResults.filter(Boolean).map(ta => ({
        symbol: ta.symbol,
        rsi: ta.rsi,
        macd: ta.macd?.macd,
        sma20: ta.sma?.sma20,
        sma50: ta.sma?.sma50,
      })),
      autoSignal: autoSignal ? { ...autoSignal, id: signalId } : null,
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

router.post('/chat/stream', optionalAuth, async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const detectedFutures = extractFutures(message);
  const taSymbols = detectedFutures.map(t => FUTURES_TO_SYMBOL[t]).filter(Boolean);

  const [futures, markets, portfolioContext, calendar, ...taResults] = await Promise.all([
    getFuturesData(),
    getAllIndices(),
    getUserPortfolioContext(req.user?.id),
    fetchEconomicCalendar(),
    ...taSymbols.map(sym => getTechnicalAnalysis(sym)),
  ]);

  addConversationMessage(req.user?.id, 'user', message);

  const futuresContext = futures.map(f => `${f.name}: ${f.val} (${f.chg})`).join(', ');
  const marketContext = markets.slice(0, 6).map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');
  const wisdom = FUTURES_WISDOM[Math.floor(Math.random() * FUTURES_WISDOM.length)];
  const portfolioBlock = portfolioContext ? `\n${portfolioContext}\n` : '';
  const conversationHistory = getConversationHistory(req.user?.id);
  const conversationBlock = formatConversationHistory(conversationHistory);
  const techBlock = taResults.filter(Boolean).map(ta => `ANÁLISIS TÉCNICO REAL (${ta.symbol}):\n${formatTechnicalContext(ta)}`).join('\n\n');
  const calendarBlock = formatCalendarContext(calendar);

  const prompt = `DATOS DE FUTUROS EN TIEMPO REAL:\n${futuresContext}\n\nÍNDICES GLOBALES:\n${marketContext}${portfolioBlock}${conversationBlock}\n${detectedFutures.length ? `ACTIVOS DETECTADOS: ${detectedFutures.join(', ')}\n` : ''}${techBlock ? '\n' + techBlock + '\n' : ''}${calendarBlock ? calendarBlock + '\n' : ''}SABIDURÍA DEL DÍA: ${wisdom}\n\nCONSULTA DEL USUARIO: "${message}"\n\nResponde siguiendo la estructura de FUTURES MASTER AI. Usa los datos de ANÁLISIS TÉCNICO REAL (RSI, MACD, SMA, Bollinger) para tus cálculos. Sé específico con niveles de precio, stops y targets. El CALENDARIO ECONÓMICO arriba muestra los eventos macro que impactan los mercados. Tenlos en cuenta en tu análisis.`;

  const aiPayload = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    temperature: 0.7,
    system: FUTURES_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  };

  let fullText = '';

  const wisdomSent = `data: ${JSON.stringify({ type: 'wisdom', wisdom })}\n\n`;
  res.write(wisdomSent);

  await callAIStream(aiPayload,
    (token) => {
      fullText += token;
      res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
    },
    async (result) => {
      if (result?.content?.[0]?.text) {
        addConversationMessage(req.user?.id, 'ai', result.content[0].text);

        const autoSignal = extractSignalFromResponse(result.content[0].text, detectedFutures);
        let signalId = null;
        if (autoSignal) {
          signalId = await autoSaveSignal(req.user?.id, autoSignal);
        }

        res.write(`data: ${JSON.stringify({
          type: 'done',
          wisdom,
          autoSignal: autoSignal ? { ...autoSignal, id: signalId } : null,
          technicalAnalysis: taResults.filter(Boolean).map(ta => ({
            symbol: ta.symbol, rsi: ta.rsi, macd: ta.macd?.macd, sma20: ta.sma?.sma20, sma50: ta.sma?.sma50,
          })),
        })}\n\n`);
      }
      res.end();
    }
  );
});

router.get('/signals', optionalAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const signals = await all('SELECT * FROM signal_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [req.user?.id || 0, limit]);
    res.json({ signals });
  } catch (err) {
    logger.error(`Signal history error: ${err.message}`);
    res.json({ signals: [] });
  }
});

router.post('/signals', optionalAuth, async (req, res) => {
  try {
    const { asset, direction, entry_price, stop_loss, take_profit, score, confidence, risk_reward, rationale } = req.body;
    if (!asset || !direction) return res.status(400).json({ error: 'Asset and direction required' });
    const result = await run(
      'INSERT INTO signal_history (user_id, agent, asset, direction, entry_price, stop_loss, take_profit, score, confidence, risk_reward, rationale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user?.id || 0, 'stockbroker', asset.toUpperCase(), direction, entry_price || null, stop_loss || null, take_profit || null, score || null, confidence || null, risk_reward || null, rationale || null]
    );
    res.status(201).json({ id: result.lastID });
  } catch (err) {
    logger.error(`Signal save error: ${err.message}`);
    res.status(500).json({ error: 'Failed to save signal' });
  }
});

function extractSignalFromResponse(text, detectedTickers) {
  try {
    const upper = text.toUpperCase();
    const hasDirection = upper.includes('LARGO') || upper.includes('CORTO');
    if (!hasDirection) return null;

    const dir = upper.includes('LARGO') ? (upper.includes('CORTO') ? 'NEUTRAL' : 'LARGO') : 'CORTO';
    if (dir === 'NEUTRAL') return null;

    const assetMatch = detectedTickers?.[0] || text.match(/[A-Z]{2,4}/)?.[0] || 'FUTURO';
    const entryMatch = text.match(/Entrada[:\s]*\$?([\d,]+\.?\d*)/i);
    const stopMatch = text.match(/Stop Loss[:\s]*\$?([\d,]+\.?\d*)/i);
    const tpMatches = [...text.matchAll(/Take Profit\s*\d*[:\s]*\$?([\d,]+\.?\d*)/gi)];
    const rrMatch = text.match(/Ratio\s*R\/R[:\s]*(\d+\.?\d*):/i);
    const scoreMatch = text.match(/Score[^:]*:\s*(\d+)/i);
    const confMatch = text.match(/Confianza[^:]*:\s*(\d+)/i);
    const lines = text.split('\n').filter(l => l.trim());
    const rationale = lines.slice(0, 3).join(' ').substring(0, 300);

    return {
      asset: assetMatch,
      direction: dir,
      entry_price: entryMatch ? entryMatch[1].replace(/,/g, '') : null,
      stop_loss: stopMatch ? stopMatch[1].replace(/,/g, '') : null,
      take_profit: tpMatches.length > 0 ? tpMatches.map(m => m[1].replace(/,/g, '')).join(', ') : null,
      score: scoreMatch ? parseInt(scoreMatch[1]) : null,
      confidence: confMatch ? parseInt(confMatch[1]) : null,
      risk_reward: rrMatch ? `${rrMatch[1]}:1` : null,
      rationale: rationale || null,
    };
  } catch (err) {
    logger.warn(`Signal extraction error: ${err.message}`);
    return null;
  }
}

async function autoSaveSignal(userId, signal) {
  if (!signal || !signal.direction) return null;
  try {
    const result = await run(
      `INSERT INTO signal_history (user_id, agent, asset, direction, entry_price, stop_loss, take_profit, score, confidence, risk_reward, rationale)
       VALUES (?, 'stockbroker', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId || 0, signal.asset, signal.direction, signal.entry_price, signal.stop_loss,
       signal.take_profit, signal.score, signal.confidence, signal.risk_reward, signal.rationale]
    );
    saveDb();
    logger.info(`Auto-signal saved: ${signal.direction} ${signal.asset} (id=${result.lastID})`);
    return result.lastID;
  } catch (err) {
    logger.warn(`Auto-signal save failed: ${err.message}`);
    return null;
  }
}

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
module.exports.extractSignalFromResponse = extractSignalFromResponse;
module.exports.autoSaveSignal = autoSaveSignal;
