import {
  auditLog,
  createDb,
  environmentRules,
  flags,
  tenantOverrides,
  type Db,
} from "@ff/db";
import {
  ENVIRONMENTS,
  type Environment,
  type EnvironmentRules,
  type FeatureFlag,
  type Lifecycle,
  type OverrideMode,
  type SafeDefault,
} from "@ff/domain";
import { createClient } from "@libsql/client";
import { and, desc, eq } from "drizzle-orm";
import { badRequest, notFound } from "./errors";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const path = resolve(process.cwd(), "../../data/feature-flags.db");
  mkdirSync(dirname(path), { recursive: true });
  return `file:${path}`;
}

let db: Db | undefined;

export function getDb(): Db {
  if (!db) db = createDb(dbUrl());
  return db;
}

/**
 * Cierra la conexión y descarta el singleton. Necesario para que el proceso (o un
 * test) pueda soltar el archivo SQLite: en Windows el handle abierto hace fallar
 * con EPERM cualquier borrado del directorio que lo contiene.
 */
export function closeDb(): void {
  db?.$client.close();
  db = undefined;
}

export async function ensureSchema(): Promise<void> {
  const client = createClient({ url: dbUrl() });
  try {
    await client.executeMultiple(`
CREATE TABLE IF NOT EXISTS flags (
  key TEXT PRIMARY KEY,
  lifecycle TEXT NOT NULL DEFAULT 'experimental',
  safe_default TEXT NOT NULL DEFAULT 'off',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS environment_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_key TEXT NOT NULL REFERENCES flags(key) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  default_on INTEGER NOT NULL DEFAULT 0,
  rollout_percent INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS env_rules_flag_env ON environment_rules(flag_key, environment);
CREATE TABLE IF NOT EXISTS tenant_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_key TEXT NOT NULL REFERENCES flags(key) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  mode TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_override_unique ON tenant_overrides(flag_key, environment, tenant_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_key TEXT NOT NULL,
  by TEXT NOT NULL,
  at TEXT NOT NULL,
  summary TEXT NOT NULL
);
`);
  } finally {
    // Sin esto queda un handle abierto sobre el archivo por cada arranque.
    client.close();
  }
}

async function loadRules(flagKey: string): Promise<EnvironmentRules[]> {
  const d = getDb();
  const envRows = await d
    .select()
    .from(environmentRules)
    .where(eq(environmentRules.flagKey, flagKey));
  const overrideRows = await d
    .select()
    .from(tenantOverrides)
    .where(eq(tenantOverrides.flagKey, flagKey));

  return ENVIRONMENTS.map((environment) => {
    const row = envRows.find((r) => r.environment === environment);
    return {
      environment,
      defaultOn: row?.defaultOn ?? false,
      rolloutPercent: row?.rolloutPercent ?? 0,
      overrides: overrideRows
        .filter((o) => o.environment === environment)
        .map((o) => ({
          tenantId: o.tenantId,
          mode: o.mode as OverrideMode,
        })),
    };
  });
}

async function lastChange(flagKey: string) {
  const d = getDb();
  const [row] = await d
    .select()
    .from(auditLog)
    .where(eq(auditLog.flagKey, flagKey))
    .orderBy(desc(auditLog.id))
    .limit(1);
  if (!row) return undefined;
  return { by: row.by, at: row.at, summary: row.summary };
}

export async function listFlags(): Promise<FeatureFlag[]> {
  const d = getDb();
  const rows = await d.select().from(flags);
  return Promise.all(
    rows.map(async (row) => ({
      key: row.key,
      lifecycle: row.lifecycle as Lifecycle,
      safeDefault: row.safeDefault as SafeDefault,
      rules: await loadRules(row.key),
      lastChange: await lastChange(row.key),
    })),
  );
}

export async function getFlag(key: string): Promise<FeatureFlag | null> {
  const d = getDb();
  const [row] = await d.select().from(flags).where(eq(flags.key, key)).limit(1);
  if (!row) return null;
  return {
    key: row.key,
    lifecycle: row.lifecycle as Lifecycle,
    safeDefault: row.safeDefault as SafeDefault,
    rules: await loadRules(row.key),
    lastChange: await lastChange(row.key),
  };
}

export async function createFlag(input: {
  key: string;
  safeDefault?: SafeDefault;
  by: string;
}): Promise<FeatureFlag> {
  const d = getDb();
  const now = new Date().toISOString();
  const safeDefault = input.safeDefault ?? "off";

  // La flag, sus reglas por ambiente y la entrada de auditoría son una sola
  // unidad: sin transacción, un fallo intermedio deja una flag sin reglas.
  await d.transaction(async (tx) => {
    await tx.insert(flags).values({
      key: input.key,
      lifecycle: "experimental",
      safeDefault,
      createdAt: now,
      updatedAt: now,
    });

    for (const environment of ENVIRONMENTS) {
      await tx.insert(environmentRules).values({
        flagKey: input.key,
        environment,
        defaultOn: false,
        rolloutPercent: 0,
      });
    }

    await tx.insert(auditLog).values({
      flagKey: input.key,
      by: input.by,
      at: now,
      summary: `Created flag (safe_default=${safeDefault})`,
    });
  });

  const flag = await getFlag(input.key);
  if (!flag) throw new Error("Failed to load created flag");
  return flag;
}

