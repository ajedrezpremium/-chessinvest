import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { safeParseRecomendaciones, safeParseAlertas } = require('../src/services/schemas');

describe('safeParseRecomendaciones', () => {
  const validAccion = {
    ticker: 'AAPL',
    nombre: 'Apple Inc',
    mercado: 'NASDAQ',
    precio: '186.42',
    variacion: '+1.2%',
    puntuacion: 87,
    criterios_met: 17,
    razon: 'Buena compañía',
    catalizador: 'Próximo earnings',
    riesgo: 'bajo',
    sector: 'Tecnología',
  };

  it('accepts valid recommendations', () => {
    const result = safeParseRecomendaciones({ acciones: [validAccion] });
    expect(result.valid).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('rejects empty ticker', () => {
    const result = safeParseRecomendaciones({ acciones: [{ ...validAccion, ticker: '' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects score > 100', () => {
    const result = safeParseRecomendaciones({ acciones: [{ ...validAccion, puntuacion: 150 }] });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid riesgo', () => {
    const result = safeParseRecomendaciones({ acciones: [{ ...validAccion, riesgo: 'ultra' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects empty array', () => {
    const result = safeParseRecomendaciones({ acciones: [] });
    expect(result.valid).toBe(false);
  });
});

describe('safeParseAlertas', () => {
  const validAlerta = {
    tipo: 'geopolitico',
    nivel: 'critical',
    titulo: 'Alerta test',
    descripcion: 'Descripción test',
    impacto: 'alto',
    acciones_afectadas: ['AAPL'],
    sector: 'Tecnología',
    direccion: 'positivo',
  };

  it('accepts valid alerts', () => {
    const result = safeParseAlertas({ alertas: [validAlerta] });
    expect(result.valid).toBe(true);
    expect(result.data).toHaveLength(1);
  });

  it('rejects invalid tipo', () => {
    const result = safeParseAlertas({ alertas: [{ ...validAlerta, tipo: 'inventado' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects empty acciones_afectadas', () => {
    const result = safeParseAlertas({ alertas: [{ ...validAlerta, acciones_afectadas: [] }] });
    expect(result.valid).toBe(false);
  });
});
