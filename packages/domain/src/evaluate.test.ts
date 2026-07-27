import { describe, expect, it } from "vitest";
import { evaluateFlag, evaluateWithFallback } from "./evaluate";
import { inRollout, rolloutSeed, stableHash } from "./hash";
import { allowsNewRules, canTransitionLifecycle } from "./lifecycle";
import type { EnvironmentRules, FeatureFlag } from "./types";

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

function rule(partial: Partial<EnvironmentRules>): EnvironmentRules {
  return {
    environment: "production",
    defaultOn: false,
    rolloutPercent: 0,
    overrides: [],
    ...partial,
  };
}

const USERS = Array.from({ length: 400 }, (_, i) => `u-${i}`);

describe("stableHash / inRollout", () => {
  it("es sticky para la misma semilla", () => {
    const seed = rolloutSeed("billing_v2", "production", "user-a");
    expect(inRollout(seed, 50)).toBe(inRollout(seed, 50));
    expect(stableHash(seed)).toBe(stableHash(seed));
  });

  it("con 50% separa usuarios de forma estable", () => {
    const results = USERS.slice(0, 40).map((u) => ({
      u,
      in: inRollout(rolloutSeed("f", "production", u), 50),
    }));
    const ins = results.filter((r) => r.in).length;
    expect(ins).toBeGreaterThan(0);
    expect(ins).toBeLessThan(40);
    for (const r of results) {
      expect(inRollout(rolloutSeed("f", "production", r.u), 50)).toBe(r.in);
    }
  });

  it("0% no incluye a nadie y 100% incluye a todos", () => {
    for (const u of USERS.slice(0, 20)) {
      const seed = rolloutSeed("f", "production", u);
      expect(inRollout(seed, 0)).toBe(false);
      expect(inRollout(seed, 100)).toBe(true);
    }
  });

  it("dos flags al mismo % no impactan al mismo conjunto de usuarios", () => {
    const a = USERS.filter((u) => inRollout(rolloutSeed("flag_a", "production", u), 10));
    const b = USERS.filter((u) => inRollout(rolloutSeed("flag_b", "production", u), 10));
    const overlap = a.filter((u) => b.includes(u)).length;
    // Si el hash no estuviera salteado por flag, a y b serían idénticos.
    expect(a).not.toEqual(b);
    expect(overlap).toBeLessThan(Math.min(a.length, b.length));
  });

  it("el bucket es independiente por ambiente", () => {
    const prod = USERS.filter((u) => inRollout(rolloutSeed("f", "production", u), 10));
    const staging = USERS.filter((u) => inRollout(rolloutSeed("f", "staging", u), 10));
    expect(prod).not.toEqual(staging);
  });

  it("la exposición real se aproxima al % configurado", () => {
    const ins = USERS.filter((u) => inRollout(rolloutSeed("f", "production", u), 25)).length;
    const ratio = ins / USERS.length;
    expect(ratio).toBeGreaterThan(0.15);
    expect(ratio).toBeLessThan(0.35);
  });
});

