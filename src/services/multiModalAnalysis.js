const { getAllIndices } = require('./marketDataService');
const { getTechnicalAnalysis } = require('./technicalAnalysis');
const { fetchStockData } = require('./stockAnalyzer');
const logger = require('./logger');

function formatBigNumber(num) {
  if (!num || isNaN(num)) return 'N/A';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(2);
}

function extractFundamentals(ticker, data) {
  const q = data?.quote;
  const m = data?.modules;
  if (!q && !m) return null;

  const fd = m?.financialData || {};
  const ks = m?.defaultKeyStatistics || {};
  const sd = m?.summaryDetail || {};
  const rec = m?.recommendationTrend || {};

  const recTrend = rec.trend || [];
  const latestRec = recTrend[0] || {};

  return {
    price: q?.regularMarketPrice,
    change: q?.regularMarketChange,
    changePct: q?.regularMarketChangePercent,
    marketCap: formatBigNumber(q?.marketCap),
    pe: sd?.trailingPE || fd?.currentPE || 'N/A',
    forwardPE: sd?.forwardPE || 'N/A',
    roe: ks?.returnOnEquity ? (ks.returnOnEquity * 100).toFixed(1) + '%' : 'N/A',
    beta: ks?.beta || 'N/A',
    profitMargin: fd?.profitMargins ? (fd.profitMargins * 100).toFixed(1) + '%' : 'N/A',
    revenueGrowth: fd?.revenueGrowth ? (fd.revenueGrowth * 100).toFixed(1) + '%' : 'N/A',
    earningsGrowth: fd?.earningsGrowth ? (fd.earningsGrowth * 100).toFixed(1) + '%' : 'N/A',
    debtToEquity: fd?.debtToEquity ? fd.debtToEquity.toFixed(1) : 'N/A',
    freeCashflow: formatBigNumber(fd?.freeCashflow),
    dividendYield: sd?.dividendYield ? (sd.dividendYield * 100).toFixed(2) + '%' : 'N/A',
    targetMeanPrice: fd?.targetMeanPrice || 'N/A',
    targetHighPrice: fd?.targetHighPrice || 'N/A',
    targetLowPrice: fd?.targetLowPrice || 'N/A',
    numberOfAnalysts: fd?.numberOfAnalystOpinions || 0,
    analystRatings: {
      strongBuy: latestRec.strongBuy || 0,
      buy: latestRec.buy || 0,
      hold: latestRec.hold || 0,
      sell: latestRec.sell || 0,
      strongSell: latestRec.strongSell || 0,
    },
    yearHigh: q?.fiftyTwoWeekHigh || 'N/A',
    yearLow: q?.fiftyTwoWeekLow || 'N/A',
    volume: formatBigNumber(q?.regularMarketVolume),
  };
}

