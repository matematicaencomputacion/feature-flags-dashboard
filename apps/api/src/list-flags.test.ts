import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Misma estrategia que app.test.ts: SQLite en memoria con cache compartida.
process.env.DATABASE_URL = "file::memory:?cache=shared";

const { flags } = await import("@ff/db");
const {
  closeDb,
  createFlag,
  ensureSchema,
  getDb,
  getFlag,
  listFlags,
  updateFlagMeta,
  upsertEnvironmentRules,
} = await import("./repo");

/** Flags con auditoría, reglas en varios ambientes y overrides. */
const KEYS_CON_HISTORIAL = ["alpha_flag", "beta_flag", "gamma_flag"];
/** Insertada a mano, sin reglas ni auditoría: ejercita el caso lastChange ausente. */
const KEY_SIN_AUDITORIA = "sin_auditoria";

/**
 * Los tenants se cargan en orden inverso al alfabético a propósito: si la lectura
 * en lote ordenara distinto que la lectura de a una (por ejemplo, cayendo en el
 * índice unique en vez del orden de inserción), la equivalencia lo detecta.
 */
async function seedFlagConHistorial(key: string): Promise<void> {
  await createFlag({ key, by: "demo" });

  await upsertEnvironmentRules({
    key,
    environment: "dev",
    defaultOn: true,
    rolloutPercent: 25,
    overrides: [
      { tenantId: "zeta", mode: "force_on" },
      { tenantId: "alpha", mode: "force_off" },
      { tenantId: "mid", mode: "force_on" },
    ],
    confirmProduction: false,
    by: "demo",
  });

  await upsertEnvironmentRules({
    key,
    environment: "production",
    defaultOn: false,
    rolloutPercent: 10,
    overrides: [
      { tenantId: "omega", mode: "force_off" },
      { tenantId: "beta", mode: "force_on" },
    ],
    confirmProduction: true,
    by: "demo",
  });

  // Tercera entrada de auditoría: el último cambio no puede ser el de creación.
  await updateFlagMeta({ key, lifecycle: "GA", by: "demo" });
}

beforeAll(async () => {
  await ensureSchema();

  for (const key of KEYS_CON_HISTORIAL) {
    await seedFlagConHistorial(key);
  }

  const now = new Date().toISOString();
  await getDb().insert(flags).values({
    key: KEY_SIN_AUDITORIA,
    lifecycle: "experimental",
    safeDefault: "off",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(() => {
  closeDb();
});

describe("listFlags — equivalencia con getFlag", () => {
  it("devuelve para cada flag exactamente lo mismo que getFlag", async () => {
    const items = await listFlags();
    expect(items.map((f) => f.key).sort()).toEqual(
      [...KEYS_CON_HISTORIAL, KEY_SIN_AUDITORIA].sort(),
    );

    for (const item of items) {
      const single = await getFlag(item.key);
      expect(single).not.toBeNull();
      expect(item).toEqual(single);
      // Compara también el orden de rules y de overrides, que toEqual respeta
      // pero conviene dejar explícito: el panel los pinta en ese orden.
      expect(JSON.stringify(item)).toBe(JSON.stringify(single));
    }
  });

  it("conserva el orden de ambientes y el contenido de los overrides", async () => {
    const [alpha] = await listFlags();
    expect(alpha?.rules.map((r) => r.environment)).toEqual([
      "dev",
      "staging",
      "production",
    ]);

    const dev = alpha?.rules.find((r) => r.environment === "dev");
    expect(dev?.defaultOn).toBe(true);
    expect(dev?.rolloutPercent).toBe(25);
    expect(dev?.overrides).toHaveLength(3);
    expect([...(dev?.overrides ?? [])].map((o) => o.tenantId).sort()).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);

    const staging = alpha?.rules.find((r) => r.environment === "staging");
    expect(staging).toEqual({
      environment: "staging",
      defaultOn: false,
      rolloutPercent: 0,
      overrides: [],
    });
  });

  it("reporta el último cambio, y lo omite en la flag sin auditoría", async () => {
    const items = await listFlags();
    const conHistorial = items.find((f) => f.key === "alpha_flag");
    const sinAuditoria = items.find((f) => f.key === KEY_SIN_AUDITORIA);

    expect(conHistorial?.lastChange?.summary).toMatch(/lifecycle/);
    expect(sinAuditoria?.lastChange).toBeUndefined();
  });
});

describe("listFlags — costo", () => {
  it("ejecuta un número constante de queries, no uno por flag", async () => {
    const spy = vi.spyOn(getDb().$client, "execute");
    try {
      spy.mockClear();
      const pocas = await listFlags();
      const queriesConPocas = spy.mock.calls.length;

      for (let i = 0; i < 6; i++) {
        await seedFlagConHistorial(`extra_flag_${i}`);
      }

      spy.mockClear();
      const muchas = await listFlags();
      const queriesConMuchas = spy.mock.calls.length;

      expect(muchas.length).toBe(pocas.length + 6);
      expect(queriesConPocas).toBe(4);
      expect(queriesConMuchas).toBe(4);
    } finally {
      spy.mockRestore();
    }
  });
});
