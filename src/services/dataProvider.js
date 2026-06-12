const logger = require('./logger');
const { cache } = require('./cache');
const config = require('../config');

const CACHE_TTL_MS = 2 * 60 * 1000;

async function fetchAlphaVantage(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) return null;

  const cacheKey = `av:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const quote = data['Global Quote'];

    if (!quote || !quote['05. price']) {
      logger.warn(`Alpha Vantage: no data for ${symbol}`);
      return null;
    }

    const result = {
      price: parseFloat(quote['05. price']),
      change: parseFloat(quote['09. change'] || 0),
      changePercent: parseFloat((quote['10. change percent'] || '0%').replace('%', '')),
      volume: parseInt(quote['06. volume'] || 0),
      source: 'alphavantage',
    };

    cache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  } catch (err) {
    logger.warn(`Alpha Vantage error for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchWithFallback(symbol, primaryFn) {
  const result = await primaryFn(symbol);
  if (result) return result;

  const avResult = await fetchAlphaVantage(symbol);
  if (avResult) return avResult;

  return null;
}

module.exports = { fetchAlphaVantage, fetchWithFallback };
