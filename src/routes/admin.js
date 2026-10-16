const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { getSupabaseAdmin } = require('../services/supabase');

const router = Router();

// Protect all admin routes
router.use(requireAuth);
router.use(requireAdmin);

// ── Dashboard Stats ───────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const [
      { count: totalUsers },
      { count: totalSubscriptions },
      { count: totalGoals },
      { count: totalIdeas },
      { count: totalAlerts },
      { count: totalWatchlist },
      { count: totalPortfolio },
      { data: subs },
      { data: recentUsers },
    ] = await Promise.all([
      admin.from('users').select('*', { count: 'exact', head: true }),
      admin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('goals').select('*', { count: 'exact', head: true }),
      admin.from('investment_ideas').select('*', { count: 'exact', head: true }),
      admin.from('price_alerts').select('*', { count: 'exact', head: true }).eq('active', 1),
      admin.from('watchlist').select('*', { count: 'exact', head: true }),
      admin.from('portfolio').select('*', { count: 'exact', head: true }),
      admin.from('subscriptions').select('plan').eq('status', 'active'),
      admin.from('users').select('id, email, username, role, created_at').order('created_at', { ascending: false }).limit(10),
    ]);

    const byPlan = {};
    for (const s of subs || []) byPlan[s.plan] = (byPlan[s.plan] || 0) + 1;
    const usersByPlan = Object.entries(byPlan).map(([plan, count]) => ({ plan, count }));

    const paid = (subs || []).filter((s) => s.plan !== 'free');
    const paidByPlan = {};
    for (const s of paid) paidByPlan[s.plan] = (paidByPlan[s.plan] || 0) + 1;
    const revenue = Object.entries(paidByPlan).map(([plan, count]) => ({ plan, count }));

    const estimatedMRR = revenue.reduce((sum, r) => {
      const prices = { basic: 4.99, pro: 14.99, premium: 49.99 };
      return sum + (r.count * (prices[r.plan] || 0));
    }, 0);

    res.json({
      totalUsers: totalUsers || 0,
      totalSubscriptions: totalSubscriptions || 0,
      totalGoals: totalGoals || 0,
      totalIdeas: totalIdeas || 0,
      totalAlerts: totalAlerts || 0,
      totalWatchlist: totalWatchlist || 0,
      totalPortfolio: totalPortfolio || 0,
      usersByPlan,
      recentUsers: recentUsers || [],
      estimatedMRR: Math.round(estimatedMRR * 100) / 100,
      revenue,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get admin stats', details: err.message });
  }
});

