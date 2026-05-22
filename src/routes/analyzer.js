const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getAllIndices } = require('../services/marketDataService');
const { getMultiModalAnalysis, buildMultiModalPrompt } = require('../services/multiModalAnalysis');
const { optionalAuth } = require('../middleware/auth');
const { get, all } = require('../services/database');
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

const TICKER_PATTERN = /\b([A-Z]{1,5})\b/g;
const BACKTEST_PATTERN = /\b(200[0-8]|201[0-9]|202[0-5]|crisis|pandemia|burbuja|recesión|crash)\b/gi;
const DEBATE_PATTERN = /\b(debate|discutir|abogado del diablo|contrario|en contra|defiende|refuta|cuestiona|opinas que|estoy equivocado|tienes razón)\b/gi;

function detectBacktestQuery(message) {
  return BACKTEST_PATTERN.test(message);
}

function detectDebateQuery(message) {
  return DEBATE_PATTERN.test(message.toLowerCase());
}

const HISTORICAL_EVENTS = {
  '2000': 'Burbuja puntocom - NASDAQ cayó 78%',
  '2001': 'Post-burbuja puntocom, ataques 11S',
  '2008': 'Crisis financiera global - S&P 500 cayó 57%',
  '2010': 'Flash Crash - caída instantánea del 9%',
  '2015': 'Crack chino - devaluación del yuan',
  '2018': 'Volmageddon - VIX explosión, corrección del 10%',
  '2020': 'Pandemia COVID-19 - crash del 34% en marzo, recuperación récord',
  '2022': 'Bear market por inflación y subida de tipos - S&P 500 cayó 25%',
  'crisis': 'Período de crisis financiera',
  'pandemia': 'COVID-19 (2020) - mercado cayó 34% y recuperó',
  'burbuja': 'Burbuja puntocom (2000) o inmobiliaria (2008)',
  'recesión': 'Período de recesión económica',
  'crash': 'Crash bursátil significativo',
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
  return '\nHISTORIAL DE CONVERSACIÓN RECIENTE:\n' + history.map((m, i) => `${i + 1}. ${m.role === 'user' ? 'Tú' : 'AI'}: ${m.message.substring(0, 150)}${m.message.length > 150 ? '...' : ''}`).join('\n') + '\n';
}

function extractTicker(message) {
  const commonTickers = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','JNJ','WMT','PG','MA','UNH','HD','DIS','BAC','XOM','PFE','CSCO','INTC','NFLX','PYPL','AMD','CRM','ADBE','KO','PEP','MRK','ABT','AVGO','LLY','TMO','COST','NKE','MCD','ACN','TXN','QCOM','DHR','NEE','LIN','UNP','PM','HON','IBM','INTU','SBUX','GE','CAT','BA','GS','MS','AXP','BLK','SPGI','ISRG','AMGN','NOW','DE','LOW','BKNG','TJX','SYK','ZTS','REGN','VRTX','MDLZ','ADI','GILD','CVS','MU','LRCX','KLAC','AMAT','SNPS','CDNS','MELI','ABNB','UBER','SHOP','SQ','RBLX','COIN','PLTR','SNOW','NET','DDOG','CRWD','PANW','MRVL','ON','FTNT','WDAY','TEAM','DDOG','SNOW','NET','CRWD','PANW','MRVL','FTNT','WDAY','TEAM','SAN','BBVA','IBE','TEF','ITX','REP','MC','FER','AMS','AENA','GRF','IAG','CABK','SAB','MAP','SLR','CLNX','COLT','ELE','ENG','REE','ACS','FCC','FER','ACC','OHL','NEO','NTGY','VIS','RED','SOL','EAE','MRL','COL','TUB','ZEL','SGRE','ALM','GAM','NTG','COL','TRE','ELE','ENG','REE','ACS','FCC','FER','ACC','OHL','NEO','NTGY','VIS','RED','SOL','EAE','MRL','COL','TUB','ZEL','SGRE','ALM','GAM','NTG','COL','TRE'];
  const matches = message.toUpperCase().match(TICKER_PATTERN) || [];
  for (const m of matches) {
    if (commonTickers.includes(m) && m.length >= 2 && m.length <= 5) return m;
  }
  return null;
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
      portfolio.forEach(p => {
        context += `- ${p.ticker}: ${p.shares} acciones (precio medio: $${p.avg_price})\n`;
      });
      context += '\n';
    }
    if (watchlist?.length) {
      context += 'TU WATCHLIST:\n';
      watchlist.forEach(w => {
        context += `- ${w.ticker}\n`;
      });
      context += '\n';
    }
    return context;
  } catch (err) {
    logger.warn(`Failed to fetch portfolio context: ${err.message}`);
    return null;
  }
}

