import {
  ENVIRONMENTS,
  LIFECYCLES,
  OVERRIDE_MODES,
  SAFE_DEFAULTS,
  evaluateFlag,
} from "@ff/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { conflict, isUniqueViolation, toHttpResponse } from "./errors";
import {
  DEMO_USER,
  createSession,
  destroySession,
  getSessionUser,
  requireAuth,
} from "./auth";
import { getCachedFlag, initFlagCache } from "./flag-cache";
import {
  createFlag,
  getFlag,
  listFlags,
  updateFlagMeta,
  upsertEnvironmentRules,
} from "./repo";

initFlagCache(getFlag);

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

app.get("/health", async (c) => {
  try {
    await listFlags();
    return c.json({ ok: true, db: "up" });
  } catch (e) {
    console.error("[health] db check failed", e);
    return c.json({ ok: false, db: "down" }, 503);
  }
});

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
    safeDefault: z.enum(SAFE_DEFAULTS).optional(),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  try {
    const flag = await createFlag({
      key: parsed.data.key,
      safeDefault: parsed.data.safeDefault,
      by: c.get("user"),
    });
    return c.json({ flag }, 201);
  } catch (e) {
    const err = isUniqueViolation(e) ? conflict("Flag key already exists") : e;
    const { status, message } = toHttpResponse(err);
    return c.json({ error: message }, status);
  }
});

app.get("/flags/:key", async (c) => {
  const flag = await getFlag(c.req.param("key"));
  if (!flag) return c.json({ error: "Not found" }, 404);
  return c.json({ flag });
});

app.patch("/flags/:key", async (c) => {
  const schema = z.object({
    lifecycle: z.enum(LIFECYCLES).optional(),
    safeDefault: z.enum(SAFE_DEFAULTS).optional(),
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
      lifecycle: parsed.data.lifecycle,
      safeDefault: parsed.data.safeDefault,
      cleanupChecklistConfirmed: parsed.data.cleanupChecklistConfirmed,
      by: c.get("user"),
    });
    return c.json({ flag });
  } catch (e) {
    const { status, message } = toHttpResponse(e);
    return c.json({ error: message }, status);
  }
});

app.put("/flags/:key/rules/:environment", async (c) => {
  const environment = z.enum(ENVIRONMENTS).safeParse(c.req.param("environment"));
  if (!environment.success) {
    return c.json({ error: "Invalid environment" }, 400);
  }

  const schema = z.object({
    defaultOn: z.boolean(),
    rolloutPercent: z.number().int().min(0).max(100),
    overrides: z.array(
      z.object({
        tenantId: z.string().min(1),
        mode: z.enum(OVERRIDE_MODES),
      }),
    ),
    confirmProduction: z.boolean().default(false),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const flag = await upsertEnvironmentRules({
      key: c.req.param("key"),
      environment: environment.data,
      defaultOn: parsed.data.defaultOn,
      rolloutPercent: parsed.data.rolloutPercent,
      overrides: parsed.data.overrides,
      confirmProduction: parsed.data.confirmProduction,
      by: c.get("user"),
    });
    return c.json({ flag });
  } catch (e) {
    const { status, message } = toHttpResponse(e);
    return c.json({ error: message }, status);
  }
});

/**
 * Evaluación pública para consumidores (sin auth de panel).
 *
 * Único endpoint que lee del caché: el panel (`GET /flags`, `GET /flags/:key`)
 * va siempre a la base para que el operador vea el estado real apenas guarda.
 */
app.post("/evaluate", async (c) => {
  const schema = z.object({
    flagKey: z.string().min(1),
    environment: z.enum(ENVIRONMENTS),
    tenantId: z.string().min(1),
    userId: z.string().min(1),
  });
  const parsed = schema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const flag = await getCachedFlag(parsed.data.flagKey);
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
  } catch (e) {
    // RF-25: si falla la lectura, safe_default (off si no hay flag cacheable).
    // Se loggea: un fallo de base no puede ser indistinguible de una flag apagada.
    console.error("[evaluate] fallback a safe_default", {
      flagKey: parsed.data.flagKey,
      environment: parsed.data.environment,
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json({
      enabled: false,
      reason: "safe_default",
      flagKey: parsed.data.flagKey,
    });
  }
});

export { app };
