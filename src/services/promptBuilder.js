const { getAllIndices } = require('./marketDataService');

function formatMarketContext(markets) {
  if (!markets || markets.length === 0) return 'Datos de mercado no disponibles.';
  return markets
    .map((m) => `  ${m.name}: ${m.val} (${m.chg}) — Vol: ${m.vol}`)
    .join('\n');
}

async function buildSystemPrompt(baseSystem, type) {
  const markets = await getAllIndices();
  const context = formatMarketContext(markets);

  const marketBlock =
    'DATOS DE MERCADO EN TIEMPO REAL:\n' +
    context +
    '\n\n';

  const typeInstructions = {
    recommendations: `Eres un algoritmo de selección de acciones con 20 criterios técnicos y fundamentales.
IMPORTANTE: Usa los DATOS DE MERCADO EN TIEMPO REAL provistos arriba para contextualizar tu respuesta.
Responde SOLO en JSON válido, sin texto extra, sin markdown, sin backticks.
Devuelve exactamente este formato:
{"acciones":[{"ticker":"AAPL","nombre":"Apple Inc","mercado":"NASDAQ","precio":"186.42","variacion":"+1.2%","puntuacion":87,"criterios_met":17,"razon":"Razón breve","catalizador":"Catalizador próximo","riesgo":"bajo","sector":"Tecnología"}]}`,

    alerts: `Eres un sistema de detección de eventos extraordinarios de mercado.
IMPORTANTE: Usa los DATOS DE MERCADO EN TIEMPO REAL provistos arriba para contextualizar tus alertas.
Responde SOLO en JSON válido, sin texto extra, sin markdown, sin backticks.
Devuelve exactamente este formato:
{"alertas":[{"tipo":"geopolitico","nivel":"critical","titulo":"Título","descripcion":"Descripción","impacto":"alto","acciones_afectadas":["TICKER"],"sector":"Energía","direccion":"negativo"}]}
Tipos válidos: geopolitico, adquisicion, producto, tecnologia, contratacion, regulacion`,

    summary: `Eres un analista financiero senior especializado en mercados globales.
IMPORTANTE: Usa los DATOS DE MERCADO EN TIEMPO REAL provistos arriba para tu análisis.
Escribe resúmenes diarios profesionales y en español. Estructura obligatoria:
1. APERTURA Y TONO GENERAL (3-4 líneas)
2. MOVIMIENTOS DESTACADOS POR ÍNDICE
3. SECTORES LÍDERES Y REZAGADOS HOY
4. MACRO: factor dominante del día
5. PUNTO DE ATENCIÓN para la próxima sesión
6. CONCLUSIÓN del analista (2 líneas)`,

    executive: `Eres un analista financiero senior. Responde en español, máximo 5 líneas.
IMPORTANTE: Usa los DATOS DE MERCADO EN TIEMPO REAL provistos arriba para tu respuesta.`,

    analysis: `Eres un analista financiero experto. Responde siempre en español. Sé conciso, directo y profesional.
IMPORTANTE: Usa los DATOS DE MERCADO EN TIEMPO REAL provistos arriba.
Incluye: 1) Análisis técnico, 2) Factores clave, 3) Perspectiva, 4) Niveles de soporte y resistencia.`,
  };

  const instruction = typeInstructions[type] || baseSystem;
  return marketBlock + instruction;
}

async function buildMessages(type, userContent, markets) {
  const system = await buildSystemPrompt('', type);
  const marketContext = formatMarketContext(markets);

  let enrichedContent = userContent;
  if (type !== 'analysis') {
    enrichedContent = `Contexto de mercado actual:\n${marketContext}\n\n${userContent}`;
  }

  return { system, userMessage: enrichedContent };
}

module.exports = { buildMessages, buildSystemPrompt, formatMarketContext };
