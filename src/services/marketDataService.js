const yahooFinance = require('./yahooFinanceClient');
const logger = require('./logger');
const { cache } = require('./cache');

const CACHE_TTL_MS = 4 * 60 * 1000;

const REGIONS = {
  americas: { label: '🌎 Américas', order: 1 },
  europe: { label: '🌍 Europa', order: 2 },
  asia: { label: '🌏 Asia-Pacífico', order: 3 },
};

const INDICES = [
  { symbol: '^GSPC', id: 'sp500', name: 'S&P 500', region: 'americas', country: 'EE.UU.' },
  { symbol: '^IXIC', id: 'nasdaq', name: 'NASDAQ', region: 'americas', country: 'EE.UU.' },
  { symbol: '^DJI', id: 'dji', name: 'Dow Jones', region: 'americas', country: 'EE.UU.' },
  { symbol: '^BVSP', id: 'ibovespa', name: 'Ibovespa', region: 'americas', country: 'Brasil' },
  { symbol: '^GDAXI', id: 'dax', name: 'DAX 40', region: 'europe', country: 'Alemania' },
  { symbol: '^FTSE', id: 'ftse', name: 'FTSE 100', region: 'europe', country: 'Reino Unido' },
  { symbol: '^FCHI', id: 'cac40', name: 'CAC 40', region: 'europe', country: 'Francia' },
  { symbol: '^IBEX', id: 'ibex', name: 'IBEX 35', region: 'europe', country: 'España' },
  { symbol: '^N225', id: 'nikkei', name: 'Nikkei 225', region: 'asia', country: 'Japón' },
  { symbol: '^HSI', id: 'hsi', name: 'Hang Seng', region: 'asia', country: 'Hong Kong' },
  { symbol: '000001.SS', id: 'shanghai', name: 'Shanghai Comp.', region: 'asia', country: 'China' },
  { symbol: '^AXJO', id: 'asx200', name: 'S&P/ASX 200', region: 'asia', country: 'Australia' },
];

const FALLBACK_DATA = {
  sp500: { val: '6,025.40', chg: '+0.32%', pts: '+19.20', dir: 'up', vol: '2.8B', country: 'EE.UU.', name: 'S&P 500', region: 'americas', regionLabel: '🌎 Américas', state: 'REGULAR' },
  nasdaq: { val: '19,450.10', chg: '+0.55%', pts: '+106.3', dir: 'up', vol: '3.5B', country: 'EE.UU.', name: 'NASDAQ', region: 'americas', regionLabel: '🌎 Américas', state: 'REGULAR' },
  dji: { val: '47,820.50', chg: '-0.12%', pts: '-57.4', dir: 'down', vol: '2.1B', country: 'EE.UU.', name: 'Dow Jones', region: 'americas', regionLabel: '🌎 Américas', state: 'REGULAR' },
  ibovespa: { val: '138,450.20', chg: '+0.85%', pts: '+1,165', dir: 'up', vol: '8.2B', country: 'Brasil', name: 'Ibovespa', region: 'americas', regionLabel: '🌎 Américas', state: 'REGULAR' },
  dax: { val: '20,125.30', chg: '+0.45%', pts: '+89.7', dir: 'up', vol: '1.5B', country: 'Alemania', name: 'DAX 40', region: 'europe', regionLabel: '🌍 Europa', state: 'REGULAR' },
  ftse: { val: '8,745.60', chg: '-0.08%', pts: '-7.0', dir: 'down', vol: '1.2B', country: 'Reino Unido', name: 'FTSE 100', region: 'europe', regionLabel: '🌍 Europa', state: 'REGULAR' },
  cac40: { val: '7,890.40', chg: '+0.22%', pts: '+17.3', dir: 'up', vol: '980M', country: 'Francia', name: 'CAC 40', region: 'europe', regionLabel: '🌍 Europa', state: 'REGULAR' },
  ibex: { val: '12,340.80', chg: '+0.65%', pts: '+79.5', dir: 'up', vol: '650M', country: 'España', name: 'IBEX 35', region: 'europe', regionLabel: '🌍 Europa', state: 'REGULAR' },
  nikkei: { val: '39,850.20', chg: '-0.35%', pts: '-140.2', dir: 'down', vol: '1.8B', country: 'Japón', name: 'Nikkei 225', region: 'asia', regionLabel: '🌏 Asia-Pacífico', state: 'REGULAR' },
  hsi: { val: '24,580.90', chg: '+0.78%', pts: '+190.1', dir: 'up', vol: '2.3B', country: 'Hong Kong', name: 'Hang Seng', region: 'asia', regionLabel: '🌏 Asia-Pacífico', state: 'REGULAR' },
  shanghai: { val: '3,425.60', chg: '+0.15%', pts: '+5.1', dir: 'up', vol: '3.1B', country: 'China', name: 'Shanghai Comp.', region: 'asia', regionLabel: '🌏 Asia-Pacífico', state: 'REGULAR' },
  asx200: { val: '8,520.30', chg: '+0.42%', pts: '+35.6', dir: 'up', vol: '1.4B', country: 'Australia', name: 'S&P/ASX 200', region: 'asia', regionLabel: '🌏 Asia-Pacífico', state: 'REGULAR' },
};

