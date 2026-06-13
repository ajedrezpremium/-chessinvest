const yahooFinance = require('./yahooFinanceClient');
const logger = require('./logger');
const { cache } = require('./cache');

const CACHE_TTL_MS = 30 * 60 * 1000;

function sharpeRatio(returns, riskFree = 0.02) {
  if (!returns.length) return 0;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const excess = avg - riskFree / 252;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : Math.round((excess / std) * Math.sqrt(252) * 100) / 100;
}

function maxDrawdown(equityCurve) {
  if (!equityCurve.length) return 0;
  let peak = equityCurve[0];
  let mdd = 0;
  for (const val of equityCurve) {
    if (val > peak) peak = val;
    const dd = (peak - val) / peak;
    if (dd > mdd) mdd = dd;
  }
  return Math.round(mdd * 10000) / 100;
}

async function runBacktest(symbol, direction, entryPrice, stopLoss, takeProfit, interval = '1d', bars = 250) {
  const cacheKey = `bt:${symbol}:${direction}:${entryPrice}:${stopLoss}:${takeProfit}:${bars}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - bars);
    const result = await yahooFinance.chart(symbol, {
      period1: period1.toISOString().split('T')[0],
      interval,
    });

    if (!result?.quotes?.length) return null;

    const quotes = result.quotes.filter(q => q.close !== null && q.high !== null && q.low !== null);
    if (quotes.length < 20) return null;

    const isLong = direction === 'LARGO';
    const entry = parseFloat(entryPrice);
    const stop = parseFloat(stopLoss);
    const target = parseFloat(takeProfit?.split(',')[0]) || null;

    const trades = [];
    let inTrade = false;
    let tradeEntry = 0;
    let tradeBar = 0;
    const equityCurve = [10000];
    const returns = [];

    for (let i = 0; i < quotes.length; i++) {
      const { high, low, close } = quotes[i];

      if (!inTrade) {
        const triggered = isLong ? low <= entry : high >= entry;
        if (triggered) {
          inTrade = true;
          tradeEntry = entry;
          tradeBar = i;
        }
      }

      if (inTrade) {
        let exitPrice = null;
        let reason = '';

        if (isLong) {
          if (stop && low <= stop) { exitPrice = stop; reason = 'stop'; }
          else if (target && high >= target) { exitPrice = target; reason = 'target'; }
          else if (i === quotes.length - 1) { exitPrice = close; reason = 'expiry'; }
        } else {
          if (stop && high >= stop) { exitPrice = stop; reason = 'stop'; }
          else if (target && low <= target) { exitPrice = target; reason = 'target'; }
          else if (i === quotes.length - 1) { exitPrice = close; reason = 'expiry'; }
        }

        if (exitPrice !== null) {
          const pnlPct = isLong
            ? ((exitPrice - tradeEntry) / tradeEntry) * 100
            : ((tradeEntry - exitPrice) / tradeEntry) * 100;
          const barsHeld = i - tradeBar;

          trades.push({
            entryBar: tradeBar,
            exitBar: i,
            entryPrice: tradeEntry,
            exitPrice: Math.round(exitPrice * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            reason,
            barsHeld,
          });

          returns.push(pnlPct / 100);
          const newEquity = equityCurve[equityCurve.length - 1] * (1 + pnlPct / 100);
          equityCurve.push(Math.round(newEquity * 100) / 100);
          inTrade = false;
        }
      }

      if (!inTrade) {
        equityCurve.push(equityCurve[equityCurve.length - 1]);
      }
    }

    const wins = trades.filter(t => t.pnlPct > 0);
    const losses = trades.filter(t => t.pnlPct <= 0);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnlPct, 0);
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

    const backtest = {
      symbol,
      direction,
      entryPrice: entry,
      stopLoss: stop || null,
      takeProfit: target || null,
      period: `${bars}d`,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? Math.round((wins.length / trades.length) * 10000) / 100 : 0,
      totalReturn: Math.round(totalPnl * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: avgLoss !== 0 ? Math.round((avgWin * wins.length) / Math.abs(avgLoss * losses.length) * 100) / 100 : 0,
      sharpe: sharpeRatio(returns),
      maxDrawdown: maxDrawdown(equityCurve),
      avgBarsHeld: trades.length ? Math.round(trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length) : 0,
      bestTrade: trades.length ? Math.round(Math.max(...trades.map(t => t.pnlPct)) * 100) / 100 : 0,
      worstTrade: trades.length ? Math.round(Math.min(...trades.map(t => t.pnlPct)) * 100) / 100 : 0,
      finalEquity: equityCurve[equityCurve.length - 1],
      trades: trades.slice(-10),
      lastUpdated: new Date().toISOString(),
    };

    cache.set(cacheKey, backtest, CACHE_TTL_MS);
    return backtest;
  } catch (err) {
    logger.warn(`Backtest failed for ${symbol}: ${err.message}`);
    return null;
  }
}

function formatBacktestContext(bt) {
  if (!bt) return '';
  const emoji = bt.totalReturn >= 0 ? '🟢' : '🔴';
  return [
    `📊 BACKTEST (${bt.period}):`,
    `${emoji} Retorno: ${bt.totalReturn >= 0 ? '+' : ''}${bt.totalReturn}% | Win Rate: ${bt.winRate}% (${bt.wins}W/${bt.losses}L)`,
    `Sharpe: ${bt.sharpe} | MDD: -${bt.maxDrawdown}% | Profit Factor: ${bt.profitFactor}`,
    `Avg Win: +${bt.avgWin}% | Avg Loss: ${bt.avgLoss}% | Mejor: +${bt.bestTrade}% | Peor: ${bt.worstTrade}%`,
    bt.totalTrades > 0 ? `Equity Final: $${bt.finalEquity?.toLocaleString() || 'N/A'} (de $10,000)` : `Sin trades ejecutados en el período`,
  ].join('\n');
}

module.exports = { runBacktest, formatBacktestContext };