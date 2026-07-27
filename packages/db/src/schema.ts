import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const flags = sqliteTable("flags", {
  key: text("key").primaryKey(),
  lifecycle: text("lifecycle").notNull().default("experimental"),
  safeDefault: text("safe_default").notNull().default("off"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const environmentRules = sqliteTable(
  "environment_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => flags.key, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    defaultOn: integer("default_on", { mode: "boolean" }).notNull().default(false),
    rolloutPercent: integer("rollout_percent").notNull().default(0),
  },
  (t) => [uniqueIndex("env_rules_flag_env").on(t.flagKey, t.environment)],
);

export const tenantOverrides = sqliteTable(
  "tenant_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => flags.key, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    tenantId: text("tenant_id").notNull(),
    mode: text("mode").notNull(),
  },
  (t) => [
    uniqueIndex("tenant_override_unique").on(
      t.flagKey,
      t.environment,
      t.tenantId,
    ),
  ],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  flagKey: text("flag_key").notNull(),
  by: text("by").notNull(),
  at: text("at").notNull(),
  summary: text("summary").notNull(),
});
