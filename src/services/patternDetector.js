function detectEngulfing(quotes) {
  if (quotes.length < 2) return null;
  const prev = quotes[quotes.length - 2];
  const curr = quotes[quotes.length - 1];
  const prevBearish = prev.close < prev.open;
  const prevBullish = prev.close > prev.open;
  if (prevBearish && curr.close > curr.open && curr.close > prev.open && curr.open < prev.close) {
    return { pattern: 'Engulfing Alcista', direction: 'bullish', strength: 3 };
  }
  if (prevBullish && curr.close < curr.open && curr.close < prev.open && curr.open > prev.close) {
    return { pattern: 'Engulfing Bajista', direction: 'bearish', strength: 3 };
  }
  return null;
}

function detectDoji(quotes) {
  if (quotes.length < 1) return null;
  const curr = quotes[quotes.length - 1];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  if (range === 0) return null;
  if (body / range < 0.1) {
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    if (lowerWick > range * 0.3 && upperWick < range * 0.1) {
      return { pattern: 'Doji Dragonfly', direction: 'bullish', strength: 2 };
    }
    if (upperWick > range * 0.3 && lowerWick < range * 0.1) {
      return { pattern: 'Doji Gravestone', direction: 'bearish', strength: 2 };
    }
    return { pattern: 'Doji', direction: 'neutral', strength: 1 };
  }
  return null;
}

function detectHammer(quotes) {
  if (quotes.length < 1) return null;
  const curr = quotes[quotes.length - 1];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  if (range === 0) return null;
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  if (lowerWick >= range * 0.6 && upperWick <= range * 0.1 && body <= range * 0.3) {
    return { pattern: 'Hammer', direction: 'bullish', strength: 2 };
  }
  if (lowerWick >= range * 0.6 && upperWick <= range * 0.1 && body <= range * 0.3 && curr.close > curr.open) {
    return { pattern: 'Hammer (Shooting Star)', direction: 'bullish', strength: 2 };
  }
  return null;
}

function detectShootingStar(quotes) {
  if (quotes.length < 1) return null;
  const curr = quotes[quotes.length - 1];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  if (range === 0) return null;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  if (upperWick >= range * 0.6 && lowerWick <= range * 0.1 && body <= range * 0.3) {
    return { pattern: 'Shooting Star', direction: 'bearish', strength: 2 };
  }
  return null;
}

function detectDoubleTop(quotes) {
  if (quotes.length < 60) return null;
  const recent = quotes.slice(-40);
  const highs = recent.map((q, i) => ({ high: q.high, i }));
  const peak1 = highs.slice(0, Math.floor(highs.length / 2)).sort((a, b) => b.high - a.high)[0];
  const peak2 = highs.slice(Math.floor(highs.length / 2)).sort((a, b) => b.high - a.high)[0];
  if (!peak1 || !peak2) return null;
  const diff = Math.abs(peak1.high - peak2.high);
  const midpoint = recent.reduce((s, q) => s + q.low, 0) / recent.length;
  const neckline = Math.min(...recent.map(q => q.low));
  if (diff / peak1.high < 0.03 && peak1.high > midpoint * 1.05 && peak2.high > midpoint * 1.05) {
    return {
      pattern: 'Double Top',
      direction: 'bearish',
      strength: 3,
      firstPeak: peak1.high,
      secondPeak: peak2.high,
      neckline,
      target: neckline - (peak1.high - neckline),
    };
  }
  return null;
}

function detectDoubleBottom(quotes) {
  if (quotes.length < 60) return null;
  const recent = quotes.slice(-40);
  const lows = recent.map((q, i) => ({ low: q.low, i }));
  const valley1 = lows.slice(0, Math.floor(lows.length / 2)).sort((a, b) => a.low - b.low)[0];
  const valley2 = lows.slice(Math.floor(lows.length / 2)).sort((a, b) => a.low - b.low)[0];
  if (!valley1 || !valley2) return null;
  const diff = Math.abs(valley1.low - valley2.low);
  const midpoint = recent.reduce((s, q) => s + q.high, 0) / recent.length;
  const neckline = Math.max(...recent.map(q => q.high));
  if (diff / valley1.low < 0.03 && valley1.low < midpoint * 0.95 && valley2.low < midpoint * 0.95) {
    return {
      pattern: 'Double Bottom',
      direction: 'bullish',
      strength: 3,
      firstValley: valley1.low,
      secondValley: valley2.low,
      neckline,
      target: neckline + (neckline - valley1.low),
    };
  }
  return null;
}

