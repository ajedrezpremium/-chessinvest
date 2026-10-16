// Seed de la base de conocimiento RAG.
// Uso: node ingest-knowledge.js (requiere supabase-v2-rag-newsletter.sql aplicado + OPENROUTER_API_KEY)
require('dotenv').config({ path: '.env' });
const { ingestChunks } = require('./src/services/rag');

const DOCS = [
  {
    source: 'metodologia',
    content: `Metodología ChessInvest: algoritmo de 20 criterios (máx 100 puntos). Análisis técnico (5): RSI 14 en 40-60; MACD cruce alcista; precio sobre medias 50 y 200; volumen +20% sobre media; soporte respetado. Fundamental (5): PER sectorial <20; BPA +15% interanual; margen neto sobre media; Deuda/EBITDA <3x; FCF positivo y creciente. Macro (5): revisiones de analistas positivas 3 meses; sector favorable a tipos; baja correlación en correcciones; geografía diversificada; dividendo estable o creciente. Riesgo/momentum (5): volatilidad implícita <30%; beta <1.3; short interest <5%; momentum 3m sobre índice; catalizador próximo. La puntuación es experimental, no garantía de rentabilidad.`,
  },
  {
    source: 'aviso-legal',
    content: `Aviso legal ChessInvest: la información es solo educativa e informativa. No constituye asesoramiento financiero ni recomendación de compra/venta. Los análisis de IA son automatizados sobre datos públicos y no garantizan resultados. Cada decisión es responsabilidad del usuario. Rentabilidades pasadas no garantizan futuras. Consulta a un asesor cualificado. Límites por plan: free 5 consultas IA/día, basic 25, pro 100, premium 500.`,
  },
  {
    source: 'glosario',
    content: `Glosario básico: PER = precio/beneficio, múltiplo de valoración. BPA = beneficio por acción. ROE = rentabilidad sobre fondos propios. RSI = índice de fuerza relativa (momentum 0-100). MACD = convergencia/divergencia de medias móviles. Beta = sensibilidad frente al mercado (1 = igual). FCF = flujo de caja libre. CAGR = tasa anual compuesta. Stop-loss = orden de corte de pérdidas. Diversificación = repartir riesgo entre activos. Interés compuesto = reinvertir beneficios.`,
  },
  {
    source: 'planes',
    content: `Planes ChessInvest: Free (mercados básicos, 5 consultas IA/día, watchlist 5, sin alertas). Basic 4,99€/mes (todos los mercados, 25 consultas/día, watchlist 25, 3 alertas, 3 carteras). Pro 14,99€/mes (IA ampliada, análisis técnico, 15 alertas, carteras ilimitadas, export CSV). Premium 49,99€/mes (todo + voz IA, alertas SMS, API, alertas ilimitadas, webhooks, soporte telefónico). Gestión en /pricing y portal de facturación Stripe.`,
  },
  {
    source: 'newsletter',
    content: `Newsletter diario ChessInvest "Top 20 IA": cada mañana se genera una edición con las 20 noticias más impactantes (score 0-100 por relevancia, sorpresa y efecto en cartera). Cada usuario configura temas (tecnología, energía, macro...), impacto mínimo, idioma y hora. Canales: web, email, Telegram (canal + DM). WhatsApp solo en planes pro/premium como add-on. El histórico queda guardado y alimenta el RAG de los agentes.`,
  },
  {
    source: 'agentes',
    content: `Agentes ChessInvest: 1) ChessInvest AI (Amigo Inversor): análisis por ticker y chat general, con memoria de conversación, contexto de cartera y alertas proactivas; modos backtest histórico y debate abogado-del-diablo. 2) Stockbroker Futures: señales LARGO/CORTO/NEUTRAL con entrada, stop, targets, score 0-100 y confianza; guarda señales automáticamente con backtest y P&L. Ambos citan riesgos y nunca dan órdenes de compra/venta.`,
  },
];

(async () => {
  try {
    const result = await ingestChunks(DOCS);
    console.log(`Ingest OK: ${result.inserted} insertados, ${result.skipped} omitidos`);
    process.exit(0);
  } catch (err) {
    console.error(`Ingest FAILED: ${err.message}`);
    process.exit(1);
  }
})();
