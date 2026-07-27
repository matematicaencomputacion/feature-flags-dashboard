import {
  TtlCache,
  type Environment,
  type EvaluateResult,
  type SafeDefault,
} from "@ff/domain";

const DEFAULT_TTL_MS = 45_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 60_000;

export type EvaluateInput = {
  flagKey: string;
  environment: Environment;
  tenantId: string;
  userId: string;
};

export type CreateClientOptions = {
  /** Base URL de la API, ej. `http://localhost:8787` (sin slash final). */
  baseUrl: string;
  /** TTL del caché local de resultados (30_000–60_000 ms). Default 45_000. */
  ttlMs?: number;
  /**
   * Si nunca hubo resultado cacheado y falla la red, determina el enabled.
   * Default: siempre `off` (RF-25).
   */
  getSafeDefault?: (flagKey: string) => SafeDefault;
  /** Inyectable para tests; por defecto `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
};

export type FeatureFlagClient = {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>;
  /** Sin argumento vacía todo el caché; con `flagKey` solo entradas de esa flag. */
  invalidate(flagKey?: string): void;
};

type ApiEvaluateBody = {
  enabled: boolean;
  reason: EvaluateResult["reason"];
  flagKey: string;
};

function assertTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
    throw new Error(
      `ttlMs debe estar entre ${MIN_TTL_MS} y ${MAX_TTL_MS} ms (PRD RF-24); recibido: ${ttlMs}`,
    );
  }
}

function cacheKey(input: EvaluateInput): string {
  return `${input.flagKey}:${input.environment}:${input.tenantId}:${input.userId}`;
}

/**
 * Caché de resultados de `POST /evaluate` (Opción A).
 *
 * `TtlCache` de domain borra entradas vencidas en `get`, así que retenemos el
 * último valor en un Map aparte para stale-while-error sin tocar la API pública
 * de `TtlCache` (usada también por el flag-cache de la API).
 *
 * La invalidación parcial por `flagKey` reconstruye el `TtlCache`: no hay API
 * pública para borrar por prefijo, y así no dependemos de detalles internos.
 */
class ResultCache {
  private fresh: TtlCache<EvaluateResult>;
  private lastKnown = new Map<string, EvaluateResult>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
    this.fresh = new TtlCache<EvaluateResult>(ttlMs);
  }

  getFresh(key: string): EvaluateResult | undefined {
    return this.fresh.get(key);
  }

  getStale(key: string): EvaluateResult | undefined {
    return this.lastKnown.get(key);
  }

  set(key: string, value: EvaluateResult): void {
    this.fresh.set(key, value);
    this.lastKnown.set(key, value);
  }

  invalidate(flagKey?: string): void {
    if (!flagKey) {
      this.fresh = new TtlCache<EvaluateResult>(this.ttlMs);
      this.lastKnown.clear();
      return;
    }
    const prefix = `${flagKey}:`;
    const nextLast = new Map<string, EvaluateResult>();
    const nextFresh = new TtlCache<EvaluateResult>(this.ttlMs);
    for (const [key, value] of this.lastKnown) {
      if (key === flagKey || key.startsWith(prefix)) continue;
      nextLast.set(key, value);
      const stillFresh = this.fresh.get(key);
      if (stillFresh !== undefined) {
        nextFresh.set(key, stillFresh);
      }
    }
    this.lastKnown = nextLast;
    this.fresh = nextFresh;
  }
}

/**
 * Cliente de evaluación para servicios consumidores.
 *
 * Cachea **resultados** de `POST /evaluate`, no definiciones de flag.
 * `evaluateWithFallback` de `@ff/domain` no aplica: opera sobre `FeatureFlag`
 * completo y la API pública no expone definiciones.
 */
export function createClient(options: CreateClientOptions): FeatureFlagClient {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  assertTtl(ttlMs);

  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const getSafeDefault = options.getSafeDefault ?? (() => "off" as const);
  const cache = new ResultCache(ttlMs);

  async function fetchEvaluate(input: EvaluateInput): Promise<EvaluateResult> {
    const res = await doFetch(`${baseUrl}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flagKey: input.flagKey,
        environment: input.environment,
        tenantId: input.tenantId,
        userId: input.userId,
      }),
    });

    if (!res.ok) {
      throw new Error(`evaluate HTTP ${res.status}`);
    }

    const body = (await res.json()) as ApiEvaluateBody;
    return { enabled: body.enabled, reason: body.reason };
  }

  return {
    async evaluate(input: EvaluateInput): Promise<EvaluateResult> {
      const key = cacheKey(input);
      const hit = cache.getFresh(key);
      if (hit) return hit;

      try {
        const result = await fetchEvaluate(input);
        cache.set(key, result);
        return result;
      } catch {
        const stale = cache.getStale(key);
        if (stale) return stale;

        const safe = getSafeDefault(input.flagKey);
        return {
          enabled: safe === "on",
          reason: "safe_default",
        };
      }
    },

    invalidate(flagKey?: string): void {
      cache.invalidate(flagKey);
    },
  };
}

export { DEFAULT_TTL_MS, MIN_TTL_MS, MAX_TTL_MS };
