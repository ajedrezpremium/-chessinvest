const logger = require('./logger');

class MemoryCache {
  constructor(defaultTTLMs = 5 * 60 * 1000) {
    this._store = new Map();
    this._defaultTTL = defaultTTLMs;
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || this._defaultTTL),
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
  }

  stats() {
    return {
      size: this._store.size,
      keys: Array.from(this._store.keys()),
    };
  }
}

const cache = new MemoryCache();

setInterval(() => {
  for (const key of cache.stats().keys) {
    cache.get(key);
  }
}, 60 * 1000);

module.exports = { cache, MemoryCache };
