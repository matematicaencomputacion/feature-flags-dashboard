import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TTL corto para no depender de las 8 horas del default. Se setea antes de
// importar el módulo, que resuelve la variable al cargarse.
const TTL_MS = 60_000;
process.env.SESSION_TTL_MS = String(TTL_MS);
// La suite no toca la base, pero evita que un import cree el archivo SQLite.
process.env.DATABASE_URL = "file::memory:?cache=shared";

const { app } = await import("./app");
const {
  createSession,
  destroySession,
  getSessionUser,
  startSessionSweep,
  stopSessionSweep,
  sweepExpiredSessions,
} = await import("./auth");

const json = { "Content-Type": "application/json" };

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopSessionSweep();
  vi.useRealTimers();
});

describe("sesiones — TTL", () => {
  it("vale antes del TTL y deja de valer después", () => {
    const token = createSession("demo");

    vi.advanceTimersByTime(TTL_MS - 1_000);
    expect(getSessionUser(token)).toBe("demo");

    vi.advanceTimersByTime(2_000);
    expect(getSessionUser(token)).toBeNull();
  });

  it("consultar una sesión vencida la saca del Map", () => {
    const token = createSession("demo");
    vi.advanceTimersByTime(TTL_MS + 1);

    expect(getSessionUser(token)).toBeNull();
    // Si siguiera guardada, el barrido tendría algo que eliminar.
    expect(sweepExpiredSessions()).toBe(0);
  });

  it("usar la sesión no renueva el TTL", () => {
    const token = createSession("demo");

    // Cinco accesos repartidos dentro de la ventana: si fuese sliding, cada uno
    // correría el vencimiento y la sesión nunca expiraría.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(TTL_MS / 5);
      expect(getSessionUser(token)).toBe("demo");
    }

    vi.advanceTimersByTime(1);
    expect(getSessionUser(token)).toBeNull();
  });

  it("logout invalida la sesión antes de que venza", () => {
    const token = createSession("demo");

    destroySession(token);

    expect(getSessionUser(token)).toBeNull();
  });
});

describe("sesiones — barrido", () => {
  it("elimina las vencidas y deja intactas las vigentes", () => {
    const vencida = createSession("demo");
    vi.advanceTimersByTime(TTL_MS + 1);
    const vigente = createSession("demo");

    expect(sweepExpiredSessions()).toBe(1);
    expect(getSessionUser(vigente)).toBe("demo");
    expect(getSessionUser(vencida)).toBeNull();

    destroySession(vigente);
  });

  it("el intervalo barre sin que nadie consulte la sesión", () => {
    const vencida = createSession("demo");
    vi.advanceTimersByTime(TTL_MS + 1);
    const vigente = createSession("demo");

    startSessionSweep(1_000);
    vi.advanceTimersByTime(1_000);

    // Nunca se consultó `vencida`, así que sólo el barrido pudo sacarla: que no
    // quede nada por barrer lo demuestra.
    expect(sweepExpiredSessions()).toBe(0);
    expect(getSessionUser(vigente)).toBe("demo");

    destroySession(vigente);
  });

  it("arrancarlo dos veces no deja un timer huérfano", () => {
    startSessionSweep(1_000);
    startSessionSweep(1_000);

    stopSessionSweep();

    const vencida = createSession("demo");
    vi.advanceTimersByTime(TTL_MS + 1);
    // Si hubiera quedado un segundo intervalo vivo, ya la habría barrido.
    expect(sweepExpiredSessions()).toBe(1);
    expect(getSessionUser(vencida)).toBeNull();
  });
});

describe("sesiones — HTTP", () => {
  it("/auth/me pasa a 401 cuando el token vence", async () => {
    const login = await app.request("/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });
    const { token } = (await login.json()) as { token: string };

    const vigente = await app.request("/auth/me", { headers: authed(token) });
    expect(vigente.status).toBe(200);

    vi.advanceTimersByTime(TTL_MS + 1);

    const vencido = await app.request("/auth/me", { headers: authed(token) });
    expect(vencido.status).toBe(401);
  });

  it("/flags rechaza un token vencido", async () => {
    const login = await app.request("/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });
    const { token } = (await login.json()) as { token: string };

    vi.advanceTimersByTime(TTL_MS + 1);

    const res = await app.request("/flags", { headers: authed(token) });
    expect(res.status).toBe(401);
  });

  it("/auth/logout sigue invalidando el token", async () => {
    const login = await app.request("/auth/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ username: "demo", password: "demo" }),
    });
    const { token } = (await login.json()) as { token: string };

    await app.request("/auth/logout", { method: "POST", headers: authed(token) });

    const res = await app.request("/auth/me", { headers: authed(token) });
    expect(res.status).toBe(401);
  });
});
