const { get, run, saveDb } = require('./database');
const logger = require('./logger');

function persistMarketData(key, data) {
  try {
    const json = JSON.stringify(data);
    const existing = get('SELECT key FROM market_cache WHERE key = ?', [key]);
    if (existing) {
      run('UPDATE market_cache SET value = ?, updated_at = datetime(\'now\') WHERE key = ?', [json, key]);
    } else {
      run('INSERT INTO market_cache (key, value) VALUES (?, ?)', [key, json]);
    }
    saveDb();
    return true;
  } catch (err) {
    logger.warn(`Failed to persist market cache for ${key}: ${err.message}`);
    return false;
  }
}

function loadMarketData(key, maxAgeMinutes = 10) {
  try {
    const row = get(
      `SELECT value, updated_at FROM market_cache WHERE key = ? AND updated_at > datetime('now', ?)`,
      [key, `-${maxAgeMinutes} minutes`]
    );
    if (row) {
      return { data: JSON.parse(row.value), age: row.updated_at, fresh: true };
    }

    const stale = get(
      'SELECT value, updated_at FROM market_cache WHERE key = ? ORDER BY updated_at DESC LIMIT 1',
      [key]
    );
    if (stale) {
      return { data: JSON.parse(stale.value), age: stale.updated_at, fresh: false };
    }

    return null;
  } catch (err) {
    logger.warn(`Failed to load market cache for ${key}: ${err.message}`);
    return null;
  }
}

function getAllCachedKeys() {
  try {
    return get('SELECT COUNT(*) as cnt FROM market_cache').cnt;
  } catch {
    return 0;
  }
}

module.exports = { persistMarketData, loadMarketData, getAllCachedKeys };
