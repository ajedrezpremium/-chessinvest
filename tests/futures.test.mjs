import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { FUTURES_SYMBOLS, getFuturesColor } = require('../src/services/futuresDataService');

describe('FUTURES_SYMBOLS', () => {
  it('has all required futures symbols', () => {
    const ids = FUTURES_SYMBOLS.map(f => f.id);
    expect(ids).toContain('vix');
    expect(ids).toContain('dxy');
    expect(ids).toContain('gold');
    expect(ids).toContain('wti');
    expect(ids).toContain('btc');
    expect(ids).toContain('spx');
    expect(ids).toContain('ndx');
    expect(ids).toContain('us10y');
  });

  it('each symbol has required fields', () => {
    FUTURES_SYMBOLS.forEach(f => {
      expect(f).toHaveProperty('id');
      expect(f).toHaveProperty('symbol');
      expect(f).toHaveProperty('name');
      expect(f.symbol).toBeTruthy();
      expect(f.name).toBeTruthy();
    });
  });
});

describe('getFuturesColor', () => {
  const mockFutures = [
    { id: 'spx', dir: 'up' },
    { id: 'vix', dir: 'down' },
    { id: 'unknown', dir: 'neutral' },
  ];

  it('returns green for up direction', () => {
    expect(getFuturesColor(mockFutures, 'spx')).toBe('green');
  });

  it('returns red for down direction', () => {
    expect(getFuturesColor(mockFutures, 'vix')).toBe('red');
  });

  it('returns yellow for unknown id', () => {
    expect(getFuturesColor(mockFutures, 'nonexistent')).toBe('yellow');
  });

  it('returns yellow for empty data', () => {
    expect(getFuturesColor([], 'spx')).toBe('yellow');
  });
});
