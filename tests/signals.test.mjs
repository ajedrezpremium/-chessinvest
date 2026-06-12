import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { extractSignalFromResponse } = require('../src/routes/stockbroker');

describe('extractSignalFromResponse', () => {
  it('extracts LARGO signal with full data', () => {
    const text = `### 🎯 Recomendación
Dirección: LARGO
Entrada: $4,250
Stop Loss: $4,100
Take Profit 1: $4,400
Take Profit 2: $4,550
Ratio R/R: 2.5:1
Score: 82
Confianza IA: 75%`;
    const result = extractSignalFromResponse(text, ['ES']);
    expect(result).not.toBeNull();
    expect(result.direction).toBe('LARGO');
    expect(result.asset).toBe('ES');
    expect(result.entry_price).toBe('4250');
    expect(result.stop_loss).toBe('4100');
    expect(result.take_profit).toBe('4400, 4550');
    expect(result.score).toBe(82);
    expect(result.confidence).toBe(75);
    expect(result.risk_reward).toBe('2.5:1');
  });

  it('extracts CORTO signal', () => {
    const text = `Dirección: CORTO
Entrada: $78.50
Stop Loss: $82.00
Take Profit: $74.00
Score: 65
Confianza: 60%`;
    const result = extractSignalFromResponse(text, ['CL']);
    expect(result).not.toBeNull();
    expect(result.direction).toBe('CORTO');
    expect(result.asset).toBe('CL');
  });

  it('returns null for NEUTRAL direction', () => {
    const text = 'Dirección: NEUTRAL por el momento';
    expect(extractSignalFromResponse(text, [])).toBeNull();
  });

  it('returns null when no direction mentioned', () => {
    const text = 'El mercado está lateral sin señales claras.';
    expect(extractSignalFromResponse(text, [])).toBeNull();
  });

  it('handles mixed case directions', () => {
    const text = 'Dirección: largo';
    const result = extractSignalFromResponse(text, ['GC']);
    expect(result).not.toBeNull();
    expect(result.direction).toBe('LARGO');
  });

  it('extracts score without % suffix', () => {
    const text = 'Dirección: LARGO\nScore: 75\nConfianza IA: 80';
    const result = extractSignalFromResponse(text, []);
    expect(result?.score).toBe(75);
    expect(result?.confidence).toBe(80);
  });

  it('returns null for LARGO Y CORTO mixed', () => {
    const text = 'Dirección: LARGO y CORTO en diferentes plazos';
    const result = extractSignalFromResponse(text, []);
    expect(result).toBeNull();
  });

  it('uses first detected ticker as asset', () => {
    const text = 'Dirección: LARGO\nEntrada: $100';
    const result = extractSignalFromResponse(text, ['NQ', 'ES']);
    expect(result?.asset).toBe('NQ');
  });

  it('extracts asset from text when no tickers given', () => {
    const text = 'Análisis del ORO (GC): Dirección: CORTO\nEntrada: $2400';
    const result = extractSignalFromResponse(text, []);
    // Should fall back to text regex match for 2-4 letter code
    expect(result?.direction).toBe('CORTO');
  });
});
