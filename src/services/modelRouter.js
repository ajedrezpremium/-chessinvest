const config = require('../config');
const { getUserSubscription } = require('./supabaseAuth');
const { persistMarketData, loadMarketData } = require('./marketCache');
const logger = require('./logger');

// Resuelve la cadena de modelos [primario, ..., fallback] según el plan.
// - Primario: MODEL_<PLAN> o modelo global.
// - Intermedio (planes free/default): mejor modelo :free disponible EN ESE MOMENTO
//   (la lista de OpenRouter rota; se re-evalúa cada 6h).
// - Último: MODEL_FALLBACK.

const FREE_CACHE_KEY = 'openrouter:free-models';
const FREE_TTL_MS = 6 * 60 * 60 * 1000;

let freeCache = { list: null, pick: null, ts: 0 };
let freeInflight = null;

function modelForPlan(plan) {
  return config.openRouter.models?.[plan] || config.openRouter.model;
}

async function planForUser(userId) {
  if (!userId) return 'free';
  try {
    const sub = await getUserSubscription(userId);
    return sub?.plan || 'free';
  } catch {
    return 'free';
  }
}

function scoreFreeModel(m) {
  const id = String(m?.id || '');
  if (!/:free$/.test(id)) return -1;
  const arch = m.architecture || {};
  const inM = arch.input_modalities || [];
  const outM = arch.output_modalities || [];
  if (!inM.includes('text') || !outM.includes('text')) return -1;
  if (/embed|moderation|safety|guard|tts|stt|whisper|image-gen|video-gen|audio/i.test(id)) return -1;

  const low = id.toLowerCase();
  let s = 0;

  const families = [
    ['nemotron-3-ultra', 34], ['llama', 30], ['qwen', 30], ['deepseek', 30],
    ['mistral', 28], ['gemma', 26], ['ministral', 24], ['phi', 22],
    ['falcon', 22], ['kimi', 22], ['glm', 20], ['nemotron', 18],
    ['granite', 18], ['liquid', 16], ['inkling', 16], ['olmo', 14],
  ];
  for (const [fam, pts] of families) {
    if (low.includes(fam)) {
      s += pts;
      break;
    }
  }

  // Modelos free gigantes (>100B) suelen incumplir el timeout en interactivo:
  // el punto dulce para chat está en 20-70B.
  const sizes = [...low.matchAll(/(\d+(?:\.\d+)?)\s*b\b/g)].map((x) => Number(x[1]));
  if (sizes.length) {
    const p = Math.max(...sizes);
    s += p >= 400 ? 10 : p >= 65 ? 30 : p >= 30 ? 28 : p >= 20 ? 26 : p >= 10 ? 22 : p >= 7 ? 18 : p >= 3 ? 12 : 6;
  }

  const ctx = Number(m.context_length) || 0;
  s += ctx >= 128000 ? 16 : ctx >= 32000 ? 10 : ctx >= 8000 ? 5 : 0;

  if (m.created) {
    const ageDays = (Date.now() - Number(m.created) * 1000) / 86400000;
    s += ageDays < 90 ? 8 : ageDays < 365 ? 4 : 0;
  }

  if (/code|coder|\bvl\b|vision/i.test(low)) s -= 12;

  return s;
}

function pickBestFree(list) {
  let best = null;
  let bestScore = -1;
  const scored = [];
  for (const m of list || []) {
    const s = scoreFreeModel(m);
    if (s < 0) continue;
    scored.push({ id: m.id, s });
    if (s > bestScore) {
      bestScore = s;
      best = m.id;
    }
  }
  scored.sort((a, b) => b.s - a.s);
  return { pick: best, top: scored.slice(0, 3) };
}

async function fetchFreeModelList() {
  if (freeInflight) return freeInflight;
  freeInflight = (async () => {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'HTTP-Referer': config.openRouter.referer, 'X-Title': config.openRouter.appName },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = (data?.data || []).filter((m) => /:free$/.test(m?.id));
      freeCache = { list, pick: null, ts: Date.now() };
      persistMarketData(FREE_CACHE_KEY, { list, ts: Date.now() }).catch(() => {});
      return list;
    } finally {
      freeInflight = null;
    }
  })();
  return freeInflight;
}

async function getBestFreeModel() {
  const fresh = freeCache.list && Date.now() - freeCache.ts < FREE_TTL_MS;
  let list = fresh ? freeCache.list : null;

  if (!list) {
    try {
      list = await fetchFreeModelList();
    } catch (err) {
      logger.warn(`Free model list fetch failed: ${err.message}`);
      list = null;
    }
  }

  if (!list?.length) {
    try {
      const cached = await loadMarketData(FREE_CACHE_KEY, 7 * 24 * 60);
      if (cached?.data?.list?.length) list = cached.data.list;
    } catch { /* sin caché persistente */ }
  }

  if (!list?.length) return null;
  const { pick, top } = pickBestFree(list);
  if (pick && pick !== freeCache.pick) {
    logger.info(`Best free model: ${pick} (top: ${top.map((t) => `${t.id.split('/').pop()}@${t.s}`).join(', ')})`);
  }
  freeCache.pick = pick;
  return pick;
}

// Solo caché en memoria (para /api/status sin latencia extra); dispara refresh en fondo si caducó.
function peekBestFreeModel() {
  const fresh = freeCache.list && Date.now() - freeCache.ts < FREE_TTL_MS;
  if (!fresh && !freeInflight) {
    fetchFreeModelList()
      .then((list) => {
        const { pick } = pickBestFree(list);
        freeCache.pick = pick;
      })
      .catch(() => {});
  }
  return freeCache.pick;
}

async function modelsForRequest(req) {
  const plan = await planForUser(req?.user?.id);
  const primary = modelForPlan(plan);
  const chain = [];
  if (primary && primary !== 'openrouter/free') {
    chain.push(primary);
  }
  try {
    const best = await getBestFreeModel();
    if (best) chain.push(best);
  } catch { /* opcional */ }
  if (primary === 'openrouter/free' && !chain.includes(primary)) chain.push(primary);
  const fallback = config.openRouter.fallbackModel;
  if (fallback) chain.push(fallback);
  return { plan, models: chain.filter((m, i, a) => m && a.indexOf(m) === i) };
}

module.exports = { modelForPlan, planForUser, modelsForRequest, getBestFreeModel, peekBestFreeModel, scoreFreeModel };
