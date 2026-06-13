const https = require('https');
const logger = require('./logger');

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const API_KEY = process.env.FINNHUB_API_KEY || 'd8mgle9r01qkiso9mrogd8mgle9r01qkiso9mrp0';

function finnhubRequest(path) {
  return new Promise((resolve, reject) => {
    const url = `${FINNHUB_BASE}${path}&token=${API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Finnhub parse failed: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchQuote(symbol) {
  if (!API_KEY) return null;
  try {
    const data = await finnhubRequest(`/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!data || data.c === undefined || data.c === 0) return null;
    return {
      regularMarketPrice: data.c,
      regularMarketChange: data.dp !== undefined ? (data.c - (data.pc || data.c)) : undefined,
      regularMarketChangePercent: data.dp,
      regularMarketVolume: data.v || undefined,
      regularMarketPreviousClose: data.pc,
      marketState: 'REGULAR',
    };
  } catch (err) {
    logger.warn(`Finnhub quote failed for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchChart(symbol) {
  return [];
}

module.exports = { fetchQuote, fetchChart };
