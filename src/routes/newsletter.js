const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserProfile } = require('../services/supabaseAuth');
const { getSupabaseAdmin } = require('../services/supabase');
const logger = require('../services/logger');
const { generateDailyNewsletter, sendNewsletterToSubscribers, getLatestNewsletter, getNewsletterSubscribers, getTodayNewsletter, getNewsletterItems, filterItems } = require('../services/newsletterService');
const { generateLinkCode, isConfigured: telegramConfigured } = require('../services/telegramService');

const router = Router();

router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { subscribed } = req.body;
    const val = subscribed !== false ? 1 : 0;
    await admin.from('user_settings').upsert({
      user_id: req.user.id,
      newsletter_subscribed: val,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    res.json({ subscribed: !!val, message: val ? 'Suscripto al newsletter diario' : 'Desuscripto del newsletter diario' });
  } catch (err) {
    logger.error(`Newsletter subscribe error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: row } = await admin.from('user_settings').select('newsletter_subscribed').eq('user_id', req.user.id).single();
    res.json({ subscribed: row?.newsletter_subscribed !== 0 });
  } catch {
    res.json({ subscribed: true });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const nl = await getLatestNewsletter();
    if (!nl) return res.json({ exists: false });
    res.json({ exists: true, id: nl.id, title: nl.title, summary: nl.summary, content: nl.content, generated_at: nl.generated_at, sent_count: nl.sent_count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch newsletter' });
  }
});

// Edición de hoy con items estructurados (público; filtros opcionales por query)
router.get('/today', async (req, res) => {
  try {
    const nl = await getTodayNewsletter();
    if (!nl) return res.json({ exists: false });
    const minImpact = Number(req.query.min_impact) || 0;
    const topics = req.query.topics || 'all';
    const items = filterItems(nl.items || [], topics, minImpact);
    res.json({
      exists: true,
      id: nl.id,
      title: nl.title,
      summary: nl.summary,
      generated_at: nl.generated_at,
      sent_count: nl.sent_count,
      total_items: (nl.items || []).length,
      items,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch newsletter' });
  }
});

router.get('/items/:id', async (req, res) => {
  try {
    const items = await getNewsletterItems(req.params.id);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Preferencias de newsletter del usuario (temas, hora, idioma, impacto mínimo)
router.get('/prefs', requireAuth, async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('user_settings')
      .select('newsletter_subscribed, newsletter_topics, newsletter_time, newsletter_lang, newsletter_min_impact, telegram_enabled, telegram_chat_id')
      .eq('user_id', req.user.id)
      .single();
    res.json({
      subscribed: data?.newsletter_subscribed !== 0,
      topics: data?.newsletter_topics || 'all',
      time: data?.newsletter_time || '08:00',
      lang: data?.newsletter_lang || 'es',
      min_impact: data?.newsletter_min_impact ?? 0,
      telegram_enabled: !!data?.telegram_enabled,
      telegram_linked: !!data?.telegram_chat_id,
      telegram_configured: telegramConfigured(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch prefs' });
  }
});

// Genera código de vinculación Telegram (/start CODIGO en el bot)
router.post('/telegram/link', requireAuth, async (req, res) => {
  try {
    if (!telegramConfigured()) {
      return res.status(503).json({ error: 'Telegram no configurado en el servidor (TELEGRAM_BOT_TOKEN)' });
    }
    const result = await generateLinkCode(req.user.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate link code' });
  }
});

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfile(req.user.id);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const result = await generateDailyNewsletter();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/send', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfile(req.user.id);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const nid = req.body.newsletterId || null;
    const result = await sendNewsletterToSubscribers(nid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/subscribers', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfile(req.user.id);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const subs = await getNewsletterSubscribers();
    res.json({ count: subs.length, subscribers: subs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfile(req.user.id);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const admin = getSupabaseAdmin();
    const { data } = await admin.from('newsletters').select('id, title, summary, generated_at, sent_count').order('generated_at', { ascending: false }).limit(30);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
