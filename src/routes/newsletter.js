const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { run, saveDb } = require('../services/database');
const logger = require('../services/logger');
const { generateDailyNewsletter, sendNewsletterToSubscribers, getLatestNewsletter, getNewsletterSubscribers } = require('../services/newsletterService');

const router = Router();

router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscribed } = req.body;
    const val = subscribed !== false ? 1 : 0;
    run('UPDATE user_settings SET newsletter_subscribed = ?, updated_at = datetime(\'now\') WHERE user_id = ?', [val, req.user.id]);
    saveDb();
    res.json({ subscribed: !!val, message: val ? 'Suscripto al newsletter diario' : 'Desuscripto del newsletter diario' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const row = require('../services/database').get('SELECT newsletter_subscribed FROM user_settings WHERE user_id = ?', [req.user.id]);
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

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const user = require('../services/database').get('SELECT role FROM users WHERE id = ?', [req.user.id]);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const result = await generateDailyNewsletter();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/send', requireAuth, async (req, res) => {
  try {
    const user = require('../services/database').get('SELECT role FROM users WHERE id = ?', [req.user.id]);
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
    const user = require('../services/database').get('SELECT role FROM users WHERE id = ?', [req.user.id]);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const subs = getNewsletterSubscribers();
    res.json({ count: subs.length, subscribers: subs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const user = require('../services/database').get('SELECT role FROM users WHERE id = ?', [req.user.id]);
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const all = require('../services/database').all('SELECT id, title, summary, generated_at, sent_count FROM newsletters ORDER BY generated_at DESC LIMIT 30');
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