function calculateChessInvestScore(fundamentals, technicals, sentiment) {
  let score = 0;
  const maxScore = 100;
  const breakdown = {};

  // FUNDAMENTAL (40 points max)
  let fundamentalScore = 0;
  if (fundamentals) {
    // PER (8 pts)
    if (fundamentals.pe !== 'N/A') {
      const pe = parseFloat(fundamentals.pe);
      if (pe > 0 && pe < 15) fundamentalScore += 8;
      else if (pe < 25) fundamentalScore += 6;
      else if (pe < 40) fundamentalScore += 3;
      else fundamentalScore += 1;
    }

    // ROE (8 pts)
    if (fundamentals.roe !== 'N/A') {
      const roe = parseFloat(fundamentals.roe);
      if (roe > 20) fundamentalScore += 8;
      else if (roe > 15) fundamentalScore += 6;
      else if (roe > 10) fundamentalScore += 4;
      else if (roe > 0) fundamentalScore += 2;
    }

    // Revenue Growth (8 pts)
    if (fundamentals.revenueGrowth !== 'N/A') {
      const growth = parseFloat(fundamentals.revenueGrowth);
      if (growth > 20) fundamentalScore += 8;
      else if (growth > 10) fundamentalScore += 6;
      else if (growth > 0) fundamentalScore += 3;
      else fundamentalScore += 0;
    }

    // Debt/Equity (8 pts)
    if (fundamentals.debtToEquity !== 'N/A') {
      const de = parseFloat(fundamentals.debtToEquity);
      if (de < 30) fundamentalScore += 8;
      else if (de < 50) fundamentalScore += 6;
      else if (de < 100) fundamentalScore += 3;
      else fundamentalScore += 1;
    }

    // Profit Margin (8 pts)
    if (fundamentals.profitMargin !== 'N/A') {
      const margin = parseFloat(fundamentals.profitMargin);
      if (margin > 25) fundamentalScore += 8;
      else if (margin > 15) fundamentalScore += 6;
      else if (margin > 5) fundamentalScore += 4;
      else if (margin > 0) fundamentalScore += 2;
    }
  }
  breakdown.fundamental = Math.min(40, fundamentalScore);

  // TECHNICAL (25 points max)
  let technicalScore = 0;
  if (technicals?.signal) {
    const sig = technicals.signal;
    if (sig.recommendation === 'COMPRA FUERTE') technicalScore += 10;
    else if (sig.recommendation === 'COMPRA') technicalScore += 7;
    else if (sig.recommendation === 'NEUTRAL') technicalScore += 5;
    else if (sig.recommendation === 'VENTA') technicalScore += 2;
    else technicalScore += 0;
  }

  if (technicals?.indicators?.rsi) {
    const rsi = technicals.indicators.rsi;
    if (rsi >= 40 && rsi <= 60) technicalScore += 8;
    else if (rsi >= 30 && rsi < 40) technicalScore += 6;
    else if (rsi > 60 && rsi <= 70) technicalScore += 5;
    else if (rsi < 30) technicalScore += 4;
    else technicalScore += 1;
  }

  if (technicals?.indicators?.sma) {
    const sma = technicals.indicators.sma;
    const price = technicals.currentPrice;
    if (sma.sma20 && sma.sma50 && price > sma.sma20 && sma.sma20 > sma.sma50) technicalScore += 7;
    else if (sma.sma20 && price > sma.sma20) technicalScore += 4;
  }
  breakdown.technical = Math.min(25, technicalScore);

  // SENTIMENT (20 points max)
  let sentimentScore = 0;
  if (sentiment) {
    sentimentScore = Math.round((sentiment.score / 100) * 20);
  }
  breakdown.sentiment = sentimentScore;

  // ANALYST CONSENSUS (15 points max)
  let analystScore = 0;
  if (fundamentals?.analystRatings) {
    const ratings = fundamentals.analystRatings;
    const total = ratings.strongBuy + ratings.buy + ratings.hold + ratings.sell + ratings.strongSell;
    if (total > 0) {
      const bullishRatio = (ratings.strongBuy + ratings.buy * 0.7) / total;
      analystScore = Math.round(bullishRatio * 15);
    }
  }
  breakdown.analyst = analystScore;

  const totalScore = breakdown.fundamental + breakdown.technical + breakdown.sentiment + breakdown.analyst;

  let grade, label, emoji;
  if (totalScore >= 85) { grade = 'A+'; label = 'Excelente'; emoji = '🏆'; }
  else if (totalScore >= 75) { grade = 'A'; label = 'Muy Bueno'; emoji = '⭐'; }
  else if (totalScore >= 65) { grade = 'B+'; label = 'Bueno'; emoji = '👍'; }
  else if (totalScore >= 55) { grade = 'B'; label = 'Aceptable'; emoji = '📊'; }
  else if (totalScore >= 45) { grade = 'C'; label = 'Regular'; emoji = '⚠️'; }
  else if (totalScore >= 35) { grade = 'D'; label = 'Débil'; emoji = '🔻'; }
  else { grade = 'F'; label = 'Muy Débil'; emoji = '❌'; }

  return {
    score: Math.min(100, totalScore),
    grade,
    label,
    emoji,
    breakdown,
  };
}

