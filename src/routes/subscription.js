const express = require('express');
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  createCheckoutSession,
  handleWebhookEvent,
  createBillingPortalSession,
  getUserSubscription,
  stripe,
} = require('../services/stripe');
const { getSupabaseAdmin } = require('../services/supabase');
const config = require('../config');

const router = Router();

// Webhook needs raw body for signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!config.stripe.webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'Webhook handler failed', details: err.message });
  }
});

router.post('/billing-portal', requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('user_id', req.user.id).single();
    if (!sub?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const session = await createBillingPortalSession(sub.stripe_customer_id);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create billing portal session', details: err.message });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const subscription = await getUserSubscription(req.user.id);
    const limits = require('../services/stripe').getPlanLimits(subscription.plan);

    const admin = getSupabaseAdmin();
    const [{ count: watchlistCount }, { count: alertCount }, { data: portfolioRows }] = await Promise.all([
      admin.from('watchlist').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id),
      admin.from('price_alerts').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('active', 1),
      admin.from('portfolio').select('ticker').eq('user_id', req.user.id),
    ]);
    const portfolioCount = new Set((portfolioRows || []).map((r) => r.ticker)).size;

    res.json({
      ...subscription,
      limits: {
        watchlist: { current: watchlistCount || 0, max: limits.watchlist },
        alerts: { current: alertCount || 0, max: limits.alerts },
        portfolios: { current: portfolioCount, max: limits.portfolios },
        aiAnalysisPerDay: limits.aiAnalysisPerDay,
        recommendations: limits.recommendations,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get subscription status', details: err.message });
  }
});

router.get('/plans', (_req, res) => {
  res.json(require('../services/stripe').PLANS);
});

module.exports = router;
