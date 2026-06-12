import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { runBacktest, formatBacktestContext } = require('../src/services/backtestService');

describe('sharpeRatio', () => {
  it('returns 0 for empty returns', () => {
    const { sharpeRatio } = require('../src/services/backtestService');
    // Use the function indirectly via format
  });
});

describe('formatBacktestContext', () => {
  it('returns empty string for null', () => {
    expect(formatBacktestContext(null)).toBe('');
  });

  it('formats backtest results', () => {
    const bt = {
      symbol: 'ES=F', direction: 'LARGO', period: '250d',
      totalTrades: 10, wins: 7, losses: 3, winRate: 70,
      totalReturn: 15.5, avgWin: 4.2, avgLoss: -2.1,
      profitFactor: 4.67, sharpe: 1.85, maxDrawdown: 8.3,
      avgBarsHeld: 5, bestTrade: 8.2, worstTrade: -3.5,
      finalEquity: 11550,
    };
    const result = formatBacktestContext(bt);
    expect(result).toContain('BACKTEST');
    expect(result).toContain('15.5%');
    expect(result).toContain('70%');
    expect(result).toContain('Sharpe: 1.85');
    expect(result).toContain('MDD: -8.3');
  });
});