async function getProactiveAlerts(userId, marketData) {
  if (!userId) return [];
  try {
    const portfolio = await all('SELECT ticker, shares, avg_price FROM portfolio WHERE user_id = ?', [userId]);
    const watchlist = await all('SELECT ticker FROM watchlist WHERE user_id = ?', [userId]);
    const tickers = [...(portfolio || []).map(p => p.ticker), ...(watchlist || []).map(w => w.ticker)];
    if (!tickers.length) return [];

    const alerts = [];
    const upIndices = marketData.filter(m => m.dir === 'up');
    const downIndices = marketData.filter(m => m.dir === 'down');

    if (downIndices.length > marketData.length * 0.6) {
      alerts.push({ type: 'macro', level: 'warning', message: '⚠️ Mayoría de índices en negativo. Considera revisar stop-loss en tu portfolio.' });
    }

    if (upIndices.length > marketData.length * 0.7) {
      alerts.push({ type: 'macro', level: 'opportunity', message: '📈 Ambiente de mercado positivo. Buen momento para evaluar nuevas entradas.' });
    }

    return alerts;
  } catch (err) {
    logger.warn(`Failed to generate proactive alerts: ${err.message}`);
    return [];
  }
}

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    const markets = await getAllIndices();
    const marketContext = markets.slice(0, 6).map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');
    const wisdom = INVESTMENT_WISDOM[Math.floor(Math.random() * INVESTMENT_WISDOM.length)];

    const ticker = extractTicker(message);
    const isBacktest = detectBacktestQuery(message);
    const isDebate = detectDebateQuery(message);
    const portfolioContext = await getUserPortfolioContext(req.user?.id);
    const proactiveAlerts = await getProactiveAlerts(req.user?.id, markets);
    const conversationHistory = getConversationHistory(req.user?.id);

    addConversationMessage(req.user?.id, 'user', message);

    let historicalContext = '';
    if (isBacktest) {
      const matches = message.toUpperCase().match(BACKTEST_PATTERN) || [];
      const events = matches.map(m => {
        const key = m.toLowerCase();
        return HISTORICAL_EVENTS[key] || `Evento histórico: ${m}`;
      });
      if (events.length) {
        historicalContext = `\nCONTEXTO HISTÓRICO PARA BACKTEST:\n${events.join('\n')}\n\nInstrucción: Responde como un análisis retrospectivo. Explica cómo habría funcionado la estrategia o inversión en ese período histórico. Incluye datos concretos de rendimiento.`;
      }
    }

    let debateContext = '';
    if (isDebate) {
      debateContext = `\n🎭 MODO DEBATE ACTIVADO: El usuario quiere que juegues al "abogado del diablo". Cuestiona su tesis de inversión con argumentos sólidos y datos. Presenta el caso contrario al que él defiende. Sé respetuoso pero implacable con los argumentos débiles. Usa datos reales para refutar.`;
    }

    let prompt, systemPrompt;

    if (ticker) {
      const multiModal = await getMultiModalAnalysis(ticker);
      const conversationBlock = formatConversationHistory(conversationHistory);
      prompt = buildMultiModalPrompt(ticker, multiModal, message, portfolioContext, proactiveAlerts, conversationBlock, historicalContext, debateContext);
      systemPrompt = 'Eres ChessInvest Amigo, un amigo experto en inversiones con capacidades de análisis multi-modal (fundamental, técnico, sentimiento, macro). Conversacional, sabio, directo. Integra todas las dimensiones en tus respuestas. Si el usuario tiene portfolio, considera cómo la acción analizada afecta su diversificación y riesgo. Si hay alertas proactivas, menciónalas al inicio de tu respuesta. Si hay historial de conversación, referencia preguntas anteriores para construir sobre ellas. Si hay contexto histórico de backtest, responde como un análisis retrospectivo con datos concretos. Si hay modo debate activado, juega al abogado del diablo con argumentos sólidos.';
    } else {
      const portfolioBlock = portfolioContext ? `\n${portfolioContext}\n` : '';
      const alertsBlock = proactiveAlerts.length > 0 ? `\n🚨 ALERTAS PROACTIVAS:\n${proactiveAlerts.map(a => `- ${a.message}`).join('\n')}\n` : '';
      const conversationBlock = formatConversationHistory(conversationHistory);
      const backtestBlock = historicalContext || '';
      const debateBlock = debateContext || '';
      prompt = `Eres "ChessInvest Amigo", un amigo íntimo que es experto en inversiones. Tu estilo es cercano, sabio y directo, como hablar con Warren Buffett tomando un café.${portfolioBlock}${alertsBlock}${conversationBlock}${backtestBlock}${debateBlock}
CONTEXTO DE MERCADO: ${marketContext}

SABIDURÍA DEL DÍA: ${wisdom}

PREGUNTA DEL USUARIO: "${message}"

Responde en español, de forma conversacional pero profesional. Incluye:

### 🧠 Mi Razonamiento
[Explica PASO A PASO cómo llegaste a tu conclusión. Muestra tu proceso de pensamiento.]

### 📊 Respuesta
[Tu respuesta directa y consejo práctico]

### ⚠️ Riesgos
[2-3 riesgos o consideraciones importantes]

1. Una respuesta directa a su pregunta
2. Un consejo práctico basado en la sabiduría de grandes inversores
3. Contexto del mercado actual si es relevante
4. Si el usuario tiene portfolio, considera cómo tu consejo afecta sus holdings
5. Una pregunta de seguimiento para mantener la conversación

IMPORTANTE: Si generas formularios HTML interactivos (checkboxes, radios, etc), NUNCA incluyas etiquetas <form> o HTML interactivo. En su lugar, usa listas con checkboxes simples que el usuario pueda marcar mentalmente. Si debes generar HTML interactivo, asegúrate de incluir siempre un botón para cerrar.

Sé cálido pero honesto sobre riesgos. Nunca des consejos específicos de compra/venta.`;
      systemPrompt = 'Eres ChessInvest Amigo, un amigo experto en inversiones. Conversacional, sabio, directo. Si el usuario tiene portfolio, considera sus holdings en tus respuestas.';
    }

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.8,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      const fallback = generateChatFallback(message);
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
      multiModal: ticker ? true : false,
      portfolioAware: portfolioContext ? true : false,
      proactiveAlerts: proactiveAlerts.length > 0 ? proactiveAlerts : null,
      conversationAware: conversationHistory.length > 0 ? true : false,
      backtest: isBacktest ? true : false,
      debate: isDebate ? true : false,
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
