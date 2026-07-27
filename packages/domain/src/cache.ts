export type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/** Cache local con TTL 30–60s (default 45s). */
export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private ttlMs: number = 45_000) {
    if (ttlMs < 30_000 || ttlMs > 60_000) {
      throw new Error("TTL must be between 30_000 and 60_000 ms");
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(key?: string): void {
    if (key) this.store.delete(key);
    else this.store.clear();
  }
}