function analyzeSentiment(fundamentals, technicals, marketData) {
  let score = 50;
  const signals = [];

  if (fundamentals) {
    const ratings = fundamentals.analystRatings;
    const totalRatings = ratings.strongBuy + ratings.buy + ratings.hold + ratings.sell + ratings.strongSell;
    if (totalRatings > 0) {
      const bullishWeight = (ratings.strongBuy * 1 + ratings.buy * 0.5) / totalRatings;
      const bearishWeight = (ratings.strongSell * 1 + ratings.sell * 0.5) / totalRatings;
      const sentiment = (bullishWeight - bearishWeight) * 20;
      score += sentiment;
      signals.push(`Analistas: ${ratings.strongBuy + ratings.buy} alcistas de ${totalRatings}`);
    }

    if (fundamentals.pe !== 'N/A' && fundamentals.pe < 20) {
      score += 5;
      signals.push('PER atractivo (<20)');
    } else if (fundamentals.pe > 40) {
      score -= 5;
      signals.push('PER elevado (>40)');
    }

    if (fundamentals.revenueGrowth !== 'N/A' && parseFloat(fundamentals.revenueGrowth) > 10) {
      score += 5;
      signals.push('Crecimiento de ingresos sólido');
    }

    if (fundamentals.debtToEquity !== 'N/A' && parseFloat(fundamentals.debtToEquity) < 50) {
      score += 3;
      signals.push('Deuda controlada');
    }
  }

  if (technicals?.signal) {
    const sig = technicals.signal;
    if (sig.recommendation.includes('COMPRA')) {
      score += sig.recommendation === 'COMPRA FUERTE' ? 10 : 5;
      signals.push(`Señal técnica: ${sig.recommendation}`);
    } else if (sig.recommendation.includes('VENTA')) {
      score -= sig.recommendation === 'VENTA FUERTE' ? 10 : 5;
      signals.push(`Señal técnica: ${sig.recommendation}`);
    }
  }

  if (technicals?.indicators?.rsi) {
    const rsi = technicals.indicators.rsi;
    if (rsi < 30) {
      score += 5;
      signals.push('RSI sobrevendido (oportunidad)');
    } else if (rsi > 70) {
      score -= 5;
      signals.push('RSI sobrecomprado (precaución)');
    }
  }

  let marketBreadth = 0.5;
  if (marketData && marketData.length > 0) {
    const upCount = marketData.filter(m => m.dir === 'up').length;
    marketBreadth = upCount / marketData.length;
    if (marketBreadth > 0.7) {
      score += 5;
      signals.push('Mayoría de índices en positivo');
    } else if (marketBreadth < 0.3) {
      score -= 5;
      signals.push('Mayoría de índices en negativo');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label, color, emoji, fearGreedLabel;
  if (score >= 80) { label = 'Muy Alcista'; color = '#00e676'; emoji = '🟢'; fearGreedLabel = 'Codicia Extrema'; }
  else if (score >= 60) { label = 'Alcista'; color = '#4caf50'; emoji = '🟢'; fearGreedLabel = 'Codicia'; }
  else if (score >= 40) { label = 'Neutral'; color = '#ffb300'; emoji = '🟡'; fearGreedLabel = 'Neutral'; }
  else if (score >= 20) { label = 'Bajista'; color = '#ff6b6b'; emoji = '🔴'; fearGreedLabel = 'Miedo'; }
  else { label = 'Muy Bajista'; color = '#ff4444'; emoji = '🔴'; fearGreedLabel = 'Miedo Extremo'; }

  return {
    score,
    label,
    color,
    emoji,
    fearGreed: fearGreedLabel,
    marketBreadth: Math.round(marketBreadth * 100) + '%',
    signals: signals.slice(0, 6),
  };
}

function buildMacroContext(marketData) {
  if (!marketData || marketData.length === 0) return 'Datos macro no disponibles.';

  const us = marketData.filter(m => m.region === 'americas' && ['sp500', 'nasdaq', 'dji'].includes(m.id));
  const eu = marketData.filter(m => m.region === 'europe');
  const asia = marketData.filter(m => m.region === 'asia');

  const formatRegion = (markets, name) => {
    if (!markets.length) return '';
    return `${name}: ${markets.map(m => `${m.name} ${m.val} (${m.chg})`).join(', ')}`;
  };

  return [
    formatRegion(us, '🇺🇸 EE.UU.'),
    formatRegion(eu, '🇪🇺 Europa'),
    formatRegion(asia, '🌏 Asia'),
  ].filter(Boolean).join('\n');
}

async function getMultiModalAnalysis(ticker) {
  const [fundamentalData, technicals, marketData] = await Promise.allSettled([
    fetchStockData(ticker),
    getTechnicalAnalysis(ticker),
    getAllIndices(),
  ]);

  const fundamentals = fundamentalData.status === 'fulfilled' ? extractFundamentals(ticker, fundamentalData.value) : null;
  const tech = technicals.status === 'fulfilled' ? technicals.value : null;
  const markets = marketData.status === 'fulfilled' ? marketData.value : [];

  const sentiment = analyzeSentiment(fundamentals, tech, markets);
  const chessInvestScore = calculateChessInvestScore(fundamentals, tech, sentiment);
  const macroContext = buildMacroContext(markets);

  return {
    ticker: ticker.toUpperCase(),
    timestamp: new Date().toISOString(),
    fundamental: fundamentals,
    technical: tech,
    sentiment,
    macro: macroContext,
    chessInvestScore,
  };
}

function buildMultiModalPrompt(ticker, analysis, userMessage, portfolioContext, proactiveAlerts, conversationHistory, historicalContext, debateContext) {
  const { fundamental, technical, sentiment, macro, chessInvestScore } = analysis;

  let prompt = `ANÁLISIS MULTI-MODAL DE ${ticker}:\n\n`;

  if (portfolioContext) {
    prompt += `### 📁 CONTEXTO DE TU PORTFOLIO\n${portfolioContext}\n`;
  }

  if (proactiveAlerts?.length > 0) {
    prompt += `### 🚨 ALERTAS PROACTIVAS\n${proactiveAlerts.map(a => `- ${a.message}`).join('\n')}\n\n`;
  }

  if (conversationHistory) {
    prompt += `### 💬 CONVERSACIÓN PREVIA\n${conversationHistory}\n`;
  }

  if (historicalContext) {
    prompt += `### ⏳ ${historicalContext}\n`;
  }

  if (debateContext) {
    prompt += `### 🎭 ${debateContext}\n`;
  }

  // ChessInvest Score
  if (chessInvestScore) {
    prompt += `### ♟️ CHESSINVEST SCORE
Score: ${chessInvestScore.score}/100 (${chessInvestScore.emoji} ${chessInvestScore.grade} - ${chessInvestScore.label})
Desglose:
- Fundamental (40pts): ${chessInvestScore.breakdown.fundamental}/40
- Técnico (25pts): ${chessInvestScore.breakdown.technical}/25
- Sentimiento (20pts): ${chessInvestScore.breakdown.sentiment}/20
- Analistas (15pts): ${chessInvestScore.breakdown.analyst}/15

`;
  }

  if (fundamental) {
    prompt += `### 📊 FUNDAMENTAL
Precio: ${fundamental.price} (${fundamental.change >= 0 ? '+' : ''}${fundamental.changePct?.toFixed(2) || 0}%)
Market Cap: ${fundamental.marketCap} | PER: ${fundamental.pe} | Forward PE: ${fundamental.forwardPE}
ROE: ${fundamental.roe} | Beta: ${fundamental.beta}
Margen: ${fundamental.profitMargin} | Crec. Ingresos: ${fundamental.revenueGrowth}
Deuda/Equity: ${fundamental.debtToEquity} | FCF: ${fundamental.freeCashflow}
Dividendo: ${fundamental.dividendYield}
Objetivo: ${fundamental.targetMeanPrice} (rango: ${fundamental.targetLowPrice}-${fundamental.targetHighPrice})
Analistas: ${fundamental.numberOfAnalysts} | Ratings: ${fundamental.analystRatings.strongBuy}FC/${fundamental.analystRatings.buy}C/${fundamental.analystRatings.hold}M/${fundamental.analystRatings.sell}V/${fundamental.analystRatings.strongSell}FV
Rango 52 sem: ${fundamental.yearLow} - ${fundamental.yearHigh}

`;
  }

  if (technical) {
    prompt += `### 📈 TÉCNICO
Precio: ${technical.currentPrice} | RSI: ${technical.indicators?.rsi || 'N/A'}
MACD: ${technical.indicators?.macd?.macd || 'N/A'} | Signal: ${technical.indicators?.macd?.signal || 'N/A'}
SMA20: ${technical.indicators?.sma?.sma20 || 'N/A'} | SMA50: ${technical.indicators?.sma?.sma50 || 'N/A'}
Bollinger: ${technical.indicators?.bollinger ? `U:${technical.indicators.bollinger.upper} M:${technical.indicators.bollinger.middle} L:${technical.indicators.bollinger.lower}` : 'N/A'}
Soporte: ${technical.indicators?.supportResistance?.support || 'N/A'} | Resistencia: ${technical.indicators?.supportResistance?.resistance || 'N/A'}
Señal: ${technical.signal?.recommendation || 'N/A'} (score: ${technical.signal?.score || 0})
Patrones: ${technical.indicators?.candlestick?.map(p => p.name).join(', ') || 'Ninguno detectado'}

`;
  }

  prompt += `### 🎯 SENTIMIENTO Y MIEDO/CODICIA
Score: ${sentiment.score}/100 (${sentiment.emoji} ${sentiment.label})
Miedo vs Codicia: ${sentiment.fearGreed}
Amplitud de Mercado: ${sentiment.marketBreadth} de índices alcistas
Factores: ${sentiment.signals.join(' | ')}

`;

  prompt += `### 🌍 MACRO
${macro}

`;

  prompt += `PREGUNTA DEL USUARIO: "${userMessage}"

INSTRUCCIONES:
1. Integra TODAS las dimensiones (fundamental, técnico, sentimiento, macro) en tu respuesta
2. Da una opinión profesional y honesta sobre riesgos y oportunidades
3. Incluye contexto de cómo cada dimensión afecta la tesis de inversión
4. Si el usuario tiene portfolio, explica cómo ${ticker} se relaciona con sus holdings actuales (diversificación, correlación, riesgo)
5. Si hay conversación previa, referencia lo que hablaron antes para construir sobre ello
6. Sé conversacional pero preciso con los datos
7. Termina con una pregunta de seguimiento para mantener la conversación

FORMATO OBLIGATORIO DE RESPUESTA:
### 🧠 Mi Razonamiento
[Explica PASO A PASO cómo llegaste a tu conclusión. Ejemplo: "Primero miro el fundamental... luego confirmo con el técnico... el sentimiento me dice... el macro contexto sugiere... Por eso mi conclusión es..."]

### 📊 Comparador de Escenarios
**🟢 Caso Alcista (bull):** [Qué pasaría si todo sale bien. Precio objetivo, catalizadores, probabilidad estimada]
**🟡 Caso Base:** [Escenario más probable. Precio esperado, timeline, probabilidad estimada]
**🔴 Caso Bajista (bear):** [Qué pasaría si sale mal. Precio mínimo, riesgos, probabilidad estimada]

### 📊 Conclusión
[Tu respuesta directa y recomendación basada en los escenarios]

### ⚠️ Riesgos a Vigilar
[2-3 riesgos específicos con datos concretos]

IMPORTANTE: Si generas formularios HTML interactivos (checkboxes, radios, etc), NUNCA incluyas etiquetas <form> o HTML interactivo. En su lugar, usa listas con checkboxes simples. Si debes generar HTML interactivo, incluye siempre un botón para cerrar.`;

  return prompt;
}

module.exports = { getMultiModalAnalysis, buildMultiModalPrompt };
