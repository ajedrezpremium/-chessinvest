const yahooFinance = require('./yahooFinanceClient');
const logger = require('./logger');
const { cache } = require('./cache');

const CACHE_TTL_MS = 15 * 60 * 1000;

const CORE_ASSETS = [
  { id: 'spx', symbol: '^GSPC', name: 'S&P 500', group: 'equities' },
  { id: 'ndx', symbol: '^IXIC', name: 'NASDAQ', group: 'equities' },
  { id: 'dji', symbol: '^DJI', name: 'Dow Jones', group: 'equities' },
  { id: 'dxy', symbol: 'DX-Y.NYB', name: 'DXY', group: 'fx' },
  { id: 'gold', symbol: 'GC=F', name: 'ORO', group: 'commodities' },
  { id: 'wti', symbol: 'CL=F', name: 'WTI', group: 'commodities' },
  { id: 'brent', symbol: 'BZ=F', name: 'BRENT', group: 'commodities' },
  { id: 'btc', symbol: 'BTC-USD', name: 'BTC', group: 'crypto' },
  { id: 'us10y', symbol: '^TNX', name: 'US10Y', group: 'bonds' },
  { id: 'vix', symbol: '^VIX', name: 'VIX', group: 'volatility' },
  { id: 'dax', symbol: '^GDAXI', name: 'DAX', group: 'equities' },
  { id: 'nikkei', symbol: '^N225', name: 'NIKKEI', group: 'equities' },
];

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

async function fetchReturns(asset, days = 90) {
  const cacheKey = `corr:${asset.symbol}:${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const now = Math.floor(Date.now() / 1000);
    const past = now - days * 24 * 60 * 60;
    const result = await yahooFinance.chart(asset.symbol, {
      period1: past,
      period2: now,
      interval: '1d',
    });

    if (!result?.quotes?.length) return null;

    const closes = result.quotes
      .filter(q => q.close !== null && q.close !== undefined)
      .map(q => q.close);

    if (closes.length < 10) return null;

    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    cache.set(cacheKey, returns, CACHE_TTL_MS);
    return returns;
  } catch (err) {
    logger.warn(`Correlation fetch failed for ${asset.symbol}: ${err.message}`);
    return null;
  }
}

async function getCorrelationMatrix(days = 90) {
  const cacheKey = `corr:matrix:${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const allReturns = await Promise.all(
    CORE_ASSETS.map(async (asset) => {
      const ret = await fetchReturns(asset, days);
      return { asset, returns: ret };
    })
  );

  const valid = allReturns.filter(r => r.returns !== null && r.returns.length > 10);
  if (valid.length < 2) {
    logger.warn('Not enough data for correlation matrix');
    return null;
  }

  const labels = valid.map(r => r.asset);
  const matrix = [];

  for (let i = 0; i < valid.length; i++) {
    const row = [];
    for (let j = 0; j < valid.length; j++) {
      if (i === j) {
        row.push(1);
      } else {
        const minLen = Math.min(valid[i].returns.length, valid[j].returns.length);
        const x = valid[i].returns.slice(-minLen);
        const y = valid[j].returns.slice(-minLen);
        row.push(pearsonCorrelation(x, y));
      }
    }
    matrix.push(row);
  }

  const result = { labels, matrix, days, lastUpdated: new Date().toISOString() };
  cache.set(cacheKey, result, CACHE_TTL_MS);
  return result;
}

function formatCorrelationMatrix(corr) {
  if (!corr || !corr.matrix || corr.matrix.length < 2) return '';

  const table = ['📊 MATRIZ DE CORRELACIÓN (Últimos ' + corr.days + ' días):'];
  table.push('');

  const pad = (s, n) => String(s).padStart(n).slice(0, n);

  const header = ' '.repeat(12) + corr.labels.map(l => pad(l.asset.id, 8)).join(' ');
  table.push(header);

  for (let i = 0; i < corr.labels.length; i++) {
    const rowLabel = pad(corr.labels[i].asset.id, 10);
    const values = corr.matrix[i].map(v => {
      if (v === null) return pad('N/A', 8);
      return pad(v.toFixed(2), 8);
    }).join(' ');
    table.push(rowLabel + ' ' + values);
  }

  table.push('');

  const highPairs = [];
  for (let i = 0; i < corr.labels.length; i++) {
    for (let j = i + 1; j < corr.labels.length; j++) {
      const v = corr.matrix[i][j];
      if (v !== null && Math.abs(v) > 0.5) {
        highPairs.push({
          a: corr.labels[i].asset.id,
          b: corr.labels[j].asset.id,
          value: v,
          abs: Math.abs(v),
        });
      }
    }
  }
  highPairs.sort((a, b) => b.abs - a.abs);

  if (highPairs.length > 0) {
    table.push('💡 Correlaciones más fuertes:');
    highPairs.slice(0, 5).forEach(p => {
      const dir = p.value > 0 ? 'positiva (+) : ambos suben juntos' : 'negativa (-) : se mueven inversamente';
      table.push(`  ${p.a.toUpperCase()} ↔ ${p.b.toUpperCase()}: ${p.value.toFixed(2)} (correlación ${dir})`);
    });
    table.push('');
    table.push('⚡ Interpretación: |r| > 0.7 = fuerte, |r| > 0.5 = moderada, |r| < 0.3 = débil');
  }

  return table.join('\n');
}

function interpretCorrelation(corr, assetA, assetB) {
  if (!corr || !corr.matrix) return null;
  const i = corr.labels.findIndex(l => l.asset.id === assetA);
  const j = corr.labels.findIndex(l => l.asset.id === assetB);
  if (i === -1 || j === -1) return null;
  return corr.matrix[i][j];
}

module.exports = { getCorrelationMatrix, formatCorrelationMatrix, interpretCorrelation, CORE_ASSETS };
