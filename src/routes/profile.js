const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { get, all, run } = require('../services/database');
const { hashPassword, verifyPassword } = require('../services/auth');

const router = Router();

// ── Settings ──────────────────────────────────────────────

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const settings = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    if (!settings) {
      await run('INSERT INTO user_settings (user_id) VALUES (?)', [req.user.id]);
      const newSettings = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
      return res.json(newSettings);
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const { theme, notifications_email, notifications_sms, language, timezone, voice_enabled, voice_input_enabled, voice_rate, voice_pitch, voice_lang } = req.body;
    const updates = {};
    if (theme !== undefined) updates.theme = theme;
    if (notifications_email !== undefined) updates.notifications_email = notifications_email;
    if (notifications_sms !== undefined) updates.notifications_sms = notifications_sms;
    if (language !== undefined) updates.language = language;
    if (timezone !== undefined) updates.timezone = timezone;
    if (voice_enabled !== undefined) updates.voice_enabled = voice_enabled;
    if (voice_input_enabled !== undefined) updates.voice_input_enabled = voice_input_enabled;
    if (voice_rate !== undefined) updates.voice_rate = voice_rate;
    if (voice_pitch !== undefined) updates.voice_pitch = voice_pitch;
    if (voice_lang !== undefined) updates.voice_lang = voice_lang;

    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.user.id];

    await run(`UPDATE user_settings SET ${fields}, updated_at = datetime('now') WHERE user_id = ?`, values);
    const settings = await get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings', details: err.message });
  }
});

// ── Goals ─────────────────────────────────────────────────

router.get('/goals', requireAuth, async (req, res) => {
  try {
    const goals = await all('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

router.post('/goals', requireAuth, async (req, res) => {
  try {
    const { title, target_amount, deadline, type } = req.body;
    if (!title || !target_amount) {
      return res.status(400).json({ error: 'Title and target_amount required' });
    }
    const result = await run(
      'INSERT INTO goals (user_id, title, target_amount, deadline, type) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, title, target_amount, deadline || null, type || 'savings'],
    );
    const goal = await get('SELECT * FROM goals WHERE id = ?', [result.lastID]);
    res.status(201).json(goal);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

router.put('/goals/:id', requireAuth, async (req, res) => {
  try {
    const { title, target_amount, current_amount, deadline, type } = req.body;
    await run(
      `UPDATE goals SET title = COALESCE(?, title), target_amount = COALESCE(?, target_amount),
       current_amount = COALESCE(?, current_amount), deadline = COALESCE(?, deadline),
       type = COALESCE(?, type) WHERE id = ? AND user_id = ?`,
      [title, target_amount, current_amount, deadline, type, req.params.id, req.user.id],
    );
    const goal = await get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json(goal);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

router.delete('/goals/:id', requireAuth, async (req, res) => {
  try {
    const result = await run('DELETE FROM goals WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Goal not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// ── Investment Ideas ──────────────────────────────────────

router.get('/ideas', requireAuth, async (req, res) => {
  try {
    const ideas = await all('SELECT * FROM investment_ideas WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id]);
    res.json(ideas);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get ideas' });
  }
});

router.post('/ideas', requireAuth, async (req, res) => {
  try {
    const { ticker, thesis, notes, status } = req.body;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });
    const result = await run(
      'INSERT INTO investment_ideas (user_id, ticker, thesis, notes, status) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, ticker, thesis || '', notes || '', status || 'pending'],
    );
    const idea = await get('SELECT * FROM investment_ideas WHERE id = ?', [result.lastID]);
    res.status(201).json(idea);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

router.put('/ideas/:id', requireAuth, async (req, res) => {
  try {
    const { ticker, thesis, notes, status } = req.body;
    await run(
      `UPDATE investment_ideas SET ticker = COALESCE(?, ticker), thesis = COALESCE(?, thesis),
       notes = COALESCE(?, notes), status = COALESCE(?, status),
       updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      [ticker, thesis, notes, status, req.params.id, req.user.id],
    );
    const idea = await get('SELECT * FROM investment_ideas WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    res.json(idea);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

router.delete('/ideas/:id', requireAuth, async (req, res) => {
  try {
    const result = await run('DELETE FROM investment_ideas WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Idea not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

// ── Price Alerts ──────────────────────────────────────────

router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const alerts = await all('SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(alerts);
  } catch (err) {
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
    const result = await run(
      'INSERT INTO price_alerts (user_id, ticker, target_price, direction) VALUES (?, ?, ?, ?)',
      [req.user.id, ticker, target_price, direction],
    );
    const alert = await get('SELECT * FROM price_alerts WHERE id = ?', [result.lastID]);
    res.status(201).json(alert);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

router.put('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const { target_price, active } = req.body;
    await run(
      'UPDATE price_alerts SET target_price = COALESCE(?, target_price), active = COALESCE(?, active) WHERE id = ? AND user_id = ?',
      [target_price, active, req.params.id, req.user.id],
    );
    const alert = await get('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

router.delete('/alerts/:id', requireAuth, async (req, res) => {
  try {
    const result = await run('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// ── Watchlist (for profile page) ──────────────────────────

router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const watchlist = await all('SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC', [req.user.id]);
    res.json(watchlist);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get watchlist' });
  }
});

// ── Profile Summary ───────────────────────────────────────

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const user = await get('SELECT id, email, username, created_at FROM users WHERE id = ?', [req.user.id]);
    const sub = await get('SELECT plan, status, current_period_end, cancel_at FROM subscriptions WHERE user_id = ?', [req.user.id]);
    const settings = await get('SELECT theme, language, timezone FROM user_settings WHERE user_id = ?', [req.user.id]);
    const goals = await all('SELECT * FROM goals WHERE user_id = ?', [req.user.id]);
    const ideas = await all('SELECT * FROM investment_ideas WHERE user_id = ?', [req.user.id]);
    const alerts = await all('SELECT * FROM price_alerts WHERE user_id = ? AND active = 1', [req.user.id]);
    const watchlist = await all('SELECT * FROM watchlist WHERE user_id = ?', [req.user.id]);
    const portfolio = await all('SELECT * FROM portfolio WHERE user_id = ?', [req.user.id]);

    res.json({
      user,
      subscription: sub,
      settings,
      stats: {
        goalsCount: goals.length,
        ideasCount: ideas.length,
        activeAlerts: alerts.length,
        watchlistCount: watchlist.length,
        portfolioCount: portfolio.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile summary' });
  }
});

// ── Personal Data ─────────────────────────────────────────

router.put('/personal', requireAuth, async (req, res) => {
  try {
    const { first_name, last_name, phone, birth_date, country, investor_profile, experience } = req.body;
    console.log('Updating personal data for user:', req.user.id, 'with:', { first_name, last_name, phone, birth_date, country, investor_profile, experience });
    await run(
      `UPDATE users SET first_name = ?, last_name = ?, phone = ?, birth_date = ?, country = ?, investor_profile = ?, experience = ? WHERE id = ?`,
      [first_name || null, last_name || null, phone || null, birth_date || null, country || null, investor_profile || null, experience || null, req.user.id],
    );
    const user = await get('SELECT id, email, username, first_name, last_name, phone, birth_date, country, investor_profile, experience FROM users WHERE id = ?', [req.user.id]);
    res.json(user);
  } catch (err) {
    console.error('Personal data update error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to update personal data', details: err.message });
  }
});

// ── Avatar ────────────────────────────────────────────────

router.put('/avatar', requireAuth, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'Avatar required' });
    await run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.user.id]);
    res.json({ success: true, avatar });
  } catch (err) {
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

    const user = await get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user || !verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = hashPassword(new_password);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
