import {
  auditLog,
  createDb,
  environmentRules,
  flags,
  runMigrations,
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
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { badRequest, notFound } from "./errors";
import { invalidateFlag } from "./flag-cache";
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

/**
 * Aplica migraciones versionadas (drizzle-kit) sobre la MISMA conexión que usa
 * el repo: un cliente aparte dejaría un handle sin cerrar y, con SQLite en
 * memoria, apuntaría a una base distinta.
 */
export async function ensureSchema(): Promise<void> {
  await runMigrations(getDb());
}

type EnvironmentRuleRow = typeof environmentRules.$inferSelect;
type TenantOverrideRow = typeof tenantOverrides.$inferSelect;
type AuditLogRow = typeof auditLog.$inferSelect;

/**
 * Arma las reglas de una flag a partir de filas ya leídas. Es el único lugar que
 * define el shape, así que la lectura de a una (getFlag) y la lectura en lote
 * (listFlags) no pueden divergir.
 *
 * El orden de `overrideRows` se respeta tal cual y queda expuesto en la respuesta,
 * así que ambas lecturas lo piden explícito por (environment, tenant_id). Antes
 * salía de que SQLite resolviera el filtro por flag_key con el índice unique;
 * leyendo la tabla entera ese orden implícito pasa a ser el de inserción.
 */
function buildRules(
  envRows: EnvironmentRuleRow[],
  overrideRows: TenantOverrideRow[],
): EnvironmentRules[] {
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

function groupByFlagKey<T extends { flagKey: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.flagKey);
    if (bucket) bucket.push(row);
    else grouped.set(row.flagKey, [row]);
  }
  return grouped;
}

function toLastChange(row: AuditLogRow) {
  return { by: row.by, at: row.at, summary: row.summary };
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
    .where(eq(tenantOverrides.flagKey, flagKey))
    .orderBy(tenantOverrides.environment, tenantOverrides.tenantId);

  return buildRules(envRows, overrideRows);
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
  return toLastChange(row);
}

/**
 * Lee todas las flags con un número constante de queries (4), no 3 por flag.
 *
 * Las reglas y los overrides se leen sin filtro porque el resultado incluye a
 * todas las flags: el FK con ON DELETE CASCADE garantiza que no haya filas
 * huérfanas, y evitar el `IN (...)` deja fuera el límite de variables de SQLite
 * cuando el catálogo crece.
 *
 * Las filas de auditoría se acotan a la última de cada flag con un max(id)
 * agrupado, para no traer el historial entero sólo para mostrar el último cambio.
 */
export async function listFlags(): Promise<FeatureFlag[]> {
  const d = getDb();
  const rows = await d.select().from(flags);
  if (rows.length === 0) return [];

  const [envRows, overrideRows, auditRows] = await Promise.all([
    d.select().from(environmentRules),
    d
      .select()
      .from(tenantOverrides)
      .orderBy(
        tenantOverrides.flagKey,
        tenantOverrides.environment,
        tenantOverrides.tenantId,
      ),
    d
      .select()
      .from(auditLog)
      .where(
        inArray(
          auditLog.id,
          d.select({ id: max(auditLog.id) }).from(auditLog).groupBy(auditLog.flagKey),
        ),
      ),
  ]);

  const envByFlag = groupByFlagKey(envRows);
  const overridesByFlag = groupByFlagKey(overrideRows);
  const lastChangeByFlag = new Map(
    auditRows.map((row) => [row.flagKey, toLastChange(row)]),
  );

  return rows.map((row) => ({
    key: row.key,
    lifecycle: row.lifecycle as Lifecycle,
    safeDefault: row.safeDefault as SafeDefault,
    rules: buildRules(envByFlag.get(row.key) ?? [], overridesByFlag.get(row.key) ?? []),
    lastChange: lastChangeByFlag.get(row.key),
  }));
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

  // Descarta la entrada negativa: /evaluate pudo cachear esta key como
  // inexistente antes de que se creara.
  invalidateFlag(input.key);

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

    invalidateFlag(input.key);
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

  invalidateFlag(input.key);

  const flag = await getFlag(input.key);
  if (!flag) throw new Error("Not found after rules update");
  return flag;
}

