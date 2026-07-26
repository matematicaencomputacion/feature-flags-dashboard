import { serve } from "@hono/node-server";
import { app } from "./app";
import { ensureSchema } from "./repo";

const port = Number(process.env.PORT ?? 8787);

await ensureSchema();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
