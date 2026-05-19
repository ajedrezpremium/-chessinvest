const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ queue: { concurrency: 2 }, suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const logger = require('./logger');

async function fetchStockData(ticker) {
  const results = {};

  try {
    const quote = await yahooFinance.quote(ticker, { timeout: 8000 });
    results.quote = quote;
  } catch (err) {
    logger.warn(`Quote failed for ${ticker}: ${err.message}`);
    results.quote = null;
  }

  try {
    const now = new Date();
    const past = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const chart = await yahooFinance.chart(ticker, {
      period1: past,
      period2: now,
      interval: '1d',
    }, { timeout: 8000 });
    results.chart = chart;
  } catch (err) {
    logger.warn(`Chart failed for ${ticker}: ${err.message}`);
    results.chart = null;
  }

  try {
    const modules = await yahooFinance.modules(ticker, {
      modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail', 'earnings', 'recommendationTrend'],
      timeout: 8000,
    });
    results.modules = modules;
  } catch (err) {
    logger.warn(`Modules failed for ${ticker}: ${err.message}`);
    results.modules = null;
  }

  return results;
}

function buildAnalysisPrompt(ticker, data) {
  const q = data.quote;
  const m = data.modules;
  const chart = data.chart;

  const price = q?.regularMarketPrice || 'N/A';
  const change = q?.regularMarketChange || 0;
  const changePct = q?.regularMarketChangePercent || 0;
  const vol = q?.regularMarketVolume || 0;
  const prevClose = q?.regularMarketPreviousClose || price;
  const dayHigh = q?.regularMarketDayHigh || price;
  const dayLow = q?.regularMarketDayLow || price;
  const yearHigh = q?.fiftyTwoWeekHigh || 'N/A';
  const yearLow = q?.fiftyTwoWeekLow || 'N/A';
  const marketCap = q?.marketCap || 0;

  const fd = m?.financialData || {};
  const ks = m?.defaultKeyStatistics || {};
  const sd = m?.summaryDetail || {};
  const rec = m?.recommendationTrend || {};

  const per = fd?.currentPrice && fd?.targetMeanPrice ? ((fd.currentPrice / fd.targetMeanPrice) * 100 - 100).toFixed(1) : 'N/A';
  const targetPrice = fd?.targetMeanPrice || 'N/A';
  const targetHigh = fd?.targetHighPrice || 'N/A';
  const targetLow = fd?.targetLowPrice || 'N/A';
  const numAnalysts = fd?.numberOfAnalystOpinions || 0;
  const roe = ks?.returnOnEquity ? (ks.returnOnEquity * 100).toFixed(1) + '%' : 'N/A';
  const pe = sd?.trailingPE || fd?.currentPE || 'N/A';
  const forwardPE = sd?.forwardPE || 'N/A';
  const divYield = sd?.dividendYield ? (sd.dividendYield * 100).toFixed(2) + '%' : 'N/A';
  const beta = ks?.beta || 'N/A';
  const profitMargin = fd?.profitMargins ? (fd.profitMargins * 100).toFixed(1) + '%' : 'N/A';
  const revenueGrowth = fd?.revenueGrowth ? (fd.revenueGrowth * 100).toFixed(1) + '%' : 'N/A';
  const earningsGrowth = fd?.earningsGrowth ? (fd.earningsGrowth * 100).toFixed(1) + '%' : 'N/A';
  const debtToEquity = fd?.debtToEquity ? fd.debtToEquity.toFixed(1) : 'N/A';
  const freeCashflow = fd?.freeCashflow ? formatBigNumber(fd.freeCashflow) : 'N/A';
  const operatingCashflow = fd?.operatingCashflow ? formatBigNumber(fd.operatingCashflow) : 'N/A';

  const recTrend = rec.trend || [];
  const latestRec = recTrend[0] || {};
  const strongBuy = latestRec.strongBuy || 0;
  const buy = latestRec.buy || 0;
  const hold = latestRec.hold || 0;
  const sell = latestRec.sell || 0;
  const strongSell = latestRec.strongSell || 0;

  let chartAnalysis = '';
  if (chart?.quotes && chart.quotes.length > 0) {
    const quotes = chart.quotes.filter(q => q.close);
    if (quotes.length > 5) {
      const recent = quotes.slice(-30);
      const sma20 = recent.slice(-20).reduce((s, q) => s + q.close, 0) / 20;
      const sma50 = quotes.slice(-50).reduce((s, q) => s + q.close, 0) / Math.min(50, quotes.length);
      const rsi = calculateRSI(quotes.slice(-15));
      const trend = price > sma20 ? 'alcista' : price > sma50 ? 'lateral-alcista' : 'bajista';
      chartAnalysis = `
- Precio actual: ${price} vs SMA20: ${sma20.toFixed(2)} vs SMA50: ${sma50.toFixed(2)}
- Tendencia: ${trend}
- RSI (14 días): ${rsi.toFixed(1)}
- Máximo 52 sem: ${yearHigh} | Mínimo 52 sem: ${yearLow}
- Volumen hoy: ${formatBigNumber(vol)}
`;
    }
  }

  const marketCapStr = formatBigNumber(marketCap);

  return `Analiza la acción ${ticker} con el siguiente estilo profesional tipo WarrenAI.

DATOS REALES DE MERCADO:
Precio: ${price} | Cambio: ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)
Máx/Mín día: ${dayHigh} / ${dayLow} | Cierre anterior: ${prevClose}
Cap. mercado: ${marketCapStr}

MÉTRICAS FUNDAMENTALES:
- PER: ${pe} | PER Forward: ${forwardPE}
- ROE: ${roe} | Beta: ${beta}
- Margen beneficio: ${profitMargin}
- Crecimiento ingresos: ${revenueGrowth} | Crecimiento beneficios: ${earningsGrowth}
- Deuda/Capital: ${debtToEquity}
- Free Cash Flow: ${freeCashflow} | Operating Cash Flow: ${operatingCashflow}
- Dividendo: ${divYield}

ANÁLISIS TÉCNICO:${chartAnalysis}
PRECIO OBJETIVO ANALISTAS:
- Media: ${targetPrice} | Máximo: ${targetHigh} | Mínimo: ${targetLow}
- Analistas: ${numAnalysts}
- Recomendaciones: ${strongBuy} fuerte compra, ${buy} compra, ${hold} mantener, ${sell} venta, ${strongSell} fuerte venta

FORMATO DE RESPUESTA (en español, profesional, conciso):

### 🚀 Momentum y tendencia

[2-3 líneas sobre el momentum actual, si está cerca de máximos/mínimos, y la tendencia general]

### 📈 ¿Fundamentos sólidos?

- **PER:** ${pe} — [evaluación breve]
- **ROE:** ${roe} — [evaluación breve]
- **Crecimiento ingresos:** ${revenueGrowth} — [evaluación breve]
- **Rentabilidad por dividendo:** ${divYield} — [evaluación breve]
- **Margen beneficio:** ${profitMargin} — [evaluación breve]

###  Análisis técnico

[2-3 líneas sobre tendencia, RSI, medias móviles, soportes/resistencias]

### ⚖️ ¿Qué vigilar ahora?

- **Pro:** [2-3 puntos positivos clave]
- **Contra:** [2-3 riesgos o puntos negativos]
- **Precio objetivo:** ${targetPrice} (upside: ${per}%) según ${numAnalysts} analistas

### 🧠 ChessInvest Take

[2-3 párrafos con tu conclusión profesional: valoración general, perfil de inversor adecuado, nivel de vigilancia necesario. Sé directo y honesto sobre riesgos.]

*Este contenido es solo para fines informativos y no constituye asesoramiento de inversión.*`;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i].close - prices[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function formatBigNumber(num) {
  if (!num || isNaN(num)) return 'N/A';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(2);
}

module.exports = { fetchStockData, buildAnalysisPrompt };
