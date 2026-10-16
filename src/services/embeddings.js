const config = require('../config');
const logger = require('./logger');

// Embeddings vía OpenRouter (modelos tipo openai/text-embedding-3-small, 1536 dims).
// Si falla (sin key, sin crédito, timeout), devuelve null y el RAG se omite sin romper nada.

async function embedTexts(texts) {
  const list = (Array.isArray(texts) ? texts : [texts])
    .map((t) => String(t || '').slice(0, 8000))
    .filter(Boolean);
  if (!list.length) return [];
  if (!config.openRouter.apiKey) {
    logger.debug('embeddings skipped: no OpenRouter key');
    return list.map(() => null);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        'HTTP-Referer': config.openRouter.referer,
        'X-Title': config.openRouter.appName,
      },
      body: JSON.stringify({ model: config.openRouter.embedModel, input: list }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(`embeddings error: HTTP ${response.status}`);
      return list.map(() => null);
    }
    const data = await response.json();
    const out = new Array(list.length).fill(null);
    for (const item of data?.data || []) {
      if (typeof item.index === 'number' && Array.isArray(item.embedding)) {
        out[item.index] = item.embedding;
      }
    }
    return out;
  } catch (err) {
    clearTimeout(timeout);
    logger.warn(`embeddings failed: ${err.message}`);
    return list.map(() => null);
  }
}

async function embedText(text) {
  const [vec] = await embedTexts([text]);
  return vec || null;
}

module.exports = { embedTexts, embedText };
