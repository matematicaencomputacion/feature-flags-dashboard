import {
  ENVIRONMENTS,
  evaluateFlag,
  type Environment,
  type Lifecycle,
  type OverrideMode,
  type SafeDefault,
} from "@ff/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  DEMO_USER,
  createSession,
  destroySession,
  getSessionUser,
  requireAuth,
} from "./auth";
import {
  createFlag,
  getFlag,
  listFlags,
  updateFlagMeta,
  upsertEnvironmentRules,
} from "./repo";

type Variables = { user: string };

const app = new Hono<{ Variables: Variables }>();

app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  if (username !== DEMO_USER.username || password !== DEMO_USER.password) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const token = createSession(DEMO_USER.username);
  return c.json({ token, user: { username: DEMO_USER.displayName } });
});

app.post("/auth/logout", async (c) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  destroySession(token);
  return c.json({ ok: true });
});

app.get("/auth/me", (c) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const user = getSessionUser(token);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user: { username: user } });
});

app.use("/flags/*", requireAuth);
app.use("/flags", requireAuth);

app.get("/flags", async (c) => {
  const items = await listFlags();
  return c.json({ items });
});

app.post("/flags", async (c) => {
  const schema = z.object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, "key must be snake_case starting with a letter"),
    safeDefault: z.enum(["off", "on"]).optional(),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  try {
    const flag = await createFlag({
      key: parsed.data.key,
      safeDefault: parsed.data.safeDefault as SafeDefault | undefined,
      by: c.get("user"),
    });
    return c.json({ flag }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Create failed";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return c.json({ error: "Flag key already exists" }, 409);
    }
    return c.json({ error: message }, 500);
  }
});

app.get("/flags/:key", async (c) => {
  const flag = await getFlag(c.req.param("key"));
  if (!flag) return c.json({ error: "Not found" }, 404);
  return c.json({ flag });
});

app.patch("/flags/:key", async (c) => {
  const schema = z.object({
    lifecycle: z.enum(["experimental", "GA", "deprecado", "eliminado"]).optional(),
    safeDefault: z.enum(["off", "on"]).optional(),
    cleanupChecklistConfirmed: z.boolean().optional(),
    confirmProduction: z.boolean().optional(),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // Cambios de lifecycle/safeDefault afectan evaluación en todos los envs incl. prod
  if (
    (parsed.data.lifecycle || parsed.data.safeDefault) &&
    !parsed.data.confirmProduction
  ) {
    return c.json(
      {
        error:
          "Meta changes affect production evaluation; confirmProduction=true required",
      },
      400,
    );
  }

  try {
    const flag = await updateFlagMeta({
      key: c.req.param("key"),
      lifecycle: parsed.data.lifecycle as Lifecycle | undefined,
      safeDefault: parsed.data.safeDefault as SafeDefault | undefined,
      cleanupChecklistConfirmed: parsed.data.cleanupChecklistConfirmed,
      by: c.get("user"),
    });
    return c.json({ flag });
  } catch (e) {
    const err = e as Error & { status?: number };
    return c.json({ error: err.message }, err.status ?? 500);
  }
});

app.put("/flags/:key/rules/:environment", async (c) => {
  const environment = c.req.param("environment");
  if (!ENVIRONMENTS.includes(environment as Environment)) {
    return c.json({ error: "Invalid environment" }, 400);
  }

  const schema = z.object({
    defaultOn: z.boolean(),
    rolloutPercent: z.number().int().min(0).max(100),
    overrides: z.array(
      z.object({
        tenantId: z.string().min(1),
        mode: z.enum(["force_on", "force_off"]),
      }),
    ),
    confirmProduction: z.boolean().optional().default(false),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const flag = await upsertEnvironmentRules({
      key: c.req.param("key"),
      environment: environment as Environment,
      defaultOn: parsed.data.defaultOn,
      rolloutPercent: parsed.data.rolloutPercent,
      overrides: parsed.data.overrides as { tenantId: string; mode: OverrideMode }[],
      confirmProduction: parsed.data.confirmProduction ?? false,
      by: c.get("user"),
    });
    return c.json({ flag });
  } catch (e) {
    const err = e as Error & { status?: number };
    return c.json({ error: err.message }, err.status ?? 500);
  }
});

/** Evaluación pública para consumidores (sin auth de panel). */
app.post("/evaluate", async (c) => {
  const schema = z.object({
    flagKey: z.string().min(1),
    environment: z.enum(["dev", "staging", "production"]),
    tenantId: z.string().min(1),
    userId: z.string().min(1),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const flag = await getFlag(parsed.data.flagKey);
    const result = evaluateFlag(flag, {
      environment: parsed.data.environment,
      tenantId: parsed.data.tenantId,
      userId: parsed.data.userId,
    });
    // not_found → safe_default off implícito
    if (result.reason === "not_found") {
      return c.json({
        enabled: false,
        reason: "safe_default",
        flagKey: parsed.data.flagKey,
      });
    }
    return c.json({ ...result, flagKey: parsed.data.flagKey });
  } catch {
    // RF-25: si falla la lectura, safe_default (off si no hay flag cacheable)
    return c.json({
      enabled: false,
      reason: "safe_default",
      flagKey: parsed.data.flagKey,
    });
  }
});

export { app };
