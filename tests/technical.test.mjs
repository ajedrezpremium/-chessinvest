import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { calcRSI, calcMACD, calcSMA, calcBollinger, findSupportResistance } = require('../src/services/technicalAnalysisService');

describe('calcSMA', () => {
  it('computes simple moving average', () => {
    const prices = [10, 20, 30, 40, 50];
    expect(calcSMA(prices, 3)).toBe(40);
  });

  it('returns null for insufficient data', () => {
    expect(calcSMA([10, 20], 3)).toBeNull();
  });

  it('handles empty array', () => {
    expect(calcSMA([], 5)).toBeNull();
  });
});

describe('calcRSI', () => {
  it('returns 100 when all gains', () => {
    const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115];
    expect(calcRSI(prices, 14)).toBe(100);
  });

  it('returns ~0 when all losses', () => {
    const prices = [115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
    expect(calcRSI(prices, 14)).toBe(0);
  });

  it('returns null for insufficient data', () => {
    expect(calcRSI([100], 14)).toBeNull();
  });

  it('returns ~50 for alternating data', () => {
    const prices = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101];
    const rsi = calcRSI(prices, 14);
    expect(rsi).toBeGreaterThanOrEqual(45);
    expect(rsi).toBeLessThanOrEqual(55);
  });
});

describe('calcMACD', () => {
  it('returns null for insufficient data', () => {
    expect(calcMACD([1, 2, 3])).toBeNull();
  });

  it('returns object with macd, signal, histogram for sufficient data', () => {
    const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.5) * 10);
    const result = calcMACD(prices);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('histogram');
    expect(typeof result.macd).toBe('number');
  });
});

describe('calcBollinger', () => {
  it('returns null for insufficient data', () => {
    expect(calcBollinger([1, 2, 3], 20)).toBeNull();
  });

  it('computes bands for sufficient data', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.random() * 10);
    const result = calcBollinger(prices, 20);
    expect(result).not.toBeNull();
    expect(result.upper).toBeGreaterThan(result.middle);
    expect(result.lower).toBeLessThan(result.middle);
  });
});

describe('findSupportResistance', () => {
  it('returns nulls for insufficient data', () => {
    const quotes = [{ high: 100, low: 90 }];
    const result = findSupportResistance(quotes);
    expect(result.support).toBeNull();
    expect(result.resistance).toBeNull();
  });

  it('finds recent high and low', () => {
    const quotes = Array.from({ length: 60 }, (_, i) => ({
      high: 100 + Math.sin(i * 0.1) * 10,
      low: 90 + Math.sin(i * 0.1) * 10,
      close: 95 + Math.sin(i * 0.1) * 10,
    }));
    const result = findSupportResistance(quotes);
    expect(result.support).toBeGreaterThan(0);
    expect(result.resistance).toBeGreaterThan(result.support);
  });
});
