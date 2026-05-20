const Stripe = require('stripe');
const config = require('../config');
const logger = require('./logger');
const { get, run } = require('./database');

const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;

const PLANS = {
  free: { price: 0, name: 'Gratis', features: ['basic_markets', '1_ai_analysis', '5_watchlist'] },
  basic: { price: 499, name: 'Básico', features: ['all_markets', '5_ai_daily', '25_watchlist', '3_alerts', '3_portfolios'] },
  pro: { price: 1499, name: 'Pro', features: ['unlimited_ai', 'technical_analysis', '15_alerts', 'unlimited_portfolios', 'export_csv', 'priority_support'] },
  premium: { price: 4999, name: 'Premium', features: ['everything', 'voice_ai', 'sms_alerts', 'api_access', 'unlimited_alerts', 'webhook_export', 'phone_support'] },
};

const PLAN_LIMITS = {
  free: { aiAnalysisPerDay: 1, watchlist: 5, alerts: 0, portfolios: 1, recommendations: 3 },
  basic: { aiAnalysisPerDay: 5, watchlist: 25, alerts: 3, portfolios: 3, recommendations: 10 },
  pro: { aiAnalysisPerDay: -1, watchlist: -1, alerts: 15, portfolios: -1, recommendations: -1 },
  premium: { aiAnalysisPerDay: -1, watchlist: -1, alerts: -1, portfolios: -1, recommendations: -1 },
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

async function createCheckoutSession(userId, email, plan) {
  if (!stripe) throw new Error('Stripe not configured');

  const planConfig = PLANS[plan];
  if (!planConfig || planConfig.price === 0) throw new Error('Invalid plan');

  const customer = await stripe.customers.create({
    email,
    metadata: { userId: String(userId) },
  });

  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `CHESS INVEST ${planConfig.name}`,
            description: `Plan ${planConfig.name} - Acceso mensual`,
          },
          unit_amount: planConfig.price,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    success_url: `${config.appUrl}/?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
    cancel_url: `${config.appUrl}/?cancelled=true`,
    metadata: { userId: String(userId), plan },
  });

  return { url: session.url, sessionId: session.id };
}

async function handleWebhookEvent(event) {
  const { get, run } = require('./database');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = parseInt(session.metadata.userId);
      const plan = session.metadata.plan;

      await run(
        `UPDATE subscriptions SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, 
         status = 'active', current_period_start = datetime('now'), 
         current_period_end = datetime('now', '+1 month'), updated_at = datetime('now')
         WHERE user_id = ?`,
        [plan, session.customer, session.subscription, userId],
      );
      logger.info(`Subscription activated: user ${userId}, plan ${plan}`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      const userId = parseInt(customer.metadata.userId);

      const plan = Object.keys(PLANS).find(p => {
        const priceId = PLANS[p].stripePriceId;
        return priceId && sub.items.data.some(item => item.price.id === priceId);
      }) || 'free';

      await run(
        `UPDATE subscriptions SET plan = ?, status = ?, current_period_start = ?, 
         current_period_end = ?, cancel_at = ?, updated_at = datetime('now')
         WHERE user_id = ?`,
        [
          plan,
          sub.status,
          new Date(sub.current_period_start * 1000).toISOString(),
          new Date(sub.current_period_end * 1000).toISOString(),
          sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
          userId,
        ],
      );
      logger.info(`Subscription updated: user ${userId}, plan ${plan}, status ${sub.status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customer = await stripe.customers.retrieve(sub.customer);
      const userId = parseInt(customer.metadata.userId);

      await run(
        `UPDATE subscriptions SET plan = 'free', status = 'cancelled', 
         current_period_end = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ?`,
        [userId],
      );
      logger.info(`Subscription cancelled: user ${userId}`);
      break;
    }

    default:
      logger.info(`Unhandled Stripe event: ${event.type}`);
  }
}

async function createBillingPortalSession(customerId) {
  if (!stripe) throw new Error('Stripe not configured');

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: config.appUrl,
  });

  return { url: session.url };
}

async function getUserSubscription(userId) {
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
  if (!sub) return { plan: 'free', status: 'active' };

  return {
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    cancelAt: sub.cancel_at,
    stripeCustomerId: sub.stripe_customer_id,
  };
}

module.exports = {
  PLANS,
  PLAN_LIMITS,
  getPlanLimits,
  createCheckoutSession,
  handleWebhookEvent,
  createBillingPortalSession,
  getUserSubscription,
  stripe,
};
