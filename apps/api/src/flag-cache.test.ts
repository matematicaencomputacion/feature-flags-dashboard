import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlag } from "@ff/domain";

// Misma estrategia que app.test.ts: SQLite en memoria con cache compartida, sin
// archivo temporal que limpiar.
process.env.DATABASE_URL = "file::memory:?cache=shared";

const { app } = await import("./app");
const { closeDb, ensureSchema, createFlag, getFlag, upsertEnvironmentRules } =
  await import("./repo");
const { getCachedFlag, initFlagCache, invalidateFlag } = await import("./flag-cache");

const json = { "Content-Type": "application/json" };

/** Loader instrumentado: contar accesos sin espiar los internals del repo. */
let loads: string[] = [];
async function countingLoader(key: string): Promise<FeatureFlag | null> {
  loads.push(key);
  return getFlag(key);
}

async function login(): Promise<string> {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });
  return ((await res.json()) as { token: string }).token;
}

async function evaluate(flagKey: string, tenantId = "t1", userId = "u1") {
  const res = await app.request("/evaluate", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      flagKey,
      environment: "production",
      tenantId,
      userId,
    }),
  });
  const { enabled, reason } = (await res.json()) as {
    enabled: boolean;
    reason: string;
  };
  return { enabled, reason };
}

async function setProductionRules(
  key: string,
  token: string,
  body: {
    defaultOn: boolean;
    rolloutPercent: number;
    overrides: { tenantId: string; mode: "force_on" | "force_off" }[];
  },
) {
  return app.request(`/flags/${key}/rules/production`, {
    method: "PUT",
    headers: { ...json, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, confirmProduction: true }),
  });
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(() => {
  loads = [];
  initFlagCache(countingLoader);
});

afterAll(() => {
  closeDb();
});

describe("flag cache — lecturas", () => {
  it("dos /evaluate consecutivos leen la definición una sola vez", async () => {
    await createFlag({ key: "cached_flag", by: "demo" });

    await evaluate("cached_flag");
    await evaluate("cached_flag");

    expect(loads.filter((k) => k === "cached_flag")).toHaveLength(1);
  });

  it("invalidar una flag no toca la entrada cacheada de otra", async () => {
    await createFlag({ key: "flag_a", by: "demo" });
    await createFlag({ key: "flag_b", by: "demo" });
    await getCachedFlag("flag_a");
    await getCachedFlag("flag_b");
    loads = [];

    invalidateFlag("flag_a");
    await getCachedFlag("flag_a");
    await getCachedFlag("flag_b");

    expect(loads).toEqual(["flag_a"]);
  });

  it("pasado el TTL vuelve a leer la definición", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      initFlagCache(
        async () => {
          calls++;
          return null;
        },
        { ttlMs: 1_000 },
      );

      await getCachedFlag("ttl_flag");
      await getCachedFlag("ttl_flag");
      expect(calls).toBe(1);

      vi.advanceTimersByTime(1_001);
      await getCachedFlag("ttl_flag");
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("flag cache — invalidación por escritura", () => {
  it("kill-switch: un force_off se ve en la evaluación siguiente, sin avanzar el reloj", async () => {
    const token = await login();
    await createFlag({ key: "kill_switch", by: "demo" });
    await setProductionRules("kill_switch", token, {
      defaultOn: true,
      rolloutPercent: 0,
      overrides: [],
    });

    expect((await evaluate("kill_switch", "acme")).enabled).toBe(true);

    await setProductionRules("kill_switch", token, {
      defaultOn: true,
      rolloutPercent: 0,
      overrides: [{ tenantId: "acme", mode: "force_off" }],
    });

    expect(await evaluate("kill_switch", "acme")).toEqual({
      enabled: false,
      reason: "force_off",
    });
  });

  it("una key cacheada como inexistente deja de serlo tras crearla", async () => {
    expect(await evaluate("todavia_no_existe")).toEqual({
      enabled: false,
      reason: "safe_default",
    });

    await createFlag({ key: "todavia_no_existe", by: "demo" });

    expect(await evaluate("todavia_no_existe")).toEqual({
      enabled: false,
      reason: "default",
    });
  });
});

describe("panel", () => {
  it("GET /flags/:key no usa caché: devuelve el estado recién guardado", async () => {
    const token = await login();
    await createFlag({ key: "panel_flag", by: "demo" });
    await getCachedFlag("panel_flag");

    await upsertEnvironmentRules({
      key: "panel_flag",
      environment: "staging",
      defaultOn: false,
      rolloutPercent: 42,
      overrides: [],
      confirmProduction: false,
      by: "demo",
    });

    const res = await app.request("/flags/panel_flag", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { flag } = (await res.json()) as { flag: FeatureFlag };
    expect(
      flag.rules.find((r) => r.environment === "staging")?.rolloutPercent,
    ).toBe(42);
  });
});
