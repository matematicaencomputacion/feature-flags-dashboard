import { afterAll, beforeAll, describe, expect, it } from "vitest";

// SQLite en memoria con cache compartida: la suite no toca el disco, así que no
// hay temporal que borrar ni handle que Windows pueda dejar bloqueado (el EPERM
// al limpiar). `cache=shared` hace que todas las conexiones vean la misma base.
// Se setea antes de importar el repo, que resuelve la URL en runtime.
process.env.DATABASE_URL = "file::memory:?cache=shared";

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

beforeAll(async () => {
  await ensureSchema();
});

afterAll(() => {
  closeDb();
});

describe("repo — atomicidad", () => {
  it("crea la flag con reglas de los tres ambientes y auditoría", async () => {
    const flag = await createFlag({ key: "billing_v2", by: "demo" });
    expect(flag.rules.map((r) => r.environment)).toEqual([
      "dev",
      "staging",
      "production",
    ]);
    expect(flag.lastChange?.by).toBe("demo");
  });

  it("una key duplicada falla sin dejar estado parcial", async () => {
    await expect(createFlag({ key: "billing_v2", by: "demo" })).rejects.toThrow();
    expect((await listFlags()).length).toBe(1);
  });

  it("el upsert reemplaza los overrides del ambiente de forma atómica", async () => {
    await upsertEnvironmentRules({
      key: "billing_v2",
      environment: "production",
      defaultOn: true,
      rolloutPercent: 50,
      overrides: [{ tenantId: "acme", mode: "force_off" }],
      confirmProduction: true,
      by: "demo",
    });
    await upsertEnvironmentRules({
      key: "billing_v2",
      environment: "production",
      defaultOn: true,
      rolloutPercent: 10,
      overrides: [{ tenantId: "globex", mode: "force_on" }],
      confirmProduction: true,
      by: "demo",
    });
    const flag = await getFlag("billing_v2");
    const prod = flag?.rules.find((r) => r.environment === "production");
    expect(prod?.overrides).toEqual([{ tenantId: "globex", mode: "force_on" }]);
    expect(prod?.rolloutPercent).toBe(10);
  });

  it("un cambio de production sin confirmar no persiste (RF-17)", async () => {
    await expect(
      upsertEnvironmentRules({
        key: "billing_v2",
        environment: "production",
        defaultOn: false,
        rolloutPercent: 0,
        overrides: [],
        confirmProduction: false,
        by: "demo",
      }),
    ).rejects.toThrow(/confirmProduction/);
    const flag = await getFlag("billing_v2");
    expect(flag?.rules.find((r) => r.environment === "production")?.rolloutPercent).toBe(10);
  });

  it("una transición de lifecycle inválida no muta la flag", async () => {
    await expect(
      updateFlagMeta({ key: "billing_v2", lifecycle: "deprecado", by: "demo" }),
    ).rejects.toThrow(/transition/);
    expect((await getFlag("billing_v2"))?.lifecycle).toBe("experimental");
  });
});

describe("HTTP", () => {
  it("/health verifica la base, no sólo el proceso", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });

  it("rechaza credenciales inválidas", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ username: "demo", password: "nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("/flags exige token", async () => {
    expect((await app.request("/flags")).status).toBe(401);
    const token = await login();
    expect(
      (await app.request("/flags", { headers: authed(token) })).status,
    ).toBe(200);
  });

  it("key duplicada devuelve 409 y no 500", async () => {
    const token = await login();
    const res = await app.request("/flags", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ key: "billing_v2" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe(
      "Flag key already exists",
    );
  });

  it("key con formato inválido devuelve 400", async () => {
    const token = await login();
    const res = await app.request("/flags", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ key: "Billing V2" }),
    });
    expect(res.status).toBe(400);
  });

  it("body malformado en POST /flags devuelve 400 y no 500", async () => {
    const token = await login();
    const res = await app.request("/flags", {
      method: "POST",
      headers: authed(token),
      body: "{ key: sin_comillas",
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("Invalid JSON body");
  });

  // El schema del PATCH es todo opcional, así que un fallback a {} parsearía
  // limpio y devolvería 200 ante un body roto.
  it("body malformado en PATCH /flags/:key devuelve 400 y no muta la flag", async () => {
    const token = await login();
    const res = await app.request("/flags/billing_v2", {
      method: "PATCH",
      headers: authed(token),
      body: "no soy json",
    });
    expect(res.status).toBe(400);
    expect((await getFlag("billing_v2"))?.lifecycle).toBe("experimental");
  });

  it("body malformado en PUT rules devuelve 400 y no pisa las reglas", async () => {
    const token = await login();
    const res = await app.request("/flags/billing_v2/rules/production", {
      method: "PUT",
      headers: authed(token),
      body: "{",
    });
    expect(res.status).toBe(400);
    const flag = await getFlag("billing_v2");
    expect(flag?.rules.find((r) => r.environment === "production")?.rolloutPercent).toBe(10);
  });

  it("body malformado en /evaluate devuelve 400 y no 500", async () => {
    const res = await app.request("/evaluate", {
      method: "POST",
      headers: json,
      body: '{"flagKey": }',
    });
    expect(res.status).toBe(400);
  });

  it("evaluate: force_on gana sobre el rollout", async () => {
    const res = await app.request("/evaluate", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        flagKey: "billing_v2",
        environment: "production",
        tenantId: "globex",
        userId: "u1",
      }),
    });
    expect(await res.json()).toEqual({
      enabled: true,
      reason: "force_on",
      flagKey: "billing_v2",
    });
  });

  it("evaluate: flag inexistente cae a safe_default off", async () => {
    const res = await app.request("/evaluate", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        flagKey: "no_existe",
        environment: "production",
        tenantId: "t",
        userId: "u",
      }),
    });
    expect(await res.json()).toEqual({
      enabled: false,
      reason: "safe_default",
      flagKey: "no_existe",
    });
  });

  it("evaluate: el rollout es terminal end-to-end (defaultOn=true, 10%)", async () => {
    const results = await Promise.all(
      Array.from({ length: 60 }, async (_, i) => {
        const res = await app.request("/evaluate", {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            flagKey: "billing_v2",
            environment: "production",
            tenantId: "sin_override",
            userId: `u-${i}`,
          }),
        });
        return (await res.json()) as { enabled: boolean };
      }),
    );
    const on = results.filter((r) => r.enabled).length;
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(30);
  });
});