// ── User Management ───────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { page = 1, limit = 20, search = '' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = admin.from('users').select('id, email, username, role, first_name, last_name, avatar, created_at', { count: 'exact' });
    if (search) query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%`);
    const { data: users, count: total, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);
    if (error) throw error;

    const userIds = (users || []).map((u) => u.id);
    let subsMap = {};
    if (userIds.length) {
      const { data: subs } = await admin.from('subscriptions').select('user_id, plan, status').in('user_id', userIds);
      for (const s of subs || []) subsMap[s.user_id] = s;
    }

    const enriched = (users || []).map((u) => ({
      ...u,
      plan: subsMap[u.id]?.plan || 'free',
      sub_status: subsMap[u.id]?.status || 'active',
    }));

    res.json({ users: enriched, total: total || 0, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get users', details: err.message });
  }
});

router.put('/users/:id/role', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { role } = req.body;
    if (!['user', 'admin', 'moderator'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const { error } = await admin.from('users').update({ role }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role', details: err.message });
  }
});

router.put('/users/:id/plan', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { plan } = req.body;
    if (!['free', 'basic', 'pro', 'premium'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    const { error } = await admin.from('subscriptions').upsert({
      user_id: req.params.id,
      plan,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan', details: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    // Delete Auth user (cascades to profile via... actually profile must be deleted; RLS cascade handles related tables)
    const { error: authErr } = await admin.auth.admin.deleteUser(req.params.id);
    if (authErr) throw authErr;
    await admin.from('users').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
});

// ── Subscriptions ─────────────────────────────────────────

router.get('/subscriptions', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: subs, error } = await admin.from('subscriptions').select('*').order('updated_at', { ascending: false }).limit(50);
    if (error) throw error;
    const userIds = (subs || []).map((s) => s.user_id);
    let usersMap = {};
    if (userIds.length) {
      const { data: users } = await admin.from('users').select('id, email, username').in('id', userIds);
      for (const u of users || []) usersMap[u.id] = u;
    }
    res.json((subs || []).map((s) => ({ ...s, email: usersMap[s.user_id]?.email, username: usersMap[s.user_id]?.username })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get subscriptions', details: err.message });
  }
});

// ── Incidents / Support Tickets ───────────────────────────

router.get('/incidents', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('incidents')
      .select('id, user_id, type, subject, description, status, priority, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const order = { high: 1, medium: 2, low: 3 };
    (data || []).sort((a, b) => (order[a.priority] || 9) - (order[b.priority] || 9));
    res.json(data || []);
  } catch (err) {
    res.json([]);
  }
});

router.post('/incidents', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { user_id, type, subject, description, priority } = req.body;
    const { data, error } = await admin
      .from('incidents')
      .insert({ user_id, type: type || 'support', subject, description, priority: priority || 'medium', status: 'open' })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create incident', details: err.message });
  }
});

router.put('/incidents/:id', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { status, priority, admin_notes } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    const { data, error } = await admin.from('incidents').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update incident', details: err.message });
  }
});

// ── Emails / Newsletter ───────────────────────────────────

router.get('/emails', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('email_campaigns')
      .select('id, subject, type, status, sent_count, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.json([]);
  }
});

router.post('/emails', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { subject, content, type, target_plan } = req.body;
    const { data, error } = await admin
      .from('email_campaigns')
      .insert({ subject, content, type: type || 'newsletter', target_plan: target_plan || 'all', status: 'draft' })
      .select('*')
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create email campaign', details: err.message });
  }
});

// ── Directorio de recursos ────────────────────────────────

const RESOURCE_CATS = ['herramienta', 'regulador', 'organismo', 'formacion'];

router.get('/resources', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('resources')
      .select('*')
      .order('featured', { ascending: false })
      .order('name')
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get resources', details: err.message });
  }
});

router.post('/resources', async (req, res) => {
  try {
    const { name, category, url, description, is_free, lang, featured } = req.body;
    if (!name || !url || !RESOURCE_CATS.includes(category)) {
      return res.status(400).json({ error: 'name, url y category válida requeridos' });
    }
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'URL no válida' });
    }
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('resources')
      .insert({
        name, category, url,
        description: description || '',
        is_free: is_free === false || is_free === 0 ? 0 : 1,
        lang: lang || 'es',
        featured: featured ? 1 : 0,
      })
      .select('*')
      .single();
    if (error) throw error;
    // Auto-ingesta RAG (los agentes pueden recomendar el recurso)
    require('../services/rag').ingestChunks([{
      content: `${data.name} (${data.category}, ${data.is_free ? 'gratis' : 'de pago'}): ${data.description} Web: ${data.url}`,
      source: 'directorio',
      lang: data.lang || 'es',
    }]).catch(() => {});
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create resource', details: err.message });
  }
});

router.put('/resources/:id', async (req, res) => {
  try {
    const allowed = ['name', 'category', 'url', 'description', 'is_free', 'lang', 'featured'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (updates.category && !RESOURCE_CATS.includes(updates.category)) {
      return res.status(400).json({ error: 'Categoría no válida' });
    }
    if (updates.url) {
      try {
        new URL(updates.url);
      } catch {
        return res.status(400).json({ error: 'URL no válida' });
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada que actualizar' });
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from('resources').update(updates).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update resource', details: err.message });
  }
});

router.delete('/resources/:id', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { data: doomed } = await admin.from('resources').select('url').eq('id', req.params.id).single();
    const { error } = await admin.from('resources').delete().eq('id', req.params.id);
    if (error) throw error;
    // Limpieza RAG del chunk auto-generado
    if (doomed?.url) {
      await admin.from('knowledge_chunks')
        .delete()
        .eq('source', 'directorio')
        .like('content', `%${doomed.url}%`)
        .then(() => {})
        .catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete resource', details: err.message });
  }
});

// ── System Health ─────────────────────────────────────────

router.get('/health', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    const { count: tableRows } = await admin.from('users').select('*', { count: 'exact', head: true });
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    res.json({
      uptime: Math.round(uptime),
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
      },
      dbUsers: tableRows || 0,
      dbEngine: 'Supabase PostgreSQL',
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get health', details: err.message });
  }
});

module.exports = router;
