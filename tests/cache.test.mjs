import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { MemoryCache } = require('../src/services/cache');

describe('MemoryCache', () => {
  let cache;

  beforeEach(() => {
    cache = new MemoryCache(1000);
  });

  afterEach(() => {
    cache.clear();
  });

  it('stores and retrieves values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns null for missing keys', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('respects TTL', async () => {
    cache.set('short', 'data', 10);
    expect(cache.get('short')).toBe('data');
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('short')).toBeNull();
  });

  it('overwrites existing keys', () => {
    cache.set('key', 'first');
    cache.set('key', 'second');
    expect(cache.get('key')).toBe('second');
  });

  it('deletes keys', () => {
    cache.set('key', 'value');
    cache.delete('key');
    expect(cache.get('key')).toBeNull();
  });

  it('reports correct stats', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    const stats = cache.stats();
    expect(stats.size).toBe(2);
    expect(stats.keys).toContain('a');
    expect(stats.keys).toContain('b');
  });
});
