const config = require('../config');
const { getUserSubscription } = require('./supabaseAuth');

// Resuelve la cadena de modelos [primario, ..., fallback] según el plan.
// Los modelos por plan son opcionales (env MODEL_FREE/BASIC/PRO/PREMIUM);
// si no están definidos se usa el modelo global. El fallback siempre va último.

function modelForPlan(plan) {
  const primary = config.openRouter.models?.[plan] || config.openRouter.model;
  const chain = [primary];
  const fallback = config.openRouter.fallbackModel;
  if (fallback && !chain.includes(fallback)) chain.push(fallback);
  return chain;
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

async function modelsForRequest(req) {
  const plan = await planForUser(req?.user?.id);
  return { plan, models: modelForPlan(plan) };
}

module.exports = { modelForPlan, planForUser, modelsForRequest };
