import type { Context, Next } from "hono";

/** Usuario demo único (RF-01 / premisa 4). Sin OAuth ni roles. */
export const DEMO_USER = {
  username: "demo",
  password: "demo",
  displayName: "demo",
} as const;

const sessions = new Map<string, { username: string; createdAt: number }>();

export function createSession(username: string): string {
  const token = `demo_${crypto.randomUUID()}`;
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

export function getSessionUser(token: string | undefined): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  return session?.username ?? null;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
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