function detectHeadAndShoulders(quotes) {
  if (quotes.length < 80) return null;
  const recent = quotes.slice(-50);
  const highs = recent.map((q, i) => ({ high: q.high, i }));
  const mid = Math.floor(highs.length / 2);
  const left = highs.slice(0, mid).sort((a, b) => b.high - a.high).slice(0, 3);
  const right = highs.slice(mid).sort((a, b) => b.high - a.high).slice(0, 3);
  const leftPeak = left[0];
  const rightPeak = right[0];
  const headHigh = Math.max(...highs.map(h => h.high));
  const head = highs.find(h => h.high === headHigh);
  if (!leftPeak || !rightPeak || !head) return null;
  const shoulderDiff = Math.abs(leftPeak.high - rightPeak.high) / leftPeak.high;
  const headToShoulder = (headHigh - leftPeak.high) / headHigh;
  if (shoulderDiff < 0.05 && headToShoulder > 0.02 && headToShoulder < 0.15) {
    const neckline = Math.min(...recent.map(q => q.low));
    return {
      pattern: 'Head & Shoulders',
      direction: 'bearish',
      strength: 5,
      leftShoulder: leftPeak.high,
      head: headHigh,
      rightShoulder: rightPeak.high,
      neckline,
      target: neckline - (headHigh - neckline),
    };
  }
  return null;
}

function detectFlag(quotes) {
  if (quotes.length < 30) return null;
  const recent = quotes.slice(-20);
  const firstHalf = recent.slice(0, 10);
  const secondHalf = recent.slice(10);
  const firstRange = Math.max(...firstHalf.map(q => q.high)) - Math.min(...firstHalf.map(q => q.low));
  const secondRange = Math.max(...secondHalf.map(q => q.high)) - Math.min(...secondHalf.map(q => q.low));
  const firstDir = firstHalf[firstHalf.length - 1].close - firstHalf[0].close;
  const secondDir = secondHalf[secondHalf.length - 1].close - secondHalf[0].close;
  const avgBodySecond = secondHalf.reduce((s, q) => s + Math.abs(q.close - q.open), 0) / secondHalf.length;
  const avgRangeSecond = secondHalf.reduce((s, q) => s + q.high - q.low, 0) / secondHalf.length;
  if (firstRange > secondRange * 1.5 && avgBodySecond / avgRangeSecond < 0.4) {
    if (firstDir > 0 && Math.abs(secondDir) / recent[0].close < 0.02) {
      return { pattern: 'Bull Flag', direction: 'bullish', strength: 3 };
    }
    if (firstDir < 0 && Math.abs(secondDir) / recent[0].close < 0.02) {
      return { pattern: 'Bear Flag', direction: 'bearish', strength: 3 };
    }
  }
  return null;
}

function detectMarubozu(quotes) {
  if (quotes.length < 1) return null;
  const curr = quotes[quotes.length - 1];
  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low;
  if (range === 0) return null;
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  if (body / range > 0.9 && lowerWick / range < 0.05 && upperWick / range < 0.05) {
    return {
      pattern: 'Marubozu',
      direction: curr.close > curr.open ? 'bullish' : 'bearish',
      strength: 3,
    };
  }
  return null;
}

function detectMorningEveningStar(quotes) {
  if (quotes.length < 3) return null;
  const c1 = quotes[quotes.length - 3];
  const c2 = quotes[quotes.length - 2];
  const c3 = quotes[quotes.length - 1];
  if (!c1 || !c2 || !c3) return null;
  const body2 = Math.abs(c2.close - c2.open);
  const range2 = c2.high - c2.low;
  if (c1.close > c1.open && body2 / range2 < 0.3 && c2.close < c1.close && c3.close > c3.open && c3.close > c2.close) {
    return { pattern: 'Morning Star', direction: 'bullish', strength: 4 };
  }
  if (c1.close < c1.open && body2 / range2 < 0.3 && c2.close > c1.close && c3.close < c3.open && c3.close < c2.close) {
    return { pattern: 'Evening Star', direction: 'bearish', strength: 4 };
  }
  return null;
}

