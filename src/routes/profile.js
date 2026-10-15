const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { updatePassword } = require('../services/supabaseAuth');
const {
  getUserSettings,
  updateUserSettings,
  getGoals,
  getIdeas,
  getAlerts,
  getWatchlist,
  getPortfolio,
  getProfileSummary,
  select,
  insert,
  update,
  upsert,
  remove,
} = require('../services/supabaseDb');
const logger = require('../services/logger');

const router = Router();

// ── Settings ──────────────────────────────────────────────

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const settings = await getUserSettings(req.user.id);
    if (!settings) {
      const newSettings = await updateUserSettings(req.user.id, {});
      return res.json(newSettings);
    }
    res.json(settings);
  } catch (err) {
    logger.error(`Get settings error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const allowedFields = [
      'theme',
      'notifications_email',
      'notifications_sms',
      'language',
      'timezone',
      'voice_enabled',
      'voice_input_enabled',
      'voice_rate',
      'voice_pitch',
      'voice_lang',
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const settings = await updateUserSettings(req.user.id, updates);
    res.json(settings);
  } catch (err) {
    logger.error(`Update settings error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update settings', details: err.message });
  }
});

// ── Goals ─────────────────────────────────────────────────

router.get('/goals', requireAuth, async (req, res) => {
  try {
    const goals = await getGoals(req.user.id);
    res.json(goals);
  } catch (err) {
    logger.error(`Get goals error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

router.post('/goals', requireAuth, async (req, res) => {
  try {
    const { title, target_amount, deadline, type } = req.body;
    if (!title || !target_amount) {
      return res.status(400).json({ error: 'Title and target_amount required' });
    }
    const goal = await insert('goals', {
      user_id: req.user.id,
      title,
      target_amount,
      deadline: deadline || null,
      type: type || 'savings',
    });
    res.status(201).json(goal);
  } catch (err) {
    logger.error(`Create goal error: ${err.message}`);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

router.put('/goals/:id', requireAuth, async (req, res) => {
  try {
    const { title, target_amount, current_amount, deadline, type } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (target_amount !== undefined) updates.target_amount = target_amount;
    if (current_amount !== undefined) updates.current_amount = current_amount;
    if (deadline !== undefined) updates.deadline = deadline;
    if (type !== undefined) updates.type = type;
    updates.updated_at = new Date().toISOString();

    const goal = await update('goals', req.params.id, updates);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json(goal);
  } catch (err) {
    logger.error(`Update goal error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

router.delete('/goals/:id', requireAuth, async (req, res) => {
  try {
    await remove('goals', req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Delete goal error: ${err.message}`);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// ── Investment Ideas ──────────────────────────────────────

router.get('/ideas', requireAuth, async (req, res) => {
  try {
    const ideas = await getIdeas(req.user.id);
    res.json(ideas);
  } catch (err) {
    logger.error(`Get ideas error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get ideas' });
  }
});

router.post('/ideas', requireAuth, async (req, res) => {
  try {
    const { ticker, thesis, notes, status } = req.body;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });
    const idea = await insert('investment_ideas', {
      user_id: req.user.id,
      ticker,
      thesis: thesis || '',
      notes: notes || '',
      status: status || 'pending',
    });
    res.status(201).json(idea);
  } catch (err) {
    logger.error(`Create idea error: ${err.message}`);
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

router.put('/ideas/:id', requireAuth, async (req, res) => {
  try {
    const { ticker, thesis, notes, status } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (ticker !== undefined) updates.ticker = ticker;
    if (thesis !== undefined) updates.thesis = thesis;
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;

    const idea = await update('investment_ideas', req.params.id, updates);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    res.json(idea);
  } catch (err) {
    logger.error(`Update idea error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

router.delete('/ideas/:id', requireAuth, async (req, res) => {
  try {
    await remove('investment_ideas', req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Delete idea error: ${err.message}`);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

// ── Price Alerts ──────────────────────────────────────────

router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const alerts = await getAlerts(req.user.id);
    res.json(alerts);
  } catch (err) {
    logger.error(`Get alerts error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get alerts' });
  }
});

router.post('/alerts', requireAuth, async (req, res) => {
  try {
    const { ticker, target_price, direction } = req.body;
    if (!ticker || !target_price || !direction) {
      return res.status(400).json({ error: 'Ticker, target_price and direction required' });
    }
    if (!['above', 'below'].includes(direction)) {
      return res.status(400).json({ error: 'Direction must be "above" or "below"' });
    }
    const alert = await insert('price_alerts', {
      user_id: req.user.id,
      ticker,
      target_price,
      direction,
    });
    res.status(201).json(alert);
  } catch (err) {
    logger.error(`Create alert error: ${err.message}`);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

router.put('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const { target_price, active } = req.body;
    const updates = {};
    if (target_price !== undefined) updates.target_price = target_price;
    if (active !== undefined) updates.active = active;

    const alert = await update('price_alerts', req.params.id, updates);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json(alert);
  } catch (err) {
    logger.error(`Update alert error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

router.delete('/alerts/:id', requireAuth, async (req, res) => {
  try {
    await remove('price_alerts', req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Delete alert error: ${err.message}`);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// ── Watchlist (for profile page) ──────────────────────────

router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const watchlist = await getWatchlist(req.user.id);
    res.json(watchlist);
  } catch (err) {
    logger.error(`Get watchlist error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get watchlist' });
  }
});

// ── Profile Summary ───────────────────────────────────────

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const summary = await getProfileSummary(req.user.id);
    res.json(summary);
  } catch (err) {
    logger.error(`Get profile summary error: ${err.message}`);
    res.status(500).json({ error: 'Failed to get profile summary' });
  }
});

// ── Personal Data ─────────────────────────────────────────

router.put('/personal', requireAuth, async (req, res) => {
  try {
    const allowedFields = [
      'first_name',
      'last_name',
      'phone',
      'birth_date',
      'country',
      'investor_profile',
      'experience',
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const user = await update('users', req.user.id, updates);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    logger.error(`Update personal data error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update personal data', details: err.message });
  }
});

// ── Avatar ────────────────────────────────────────────────

router.put('/avatar', requireAuth, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'Avatar required' });
    await update('users', req.user.id, { avatar });
    res.json({ success: true, avatar });
  } catch (err) {
    logger.error(`Update avatar error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// ── Password Change ───────────────────────────────────────

router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // This requires the user's current session - Supabase handles this via updatePassword
    // The access token is in the Authorization header
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await updatePassword(header.slice(7), new_password);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Change password error: ${err.message}`);
    if (err.message.includes('weak_password') || err.message.includes('Password should be')) {
      return res.status(400).json({ error: 'Password too weak' });
    }
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;