// Tiny in-memory TTL cache with in-flight de-duplication and size cap.
class TTLCache {
  constructor({ ttlMs = 5 * 60 * 1000, max = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.store = new Map();
    this.inflight = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh LRU position
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.size >= this.max) this.store.delete(this.store.keys().next().value);
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  /** Returns cached value or runs loader once even under concurrent calls. */
  async wrap(key, loader, ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const value = await loader();
        // Don't cache empty results so a flaky provider can recover quickly
        const empty = Array.isArray(value) && value.length === 0;
        if (!empty) this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}

module.exports = { TTLCache };