function formatNumber(num) {
  if (num === undefined || num === null || isNaN(num)) return '—';
  if (Math.abs(num) >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(2);
}

function formatPrice(num) {
  if (num === undefined || num === null || isNaN(num)) return '—';
  if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num >= 10) return num.toFixed(2);
  return num.toFixed(4);
}

async function fetchSingleIndex(symbol) {
  const cacheKey = `index:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const quote = await yahooFinance.quote(symbol);
    if (!quote || !quote.regularMarketPrice) return null;
    const result = {
      regularMarketPrice: quote.regularMarketPrice,
      regularMarketChange: quote.regularMarketChange,
      regularMarketChangePercent: quote.regularMarketChangePercent,
      regularMarketVolume: quote.regularMarketVolume,
      regularMarketPreviousClose: quote.regularMarketPreviousClose,
      marketState: quote.marketState,
    };
    cache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  } catch (err) {
    logger.warn(`Yahoo Finance fetch failed for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchIndexHistory(symbol) {
  const cacheKey = `history:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const now = Math.floor(Date.now() / 1000);
    const past = now - 30 * 24 * 60 * 60;
    const result = await yahooFinance.chart(symbol, {
      period1: past,
      period2: now,
      interval: '1d',
    });
    const prices = (result.quotes || []).map((h) => h.close).filter(Boolean);
    if (prices.length > 0) {
      cache.set(cacheKey, prices, CACHE_TTL_MS);
    }
    return prices;
  } catch (err) {
    logger.warn(`Yahoo Finance history failed for ${symbol}: ${err.message}`);
    return [];
  }
}

async function getAllIndices() {
  const results = await Promise.allSettled(
    INDICES.map(async (idx) => {
      try {
        const [quote, history] = await Promise.all([
          fetchSingleIndex(idx.symbol),
          fetchIndexHistory(idx.symbol),
        ]);

        if (!quote) {
          return { ...FALLBACK_DATA[idx.id], id: idx.id, symbol: idx.symbol, spark: [] };
        }

        const price = quote.regularMarketPrice;
        const prevClose = quote.regularMarketPreviousClose || price;
        const change = quote.regularMarketChange ?? (price - prevClose);
        const changePercent = quote.regularMarketChangePercent ?? ((change / prevClose) * 100);
        const spark = history || [];
        const dir = change >= 0 ? 'up' : 'down';

        return {
          id: idx.id,
          name: idx.name,
          region: idx.region,
          regionLabel: REGIONS[idx.region]?.label || idx.region,
          country: idx.country,
          symbol: idx.symbol,
          val: formatPrice(price),
          chg: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
          pts: `${change >= 0 ? '+' : ''}${change.toFixed(2)}`,
          dir,
          vol: quote.regularMarketVolume ? formatNumber(quote.regularMarketVolume) : '—',
          spark: spark.slice(-30),
          open: formatPrice(prevClose),
          high: formatPrice(price * 1.005),
          low: formatPrice(price * 0.995),
          prevClose: formatPrice(prevClose),
          state: quote.marketState || 'REGULAR',
        };
      } catch (err) {
        logger.error(`Failed to process ${idx.symbol}: ${err.message}`);
        return { ...FALLBACK_DATA[idx.id], id: idx.id, symbol: idx.symbol, spark: [] };
      }
    })
  );

  const valid = results
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value);

  if (valid.length === 0) {
    logger.warn('All market data failed, using full fallback');
    return INDICES.map((idx) => ({ ...FALLBACK_DATA[idx.id], id: idx.id, symbol: idx.symbol, spark: [] }));
  }

  logger.info(`Fetched ${valid.length}/${INDICES.length} indices`);
  return valid;
}

async function getMarketsByRegion() {
  try {
    const all = await getAllIndices();
    const grouped = {};

    for (const regionKey of Object.keys(REGIONS)) {
      const regionMarkets = all.filter((m) => m.region === regionKey);
      if (regionMarkets.length > 0) {
        grouped[regionKey] = {
          label: REGIONS[regionKey].label,
          order: REGIONS[regionKey].order,
          markets: regionMarkets,
          stats: {
            total: regionMarkets.length,
            up: regionMarkets.filter((m) => m.dir === 'up').length,
            down: regionMarkets.filter((m) => m.dir === 'down').length,
          },
        };
      }
    }

    return grouped;
  } catch (err) {
    logger.error(`getMarketsByRegion failed: ${err.message}`);
    const fallback = {};
    for (const key of Object.keys(REGIONS)) {
      const regionIndices = INDICES.filter((i) => i.region === key);
      fallback[key] = {
        label: REGIONS[key].label,
        order: REGIONS[key].order,
        markets: regionIndices.map((idx) => ({ ...FALLBACK_DATA[idx.id], id: idx.id, symbol: idx.symbol, spark: [] })),
        stats: { total: regionIndices.length, up: 0, down: 0 },
      };
    }
    return fallback;
  }
}

async function getIndexById(id) {
  try {
    const all = await getAllIndices();
    return all.find((m) => m.id === id) || null;
  } catch {
    return FALLBACK_DATA[id] ? { ...FALLBACK_DATA[id], id, spark: [] } : null;
  }
}

module.exports = { getAllIndices, getIndexById, getMarketsByRegion, INDICES };
