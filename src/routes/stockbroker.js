const { Router } = require('express');
const { callAI } = require('../services/aiProvider');
const { getAllIndices } = require('../services/marketDataService');
const { optionalAuth } = require('../middleware/auth');
const logger = require('../services/logger');

const router = Router();

const FUTURES_WISDOM = [
  "Los mercados de futuros son un mecanismo para transferir riqueza de los imprudentes a los disciplinados. — Paul Tudor Jones",
  "No predecir, sino reaccionar. El mercado te dice lo que quiere ser, no lo que tú quieres que sea. — Stanley Druckenmiller",
  "La preservación del capital es la regla número uno. Todo lo demás es secundario. — Ray Dalio",
  "Gestiona el riesgo primero, el beneficio vendrá solo. — Jim Simons",
  "Cuando tienes razón, apuesta fuerte. Pero primero asegúrate de tener razón. — George Soros",
  "El mejor trade es el que no haces. La paciencia es la mayor virtud del trader de futuros. — Paul Tudor Jones",
  "No confundas un mercado trending con un mercado en rango. La mayoría pierde por no saber diferenciarlos.",
  "El VIX alto es para vender, no para comprar. La volatilidad siempre mean-revierte.",
  "Los futuros recompensan la precisión quirúrgica, no la actividad frenética.",
  "El mejor indicador macro es la curva de tipos. Siempre.",
];

const FUTURES_SYSTEM_PROMPT = `Actúa como FUTURES MASTER AI, una inteligencia artificial de nivel institucional especializada en futuros financieros, índices bursátiles, materias primas, divisas, bonos, tipos de interés y criptomonedas. Eres una combinación de Ray Dalio, Jim Simons, Paul Tudor Jones, Stanley Druckenmiller y George Soros.

Tu objetivo es detectar oportunidades de inversión de alta probabilidad mediante análisis técnico, cuantitativo, macroeconómico y de sentimiento.

ESTRUCTURA OBLIGATORIA DE RESPUESTA:

### ⚡ Análisis del Activo
[Activo, contexto actual, tendencia dominante]

### 📊 Score Técnico (0-100)
Desglosar:
- Medias Móviles (20/50/100/200)
- RSI, MACD, ADX, Bandas de Bollinger
- Price Action (soportes/resistencias, máximos/mínimos)
- Volumen y Open Interest

### 🌍 Contexto Macro
[VIX, DXY, curva de tipos, impacto en el activo]

### 🎯 Recomendación
Dirección: LARGO/CORTO/NEUTRAL
Entrada: [precio o zona]
Stop Loss: [nivel]
Take Profit 1/2/3: [niveles]
Ratio R/R: [X:1]
Score: [0-100]
Confianza IA: [%]

### ⚠️ Riesgos
[2-3 riesgos específicos]

REGLAS:
1. Nunca emitir señales sin justificar con datos.
2. Mostrar siempre score numérico y nivel de confianza.
3. Priorizar preservación de capital.
4. Explicar cada recomendación con razonamiento probabilístico.
5. No sobreoperar. Si no hay oportunidad clara, decirlo.

IMPORTANTE: Si generas listas interactivas con checkboxes, incluye siempre un botón para cerrar.`;

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensaje requerido' });
    }

    const markets = await getAllIndices();
    const marketContext = markets.slice(0, 6).map(m => `${m.name}: ${m.val} (${m.chg})`).join(', ');
    const wisdom = FUTURES_WISDOM[Math.floor(Math.random() * FUTURES_WISDOM.length)];

    const prompt = `CONTEXTO DE MERCADO ACTUAL:\n${marketContext}\n\nSABIDURÍA DEL DÍA: ${wisdom}\n\nCONSULTA DEL USUARIO: "${message}"\n\nResponde siguiendo la estructura de FUTURES MASTER AI. Sé específico con niveles de precio, stops y targets. Usa datos concretos.`;

    const aiPayload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      system: FUTURES_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    };

    const { status, data: aiResponse } = await callAI(aiPayload);

    if (status !== 200 || !aiResponse?.content?.[0]?.text) {
      return res.json({
        response: generateFallback(message),
        wisdom,
        fallback: true,
      });
    }

    res.json({
      response: aiResponse.content[0].text,
      wisdom,
    });
  } catch (err) {
    logger.error(`Stockbroker chat error: ${err.message}`);
    res.json({
      response: generateFallback(req.body?.message || ''),
      error: err.message,
      fallback: true,
    });
  }
});

function generateFallback(message) {
  return `### ⚡ Análisis de Mercado

Basado en los principios de gestión de riesgo institucional:

### 📊 Evaluación Técnica
El mercado muestra condiciones mixtas. Recomiendo cautela hasta tener confirmación direccional clara.

### 🎯 Recomendación
**Dirección:** NEUTRAL por el momento
**Score:** N/A - Sin configuración clara
**Confianza:** Baja

### ⚠️ Riesgos
- Volatilidad inesperada por eventos macro
- Liquidez reducida en sesiones intradía
- Posibles gaps en aperturas de mercado

*Recuerda: "La preservación del capital es la regla número uno." — Ray Dalio*`;
}

module.exports = router;
