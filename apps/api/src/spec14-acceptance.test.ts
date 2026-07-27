/**
 * Criterios Spec 14 aún sin e2e de panel (CA-03…06, 09…13).
 * Cada `it` nombra el CA que cierra; la matriz vive en docs/specs/14-mvp-acceptance.md.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inRollout, rolloutSeed } from "@ff/domain";

const tmpDir = mkdtempSync(join(tmpdir(), "ff-spec14-"));
const dbFile = join(tmpDir, "acceptance.db");
process.env.DATABASE_URL = `file:${dbFile}`;

const { app } = await import("./app");
const {
  closeDb,
  ensureSchema,
  createFlag,
  getFlag,
  listFlags,
  updateFlagMeta,
  upsertEnvironmentRules,
} = await import("./repo");

const json = { "Content-Type": "application/json" };

async function login(): Promise<string> {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });
  return ((await res.json()) as { token: string }).token;
}

function authed(token: string) {
  return { ...json, Authorization: `Bearer ${token}` };
}

async function evaluate(body: {
  flagKey: string;
  environment: string;
  tenantId: string;
  userId: string;
}) {
  const res = await app.request("/evaluate", {
    method: "POST",
    headers: json,
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      enabled: boolean;
      reason: string;
      flagKey: string;
    },
  };
}

/** Descubre un par in/out a 50% (mismo criterio que la corrida manual Spec 14). */
function stickyPair(flagKey: string, environment: string) {
  let userIn: string | undefined;
  let userOut: string | undefined;
  for (let i = 0; i < 200; i++) {
    const userId = `u${i}`;
    const inside = inRollout(rolloutSeed(flagKey, environment, userId), 50);
    if (inside && !userIn) userIn = userId;
    if (!inside && !userOut) userOut = userId;
    if (userIn && userOut) return { userIn, userOut };
  }
  throw new Error(`No sticky pair for ${flagKey}/${environment}`);
}

beforeAll(async () => {
  await ensureSchema();
});

