/**
 * Stickiness / contrato real: el SDK habla con `POST /evaluate` de la API
 * in-memory vía `app.request` (sin red). No importa `@ff/api` como dep de
 * runtime: solo este test resuelve el módulo relativo del monorepo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "./client";

process.env.DATABASE_URL = "file::memory:?cache=shared";

const { app } = await import("@ff/api/app");
const {
  closeDb,
  ensureSchema,
  createFlag,
  upsertEnvironmentRules,
} = await import("@ff/api/repo");

const BASE = "http://sdk.test";

function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const path = new URL(url).pathname;
  return Promise.resolve(app.request(path, init));
}

beforeAll(async () => {
  await ensureSchema();
  await createFlag({ key: "mvp_check", by: "seed" });
  await upsertEnvironmentRules({
    key: "mvp_check",
    environment: "staging",
    defaultOn: false,
    rolloutPercent: 50,
    overrides: [],
    confirmProduction: false,
    by: "seed",
  });
  await upsertEnvironmentRules({
    key: "mvp_check",
    environment: "production",
    defaultOn: false,
    rolloutPercent: 100,
    overrides: [{ tenantId: "acme", mode: "force_off" }],
    confirmProduction: true,
    by: "seed",
  });
});

afterAll(() => {
  closeDb();
});

describe("SDK ↔ API /evaluate (integración)", () => {
  it("force_off de acme gana sobre rollout 100% en production", async () => {
    const client = createClient({ baseUrl: BASE, fetch: apiFetch });
    const result = await client.evaluate({
      flagKey: "mvp_check",
      environment: "production",
      tenantId: "acme",
      userId: "anyone",
    });
    expect(result).toEqual({ enabled: false, reason: "force_off" });
  });

  it("rollout 100% sin override → enabled true (reason rollout)", async () => {
    const client = createClient({ baseUrl: BASE, fetch: apiFetch });
    const result = await client.evaluate({
      flagKey: "mvp_check",
      environment: "production",
      tenantId: "other",
      userId: "user-1",
    });
    expect(result).toEqual({ enabled: true, reason: "rollout" });
  });

  it("stickiness staging 50%: mismo userId estable en ≥5 evaluates", async () => {
    const client = createClient({ baseUrl: BASE, fetch: apiFetch });
    const input = {
      flagKey: "mvp_check",
      environment: "staging" as const,
      tenantId: "acme",
      userId: "sticky-user",
    };

    // Sin cache entre llamadas para forzar re-evaluación server-side.
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      client.invalidate();
      const r = await client.evaluate(input);
      expect(r.reason).toBe("rollout");
      results.push(r.enabled);
    }
    expect(new Set(results).size).toBe(1);
  });

  it("cache hit no vuelve a pegarle a la API", async () => {
    let calls = 0;
    const countingFetch: typeof fetch = async (input, init) => {
      calls += 1;
      return apiFetch(input, init);
    };

    const client = createClient({ baseUrl: BASE, fetch: countingFetch });
    const input = {
      flagKey: "mvp_check",
      environment: "production" as const,
      tenantId: "other",
      userId: "cache-user",
    };

    await client.evaluate(input);
    await client.evaluate(input);
    expect(calls).toBe(1);
  });
});
