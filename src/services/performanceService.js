const yahooFinance = require('./yahooFinanceClient');
const { getSupabaseAdmin } = require('./supabase');
const { persistMarketData, loadMarketData } = require('./marketCache');
const logger = require('./logger');

const BENCHMARKS = [
  { id: 'sp500', ticker: '^GSPC', name: 'S&P 500' },
  { id: 'ibex', ticker: '^IBEX', name: 'IBEX 35' },
];

const memHist = new Map(); // ticker -> { map, closes, endDate, ts }
const HIST_TTL_MS = 12 * 60 * 60 * 1000;

function dayStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

// Descarga 2 años de cierres diarios (con caché memoria + Supabase 24h).
async function getHistory(ticker) {
  const cached = memHist.get(ticker);
  if (cached && Date.now() - cached.ts < HIST_TTL_MS) return cached;

  try {
    const persisted = await loadMarketData(`hist:${ticker}`, 24 * 60);
    if (persisted?.data?.closes?.length) {
      const entry = { ...persisted.data, ts: Date.now() };
      memHist.set(ticker, entry);
      return entry;
    }
  } catch { /* seguir a descarga */ }

  const now = Math.floor(Date.now() / 1000);
  const chart = await yahooFinance.chart(ticker, {
    period1: now - 730 * 24 * 60 * 60,
    period2: now,
    interval: '1d',
  });
  const map = {};
  const closes = [];
  for (const q of chart.quotes || []) {
    if (typeof q.close !== 'number' || !q.date) continue;
    const d = dayStr(q.date);
    map[d] = q.close;
    closes.push({ date: d, close: q.close });
  }
  closes.sort((a, b) => (a.date < b.date ? -1 : 1));
  const entry = { map, closes, endDate: closes.length ? closes[closes.length - 1].date : null, ts: Date.now() };
  memHist.set(ticker, entry);
  persistMarketData(`hist:${ticker}`, { map, closes, endDate: entry.endDate }).catch(() => {});
  return entry;
}

// Precio en fecha d (o última sesión anterior disponible, máx 7 días atrás).
function priceAt(hist, dateStr) {
  if (!hist) return null;
  if (hist.map[dateStr] != null) return hist.map[dateStr];
  const d = new Date(dateStr + 'T12:00:00Z');
  for (let i = 1; i <= 7; i++) {
    const prev = dayStr(new Date(d.getTime() - i * 86400000));
    if (hist.map[prev] != null) return hist.map[prev];
  }
  return null;
}

