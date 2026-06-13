const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ queue: { concurrency: 2 }, suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const logger = require('./logger');
const { cache } = require('./cache');

const CACHE_TTL_MS = 5 * 60 * 1000;

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  const recent = changes.slice(-period);
  const gains = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = recent.filter(c => c < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Math.round(100 - (100 / (1 + rs)));
}

function calcMACD(prices) {
  if (prices.length < 26) return null;
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (ema12 === null || ema26 === null) return null;
  const macdLine = ema12 - ema26;
  const signal = calcEMA(prices.map((_, i) => {
    const e12 = calcEMA(prices.slice(0, i + 1), 12);
    const e26 = calcEMA(prices.slice(0, i + 1), 26);
    return e12 !== null && e26 !== null ? e12 - e26 : null;
  }).filter(v => v !== null), 9);
  return {
    macd: Math.round(macdLine * 100) / 100,
    signal: signal !== null ? Math.round(signal * 100) / 100 : null,
    histogram: signal !== null ? Math.round((macdLine - signal) * 100) / 100 : null,
  };
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcBollinger(prices, period = 20) {
  if (prices.length < period) return null;
  const sma = calcSMA(prices, period);
  if (sma === null) return null;
  const recent = prices.slice(-period);
  const variance = recent.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return {
    upper: Math.round((sma + 2 * stdDev) * 100) / 100,
    middle: Math.round(sma * 100) / 100,
    lower: Math.round((sma - 2 * stdDev) * 100) / 100,
  };
}

function findSupportResistance(quotes) {
  if (quotes.length < 50) return { support: null, resistance: null };
  const highs = quotes.map(q => q.high);
  const lows = quotes.map(q => q.low);
  const recent = quotes.slice(-20);
  const resistance = Math.max(...recent.map(q => q.high));
  const support = Math.min(...recent.map(q => q.low));
  return {
    support: Math.round(support * 100) / 100,
    resistance: Math.round(resistance * 100) / 100,
  };
}

async function getTechnicalAnalysis(symbol, interval = '1d', range = '6mo') {
  const cacheKey = `ta:${symbol}:${interval}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - 6);
    const result = await yahooFinance.chart(symbol, {
      period1: period1.toISOString().split('T')[0],
      interval,
    });

    if (!result || !result.quotes || result.quotes.length < 30) {
      logger.warn(`TA: insufficient data for ${symbol}`);
      return null;
    }

    const quotes = result.quotes.filter(q => q.close !== null && q.close !== undefined);
    if (quotes.length < 30) return null;

    const closes = quotes.map(q => q.close);
    const currentPrice = closes[closes.length - 1];
    const prevClose = closes.length > 1 ? closes[closes.length - 2] : currentPrice;

    const analysis = {
      symbol,
      currentPrice,
      change: currentPrice - prevClose,
      changePercent: ((currentPrice - prevClose) / prevClose) * 100,
      sma: {
        sma20: calcSMA(closes, 20),
        sma50: calcSMA(closes, 50),
        sma100: calcSMA(closes, 100),
        sma200: closes.length >= 200 ? calcSMA(closes, 200) : null,
      },
      rsi: calcRSI(closes),
      macd: calcMACD(closes),
      bollinger: calcBollinger(closes),
      supportResistance: findSupportResistance(quotes),
      volume: quotes[quotes.length - 1]?.volume || 0,
      avgVolume: Math.round(quotes.slice(-20).reduce((s, q) => s + (q.volume || 0), 0) / 20),
      high52w: Math.max(...quotes.map(q => q.high)),
      low52w: Math.min(...quotes.filter(q => q.low).map(q => q.low)),
      dataPoints: quotes.length,
      lastUpdated: new Date().toISOString(),
    };

    cache.set(cacheKey, analysis, CACHE_TTL_MS);
    return analysis;
  } catch (err) {
    logger.warn(`Technical analysis failed for ${symbol}: ${err.message}`);
    return null;
  }
}

function formatTechnicalContext(analysis) {
  if (!analysis) return '';
  const { sma, rsi, macd, bollinger, supportResistance } = analysis;
  let lines = [
    `Precio Actual: $${analysis.currentPrice} (${analysis.change >= 0 ? '+' : ''}${analysis.changePercent?.toFixed(2)}%)`,
    `RSI(14): ${rsi ?? 'N/A'} ${rsi !== null && rsi < 30 ? '⚠️ SOBREVENDIDO' : rsi > 70 ? '⚠️ SOBRECOMPRADO' : ''}`,
    `SMA20: ${sma?.sma20 !== null ? '$' + sma.sma20.toFixed(2) : 'N/A'}`,
    `SMA50: ${sma?.sma50 !== null ? '$' + sma.sma50.toFixed(2) : 'N/A'}`,
    `SMA100: ${sma?.sma100 !== null ? '$' + sma.sma100.toFixed(2) : 'N/A'}`,
    sma?.sma200 !== null ? `SMA200: $${sma.sma200.toFixed(2)}` : null,
    `MACD: ${macd?.macd ?? 'N/A'} (Signal: ${macd?.signal ?? 'N/A'}, Histograma: ${macd?.histogram ?? 'N/A'})`,
    `Bollinger: Upper $${bollinger?.upper ?? 'N/A'} / Middle $${bollinger?.middle ?? 'N/A'} / Lower $${bollinger?.lower ?? 'N/A'}`,
    `Soporte: $${supportResistance?.support ?? 'N/A'} | Resistencia: $${supportResistance?.resistance ?? 'N/A'}`,
    `Volumen: ${analysis.volume?.toLocaleString() || 'N/A'} (Media 20d: ${analysis.avgVolume?.toLocaleString() || 'N/A'})`,
    `Máx 52 sem: $${analysis.high52w?.toLocaleString() || 'N/A'} | Mín 52 sem: $${analysis.low52w?.toLocaleString() || 'N/A'}`,
  ].filter(Boolean);

  return lines.join('\n');
}

const TIMEFRAMES = [
  { name: '1m', interval: '1m', range: '1d', bars: 390, label: '1 minuto' },
  { name: '5m', interval: '5m', range: '5d', bars: 390, label: '5 minutos' },
  { name: '15m', interval: '15m', range: '10d', bars: 390, label: '15 minutos' },
  { name: '1h', interval: '1h', range: '1mo', bars: 200, label: '1 hora' },
  { name: '4h', interval: '1h', range: '1mo', bars: 200, label: '4 horas' },
  { name: '1d', interval: '1d', range: '6mo', bars: 130, label: '1 día' },
  { name: '1w', interval: '1wk', range: '2y', bars: 104, label: '1 semana' },
];

function detectTimeframe(message) {
  const upper = message.toUpperCase();
  if (/\b(1M|1\s*MIN|MINUTO)\b/.test(upper)) return '1m';
  if (/\b(5M|5\s*MIN)\b/.test(upper)) return '5m';
  if (/\b(15M|15\s*MIN)\b/.test(upper)) return '15m';
  if (/\b(1H|1\s*HORA|HORARIO)\b/.test(upper)) return '1h';
  if (/\b(4H|4\s*HORA)\b/.test(upper)) return '4h';
  if (/\b(SEMANAL|WEEK|1W)\b/.test(upper)) return '1w';
  if (/\b(INTRADIA|SCALP|RAPIDO)\b/.test(upper)) return '5m';
  if (/\b(MEDIO\s*PLAZO|MEDIOPLAZO|SWING)\b/.test(upper)) return '4h';
  if (/\b(LARGO\s*PLAZO|LARGOPLAZO|POSICIONAL|ESTRUCTURAL)\b/.test(upper)) return '1d';
  return '1d';
}

async function getMultiTimeframeAnalysis(symbol, userMessage = '') {
  const tfName = detectTimeframe(userMessage);
  const tfConfig = TIMEFRAMES.find(t => t.name === tfName) || TIMEFRAMES.find(t => t.name === '1d');

  const primary = await getTechnicalAnalysis(symbol, tfConfig.interval, tfConfig.range);

  const contextTfs = ['1d', '4h', '1h'].filter(t => t !== tfName).slice(0, 2);
  const contextResults = await Promise.all(
    contextTfs.map(tf => {
      const cfg = TIMEFRAMES.find(t => t.name === tf);
      return getTechnicalAnalysis(symbol, cfg.interval, cfg.range);
    })
  );

  const contextMap = {};
  contextTfs.forEach((tf, i) => { contextMap[tf] = contextResults[i]; });

  return {
    primary: { ...primary, timeframe: tfName, timeframeLabel: tfConfig.label },
    context: contextMap,
    availableTimeframes: TIMEFRAMES.filter(t => t.name !== tfName).map(t => t.name),
  };
}

function formatMultiTimeframeContext(mta) {
  if (!mta?.primary) return '';

  const p = mta.primary;
  let text = `📊 ANÁLISIS MULTI-TIMEFRAME (${p.timeframeLabel}):\n`;
  text += `${formatTechnicalContext(p)}\n`;

  for (const [tf, ta] of Object.entries(mta.context || {})) {
    if (!ta) continue;
    const tfLabel = TIMEFRAMES.find(t => t.name === tf)?.label || tf;
    text += `\n--- Contexto ${tfLabel} ---\n`;
    text += `RSI: ${ta.rsi ?? 'N/A'} | SMA20: ${ta.sma?.sma20 !== null ? '$' + ta.sma.sma20.toFixed(2) : 'N/A'} | SMA50: ${ta.sma?.sma50 !== null ? '$' + ta.sma.sma50.toFixed(2) : 'N/A'}\n`;
    text += `MACD: ${ta.macd?.macd ?? 'N/A'} | Bollinger U: $${ta.bollinger?.upper ?? 'N/A'} L: $${ta.bollinger?.lower ?? 'N/A'}\n`;
  }

  return text;
}

module.exports = {
  getTechnicalAnalysis, formatTechnicalContext, getMultiTimeframeAnalysis, formatMultiTimeframeContext,
  calcRSI, calcMACD, calcSMA, calcBollinger, findSupportResistance, detectTimeframe,
};