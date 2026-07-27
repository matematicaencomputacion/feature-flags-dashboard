export type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * Cache local con TTL (default 45s).
 *
 * El rango 30–60s que exige el PRD es una regla de producto y se valida donde se
 * configura el TTL, no acá: esta utilidad tiene que servir también para casos con
 * ventanas cortas, como los tests.
 */
export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private ttlMs: number = 45_000) {}

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
