const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ queue: { concurrency: 2 }, suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const logger = require('./logger');

async function fetchHistoricalData(ticker, period = '3mo', interval = '1d') {
  try {
    const periodMap = { '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730 };
    const days = periodMap[period] || 90;
    const now = Math.floor(Date.now() / 1000);
    const period1 = now - days * 86400;

    const result = await yahooFinance.historical(ticker, { period1, period2: now, interval });
    if (!result || result.length < 20) {
      return null;
    }
    return result.filter(q => q.close != null).map(q => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }));
  } catch (err) {
    logger.error(`Failed to fetch historical data for ${ticker}: ${err.message}`);
    return null;
  }
}

function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      result.push(slice.reduce((sum, d) => sum + d.close, 0) / period);
    }
  }
  return result;
}

function calcEMA(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = data[0]?.close;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(ema);
    } else {
      ema = data[i].close * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function calcRSI(data, period = 14) {
  if (data.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

function calcMACD(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);

  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calcEMA(macdLine.map(v => ({ close: v })), signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);

  return {
    macd: Math.round(macdLine[macdLine.length - 1] * 1000) / 1000,
    signal: Math.round(signalLine[signalLine.length - 1] * 1000) / 1000,
    histogram: Math.round(histogram[histogram.length - 1] * 1000) / 1000,
  };
}

function calcBollingerBands(data, period = 20, stdDev = 2) {
  if (data.length < period) return null;

  const slice = data.slice(-period);
  const sma = slice.reduce((sum, d) => sum + d.close, 0) / period;
  const variance = slice.reduce((sum, d) => sum + Math.pow(d.close - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: Math.round((sma + stdDev * std) * 100) / 100,
    middle: Math.round(sma * 100) / 100,
    lower: Math.round((sma - stdDev * std) * 100) / 100,
    bandwidth: Math.round(((2 * stdDev * std) / sma) * 10000) / 100,
  };
}

function calcFibonacciLevels(data) {
  const prices = data.map(d => d.close);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const diff = high - low;

  return {
    high: Math.round(high * 100) / 100,
    low: Math.round(low * 100) / 100,
    levels: {
      '0%': Math.round(high * 100) / 100,
      '23.6%': Math.round((high - diff * 0.236) * 100) / 100,
      '38.2%': Math.round((high - diff * 0.382) * 100) / 100,
      '50%': Math.round((high - diff * 0.5) * 100) / 100,
      '61.8%': Math.round((high - diff * 0.618) * 100) / 100,
      '78.6%': Math.round((high - diff * 0.786) * 100) / 100,
      '100%': Math.round(low * 100) / 100,
    },
  };
}

function detectCandlestickPatterns(data) {
  if (data.length < 2) return [];
  const patterns = [];
  const last = data[data.length - 1];
  const prev = data[data.length - 2];

  const body = last.close - last.open;
  const prevBody = prev.close - prev.open;
  const upperShadow = last.high - Math.max(last.open, last.close);
  const lowerShadow = Math.min(last.open, last.close) - last.low;
  const range = last.high - last.low;

  if (Math.abs(body) < range * 0.1) {
    patterns.push({ name: 'Doji', type: 'neutral', signal: 'Indecisión en el mercado' });
  }

  if (lowerShadow > Math.abs(body) * 2 && upperShadow < Math.abs(body) * 0.5) {
    patterns.push({ name: 'Hammer', type: 'bullish', signal: 'Posible reversión alcista' });
  }

  if (upperShadow > Math.abs(body) * 2 && lowerShadow < Math.abs(body) * 0.5) {
    patterns.push({ name: 'Shooting Star', type: 'bearish', signal: 'Posible reversión bajista' });
  }

  if (prevBody < 0 && body > 0 && last.close > prev.open && last.open < prev.close) {
    patterns.push({ name: 'Bullish Engulfing', type: 'bullish', signal: 'Fuerza compradora significativa' });
  }

  if (prevBody > 0 && body < 0 && last.close < prev.open && last.open > prev.close) {
    patterns.push({ name: 'Bearish Engulfing', type: 'bearish', signal: 'Fuerza vendedora significativa' });
  }

  if (body > 0 && body > range * 0.7) {
    patterns.push({ name: 'Marubozu Alcista', type: 'bullish', signal: 'Tendencia alcista fuerte' });
  }

  if (body < 0 && Math.abs(body) > range * 0.7) {
    patterns.push({ name: 'Marubozu Bajista', type: 'bearish', signal: 'Tendencia bajista fuerte' });
  }

  return patterns;
}

function calcSupportResistance(data, lookback = 20) {
  const recent = data.slice(-lookback);
  const highs = recent.map(d => d.high);
  const lows = recent.map(d => d.low);

  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  return {
    resistance: Math.round(resistance * 100) / 100,
    support: Math.round(support * 100) / 100,
    pivot: Math.round(((resistance + support + data[data.length - 1].close) / 3) * 100) / 100,
  };
}

function calcVolumeAnalysis(data, period = 20) {
  if (data.length < period) return null;
  const recent = data.slice(-period);
  const avgVolume = recent.reduce((sum, d) => sum + (d.volume || 0), 0) / period;
  const currentVolume = data[data.length - 1].volume || 0;
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 0;

  return {
    currentVolume,
    avgVolume: Math.round(avgVolume),
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    unusual: volumeRatio > 2,
  };
}

function calcMomentum(data, period = 10) {
  if (data.length < period) return null;
  const current = data[data.length - 1].close;
  const past = data[data.length - period].close;
  const momentum = ((current - past) / past) * 100;

  return {
    value: Math.round(momentum * 100) / 100,
    direction: momentum > 0 ? 'bullish' : 'bearish',
  };
}

function generateSignal(indicators) {
  let score = 0;
  const signals = [];

  if (indicators.rsi !== null) {
    if (indicators.rsi < 30) { score += 2; signals.push('RSI sobrevendido (compra)'); }
    else if (indicators.rsi > 70) { score -= 2; signals.push('RSI sobrecomprado (venta)'); }
    else if (indicators.rsi < 45) { score += 1; signals.push('RSI neutro-bajo'); }
    else if (indicators.rsi > 55) { score -= 1; signals.push('RSI neutro-alto'); }
  }

  if (indicators.macd) {
    if (indicators.macd.histogram > 0 && indicators.macd.macd > indicators.macd.signal) {
      score += 2; signals.push('MACD cruce alcista');
    } else if (indicators.macd.histogram < 0 && indicators.macd.macd < indicators.macd.signal) {
      score -= 2; signals.push('MACD cruce bajista');
    }
  }

  if (indicators.bollinger) {
    const price = indicators.currentPrice;
    if (price <= indicators.bollinger.lower) { score += 2; signals.push('Precio en banda inferior Bollinger'); }
    else if (price >= indicators.bollinger.upper) { score -= 2; signals.push('Precio en banda superior Bollinger'); }
  }

  if (indicators.volume && indicators.volume.unusual) {
    signals.push(`Volumen inusual (${indicators.volume.volumeRatio}x promedio)`);
  }

  if (indicators.candlestick && indicators.candlestick.length > 0) {
    indicators.candlestick.forEach(p => {
      if (p.type === 'bullish') { score += 1; signals.push(`Patrón: ${p.name}`); }
      else if (p.type === 'bearish') { score -= 1; signals.push(`Patrón: ${p.name}`); }
    });
  }

  let recommendation = 'NEUTRAL';
  if (score >= 4) recommendation = 'COMPRA FUERTE';
  else if (score >= 2) recommendation = 'COMPRA';
  else if (score <= -4) recommendation = 'VENTA FUERTE';
  else if (score <= -2) recommendation = 'VENTA';

  return { score, recommendation, signals };
}

async function getTechnicalAnalysis(ticker) {
  const data = await fetchHistoricalData(ticker, '6mo', '1d');
  if (!data) return { error: 'No se pudieron obtener datos históricos', ticker };

  const currentPrice = data[data.length - 1].close;

  const sma20 = calcSMA(data, 20);
  const sma50 = calcSMA(data, 50);
  const sma200 = data.length >= 200 ? calcSMA(data, 200) : null;

  const rsi = calcRSI(data);
  const macd = calcMACD(data);
  const bollinger = calcBollingerBands(data);
  const fibonacci = calcFibonacciLevels(data);
  const candlestick = detectCandlestickPatterns(data);
  const supportResistance = calcSupportResistance(data);
  const volume = calcVolumeAnalysis(data);
  const momentum = calcMomentum(data);

  const indicators = {
    currentPrice: Math.round(currentPrice * 100) / 100,
    rsi,
    macd,
    bollinger,
    sma: {
      sma20: sma20[sma20.length - 1] ? Math.round(sma20[sma20.length - 1] * 100) / 100 : null,
      sma50: sma50[sma50.length - 1] ? Math.round(sma50[sma50.length - 1] * 100) / 100 : null,
      sma200: sma200 ? (sma200[sma200.length - 1] ? Math.round(sma200[sma200.length - 1] * 100) / 100 : null) : null,
    },
    fibonacci,
    candlestick,
    supportResistance,
    volume,
    momentum,
  };

  const signal = generateSignal(indicators);

  return {
    ticker,
    timestamp: new Date().toISOString(),
    currentPrice: indicators.currentPrice,
    indicators,
    signal,
  };
}

module.exports = {
  getTechnicalAnalysis,
  fetchHistoricalData,
  calcRSI,
  calcMACD,
  calcBollingerBands,
  calcFibonacciLevels,
  detectCandlestickPatterns,
  calcSupportResistance,
  calcVolumeAnalysis,
  calcSMA,
  calcEMA,
};