describe("evaluateFlag precedence", () => {
  it("force_off gana sobre % = 100", () => {
    const flag = baseFlag({
      rules: [
        rule({
          defaultOn: true,
          rolloutPercent: 100,
          overrides: [{ tenantId: "acme", mode: "force_off" }],
        }),
      ],
    });
    expect(
      evaluateFlag(flag, {
        environment: "production",
        tenantId: "acme",
        userId: "any",
      }),
    ).toEqual({ enabled: false, reason: "force_off" });
  });

  it("force_on gana sobre % = 0", () => {
    const flag = baseFlag({
      rules: [rule({ overrides: [{ tenantId: "acme", mode: "force_on" }] })],
    });
    expect(
      evaluateFlag(flag, {
        environment: "production",
        tenantId: "acme",
        userId: "any",
      }),
    ).toEqual({ enabled: true, reason: "force_on" });
  });

  it("el override de un tenant no afecta a otro tenant", () => {
    const flag = baseFlag({
      rules: [
        rule({
          defaultOn: true,
          overrides: [{ tenantId: "acme", mode: "force_off" }],
        }),
      ],
    });
    expect(
      evaluateFlag(flag, {
        environment: "production",
        tenantId: "globex",
        userId: "u1",
      }),
    ).toEqual({ enabled: true, reason: "default" });
  });

  it("usa default de ambiente cuando no hay % configurado", () => {
    const flag = baseFlag({
      rules: [rule({ environment: "staging", defaultOn: true })],
    });
    expect(
      evaluateFlag(flag, {
        environment: "staging",
        tenantId: "t1",
        userId: "u1",
      }),
    ).toEqual({ enabled: true, reason: "default" });
  });

  it("el % es terminal: un usuario fuera del bucket NO hereda defaultOn", () => {
    const flag = baseFlag({
      rules: [rule({ defaultOn: true, rolloutPercent: 10 })],
    });
    const outcomes = USERS.map(
      (u) =>
        evaluateFlag(flag, {
          environment: "production",
          tenantId: "t",
          userId: u,
        }).enabled,
    );
    // Con defaultOn=true y rollout=10%, la mayoría debe quedar en false.
    expect(outcomes.filter(Boolean).length).toBeLessThan(USERS.length / 2);
    expect(outcomes.some((o) => o)).toBe(true);
  });

  it("reporta reason=rollout cuando decide el porcentaje", () => {
    const flag = baseFlag({ rules: [rule({ rolloutPercent: 100 })] });
    expect(
      evaluateFlag(flag, {
        environment: "production",
        tenantId: "t",
        userId: "u",
      }),
    ).toEqual({ enabled: true, reason: "rollout" });
  });

  it("los ambientes son independientes entre sí", () => {
    const flag = baseFlag({
      rules: [
        rule({ environment: "dev", defaultOn: true }),
        rule({ environment: "production", defaultOn: false }),
      ],
    });
    const ctx = { tenantId: "t", userId: "u" } as const;
    expect(evaluateFlag(flag, { ...ctx, environment: "dev" }).enabled).toBe(true);
    expect(evaluateFlag(flag, { ...ctx, environment: "production" }).enabled).toBe(false);
  });

  it("sin reglas para el ambiente cae a safe_default", () => {
    const flag = baseFlag({ safeDefault: "on", rules: [] });
    expect(
      evaluateFlag(flag, { environment: "dev", tenantId: "t", userId: "u" }),
    ).toEqual({ enabled: true, reason: "safe_default" });
  });

  it("flag inexistente devuelve not_found", () => {
    expect(
      evaluateFlag(null, { environment: "dev", tenantId: "t", userId: "u" }),
    ).toEqual({ enabled: false, reason: "not_found" });
  });

  it("flags eliminadas no se evalúan como enabled", () => {
    const flag = baseFlag({
      lifecycle: "eliminado",
      rules: [rule({ defaultOn: true, rolloutPercent: 100 })],
    });
    const result = evaluateFlag(flag, {
      environment: "production",
      tenantId: "t",
      userId: "u",
    });
    expect(result).toEqual({ enabled: false, reason: "eliminado" });
  });

  it("flags deprecadas siguen evaluándose (RF: deprecado evalúa, no admite reglas)", () => {
    const flag = baseFlag({
      lifecycle: "deprecado",
      rules: [rule({ defaultOn: true })],
    });
    expect(
      evaluateFlag(flag, {
        environment: "production",
        tenantId: "t",
        userId: "u",
      }).enabled,
    ).toBe(true);
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

  it("sin flag cacheada y fetch caído devuelve off", () => {
    expect(
      evaluateWithFallback(
        null,
        { environment: "production", tenantId: "t", userId: "u" },
        { fetchFailed: true },
      ),
    ).toEqual({ enabled: false, reason: "safe_default" });
  });

  it("sin fallo delega en evaluateFlag", () => {
    const flag = baseFlag({ rules: [rule({ defaultOn: true })] });
    expect(
      evaluateWithFallback(flag, {
        environment: "production",
        tenantId: "t",
        userId: "u",
      }),
    ).toEqual({ enabled: true, reason: "default" });
  });
});

describe("lifecycle", () => {
  it("solo permite avanzar un paso", () => {
    expect(canTransitionLifecycle("experimental", "GA")).toBe(true);
    expect(canTransitionLifecycle("experimental", "deprecado")).toBe(false);
    expect(canTransitionLifecycle("GA", "deprecado")).toBe(true);
  });

  it("no permite retroceder ni quedarse en el mismo estado", () => {
    expect(canTransitionLifecycle("GA", "experimental")).toBe(false);
    expect(canTransitionLifecycle("GA", "GA")).toBe(false);
    expect(canTransitionLifecycle("eliminado", "GA")).toBe(false);
  });

  it("deprecado no admite reglas nuevas", () => {
    expect(allowsNewRules("deprecado")).toBe(false);
    expect(allowsNewRules("eliminado")).toBe(false);
    expect(allowsNewRules("experimental")).toBe(true);
    expect(allowsNewRules("GA")).toBe(true);
  });
});
