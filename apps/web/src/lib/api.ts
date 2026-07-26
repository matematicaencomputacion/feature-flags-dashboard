import type { Environment, FeatureFlag, Lifecycle, OverrideMode, SafeDefault } from "@ff/domain";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ff_token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const t = token();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.formErrors?.[0] ?? data.error ?? res.statusText);
  }
  return data as T;
}

export async function login(username: string, password: string) {
  const data = await request<{ token: string; user: { username: string } }>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    },
  );
  localStorage.setItem("ff_token", data.token);
  return data.user;
}

export async function logout() {
  try {
    await request("/auth/logout", { method: "POST" });
  } finally {
    localStorage.removeItem("ff_token");
  }
}

export async function listFlags() {
  return request<{ items: FeatureFlag[] }>("/flags");
}

export async function getFlag(key: string) {
  return request<{ flag: FeatureFlag }>(`/flags/${encodeURIComponent(key)}`);
}

export async function createFlag(key: string, safeDefault: SafeDefault = "off") {
  return request<{ flag: FeatureFlag }>("/flags", {
    method: "POST",
    body: JSON.stringify({ key, safeDefault }),
  });
}

export async function updateFlagMeta(
  key: string,
  body: {
    lifecycle?: Lifecycle;
    safeDefault?: SafeDefault;
    cleanupChecklistConfirmed?: boolean;
    confirmProduction: boolean;
  },
) {
  return request<{ flag: FeatureFlag }>(`/flags/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function updateRules(
  key: string,
  environment: Environment,
  body: {
    defaultOn: boolean;
    rolloutPercent: number;
    overrides: { tenantId: string; mode: OverrideMode }[];
    confirmProduction: boolean;
  },
) {
  return request<{ flag: FeatureFlag }>(
    `/flags/${encodeURIComponent(key)}/rules/${environment}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export { API_URL };