export async function updateFlagMeta(input: {
  key: string;
  lifecycle?: Lifecycle;
  safeDefault?: SafeDefault;
  cleanupChecklistConfirmed?: boolean;
  by: string;
}): Promise<FeatureFlag> {
  const current = await getFlag(input.key);
  if (!current) throw notFound();

  const d = getDb();
  const now = new Date().toISOString();
  const updates: Partial<{ lifecycle: string; safeDefault: string; updatedAt: string }> = {
    updatedAt: now,
  };
  const summaries: string[] = [];

  if (input.lifecycle && input.lifecycle !== current.lifecycle) {
    const { canTransitionLifecycle } = await import("@ff/domain");
    if (!canTransitionLifecycle(current.lifecycle, input.lifecycle)) {
      throw badRequest(
        `Invalid lifecycle transition ${current.lifecycle} → ${input.lifecycle}`,
      );
    }
    if (input.lifecycle === "eliminado" && !input.cleanupChecklistConfirmed) {
      throw badRequest("Cleanup checklist confirmation required before eliminado");
    }
    updates.lifecycle = input.lifecycle;
    summaries.push(`lifecycle ${current.lifecycle} → ${input.lifecycle}`);
  }

  if (input.safeDefault && input.safeDefault !== current.safeDefault) {
    updates.safeDefault = input.safeDefault;
    summaries.push(`safe_default → ${input.safeDefault}`);
  }

  if (Object.keys(updates).length > 1) {
    await d.transaction(async (tx) => {
      await tx.update(flags).set(updates).where(eq(flags.key, input.key));
      await tx.insert(auditLog).values({
        flagKey: input.key,
        by: input.by,
        at: now,
        summary: summaries.join("; ") || "Updated flag",
      });
    });
  }

  const flag = await getFlag(input.key);
  if (!flag) throw new Error("Not found after update");
  return flag;
}

export async function upsertEnvironmentRules(input: {
  key: string;
  environment: Environment;
  defaultOn: boolean;
  rolloutPercent: number;
  overrides: { tenantId: string; mode: OverrideMode }[];
  confirmProduction: boolean;
  by: string;
}): Promise<FeatureFlag> {
  const current = await getFlag(input.key);
  if (!current) throw notFound();

  const { allowsNewRules } = await import("@ff/domain");
  if (!allowsNewRules(current.lifecycle)) {
    throw badRequest("Deprecated/eliminated flags cannot accept new rules");
  }

  if (input.environment === "production" && !input.confirmProduction) {
    throw badRequest("Production changes require confirmProduction=true");
  }

  if (input.rolloutPercent < 0 || input.rolloutPercent > 100) {
    throw badRequest("rolloutPercent must be 0–100");
  }

  const now = new Date().toISOString();
  const summary = `Updated ${input.environment}: default=${input.defaultOn}, %=${input.rolloutPercent}, overrides=${input.overrides.length}`;

  // Reemplazo de reglas + overrides + auditoría en una transacción: el DELETE de
  // overrides seguido de N INSERT no puede quedar a mitad de camino.
  await getDb().transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(environmentRules)
      .where(
        and(
          eq(environmentRules.flagKey, input.key),
          eq(environmentRules.environment, input.environment),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await tx
        .update(environmentRules)
        .set({
          defaultOn: input.defaultOn,
          rolloutPercent: input.rolloutPercent,
        })
        .where(eq(environmentRules.id, existing[0].id));
    } else {
      await tx.insert(environmentRules).values({
        flagKey: input.key,
        environment: input.environment,
        defaultOn: input.defaultOn,
        rolloutPercent: input.rolloutPercent,
      });
    }

    await tx
      .delete(tenantOverrides)
      .where(
        and(
          eq(tenantOverrides.flagKey, input.key),
          eq(tenantOverrides.environment, input.environment),
        ),
      );

    for (const o of input.overrides) {
      await tx.insert(tenantOverrides).values({
        flagKey: input.key,
        environment: input.environment,
        tenantId: o.tenantId,
        mode: o.mode,
      });
    }

    await tx.update(flags).set({ updatedAt: now }).where(eq(flags.key, input.key));
    await tx.insert(auditLog).values({
      flagKey: input.key,
      by: input.by,
      at: now,
      summary,
    });
  });

  const flag = await getFlag(input.key);
  if (!flag) throw new Error("Not found after rules update");
  return flag;
}

