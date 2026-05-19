const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ queue: { concurrency: 3 } });
const logger = require('./logger');
const { cache } = require('./cache');

const CACHE_TTL_MS = 4 * 60 * 1000;

const REGIONS = {
  americas: { label: '🌎 Américas', order: 1 },
  europe: { label: '🌍 Europa', order: 2 },
  asia: { label: '🌏 Asia-Pacífico', order: 3 },
  middle_east: { label: '🕌 Medio Oriente', order: 4 },
  africa: { label: '🌍 África', order: 5 },
};

const INDICES = [
  // ── AMÉRICAS ──
  { symbol: '^GSPC', id: 'sp500', name: 'S&P 500', region: 'americas', country: 'EE.UU.' },
  { symbol: '^IXIC', id: 'nasdaq', name: 'NASDAQ', region: 'americas', country: 'EE.UU.' },
  { symbol: '^DJI', id: 'dji', name: 'Dow Jones', region: 'americas', country: 'EE.UU.' },
  { symbol: '^RUT', id: 'russell2000', name: 'Russell 2000', region: 'americas', country: 'EE.UU.' },
  { symbol: '^GSPTSE', id: 'tsx', name: 'S&P/TSX', region: 'americas', country: 'Canadá' },
  { symbol: '^BVSP', id: 'ibovespa', name: 'Ibovespa', region: 'americas', country: 'Brasil' },
  { symbol: '^MXX', id: 'ipc', name: 'IPC México', region: 'americas', country: 'México' },
  { symbol: '^MERV', id: 'merval', name: 'S&P Merval', region: 'americas', country: 'Argentina' },
  { symbol: '^IPSA', id: 'ipsa', name: 'S&P IPSA', region: 'americas', country: 'Chile' },
  { symbol: '^COLCAP', id: 'colcap', name: 'COLCAP', region: 'americas', country: 'Colombia' },

  // ── EUROPA ──
  { symbol: '^GDAXI', id: 'dax', name: 'DAX 40', region: 'europe', country: 'Alemania' },
  { symbol: '^FTSE', id: 'ftse', name: 'FTSE 100', region: 'europe', country: 'Reino Unido' },
  { symbol: '^FCHI', id: 'cac40', name: 'CAC 40', region: 'europe', country: 'Francia' },
  { symbol: '^STOXX50E', id: 'stoxx50', name: 'Euro Stoxx 50', region: 'europe', country: 'Zona Euro' },
  { symbol: '^IBEX', id: 'ibex', name: 'IBEX 35', region: 'europe', country: 'España' },
  { symbol: '^FTMIB', id: 'ftsemib', name: 'FTSE MIB', region: 'europe', country: 'Italia' },
  { symbol: '^AEX', id: 'aex', name: 'AEX', region: 'europe', country: 'Países Bajos' },
  { symbol: '^SSMI', id: 'smi', name: 'SMI', region: 'europe', country: 'Suiza' },
  { symbol: '^OMX', id: 'omx', name: 'OMX Stockholm 30', region: 'europe', country: 'Suecia' },
  { symbol: '^OSEAX', id: 'oseax', name: 'OSEAX', region: 'europe', country: 'Noruega' },
  { symbol: '^WIG20', id: 'wig20', name: 'WIG20', region: 'europe', country: 'Polonia' },
  { symbol: '^BUX', id: 'bux', name: 'BUX', region: 'europe', country: 'Hungría' },

  // ── ASIA-PACÍFICO ──
  { symbol: '^N225', id: 'nikkei', name: 'Nikkei 225', region: 'asia', country: 'Japón' },
  { symbol: '^HSI', id: 'hsi', name: 'Hang Seng', region: 'asia', country: 'Hong Kong' },
  { symbol: '000001.SS', id: 'shanghai', name: 'Shanghai Comp.', region: 'asia', country: 'China' },
  { symbol: '399001.SZ', id: 'shenzhen', name: 'Shenzhen Comp.', region: 'asia', country: 'China' },
  { symbol: '^KS11', id: 'kospi', name: 'KOSPI', region: 'asia', country: 'Corea del Sur' },
  { symbol: '^TWII', id: 'twse', name: 'TWSE', region: 'asia', country: 'Taiwán' },
  { symbol: '^STI', id: 'sti', name: 'Straits Times', region: 'asia', country: 'Singapur' },
  { symbol: '^AXJO', id: 'asx200', name: 'S&P/ASX 200', region: 'asia', country: 'Australia' },
  { symbol: '^NSEI', id: 'nifty50', name: 'NIFTY 50', region: 'asia', country: 'India' },
  { symbol: '^BSESN', id: 'sensex', name: 'S&P BSE Sensex', region: 'asia', country: 'India' },
  { symbol: '^JKSE', id: 'jkse', name: 'Jakarta Composite', region: 'asia', country: 'Indonesia' },
  { symbol: '^KLSE', id: 'klse', name: 'FTSE Bursa Malaysia', region: 'asia', country: 'Malasia' },
  { symbol: '^SET', id: 'set', name: 'SET Index', region: 'asia', country: 'Tailandia' },

  // ── MEDIO ORIENTE ──
  { symbol: '^TA125.TA', id: 'ta125', name: 'TA-125', region: 'middle_east', country: 'Israel' },
  { symbol: '^TASI', id: 'tasi', name: 'Tadawul All Share', region: 'middle_east', country: 'Arabia Saudí' },
  { symbol: '^DFMGI', id: 'dfm', name: 'DFM General', region: 'middle_east', country: 'Dubai' },
  { symbol: '^ADX', id: 'adx', name: 'ADX General', region: 'middle_east', country: 'Abu Dhabi' },

  // ── ÁFRICA ──
  { symbol: '^J203.JO', id: 'jse40', name: 'FTSE/JSE Top 40', region: 'africa', country: 'Sudáfrica' },
  { symbol: '^EGX30', id: 'egx30', name: 'EGX 30', region: 'africa', country: 'Egipto' },
  { symbol: '^NGSEINDX', id: 'ngse', name: 'NGX All-Share', region: 'africa', country: 'Nigeria' },
  { symbol: '^MOEXME', id: 'moex', name: 'MOEX Russia', region: 'europe', country: 'Rusia' },
];

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

