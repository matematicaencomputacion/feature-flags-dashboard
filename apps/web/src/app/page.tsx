"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("ff_token")) {
      router.replace("/flags");
    }
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await login(String(form.get("username")), String(form.get("password")));
      router.push("/flags");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="mb-2 text-sm tracking-[0.2em] text-[var(--muted)] uppercase">
        Internal tools
      </p>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Feature Flags</h1>
      <p className="mb-8 text-[var(--muted)]">
        Activá o desactivá features por ambiente, empresa y %. Usuario demo:{" "}
        <code className="text-[var(--accent)]">demo / demo</code>
      </p>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6"
      >
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--muted)]">Usuario</span>
          <input
            name="username"
            defaultValue="demo"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--muted)]">Password</span>
          <input
            name="password"
            type="password"
            defaultValue="demo"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--accent)]"
          />
        </label>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-[#04140f] transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
