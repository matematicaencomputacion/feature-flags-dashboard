import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import { runMigrations } from "./migrations";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const dbPath = process.env.DATABASE_URL ?? `file:${resolve(root, "data/feature-flags.db")}`;
const filePath = dbPath.replace(/^file:/, "");

if (!dbPath.includes(":memory:")) {
  mkdirSync(dirname(filePath), { recursive: true });
}

const url = dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`;
const db = createDb(url);

await runMigrations(db);
db.$client.close();

console.log(`Migrated SQLite at ${dbPath}`);