function detectThreeWhiteSoldiers(quotes) {
  if (quotes.length < 3) return null;
  const recent3 = quotes.slice(-3);
  const allBullish = recent3.every(q => q.close > q.open);
  const higherHighs = recent3[1].close > recent3[0].close && recent3[2].close > recent3[1].close;
  if (allBullish && higherHighs) {
    return { pattern: 'Three White Soldiers', direction: 'bullish', strength: 4 };
  }
  return null;
}

function detectThreeBlackCrows(quotes) {
  if (quotes.length < 3) return null;
  const recent3 = quotes.slice(-3);
  const allBearish = recent3.every(q => q.close < q.open);
  const lowerLows = recent3[1].close < recent3[0].close && recent3[2].close < recent3[1].close;
  if (allBearish && lowerLows) {
    return { pattern: 'Three Black Crows', direction: 'bearish', strength: 4 };
  }
  return null;
}

function detectPatterns(quotes) {
  if (!quotes || quotes.length < 3) return [];

  const cleanQuotes = quotes.filter(q => q && q.open !== null && q.high !== null && q.low !== null && q.close !== null);
  if (cleanQuotes.length < 3) return [];

  const detections = [
    detectEngulfing(cleanQuotes),
    detectDoji(cleanQuotes),
    detectHammer(cleanQuotes),
    detectShootingStar(cleanQuotes),
    detectDoubleTop(cleanQuotes),
    detectDoubleBottom(cleanQuotes),
    detectHeadAndShoulders(cleanQuotes),
    detectFlag(cleanQuotes),
    detectMarubozu(cleanQuotes),
    detectMorningEveningStar(cleanQuotes),
    detectThreeWhiteSoldiers(cleanQuotes),
    detectThreeBlackCrows(cleanQuotes),
  ].filter(Boolean);

  detections.sort((a, b) => b.strength - a.strength);

  return detections;
}

function formatPatternSummary(patterns) {
  if (!patterns || patterns.length === 0) return 'No se detectaron patrones relevantes.';
  return patterns.map(p => {
    let line = `🔍 ${p.pattern} (${p.direction === 'bullish' ? '✅ Alcista' : p.direction === 'bearish' ? '🔴 Bajista' : '⚪ Neutral'}, fuerza: ${p.strength}/5)`;
    if (p.neckline !== undefined) line += ` | Neckline: $${p.neckline.toFixed(2)}`;
    if (p.target !== undefined) line += ` | Target: $${p.target.toFixed(2)}`;
    if (p.firstPeak !== undefined) line += ` | Pico 1: $${p.firstPeak.toFixed(2)} Pico 2: $${p.secondPeak?.toFixed(2)}`;
    if (p.firstValley !== undefined) line += ` | Valle 1: $${p.firstValley.toFixed(2)} Valle 2: $${p.secondValley?.toFixed(2)}`;
    return line;
  }).join('\n');
}

const yahooFinance = require('./yahooFinanceClient');
const logger = require('./logger');

async function detectPatternsForSymbol(symbol, interval = '1d', range = '6mo') {
  try {
    const period1 = new Date();
    period1.setMonth(period1.getMonth() - 6);
    const result = await yahooFinance.chart(symbol, {
      period1: period1.toISOString().split('T')[0],
      interval,
    });
    if (!result?.quotes?.length) return [];
    const clean = result.quotes.filter(q => q.open && q.high && q.low && q.close);
    return detectPatterns(clean);
  } catch (err) {
    logger.warn(`Pattern detection failed for ${symbol}: ${err.message}`);
    return [];
  }
}

module.exports = { detectPatterns, detectPatternsForSymbol, formatPatternSummary };
