import { describe, expect, it } from "vitest";
import { evaluateFlag, evaluateWithFallback } from "./evaluate";
import { inRollout, stableHash } from "./hash";
import { allowsNewRules, canTransitionLifecycle } from "./lifecycle";
import type { FeatureFlag } from "./types";

function baseFlag(overrides?: Partial<FeatureFlag>): FeatureFlag {
  return {
    key: "billing_v2",
    lifecycle: "experimental",
    safeDefault: "off",
    rules: [
      {
        environment: "production",
        defaultOn: false,
        rolloutPercent: 0,
        overrides: [],
      },
    ],
    ...overrides,
  };
}

describe("stableHash / inRollout", () => {
  it("es sticky para el mismo user_id", () => {
    const a = inRollout("user-a", 50);
    const b = inRollout("user-a", 50);
    expect(a).toBe(b);
    expect(stableHash("user-a")).toBe(stableHash("user-a"));
  });

  it("con 50% separa usuarios de forma estable", () => {
    const users = Array.from({ length: 40 }, (_, i) => `u-${i}`);
    const results = users.map((u) => ({ u, in: inRollout(u, 50) }));
    const ins = results.filter((r) => r.in).length;
    expect(ins).toBeGreaterThan(0);
    expect(ins).toBeLessThan(users.length);
    for (const r of results) {
      expect(inRollout(r.u, 50)).toBe(r.in);
    }
  });
});

describe("evaluateFlag precedence", () => {
  it("force_off gana sobre % = 100", () => {
    const flag = baseFlag({
      rules: [
        {
          environment: "production",
          defaultOn: true,
          rolloutPercent: 100,
          overrides: [{ tenantId: "acme", mode: "force_off" }],
        },
      ],
    });
    const result = evaluateFlag(flag, {
      environment: "production",
      tenantId: "acme",
      userId: "any",
    });
    expect(result).toEqual({ enabled: false, reason: "force_off" });
  });

  it("force_on gana sobre % = 0", () => {
    const flag = baseFlag({
      rules: [
        {
          environment: "production",
          defaultOn: false,
          rolloutPercent: 0,
          overrides: [{ tenantId: "acme", mode: "force_on" }],
        },
      ],
    });
    const result = evaluateFlag(flag, {
      environment: "production",
      tenantId: "acme",
      userId: "any",
    });
    expect(result).toEqual({ enabled: true, reason: "force_on" });
  });

  it("usa default de ambiente si no hay override ni rollout hit", () => {
    const flag = baseFlag({
      rules: [
        {
          environment: "staging",
          defaultOn: true,
          rolloutPercent: 0,
          overrides: [],
        },
      ],
    });
    const result = evaluateFlag(flag, {
      environment: "staging",
      tenantId: "t1",
      userId: "u1",
    });
    expect(result).toEqual({ enabled: true, reason: "default" });
  });

  it("flags eliminadas no se evalúan como enabled", () => {
    const flag = baseFlag({ lifecycle: "eliminado" });
    expect(
      evaluateFlag(flag, {
        environment: "production",
        tenantId: "t",
        userId: "u",
      }).reason,
    ).toBe("eliminado");
  });
});

describe("evaluateWithFallback", () => {
  it("usa safe_default si falla el fetch", () => {
    const flag = baseFlag({ safeDefault: "on" });
    expect(
      evaluateWithFallback(
        flag,
        { environment: "production", tenantId: "t", userId: "u" },
        { fetchFailed: true },
      ),
    ).toEqual({ enabled: true, reason: "safe_default" });
  });
});

describe("lifecycle", () => {
  it("solo permite avanzar un paso", () => {
    expect(canTransitionLifecycle("experimental", "GA")).toBe(true);
    expect(canTransitionLifecycle("experimental", "deprecado")).toBe(false);
    expect(canTransitionLifecycle("GA", "deprecado")).toBe(true);
  });

  it("deprecado no admite reglas nuevas", () => {
    expect(allowsNewRules("deprecado")).toBe(false);
    expect(allowsNewRules("GA")).toBe(true);
  });
});
