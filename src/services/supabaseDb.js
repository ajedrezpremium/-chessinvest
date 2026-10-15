const { getSupabaseAdmin } = require('./supabase');
const logger = require('./logger');

function mapRow(row) {
  return row;
}

function mapRows(rows) {
  return rows || [];
}

async function run(sql, params = []) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  // This is a simplified approach - for complex queries we'd use RPC
  // For now, we'll use the Supabase client methods directly in routes
  // This function is kept for compatibility but routes should migrate to direct Supabase calls
  throw new Error('Use direct Supabase client methods instead of raw SQL');
}

async function get(sql, params = []) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');
  throw new Error('Use direct Supabase client methods instead of raw SQL');
}

async function all(sql, params = []) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');
  throw new Error('Use direct Supabase client methods instead of raw SQL');
}

// Direct Supabase table helpers
const tables = {
  users: () => getSupabaseAdmin().from('users'),
  watchlist: () => getSupabaseAdmin().from('watchlist'),
  portfolio: () => getSupabaseAdmin().from('portfolio'),
  recommendation_history: () => getSupabaseAdmin().from('recommendation_history'),
  subscriptions: () => getSupabaseAdmin().from('subscriptions'),
  price_alerts: () => getSupabaseAdmin().from('price_alerts'),
  goals: () => getSupabaseAdmin().from('goals'),
  investment_ideas: () => getSupabaseAdmin().from('investment_ideas'),
  user_settings: () => getSupabaseAdmin().from('user_settings'),
  incidents: () => getSupabaseAdmin().from('incidents'),
  email_campaigns: () => getSupabaseAdmin().from('email_campaigns'),
  conversation_history: () => getSupabaseAdmin().from('conversation_history'),
  notifications: () => getSupabaseAdmin().from('notifications'),
  refresh_tokens: () => getSupabaseAdmin().from('refresh_tokens'),
  usage_tracking: () => getSupabaseAdmin().from('usage_tracking'),
  password_resets: () => getSupabaseAdmin().from('password_resets'),
  market_cache: () => getSupabaseAdmin().from('market_cache'),
  signal_history: () => getSupabaseAdmin().from('signal_history'),
  newsletters: () => getSupabaseAdmin().from('newsletters'),
};

// Generic CRUD helpers
async function select(tableName, filters = {}, options = {}) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  let query = admin.from(tableName).select(options.columns || '*');

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query = query.eq(key, value);
    }
  });

  if (options.order) {
    query = query.order(options.order.column, { ascending: options.order.ascending });
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.single) {
    const { data, error } = await query.single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function insert(tableName, data) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data: result, error } = await admin.from(tableName).insert(data).select().single();
  if (error) throw error;
  return result;
}

async function update(tableName, id, data, idColumn = 'id') {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data: result, error } = await admin.from(tableName).update(data).eq(idColumn, id).select().single();
  if (error) throw error;
  return result;
}

async function upsert(tableName, data, onConflict) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { data: result, error } = await admin
    .from(tableName)
    .upsert(data, { onConflict })
    .select()
    .single();
  if (error) throw error;
  return result;
}

async function remove(tableName, id, idColumn = 'id') {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin not configured');

  const { error } = await admin.from(tableName).delete().eq(idColumn, id);
  if (error) throw error;
  return { success: true };
}

// Specific helpers for common patterns
async function getUserSettings(userId) {
  return select('user_settings', { user_id: userId }, { single: true });
}

async function updateUserSettings(userId, data) {
  return upsert('user_settings', { user_id: userId, ...data, updated_at: new Date().toISOString() }, 'user_id');
}

async function getSubscription(userId) {
  return select('subscriptions', { user_id: userId }, { single: true });
}

async function getGoals(userId) {
  return select('goals', { user_id: userId }, { order: { column: 'created_at', ascending: false } });
}

async function getIdeas(userId) {
  return select('investment_ideas', { user_id: userId }, { order: { column: 'updated_at', ascending: false } });
}

async function getAlerts(userId, activeOnly = false) {
  const filters = { user_id: userId };
  if (activeOnly) filters.active = 1;
  return select('price_alerts', filters, { order: { column: 'created_at', ascending: false } });
}

async function getWatchlist(userId) {
  return select('watchlist', { user_id: userId }, { order: { column: 'added_at', ascending: false } });
}

async function getPortfolio(userId) {
  return select('portfolio', { user_id: userId }, { order: { column: 'added_at', ascending: false } });
}

async function getProfileSummary(userId) {
  const [user, subscription, settings, goals, ideas, alerts, watchlist, portfolio] = await Promise.all([
    select('users', { id: userId }, { single: true, columns: 'id,email,username,created_at,avatar,role' }),
    getSubscription(userId),
    getUserSettings(userId),
    getGoals(userId),
    getIdeas(userId),
    getAlerts(userId, true),
    getWatchlist(userId),
    getPortfolio(userId),
  ]);

  return {
    user,
    subscription,
    settings,
    stats: {
      goalsCount: goals.length,
      ideasCount: ideas.length,
      activeAlerts: alerts.length,
      watchlistCount: watchlist.length,
      portfolioCount: portfolio.length,
    },
  };
}

module.exports = {
  run,
  get,
  all,
  select,
  insert,
  update,
  upsert,
  remove,
  tables,
  getUserSettings,
  updateUserSettings,
  getSubscription,
  getGoals,
  getIdeas,
  getAlerts,
  getWatchlist,
  getPortfolio,
  getProfileSummary,
};