import type { Context, Next } from "hono";

/** Usuario demo único (RF-01 / premisa 4). Sin OAuth ni roles. */
export const DEMO_USER = {
  username: "demo",
  password: "demo",
  displayName: "demo",
} as const;

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1_000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * El TTL corre desde la creación y NO se renueva al usar la sesión (no es
 * sliding). Con un único usuario demo y un panel interno, una expiración
 * predecible vale más que mantener viva una sesión activa: un token filtrado
 * deja de servir dentro de una ventana acotada por más que lo sigan usando, y no
 * hay que escribir en el Map en cada request. Si alguna vez hay usuarios reales,
 * esto se revisa junto con el resto de la auth.
 */
function ttlFromEnv(): number {
  const raw = process.env.SESSION_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;

  const ttlMs = Number(raw);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(
      `SESSION_TTL_MS debe ser una cantidad de ms positiva; recibido: ${raw}`,
    );
  }
  return ttlMs;
}

const sessionTtlMs = ttlFromEnv();

type Session = { username: string; createdAt: number };

const sessions = new Map<string, Session>();

function hasExpired(session: Session, now: number): boolean {
  return now > session.createdAt + sessionTtlMs;
}

export function createSession(username: string): string {
  const token = `demo_${crypto.randomUUID()}`;
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

export function getSessionUser(token: string | undefined): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (hasExpired(session, Date.now())) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

/**
 * Descarta las sesiones vencidas y devuelve cuántas eliminó. `getSessionUser` ya
 * descarta la que consulta, pero una sesión que nadie vuelve a usar quedaría
 * ocupando memoria hasta que se reinicie el proceso.
 */
export function sweepExpiredSessions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [token, session] of sessions) {
    if (hasExpired(session, now)) {
      sessions.delete(token);
      removed++;
    }
  }
  return removed;
}

let sweepHandle: ReturnType<typeof setInterval> | undefined;

/** Arranca el barrido periódico. Idempotente: llamarlo dos veces no duplica el timer. */
export function startSessionSweep(intervalMs: number = SWEEP_INTERVAL_MS): void {
  if (sweepHandle) return;
  sweepHandle = setInterval(sweepExpiredSessions, intervalMs);
  // Un timer de limpieza no puede ser el motivo por el que el proceso no termina.
  sweepHandle.unref?.();
}

export function stopSessionSweep(): void {
  if (!sweepHandle) return;
  clearInterval(sweepHandle);
  sweepHandle = undefined;
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const user = getSessionUser(token);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("user", user);
  await next();
}