afterAll(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Spec 14 — CA restantes (API)", () => {
  it("CA-14-03: GET flag refleja % distintos en dev/staging/production", async () => {
    const key = "ca03_envs";
    await createFlag({ key, by: "demo" });
    await upsertEnvironmentRules({
      key,
      environment: "dev",
      defaultOn: false,
      rolloutPercent: 0,
      overrides: [],
      confirmProduction: false,
      by: "demo",
    });
    await upsertEnvironmentRules({
      key,
      environment: "staging",
      defaultOn: false,
      rolloutPercent: 50,
      overrides: [],
      confirmProduction: false,
      by: "demo",
    });
    await upsertEnvironmentRules({
      key,
      environment: "production",
      defaultOn: false,
      rolloutPercent: 100,
      overrides: [],
      confirmProduction: true,
      by: "demo",
    });

    const token = await login();
    const res = await app.request(`/flags/${key}`, { headers: authed(token) });
    expect(res.status).toBe(200);
    const { flag } = (await res.json()) as {
      flag: {
        rules: { environment: string; rolloutPercent: number }[];
      };
    };
    const byEnv = Object.fromEntries(
      flag.rules.map((r) => [r.environment, r.rolloutPercent]),
    );
    expect(byEnv).toEqual({ dev: 0, staging: 50, production: 100 });
  });

  it("CA-14-04: force_on y force_off se respetan vía POST /evaluate", async () => {
    const key = "ca04_overrides";
    await createFlag({ key, by: "demo" });
    await upsertEnvironmentRules({
      key,
      environment: "staging",
      defaultOn: false,
      rolloutPercent: 0,
      overrides: [{ tenantId: "beta", mode: "force_on" }],
      confirmProduction: false,
      by: "demo",
    });
    await upsertEnvironmentRules({
      key,
      environment: "production",
      defaultOn: false,
      rolloutPercent: 100,
      overrides: [{ tenantId: "acme", mode: "force_off" }],
      confirmProduction: true,
      by: "demo",
    });

    const forceOn = await evaluate({
      flagKey: key,
      environment: "staging",
      tenantId: "beta",
      userId: "anyone",
    });
    expect(forceOn.body).toEqual({
      enabled: true,
      reason: "force_on",
      flagKey: key,
    });

    const forceOff = await evaluate({
      flagKey: key,
      environment: "production",
      tenantId: "acme",
      userId: "anyone",
    });
    expect(forceOff.body).toEqual({
      enabled: false,
      reason: "force_off",
      flagKey: key,
    });
  });

  it("CA-14-05: sticky 50% — par in/out estable en ≥5 evaluates cada uno", async () => {
    const key = "ca05_sticky";
    await createFlag({ key, by: "demo" });
    await upsertEnvironmentRules({
      key,
      environment: "staging",
      defaultOn: false,
      rolloutPercent: 50,
      overrides: [],
      confirmProduction: false,
      by: "demo",
    });

    const { userIn, userOut } = stickyPair(key, "staging");

    for (let i = 0; i < 5; i++) {
      const inn = await evaluate({
        flagKey: key,
        environment: "staging",
        tenantId: "t",
        userId: userIn,
      });
      expect(inn.body).toMatchObject({
        enabled: true,
        reason: "rollout",
        flagKey: key,
      });

      const out = await evaluate({
        flagKey: key,
        environment: "staging",
        tenantId: "t",
        userId: userOut,
      });
      expect(out.body).toMatchObject({
        enabled: false,
        reason: "rollout",
        flagKey: key,
      });
    }
  });

  it("CA-14-06: force_off + rollout 100% ⇒ enabled false", async () => {
    const key = "ca06_precedence";
    await createFlag({ key, by: "demo" });
    await upsertEnvironmentRules({
      key,
      environment: "production",
      defaultOn: false,
      rolloutPercent: 100,
      overrides: [{ tenantId: "acme", mode: "force_off" }],
      confirmProduction: true,
      by: "demo",
    });

    const res = await evaluate({
      flagKey: key,
      environment: "production",
      tenantId: "acme",
      userId: "user-a",
    });
    expect(res.body).toEqual({
      enabled: false,
      reason: "force_off",
      flagKey: key,
    });
  });

  it("CA-14-09: deprecado bloquea PUT rules y evaluate sigue respondiendo", async () => {
    const key = "ca09_deprecated";
    await createFlag({ key, by: "demo" });
    await upsertEnvironmentRules({
      key,
      environment: "production",
      defaultOn: false,
      rolloutPercent: 100,
      overrides: [],
      confirmProduction: true,
      by: "demo",
    });
    await updateFlagMeta({
      key,
      lifecycle: "GA",
      by: "demo",
    });
    await updateFlagMeta({
      key,
      lifecycle: "deprecado",
      by: "demo",
    });
    expect((await getFlag(key))?.lifecycle).toBe("deprecado");

    const token = await login();
    const put = await app.request(`/flags/${key}/rules/staging`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({
        defaultOn: true,
        rolloutPercent: 10,
        overrides: [],
        confirmProduction: false,
      }),
    });
    expect(put.status).toBe(400);
    expect((await put.json() as { error: string }).error).toMatch(
      /Deprecated|eliminated|rules/i,
    );

    const ev = await evaluate({
      flagKey: key,
      environment: "production",
      tenantId: "t",
      userId: "u1",
    });
    expect(ev.status).toBe(200);
    expect(ev.body).toEqual({
      enabled: true,
      reason: "rollout",
      flagKey: key,
    });
  });

  it("CA-14-10: cerrar y reabrir la DB en archivo conserva la flag", async () => {
    const key = "ca10_persist";
    await createFlag({ key, by: "demo" });
    expect((await listFlags()).some((f) => f.key === key)).toBe(true);

    closeDb();
    // Misma DATABASE_URL en archivo: el singleton se recrea al primer acceso.
    const again = await listFlags();
    expect(again.some((f) => f.key === key)).toBe(true);
    expect(await getFlag(key)).toMatchObject({ key });
  });

  it("CA-14-12: PUT production confirmado cambia /evaluate de inmediato", async () => {
    const key = "ca12_noredeploy";
    await createFlag({ key, by: "demo" });
    await upsertEnvironmentRules({
      key,
      environment: "production",
      defaultOn: false,
      rolloutPercent: 100,
      overrides: [],
      confirmProduction: true,
      by: "demo",
    });

    const before = await evaluate({
      flagKey: key,
      environment: "production",
      tenantId: "t",
      userId: "u1",
    });
    expect(before.body.enabled).toBe(true);

    const started = Date.now();
    await upsertEnvironmentRules({
      key,
      environment: "production",
      defaultOn: false,
      rolloutPercent: 0,
      overrides: [],
      confirmProduction: true,
      by: "demo",
    });
    const after = await evaluate({
      flagKey: key,
      environment: "production",
      tenantId: "t",
      userId: "u1",
    });
    const elapsed = Date.now() - started;

    expect(after.body).toEqual({
      enabled: false,
      reason: "default",
      flagKey: key,
    });
    expect(elapsed).toBeLessThan(60_000);
  });

  it("CA-14-13: no hay rutas OAuth/roles ni campos de targeting fuera de alcance", async () => {
    for (const path of [
      "/oauth",
      "/oauth/callback",
      "/roles",
      "/rbac",
      "/analytics/exposure",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }

    const rejected = await app.request("/evaluate", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        flagKey: "x",
        environment: "dev",
        tenantId: "t",
        userId: "u",
        region: "eu",
        plan: "enterprise",
      }),
    });
    // Zod strip/forbid: con schema estricto los extras no habilitan targeting.
    // Si el body sigue siendo válido (strip), la evaluación usa solo env/tenant/user.
    expect([200, 400]).toContain(rejected.status);
    if (rejected.status === 200) {
      const body = (await rejected.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("region");
      expect(Object.keys(body).sort()).toEqual(
        ["enabled", "flagKey", "reason"].sort(),
      );
    }
  });
});
