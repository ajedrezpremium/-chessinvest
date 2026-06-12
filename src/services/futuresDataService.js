const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ queue: { concurrency: 2 }, suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const logger = require('./logger');
const { cache } = require('./cache');
const { fetchAlphaVantage } = require('./dataProvider');

const CACHE_TTL_MS = 2 * 60 * 1000;

const FUTURES_SYMBOLS = [
  { id: 'vix', symbol: '^VIX', name: 'VIX', color: 'yellow' },
  { id: 'dxy', symbol: 'DX-Y.NYB', name: 'DXY', color: 'yellow' },
  { id: 'us10y', symbol: '^TNX', name: 'US10Y', color: 'green' },
  { id: 'gold', symbol: 'GC=F', name: 'OR', color: 'green' },
  { id: 'wti', symbol: 'CL=F', name: 'WTI', color: 'green' },
  { id: 'brent', symbol: 'BZ=F', name: 'BRENT', color: 'green' },
  { id: 'btc', symbol: 'BTC-USD', name: 'BTC', color: 'red' },
  { id: 'eth', symbol: 'ETH-USD', name: 'ETH', color: 'red' },
  { id: 'spx', symbol: '^GSPC', name: 'SPX', color: 'green' },
  { id: 'ndx', symbol: '^IXIC', name: 'NDX', color: 'green' },
  { id: 'dji', symbol: '^DJI', name: 'DJI', color: 'green' },
  { id: 'dax', symbol: '^GDAXI', name: 'DAX', color: 'green' },
  { id: 'nikkei', symbol: '^N225', name: 'NIKKEI', color: 'green' },
  { id: 'hsi', symbol: '^HSI', name: 'HSI', color: 'green' },
];

const FALLBACK_DATA = {
  vix: { val: '14.2', chg: '+0.5%', dir: 'up' },
  dxy: { val: '104.50', chg: '-0.2%', dir: 'down' },
  us10y: { val: '4.35', chg: '+0.02', dir: 'up' },
  gold: { val: '2,340', chg: '+0.8%', dir: 'up' },
  wti: { val: '78.40', chg: '+1.2%', dir: 'up' },
  brent: { val: '82.15', chg: '+0.9%', dir: 'up' },
  btc: { val: '67,200', chg: '-2.1%', dir: 'down' },
  eth: { val: '3,450', chg: '-1.8%', dir: 'down' },
  spx: { val: '6,025', chg: '+0.3%', dir: 'up' },
  ndx: { val: '19,450', chg: '+0.5%', dir: 'up' },
  dji: { val: '47,820', chg: '-0.1%', dir: 'down' },
  dax: { val: '20,125', chg: '+0.4%', dir: 'up' },
  nikkei: { val: '39,850', chg: '-0.4%', dir: 'down' },
  hsi: { val: '24,580', chg: '+0.8%', dir: 'up' },
};

function formatPrice(num) {
  if (num === undefined || num === null || isNaN(num)) return '—';
  if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (num >= 10) return num.toFixed(2);
  return num.toFixed(4);
}

function formatChange(change, changePercent) {
  if (change === undefined || change === null) return '—';
  const dir = change >= 0 ? '+' : '';
  return `${dir}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%)`;
}

async function fetchQuote(symbol) {
  const quote = await yahooFinance.quote(symbol);
  if (!quote || !quote.regularMarketPrice) return null;
  return {
    price: quote.regularMarketPrice,
    change: quote.regularMarketChange,
    changePercent: quote.regularMarketChangePercent,
    openInterest: quote.openInterest || quote.regularMarketVolume || null,
    volume: quote.regularMarketVolume || null,
    source: 'quote',
  };
}

async function fetchChartFallback(symbol) {
  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 5);
    const result = await yahooFinance.chart(symbol, {
      period1: period1.toISOString().split('T')[0],
      interval: '1d',
    });
    if (!result?.quotes?.length) return null;
    const quotes = result.quotes.filter(q => q.close !== null);
    if (!quotes.length) return null;
    const last = quotes[quotes.length - 1];
    const prev = quotes.length > 1 ? quotes[quotes.length - 2] : last;
    return {
      price: last.close,
      change: last.close - prev.close,
      changePercent: ((last.close - prev.close) / prev.close) * 100,
      source: 'chart',
    };
  } catch (err) {
    logger.warn(`Chart fallback also failed for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchSingleFuture(symbol) {
  const cacheKey = `futures:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let result = null;
  try {
    result = await fetchQuote(symbol);
  } catch (err) {
    logger.warn(`Quote failed for ${symbol}: ${err.message}. Trying chart fallback...`);
  }

  if (!result) {
    result = await fetchChartFallback(symbol);
  }

  if (!result) {
    result = await fetchAlphaVantage(symbol);
    if (result) logger.info(`Alpha Vantage fallback succeeded for ${symbol}`);
  }

  if (!result) {
    logger.warn(`All data sources failed for ${symbol}. Using hardcoded fallback.`);
    return null;
  }

  cache.set(cacheKey, { price: result.price, change: result.change, changePercent: result.changePercent }, CACHE_TTL_MS);
  return result;
}

async function getFuturesData() {
  const results = await Promise.allSettled(
    FUTURES_SYMBOLS.map(async (f) => {
      try {
        const quote = await fetchSingleFuture(f.symbol);
        if (!quote) {
          return { ...FALLBACK_DATA[f.id], id: f.id, name: f.name, symbol: f.symbol };
        }
        const dir = quote.change >= 0 ? 'up' : 'down';
        return {
          id: f.id,
          name: f.name,
          symbol: f.symbol,
          val: formatPrice(quote.price),
          chg: `${quote.change >= 0 ? '+' : ''}${quote.changePercent?.toFixed(1) || 0}%`,
          pts: quote.change.toFixed(2),
          dir,
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          openInterest: quote.openInterest,
          volume: quote.volume,
        };
      } catch (err) {
        return { ...FALLBACK_DATA[f.id], id: f.id, name: f.name, symbol: f.symbol };
      }
    })
  );

  const valid = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (valid.length === 0) {
    return FUTURES_SYMBOLS.map(f => ({ ...FALLBACK_DATA[f.id], id: f.id, name: f.name, symbol: f.symbol }));
  }

  return valid;
}

function getFuturesColor(futures, id) {
  const f = futures?.find(x => x.id === id);
  if (!f) return 'yellow';
  if (f.dir === 'up') return 'green';
  return 'red';
}

module.exports = { getFuturesData, FUTURES_SYMBOLS, getFuturesColor, FALLBACK_DATA };
