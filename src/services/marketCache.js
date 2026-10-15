const { getSupabaseAdmin } = require('./supabase');
const logger = require('./logger');

async function persistMarketData(key, data) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return false;

    const json = JSON.stringify(data);
    const { error } = await admin.from('market_cache').upsert({
      key,
      value: json,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return true;
  } catch (err) {
    logger.warn(`Failed to persist market cache for ${key}: ${err.message}`);
    return false;
  }
}

async function loadMarketData(key, maxAgeMinutes = 10) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return null;

    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    const { data: fresh, error: freshErr } = await admin
      .from('market_cache')
      .select('value, updated_at')
      .eq('key', key)
      .gt('updated_at', cutoff)
      .single();

    if (!freshErr && fresh) {
      return { data: JSON.parse(fresh.value), age: fresh.updated_at, fresh: true };
    }

    const { data: stale, error: staleErr } = await admin
      .from('market_cache')
      .select('value, updated_at')
      .eq('key', key)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (!staleErr && stale) {
      return { data: JSON.parse(stale.value), age: stale.updated_at, fresh: false };
    }

    return null;
  } catch (err) {
    logger.warn(`Failed to load market cache for ${key}: ${err.message}`);
    return null;
  }
}

async function getAllCachedKeys() {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return 0;
    const { count } = await admin.from('market_cache').select('*', { count: 'exact', head: true });
    return count || 0;
  } catch {
    return 0;
  }
}

module.exports = { persistMarketData, loadMarketData, getAllCachedKeys };