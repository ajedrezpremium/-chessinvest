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

module.exports = { getTechnicalAnalysis, formatTechnicalContext, calcRSI, calcMACD, calcSMA, calcBollinger, findSupportResistance };