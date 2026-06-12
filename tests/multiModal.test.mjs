import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { calculateChessInvestScore, analyzeSentiment, buildMacroContext } = require('../src/services/multiModalAnalysis');

describe('calculateChessInvestScore', () => {
  const mockFundamentals = {
    pe: '18.5',
    roe: '25.3%',
    revenueGrowth: '15.2%',
    debtToEquity: '22.5',
    profitMargin: '20.1%',
    analystRatings: { strongBuy: 12, buy: 8, hold: 3, sell: 1, strongSell: 0 },
  };

  const mockTechnicals = {
    currentPrice: 185.42,
    signal: { recommendation: 'COMPRA FUERTE', score: 6 },
    indicators: {
      rsi: 54,
      sma: { sma20: 180.5, sma50: 175.2 },
    },
  };

  const mockSentiment = { score: 65 };

  it('computes score with all data available', () => {
    const result = calculateChessInvestScore(mockFundamentals, mockTechnicals, mockSentiment);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.grade).toMatch(/^[A-F][+-]?$/);
    expect(result.breakdown).toHaveProperty('fundamental');
    expect(result.breakdown).toHaveProperty('technical');
    expect(result.breakdown).toHaveProperty('sentiment');
    expect(result.breakdown).toHaveProperty('analyst');
  });

  it('returns lowest grade with poor data', () => {
    const bad = { pe: '85', roe: '1.2%', revenueGrowth: '-5%', debtToEquity: '250', profitMargin: '0.5%', analystRatings: { strongBuy: 0, buy: 0, hold: 1, sell: 8, strongSell: 5 } };
    const result = calculateChessInvestScore(bad, { signal: { recommendation: 'VENTA' }, indicators: { rsi: 25 } }, { score: 15 });
    expect(result.grade).toBe('F');
  });

  it('handles null fundamentals gracefully', () => {
    const result = calculateChessInvestScore(null, null, { score: 50 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.breakdown.fundamental).toBe(0);
    expect(result.breakdown.technical).toBe(0);
  });
});

describe('analyzeSentiment', () => {
  it('returns neutral sentiment with minimal data', () => {
    const result = analyzeSentiment(null, null, []);
    expect(result.score).toBe(50);
    expect(result.fearGreed).toBe('Neutral');
  });

  it('detects bullish sentiment with strong fundamentals', () => {
    const fundamentals = { pe: '12', revenueGrowth: '25%', debtToEquity: '10', analystRatings: { strongBuy: 15, buy: 5, hold: 1, sell: 0, strongSell: 0 } };
    const technicals = { signal: { recommendation: 'COMPRA FUERTE' }, indicators: { rsi: 45 } };
    const result = analyzeSentiment(fundamentals, technicals, []);
    expect(result.score).toBeGreaterThan(60);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('detects bearish sentiment with poor data', () => {
    const fundamentals = { pe: '85', revenueGrowth: '-5%', debtToEquity: '300', analystRatings: { strongBuy: 0, buy: 1, hold: 2, sell: 10, strongSell: 8 } };
    const technicals = { signal: { recommendation: 'VENTA FUERTE' }, indicators: { rsi: 75 } };
    const result = analyzeSentiment(fundamentals, technicals, []);
    expect(result.score).toBeLessThan(40);
  });
});

describe('buildMacroContext', () => {
  it('returns fallback for empty data', () => {
    expect(buildMacroContext([])).toBe('Datos macro no disponibles.');
  });

  it('builds context from market data', () => {
    const markets = [
      { id: 'sp500', name: 'S&P 500', val: '6,025', chg: '+0.3%', region: 'americas' },
      { id: 'dax', name: 'DAX 40', val: '20,125', chg: '+0.4%', region: 'europe' },
      { id: 'nikkei', name: 'Nikkei 225', val: '39,850', chg: '-0.4%', region: 'asia' },
    ];
    const result = buildMacroContext(markets);
    expect(result).toContain('S&P 500');
    expect(result).toContain('DAX 40');
    expect(result).toContain('Nikkei 225');
  });

  it('handles null input', () => {
    const result = buildMacroContext(null);
    expect(result).toBe('Datos macro no disponibles.');
  });
});
