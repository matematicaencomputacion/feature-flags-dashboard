import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type EvaluateInput } from "./client";

const baseInput: EvaluateInput = {
  flagKey: "billing_v2",
  environment: "production",
  tenantId: "acme",
  userId: "user-1",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Nuevo Response por llamada: el body de `Response` solo se puede leer una vez. */
function fetchOk(body: unknown, status = 200) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(jsonResponse(body, status)),
  );
}

describe("FeatureFlagClient — cache y fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("CA-13-01: segunda evaluate idéntica dentro del TTL no vuelve a fetch", async () => {
    const fetchMock = fetchOk({
      enabled: true,
      reason: "force_on",
      flagKey: "billing_v2",
    });

    const client = createClient({
      baseUrl: "http://localhost:8787",
      ttlMs: 45_000,
      fetch: fetchMock,
    });

    const a = await client.evaluate(baseInput);
    const b = await client.evaluate(baseInput);

    expect(a).toEqual({ enabled: true, reason: "force_on" });
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("contextos distintos no comparten entrada (otro userId → 2 fetch)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as EvaluateInput;
      return jsonResponse({
        enabled: body.userId === "user-1",
        reason: "rollout",
        flagKey: body.flagKey,
      });
    });

    const client = createClient({
      baseUrl: "http://localhost:8787",
      fetch: fetchMock,
    });

    await client.evaluate(baseInput);
    await client.evaluate({ ...baseInput, userId: "user-2" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("CA-13-02: tras invalidate() el siguiente evaluate vuelve a fetchear", async () => {
    const fetchMock = fetchOk({
      enabled: true,
      reason: "default",
      flagKey: "billing_v2",
    });

    const client = createClient({
      baseUrl: "http://localhost:8787",
      fetch: fetchMock,
    });

    await client.evaluate(baseInput);
    client.invalidate();
    await client.evaluate(baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidate(flagKey) solo limpia esa flag", async () => {
    const fetchMock = fetchOk({ enabled: true, reason: "rollout", flagKey: "x" });

    const client = createClient({
      baseUrl: "http://localhost:8787",
      fetch: fetchMock,
    });

    await client.evaluate(baseInput);
    await client.evaluate({ ...baseInput, flagKey: "other_flag" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.invalidate("billing_v2");

    await client.evaluate(baseInput);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await client.evaluate({ ...baseInput, flagKey: "other_flag" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("tras expirar el TTL vuelve a fetchear", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ enabled: true, reason: "rollout", flagKey: "billing_v2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ enabled: false, reason: "rollout", flagKey: "billing_v2" }),
      );

    const client = createClient({
      baseUrl: "http://localhost:8787",
      ttlMs: 30_000,
      fetch: fetchMock,
    });

    const first = await client.evaluate(baseInput);
    expect(first.enabled).toBe(true);

    vi.advanceTimersByTime(30_001);

    const second = await client.evaluate(baseInput);
    expect(second.enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fallo de red con caché previa → último resultado (stale-while-error), aunque TTL vencido", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ enabled: true, reason: "force_on", flagKey: "billing_v2" }),
      )
      .mockRejectedValueOnce(new Error("network down"));

    const client = createClient({
      baseUrl: "http://localhost:8787",
      ttlMs: 30_000,
      fetch: fetchMock,
    });

    await client.evaluate(baseInput);
    vi.advanceTimersByTime(30_001);

    const stale = await client.evaluate(baseInput);
    expect(stale).toEqual({ enabled: true, reason: "force_on" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("CA-13-03: fallo de red sin caché → safe_default off", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const client = createClient({
      baseUrl: "http://localhost:8787",
      fetch: fetchMock,
    });

    const result = await client.evaluate(baseInput);
    expect(result).toEqual({ enabled: false, reason: "safe_default" });
  });

  it("getSafeDefault on cuando no hay caché y falla la red", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));

    const client = createClient({
      baseUrl: "http://localhost:8787",
      fetch: fetchMock,
      getSafeDefault: () => "on",
    });

    const result = await client.evaluate(baseInput);
    expect(result).toEqual({ enabled: true, reason: "safe_default" });
  });

  it("respuesta no-2xx de la API = fallo (no resultado)", async () => {
    const fetchMock = fetchOk({ error: "boom" }, 500);

    const client = createClient({
      baseUrl: "http://localhost:8787",
      fetch: fetchMock,
    });

    const result = await client.evaluate(baseInput);
    expect(result).toEqual({ enabled: false, reason: "safe_default" });
  });

  it("CA-13-04: constructor con ttlMs: 1000 lanza error", () => {
    expect(() =>
      createClient({ baseUrl: "http://localhost:8787", ttlMs: 1000 }),
    ).toThrow(/ttlMs debe estar entre/);
  });

  it("ttlMs por encima de 60s lanza error", () => {
    expect(() =>
      createClient({ baseUrl: "http://localhost:8787", ttlMs: 61_000 }),
    ).toThrow(/ttlMs debe estar entre/);
  });
});
