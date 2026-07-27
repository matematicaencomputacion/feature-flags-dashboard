import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./client";

/**
 * Carpeta generada por `drizzle-kit generate`. Resuelta desde este módulo
 * (no desde cwd) para que funcione igual desde la raíz, desde apps/api y en tests.
 */
export const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

/** Aplica migraciones pendientes sobre la conexión dada (idempotente). */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
