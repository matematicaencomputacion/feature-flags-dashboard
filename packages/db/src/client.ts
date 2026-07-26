import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL ?? "file:../../data/feature-flags.db") {
  const client = createClient({ url });
  return drizzle(client, { schema });
}
