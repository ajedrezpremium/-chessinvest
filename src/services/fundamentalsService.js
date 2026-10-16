const yahooFinance = require('./yahooFinanceClient');
const { getSupabaseAdmin } = require('./supabase');
const { INDEX_CONSTITUENTS } = require('../data/indexConstituents');
const logger = require('./logger');

// ── Universo: IBEX completo + top 8 por peso del resto de índices ──
function buildUniverse(topN = 8) {
  const seen = new Map();
  for (const [key, idx] of Object.entries(INDEX_CONSTITUENTS)) {
    const list = [...(idx.constituents || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const take = key === 'ibex' ? list : list.slice(0, topN);
    for (const c of take) {
      if (!seen.has(c.ticker)) seen.set(c.ticker, { ticker: c.ticker, name: c.name, sector: c.sector || 'General' });
    }
  }
  return [...seen.values()];
}

// ── Indicadores técnicos con histórico ligero (6 meses) ──
function sma(values, n) {
  if (!values || values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function ema(values, n) {
  if (!values || values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi14(closes) {
  if (!closes || closes.length < 15) return null;
  const c = closes.slice(-15);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function macdBullish(closes) {
  if (!closes || closes.length < 60) return null;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  if (e12 == null || e26 == null) return null;
  // Señal aproximada: MACD actual vs MACD de hace 9 sesiones
  const past = closes.slice(0, -9);
  const p12 = ema(past, 12);
  const p26 = ema(past, 26);
  if (p12 == null || p26 == null) return e12 > e26;
  return e12 - e26 > p12 - p26 && e12 > e26;
}

// ── Scoring determinista 20 criterios (0/2.5/5 cada uno, máx 100) ──
// Proxies documentados donde el dato free no existe: IV→rango intradía,
// short interest→lejanía de máximos, geografía→capitalización.
function scoreTicker(input) {
  const { quote: q = {}, fd = {}, ks = {}, sd = {}, rec = {}, cal = {}, closes = [], sector = 'General' } = input;
  const price = q.regularMarketPrice || fd.currentPrice || null;
  const isFin = /financier|seguro|banc/i.test(sector);
  const crit = [];
  const C = (n, pass, label) => crit.push({ n, pass, label });

  const rsi = rsi14(closes);
  C(1, rsi == null ? 0 : rsi >= 40 && rsi <= 60 ? 5 : rsi >= 30 && rsi <= 70 ? 2.5 : 0, 'RSI 14 en zona óptima');

  const macd = macdBullish(closes);
  C(2, macd == null ? 0 : macd ? 5 : 0, 'MACD alcista');

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = q.twoHundredDayAverage || null;
  C(3, price == null ? 0 : price > (s50 || Infinity) && price > (s200 || Infinity) ? 5 : price > (s50 || Infinity) ? 2.5 : 0, 'Sobre medias 50/200');

  const vol = q.regularMarketVolume || 0;
  const avg10 = q.averageDailyVolume10Day || 0;
  C(4, vol && avg10 ? (vol > avg10 * 1.2 ? 5 : 0) : 0, 'Volumen sobre media');

  const low52 = q.fiftyTwoWeekLow || null;
  C(5, price && low52 ? (price > low52 * 1.1 ? 5 : price > low52 ? 2.5 : 0) : 0, 'Soporte respetado');

  const pe = sd.trailingPE ?? fd.currentPE ?? null;
  C(6, pe == null || pe <= 0 ? 0 : pe < 20 ? 5 : pe <= 30 ? 2.5 : 0, 'PER razonable');

  const eg = fd.earningsGrowth ?? null;
  C(7, eg == null ? 0 : eg > 0.15 ? 5 : eg > 0 ? 2.5 : 0, 'Crecimiento BPA');

  const pm = fd.profitMargins ?? null;
  C(8, pm == null ? 0 : pm > 0.15 ? 5 : pm > 0 ? 2.5 : 0, 'Margen neto');

  const de = fd.debtToEquity ?? null;
  C(9, isFin ? 2.5 : de == null ? 0 : de < 3 ? 5 : de < 5 ? 2.5 : 0, 'Deuda controlada');

  const fcf = fd.freeCashflow ?? null;
  const ocf = fd.operatingCashflow ?? null;
  C(10, fcf > 0 ? 5 : ocf > 0 ? 2.5 : 0, 'Caja positiva');

  const trend = rec.trend || [];
  const last = trend[trend.length - 1] || {};
  const buy = (last.strongBuy || 0) + (last.buy || 0);
  const tot = buy + (last.hold || 0) + (last.sell || 0) + (last.strongSell || 0);
  const buyPct = tot > 0 ? buy / tot : null;
  C(11, buyPct == null ? 0 : buyPct >= 0.6 ? 5 : buyPct >= 0.4 ? 2.5 : 0, 'Analistas compran');

  const target = fd.targetMeanPrice || null;
  const upside = target && price ? (target - price) / price : null;
  C(12, upside == null ? 0 : upside > 0.1 ? 5 : upside > 0 ? 2.5 : 0, 'Potencial vs objetivo');

  const cap = q.marketCap || 0;
  C(13, cap >= 10e9 ? 5 : cap >= 2e9 ? 2.5 : 0, 'Liquidez por tamaño');
  C(14, cap >= 100e9 ? 5 : cap >= 20e9 ? 2.5 : 0, 'Diversificación global');

  const dy = sd.dividendYield ?? null;
  C(15, dy == null ? 0 : dy >= 0.03 ? 5 : dy > 0 ? 2.5 : 0, 'Dividendo');

  const dh = q.regularMarketDayHigh || 0;
  const dl = q.regularMarketDayLow || 0;
  const range = price && dh && dl ? (dh - dl) / price : null;
  C(16, range == null ? 0 : range <= 0.03 ? 5 : range <= 0.06 ? 2.5 : 0, 'Volatilidad contenida');

  const beta = ks.beta ?? null;
  C(17, beta == null ? 2.5 : beta < 1 ? 5 : beta < 1.3 ? 2.5 : 0, 'Beta defensiva');

  const high52 = q.fiftyTwoWeekHigh || null;
  C(18, price && high52 ? (price < high52 * 0.98 ? 5 : 0) : 0, 'No extendido en máximos');

  const m3 = closes.length >= 66 ? closes[closes.length - 1] / closes[closes.length - 66] - 1 : null;
  C(19, m3 == null ? 0 : m3 > 0 ? 5 : m3 > -0.05 ? 2.5 : 0, 'Momentum 3 meses');

  const earnDate = cal.earningsDate?.[0];
  const inDays = earnDate ? Math.round((new Date(earnDate * 1000) - Date.now()) / 86400000) : null;
  C(20, inDays != null && inDays >= 0 && inDays <= 75 ? 5 : 0, 'Catalizador próximo');

  const score = Math.round(crit.reduce((s, c) => s + c.pass, 0));
  return {
    score,
    met: crit.filter((c) => c.pass >= 5).length,
    breakdown: crit,
    metrics: {
      rsi: rsi != null ? Math.round(rsi * 10) / 10 : null,
      sma20: s20, sma50: s50,
      momentum3m: m3 != null ? Math.round(m3 * 1000) / 10 : null,
      buyPct: buyPct != null ? Math.round(buyPct * 100) : null,
      upside: upside != null ? Math.round(upside * 1000) / 10 : null,
      beta, pe, forwardPE: sd.forwardPE ?? null,
      divYield: dy, debtEquity: de, roe: ks.returnOnEquity ?? null,
      profitMargin: pm, epsGrowth: eg, marketCap: cap,
      earningsInDays: inDays,
      dayRangePct: range != null ? Math.round(range * 1000) / 10 : null,
      high52: high52, low52: low52,
    },
  };
}

// Yahoo usa guion en Berkshire (BRK-B); el universo guarda BRK.B para mostrar.
function apiTicker(ticker) {
  if (ticker === 'BRK.B') return 'BRK-B';
  if (ticker === 'BRK.A') return 'BRK-A';
  return ticker;
}

async function fetchTickerData(ticker) {
  const out = { quote: null, modules: null, closes: [] };
  const yt = apiTicker(ticker);
  try {
    out.quote = await yahooFinance.quote(yt);
  } catch (err) {
    logger.warn(`Screener quote failed ${ticker}: ${err.message}`);
    return null;
  }
  try {
    out.modules = await yahooFinance.quoteSummary(yt, {
      modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'recommendationTrend', 'calendarEvents'],
    });
  } catch (err) {
    logger.warn(`Screener modules failed ${ticker}: ${err.message}`);
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const chart = await yahooFinance.chart(yt, {
      period1: now - 182 * 24 * 60 * 60,
      period2: now,
      interval: '1d',
    });
    out.closes = (chart.quotes || []).map((c) => c.close).filter((v) => typeof v === 'number');
  } catch (err) {
    logger.warn(`Screener chart failed ${ticker}: ${err.message}`);
  }
  return out;
}

async function scanFundamentals() {
  const { getSupabaseAdmin } = require('./supabase');
  const admin = getSupabaseAdmin();
  if (!admin) {
    logger.warn('Screener scan skipped: Supabase not configured');
    return { scanned: 0 };
  }
  const universe = buildUniverse(8);
  logger.info(`Screener scan start: ${universe.length} tickers`);
  let ok = 0;
  let fail = 0;
  for (const u of universe) {
    try {
      const data = await fetchTickerData(u.ticker);
      if (!data?.quote?.regularMarketPrice) {
        fail++;
        continue;
      }
      const q = data.quote;
      const m = data.modules || {};
      const calc = scoreTicker({
        quote: q,
        fd: m.financialData || {},
        ks: m.defaultKeyStatistics || {},
        sd: m.summaryDetail || {},
        rec: m.recommendationTrend || {},
        cal: m.calendarEvents || {},
        closes: data.closes,
        sector: u.sector,
      });
      const mt = calc.metrics;
      const chg = q.regularMarketChangePercent ?? 0;
      const row = {
        ticker: u.ticker,
        name: u.name || q.longName || q.shortName || u.ticker,
        sector: u.sector,
        price: q.regularMarketPrice,
        chg_pct: typeof chg === 'number' ? Math.round(chg * 100) / 100 : null,
        market_cap: mt.marketCap || null,
        pe: mt.pe ?? null,
        forward_pe: mt.forwardPE ?? null,
        eps_growth: mt.epsGrowth ?? null,
        div_yield: mt.divYield ?? null,
        debt_equity: mt.debtEquity ?? null,
        profit_margin: mt.profitMargin ?? null,
        roe: mt.roe ?? null,
        beta: mt.beta ?? null,
        rsi14: mt.rsi ?? null,
        sma20: mt.sma20 ?? null,
        sma50: mt.sma50 ?? null,
        above_sma200: q.twoHundredDayAverage && q.regularMarketPrice ? (q.regularMarketPrice > q.twoHundredDayAverage ? 1 : 0) : null,
        momentum_3m: mt.momentum3m ?? null,
        analyst_buy_pct: mt.buyPct ?? null,
        target_upside: mt.upside ?? null,
        earnings_in_days: mt.earningsInDays ?? null,
        day_range_pct: mt.dayRangePct ?? null,
        fifty_two_w_high: mt.high52 ?? null,
        fifty_two_w_low: mt.low52 ?? null,
        score: calc.score,
        criteria_met: calc.met,
        breakdown: JSON.stringify(calc.breakdown.map((c) => ({ n: c.n, pass: c.pass }))),
        updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from('ticker_fundamentals').upsert(row, { onConflict: 'ticker' });
      if (error) throw error;
      ok++;
      if (ok % 20 === 0) logger.info(`Screener scan progress: ${ok}/${universe.length}`);
    } catch (err) {
      fail++;
      logger.warn(`Screener scan failed ${u.ticker}: ${err.message}`);
    }
  }
  logger.info(`Screener scan done: ${ok} ok, ${fail} fail`);
  return { scanned: ok, failed: fail, universe: universe.length };
}

async function getSnapshot({ minScore = 0, maxPE = null, minDiv = null, maxDebt = null, sector = null, sort = 'score', limit = 50 } = {}) {
  const { getSupabaseAdmin } = require('./supabase');
  const admin = getSupabaseAdmin();
  if (!admin) return { rows: [], updated_at: null };
  let query = admin.from('ticker_fundamentals').select('*').gte('score', Number(minScore) || 0);
  if (maxPE != null && maxPE !== '') query = query.lte('pe', Number(maxPE));
  if (minDiv != null && minDiv !== '') query = query.gte('div_yield', Number(minDiv));
  if (maxDebt != null && maxDebt !== '') query = query.lte('debt_equity', Number(maxDebt));
  if (sector) query = query.eq('sector', sector);
  const allowedSort = ['score', 'pe', 'div_yield', 'momentum_3m', 'market_cap', 'rsi14'];
  const sortCol = allowedSort.includes(sort) ? sort : 'score';
  const asc = sortCol === 'pe';
  query = query.order(sortCol, { ascending: asc, nullsFirst: false }).limit(Math.min(Number(limit) || 50, 100));
  const { data, error } = await query;
  if (error) throw error;
  const { data: newest } = await admin.from('ticker_fundamentals').select('updated_at').order('updated_at', { ascending: false }).limit(1).single();
  return { rows: data || [], updated_at: newest?.updated_at || null };
}

async function getSectors() {
  const { getSupabaseAdmin } = require('./supabase');
  const admin = getSupabaseAdmin();
  if (!admin) return [];
  const { data } = await admin.from('ticker_fundamentals').select('sector');
  return [...new Set((data || []).map((r) => r.sector).filter(Boolean))].sort();
}

module.exports = { buildUniverse, scoreTicker, scanFundamentals, getSnapshot, getSectors };
