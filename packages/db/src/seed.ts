import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import { runMigrations } from "./migrations";
import {
  auditLog,
  environmentRules,
  flags,
  tenantOverrides,
} from "./schema";

/**
 * Seed idempotente alineado al escenario de Spec 14 (`mvp_check`).
 * Spec 03 pedía `billing_v2`; en main prevalece el escenario de aceptación MVP.
 *
 * - production: rollout 100% + override acme force_off
 * - staging: rollout 50%, sin overrides
 * - dev: default off, rollout 0
 */
const FLAG_KEY = "mvp_check";
const SEED_BY = "seed";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const dbPath = process.env.DATABASE_URL ?? `file:${resolve(root, "data/feature-flags.db")}`;
const filePath = dbPath.replace(/^file:/, "");

if (!dbPath.includes(":memory:")) {
  mkdirSync(dirname(filePath), { recursive: true });
}

const url = dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`;
const db = createDb(url);

await runMigrations(db);

const now = new Date().toISOString();

await db
  .insert(flags)
  .values({
    key: FLAG_KEY,
    lifecycle: "experimental",
    safeDefault: "off",
    createdAt: now,
    updatedAt: now,
  })
  .onConflictDoUpdate({
    target: flags.key,
    set: {
      lifecycle: "experimental",
      safeDefault: "off",
      updatedAt: now,
    },
  });

async function upsertRule(
  environment: string,
  defaultOn: boolean,
  rolloutPercent: number,
): Promise<void> {
  const existing = await db
    .select()
    .from(environmentRules)
    .where(
      and(
        eq(environmentRules.flagKey, FLAG_KEY),
        eq(environmentRules.environment, environment),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(environmentRules)
      .set({ defaultOn, rolloutPercent })
      .where(eq(environmentRules.id, existing[0].id));
  } else {
    await db.insert(environmentRules).values({
      flagKey: FLAG_KEY,
      environment,
      defaultOn,
      rolloutPercent,
    });
  }
}

await upsertRule("dev", false, 0);
await upsertRule("staging", false, 50);
await upsertRule("production", false, 100);

// Staging: sin overrides (borrar leftovers de corridas viejas).
await db
  .delete(tenantOverrides)
  .where(
    and(
      eq(tenantOverrides.flagKey, FLAG_KEY),
      eq(tenantOverrides.environment, "staging"),
    ),
  );

await db
  .delete(tenantOverrides)
  .where(
    and(
      eq(tenantOverrides.flagKey, FLAG_KEY),
      eq(tenantOverrides.environment, "dev"),
    ),
  );

const prodOverride = await db
  .select()
  .from(tenantOverrides)
  .where(
    and(
      eq(tenantOverrides.flagKey, FLAG_KEY),
      eq(tenantOverrides.environment, "production"),
      eq(tenantOverrides.tenantId, "acme"),
    ),
  )
  .limit(1);

if (prodOverride[0]) {
  await db
    .update(tenantOverrides)
    .set({ mode: "force_off" })
    .where(eq(tenantOverrides.id, prodOverride[0].id));
} else {
  await db.insert(tenantOverrides).values({
    flagKey: FLAG_KEY,
    environment: "production",
    tenantId: "acme",
    mode: "force_off",
  });
}

// Una sola fila de auditoría del seed: re-correr no duplica.
const existingAudit = await db
  .select()
  .from(auditLog)
  .where(and(eq(auditLog.flagKey, FLAG_KEY), eq(auditLog.by, SEED_BY)))
  .limit(1);

if (!existingAudit[0]) {
  await db.insert(auditLog).values({
    flagKey: FLAG_KEY,
    by: SEED_BY,
    at: now,
    summary:
      "Seed mvp_check (prod 100% + acme force_off; staging 50%; dev 0%)",
  });
}

db.$client.close();
console.log(`Seeded ${FLAG_KEY} at ${dbPath}`);