function generateSparkline(history) {
  if (!history || history.length < 2) return [];
  return history.map((h) => h.close || h);
}

async function fetchSingleIndex(symbol) {
  const cacheKey = `index:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const quote = await yahooFinance.quote(symbol);
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
    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const history = await yahooFinance.historical(symbol, {
      period1: past.toISOString(),
      period2: now.toISOString(),
      interval: '1d',
    });
    const prices = history.map((h) => h.close);
    cache.set(cacheKey, prices, CACHE_TTL_MS);
    return prices;
  } catch (err) {
    logger.warn(`Yahoo Finance history failed for ${symbol}: ${err.message}`);
    return [];
  }
}

async function getAllIndices() {
  const results = await Promise.allSettled(
    INDICES.map(async (idx) => {
      const [quote, history] = await Promise.all([
        fetchSingleIndex(idx.symbol),
        fetchIndexHistory(idx.symbol),
      ]);

      if (!quote) {
        logger.warn(`No data for ${idx.symbol}, using fallback`);
        return null;
      }

      const price = quote.regularMarketPrice;
      const prevClose = quote.regularMarketPreviousClose || price;
      const change = quote.regularMarketChange ?? (price - prevClose);
      const changePercent = quote.regularMarketChangePercent ?? ((change / prevClose) * 100);
      const spark = generateSparkline(history);
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
        open: formatPrice(price - change + (prevClose - (price - change))),
        high: formatPrice(price * 1.005),
        low: formatPrice(price * 0.995),
        prevClose: formatPrice(prevClose),
        state: quote.marketState || 'REGULAR',
      };
    })
  );

  const valid = results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  if (valid.length === 0) {
    logger.error('All market data fetches failed');
  } else {
    logger.info(`Fetched ${valid.length}/${INDICES.length} indices`);
  }

  return valid;
}

async function getMarketsByRegion() {
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
}

async function getIndexById(id) {
  const all = await getAllIndices();
  return all.find((m) => m.id === id) || null;
}

module.exports = { getAllIndices, getIndexById, INDICES };
