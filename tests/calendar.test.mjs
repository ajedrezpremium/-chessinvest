import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { formatCalendarContext, generateEconomicSchedule } = require('../src/services/economicCalendar');

describe('generateEconomicSchedule', () => {
  it('generates events with required fields', () => {
    const cal = generateEconomicSchedule();
    expect(cal.events.length).toBeGreaterThan(0);
    cal.events.forEach(e => {
      expect(e).toHaveProperty('title');
      expect(e).toHaveProperty('country');
      expect(e).toHaveProperty('impact');
      expect(e).toHaveProperty('date');
    });
  });

  it('includes high impact events', () => {
    const cal = generateEconomicSchedule();
    expect(cal.highImpact.length).toBeGreaterThan(0);
    cal.highImpact.forEach(e => {
      expect(e.impact).toBe('High');
    });
  });

  it('has Fed meeting event', () => {
    const cal = generateEconomicSchedule();
    const fed = cal.events.find(e => e.title.includes('Fed'));
    expect(fed).toBeDefined();
  });

  it('has NFP event', () => {
    const cal = generateEconomicSchedule();
    const nfp = cal.events.find(e => e.title.includes('Non-Farm'));
    expect(nfp).toBeDefined();
  });

  it('has CPI event', () => {
    const cal = generateEconomicSchedule();
    const cpi = cal.events.find(e => e.title.includes('CPI'));
    expect(cpi).toBeDefined();
  });
});

describe('formatCalendarContext', () => {
  it('returns empty string for null input', () => {
    expect(formatCalendarContext(null)).toBe('');
  });

  it('returns empty string for empty events', () => {
    expect(formatCalendarContext({ events: [] })).toBe('');
  });

  it('formats events with impact icons', () => {
    const cal = {
      events: [
        { title: 'Fed Rate Decision', country: 'US', impact: 'High', date: new Date(Date.now() + 86400000).toISOString(), forecast: '5.5%', previous: '5.5%' },
      ]
    };
    const result = formatCalendarContext(cal);
    expect(result).toContain('🔴');
    expect(result).toContain('Fed Rate Decision');
    expect(result).toContain('🇺🇸');
  });

  it('marks today events with 🔴 HOY', () => {
    const cal = {
      events: [
        { title: 'NFP', country: 'US', impact: 'High', date: new Date().toISOString(), forecast: '—', previous: '—' },
      ]
    };
    const result = formatCalendarContext(cal);
    expect(result).toContain('🔴 HOY');
  });
});
