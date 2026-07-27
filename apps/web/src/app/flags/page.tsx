"use client";

import type { FeatureFlag } from "@ff/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { createFlag, listFlags, logout } from "@/lib/api";

export default function FlagsPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeatureFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const data = await listFlags();
    setItems(data.items);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const key = String(form.get("key")).trim();
      await createFlag(key);
      e.currentTarget.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm tracking-[0.2em] text-[var(--muted)] uppercase">
            Feature Flags
          </p>
          <h1 className="text-3xl font-semibold">Flags</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Precedencia: empresa → % → default · Exposición = % configurado
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            router.push("/");
          }}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          Salir
        </button>
      </header>

      <form
        onSubmit={onCreate}
        className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4"
      >
        <label className="min-w-[220px] flex-1 space-y-1 text-sm">
          <span className="text-[var(--muted)]">Nueva flag (snake_case)</span>
          <input
            name="key"
            required
            placeholder="billing_v2"
            pattern="^[a-z][a-z0-9_]*$"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[#04140f] hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          Crear
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-[var(--danger)]">{error}</p>}

      <ul className="space-y-2">
        {items.map((flag) => {
          const prod = flag.rules.find((r) => r.environment === "production");
          return (
            <li key={flag.key}>
              <Link
                href={`/flags/${flag.key}`}
                className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 transition hover:border-[var(--accent)]"
              >
                <div>
                  <p className="font-medium">{flag.key}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {flag.lifecycle} · safe_default={flag.safeDefault}
                    {flag.lastChange
                      ? ` · ${flag.lastChange.by} @ ${new Date(flag.lastChange.at).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <span className="text-sm text-[var(--muted)]">
                  prod ~{prod?.rolloutPercent ?? 0}%
                </span>
              </Link>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-[var(--muted)]">
            No hay flags todavía. Creá la primera.
          </li>
        )}
      </ul>
    </main>
  );
}
