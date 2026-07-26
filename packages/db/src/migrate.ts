import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const dbPath = process.env.DATABASE_URL ?? `file:${resolve(root, "data/feature-flags.db")}`;
const filePath = dbPath.replace(/^file:/, "");

mkdirSync(dirname(filePath), { recursive: true });

const client = createClient({ url: dbPath.startsWith("file:") ? dbPath : `file:${dbPath}` });

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

console.log(`Migrated SQLite at ${dbPath}`);