function xirr(flows, guess = 0.1) {
  // flows: [{amount (>0 cobra, <0 paga), date: 'YYYY-MM-DD'}]
  if (!flows.length) return null;
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;
  const t0 = Math.min(...flows.map((f) => new Date(f.date).getTime()));
  const npv = (r) => flows.reduce((s, f) => {
    const t = (new Date(f.date).getTime() - t0) / 31557600000;
    return s + f.amount / Math.pow(1 + r, t);
  }, 0);
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  if (flo * fhi > 0) {
    // Sin cambio de signo: probar con guess cercano
    const fg = npv(guess);
    if (Math.abs(fg) < 1e-6) return guess;
    return null;
  }
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm <= 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

async function getPerformance(userId) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase not configured');

  const { data: txs, error } = await admin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('executed_at', { ascending: true });
  if (error) throw error;
  if (!txs?.length) {
    return { empty: true, positions: [], twr: null, xirr: null, dividends: 0, benchmarks: [], curve: [] };
  }

  const tickers = [...new Set(txs.map((t) => t.ticker))];
  const hists = {};
  await Promise.all(tickers.map(async (t) => {
    try {
      hists[t] = await getHistory(t);
    } catch (err) {
      logger.warn(`History failed for ${t}: ${err.message}`);
      hists[t] = null;
    }
  }));
  const benchHists = {};
  await Promise.all(BENCHMARKS.map(async (b) => {
    try {
      benchHists[b.ticker] = await getHistory(b.ticker);
    } catch {
      benchHists[b.ticker] = null;
    }
  }));

  // Libro por coste medio + TWR por encadenamiento de subperiodos
  const holdings = {}; // ticker -> shares
  const avgCost = {}; // ticker -> { shares, cost }
  const flows = []; // para XIRR
  let twrFactor = 1;
  let periodStartValue = 0;
  let periodStartSet = false;
  let dividends = 0;
  const posStats = {}; // ticker -> { buys, sells, divs }

  const valueHoldings = (dateStr) => {
    let v = 0;
    for (const [t, sh] of Object.entries(holdings)) {
      if (sh <= 0) continue;
      const p = priceAt(hists[t], dateStr);
      if (p == null) return null;
      v += sh * p;
    }
    return v;
  };

  for (const tx of txs) {
    const d = dayStr(tx.executed_at);
    const valBefore = valueHoldings(d);
    // Cierra el subperiodo anterior con el valor pre-flujo
    if (periodStartSet && valBefore != null && periodStartValue > 0) {
      twrFactor *= valBefore / periodStartValue;
    }
    const sh = Number(tx.shares) || 0;
    const px = Number(tx.price) || 0;
    const fee = Number(tx.fee) || 0;
    const st = (posStats[tx.ticker] = posStats[tx.ticker] || { buys: 0, sells: 0, divs: 0 });

    if (tx.side === 'buy') {
      holdings[tx.ticker] = (holdings[tx.ticker] || 0) + sh;
      const ac = (avgCost[tx.ticker] = avgCost[tx.ticker] || { shares: 0, cost: 0 });
      ac.shares += sh;
      ac.cost += sh * px + fee;
      st.buys += sh * px + fee;
      flows.push({ amount: -(sh * px + fee), date: d });
    } else if (tx.side === 'sell') {
      holdings[tx.ticker] = Math.max(0, (holdings[tx.ticker] || 0) - sh);
      const ac = avgCost[tx.ticker] || { shares: 0, cost: 0 };
      if (ac.shares > 0) {
        const frac = Math.min(1, sh / ac.shares);
        ac.cost *= 1 - frac;
        ac.shares = Math.max(0, ac.shares - sh);
      }
      st.sells += sh * px - fee;
      flows.push({ amount: sh * px - fee, date: d });
    } else if (tx.side === 'dividend') {
      const amount = sh > 0 && px > 0 ? sh * px : px; // sh×px o importe directo
      dividends += amount;
      st.divs += amount;
      flows.push({ amount, date: d });
    }

    // Nuevo subperiodo arranca post-flujo
    const valAfter = valueHoldings(d);
    if (valAfter != null && valAfter > 0) {
      periodStartValue = valAfter;
      periodStartSet = true;
    } else if (valAfter != null) {
      periodStartSet = false;
    }
  }

  const endDate = Object.values(hists).map((h) => h?.endDate).filter(Boolean).sort().pop()
    || dayStr(new Date());
  const finalValue = valueHoldings(endDate) || 0;
  if (periodStartSet && periodStartValue > 0 && finalValue != null) {
    twrFactor *= finalValue / periodStartValue;
  }
  const twr = periodStartSet ? twrFactor - 1 : null;
  if (finalValue > 0) flows.push({ amount: finalValue, date: endDate });
  // XIRR solo con historial mínimo de 30 días (anualizar periodos cortos desinforma)
  const spanDays = (new Date(endDate) - new Date(dayStr(txs[0].executed_at))) / 86400000;
  const irr = spanDays >= 30 ? xirr(flows) : null;

  // Posiciones actuales con rentabilidad simple vs coste medio
  const positions = [];
  for (const [t, sh] of Object.entries(holdings)) {
    if (sh <= 0) continue;
    const p = priceAt(hists[t], endDate);
    const ac = avgCost[t] || { shares: sh, cost: 0 };
    const avgPx = ac.shares > 0 ? ac.cost / ac.shares : 0;
    const value = p != null ? sh * p : 0;
    const ret = avgPx > 0 && p != null ? (p - avgPx) / avgPx : null;
    positions.push({
      ticker: t,
      shares: Math.round(sh * 10000) / 10000,
      avg_price: Math.round(avgPx * 100) / 100,
      price: p != null ? Math.round(p * 100) / 100 : null,
      value: Math.round(value * 100) / 100,
      return_pct: ret != null ? Math.round(ret * 10000) / 100 : null,
      dividends: Math.round((posStats[t]?.divs || 0) * 100) / 100,
    });
  }
  positions.sort((a, b) => b.value - a.value);

  // Curva mensual normalizada (cartera vs benchmarks desde el primer flujo)
  const firstDate = dayStr(txs[0].executed_at).slice(0, 7);
  const months = [];
  {
    const [y0, m0] = firstDate.split('-').map(Number);
    const now = new Date();
    let y = y0;
    let m = m0;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
      if (months.length > 60) break;
    }
  }
  // Holdings por mes: replay simple de transacciones acumuladas a fin de mes
  const curve = [];
  const acc = {};
  let txIdx = 0;
  const sortedTx = [...txs].sort((a, b) => new Date(a.executed_at) - new Date(b.executed_at));
  // Base de normalización: valor a fin del primer mes con holdings de entonces
  let basePf = null;
  const baseBench = {};
  for (const ym of months) {
    const [yy, mm] = ym.split('-').map(Number);
    const lastDay = new Date(yy, mm, 0);
    const today = new Date();
    const monthEnd = dayStr(lastDay > today ? today : lastDay);
    while (txIdx < sortedTx.length && dayStr(sortedTx[txIdx].executed_at) <= monthEnd) {
      const t = sortedTx[txIdx++];
      if (t.side === 'buy') acc[t.ticker] = (acc[t.ticker] || 0) + Number(t.shares || 0);
      else if (t.side === 'sell') acc[t.ticker] = Math.max(0, (acc[t.ticker] || 0) - Number(t.shares || 0));
    }
    let v = 0;
    let complete = true;
    for (const [t, sh] of Object.entries(acc)) {
      if (sh <= 0) continue;
      const p = priceAt(hists[t], monthEnd);
      if (p == null) {
        complete = false;
        break;
      }
      v += sh * p;
    }
    if (!complete || v <= 0) continue;
    if (basePf == null) {
      basePf = v;
      for (const b of BENCHMARKS) {
        const bp = priceAt(benchHists[b.ticker], monthEnd);
        if (bp != null) baseBench[b.id] = bp;
      }
    }
    const point = { date: ym, portfolio: Math.round((v / basePf) * 10000) / 100 };
    for (const b of BENCHMARKS) {
      const bp = priceAt(benchHists[b.ticker], monthEnd);
      if (bp != null && baseBench[b.id]) {
        point[b.id] = Math.round((bp / baseBench[b.id]) * 10000) / 100;
      }
    }
    curve.push(point);
  }

  // Benchmarks: rentabilidad en el periodo completo [primer flujo, hoy]
  const benchmarks = BENCHMARKS.map((b) => {
    const h = benchHists[b.ticker];
    const startP = h ? priceAt(h, dayStr(txs[0].executed_at)) : null;
    const endP = h ? priceAt(h, endDate) : null;
    return {
      id: b.id,
      name: b.name,
      return_pct: startP && endP ? Math.round(((endP - startP) / startP) * 10000) / 100 : null,
    };
  });

  const pct = (x) => (x == null ? null : Math.round(x * 10000) / 100);
  return {
    empty: false,
    as_of: endDate,
    total_value: Math.round(finalValue * 100) / 100,
    twr_pct: pct(twr),
    xirr_pct: irr != null ? Math.round(irr * 10000) / 100 : null,
    dividends: Math.round(dividends * 100) / 100,
    flows_count: txs.length,
    positions,
    benchmarks,
    curve,
  };
}

module.exports = { getPerformance, getHistory, xirr };
