"use client";

import type {
  Environment,
  EnvironmentRules,
  FeatureFlag,
  Lifecycle,
  OverrideMode,
} from "@ff/domain";
import { ENVIRONMENTS } from "@ff/domain";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getFlag, updateFlagMeta, updateRules } from "@/lib/api";

const NEXT_LIFECYCLE: Partial<Record<Lifecycle, Lifecycle>> = {
  experimental: "GA",
  GA: "deprecado",
  deprecado: "eliminado",
};

export default function FlagDetailPage() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(params.key);
  const [flag, setFlag] = useState<FeatureFlag | null>(null);
  const [env, setEnv] = useState<Environment>("dev");
  const [error, setError] = useState<string | null>(null);
  const [pendingProd, setPendingProd] = useState<null | (() => Promise<void>)>(null);
  const [checklist, setChecklist] = useState(false);

  const rules = useMemo(
    () => flag?.rules.find((r) => r.environment === env),
    [flag, env],
  );

  const [draft, setDraft] = useState<EnvironmentRules | null>(null);

  useEffect(() => {
    getFlag(key)
      .then((d) => {
        setFlag(d.flag);
        const r = d.flag.rules.find((x) => x.environment === "dev")!;
        setDraft({ ...r, overrides: [...r.overrides] });
      })
      .catch((e) => setError(e.message));
  }, [key]);

  useEffect(() => {
    if (!flag) return;
    const r = flag.rules.find((x) => x.environment === env)!;
    setDraft({ ...r, overrides: r.overrides.map((o) => ({ ...o })) });
  }, [env, flag]);

  async function saveRules() {
    if (!draft) return;
    setError(null);
    const doSave = async () => {
      const res = await updateRules(key, env, {
        defaultOn: draft.defaultOn,
        rolloutPercent: draft.rolloutPercent,
        overrides: draft.overrides,
        confirmProduction: env === "production",
      });
      setFlag(res.flag);
      setPendingProd(null);
    };
    if (env === "production") {
      setPendingProd(() => doSave);
      return;
    }
    try {
      await doSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function advanceLifecycle() {
    if (!flag) return;
    const next = NEXT_LIFECYCLE[flag.lifecycle];
    if (!next) return;
    setError(null);
    const doUpdate = async () => {
      const res = await updateFlagMeta(key, {
        lifecycle: next,
        cleanupChecklistConfirmed: next === "eliminado" ? checklist : undefined,
        confirmProduction: true,
      });
      setFlag(res.flag);
      setPendingProd(null);
      setChecklist(false);
    };
    setPendingProd(() => doUpdate);
  }

  if (!flag || !draft || !rules) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10 text-[var(--muted)]">
        {error ?? "Cargando…"}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/flags" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">
        ← Flags
      </Link>
      <header className="mt-4 mb-6">
        <h1 className="text-3xl font-semibold">{flag.key}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {flag.lifecycle} · safe_default={flag.safeDefault}
          {flag.lastChange
            ? ` · último: ${flag.lastChange.by} — ${flag.lastChange.summary} (${new Date(flag.lastChange.at).toLocaleString()})`
            : ""}
        </p>
      </header>

      {error && <p className="mb-4 text-sm text-[var(--danger)]">{error}</p>}

      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
        <h2 className="mb-3 text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
          Ciclo de vida
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md border border-[var(--border)] px-2 py-1 text-sm">
            {flag.lifecycle}
          </span>
          {NEXT_LIFECYCLE[flag.lifecycle] && (
            <>
              {NEXT_LIFECYCLE[flag.lifecycle] === "eliminado" && (
                <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={checklist}
                    onChange={(e) => setChecklist(e.target.checked)}
                  />
                  Código ya no depende de esta flag
                </label>
              )}
              <button
                type="button"
                onClick={() => void advanceLifecycle()}
                disabled={
                  NEXT_LIFECYCLE[flag.lifecycle] === "eliminado" && !checklist
                }
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--accent)] disabled:opacity-40"
              >
                Avanzar a {NEXT_LIFECYCLE[flag.lifecycle]}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
        <div className="mb-4 flex gap-2">
          {ENVIRONMENTS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEnv(e)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                env === e
                  ? "bg-[var(--accent)] text-[#04140f]"
                  : "border border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        <p className="mb-4 text-sm text-[var(--muted)]">
          Exposición teórica: ~{draft.rolloutPercent}% del tráfico en {env}
          {env === "production" && (
            <span className="ml-2 text-[var(--warn)]">· requiere confirmación</span>
          )}
        </p>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.defaultOn}
              onChange={(e) =>
                setDraft({ ...draft, defaultOn: e.target.checked })
              }
              disabled={flag.lifecycle === "deprecado" || flag.lifecycle === "eliminado"}
            />
            Default del ambiente ON
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-[var(--muted)]">Rollout %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.rolloutPercent}
              disabled={flag.lifecycle === "deprecado" || flag.lifecycle === "eliminado"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  rolloutPercent: Number(e.target.value),
                })
              }
              className="w-32 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm text-[var(--muted)]">Overrides por empresa</h3>
              <button
                type="button"
                disabled={flag.lifecycle === "deprecado" || flag.lifecycle === "eliminado"}
                onClick={() =>
                  setDraft({
                    ...draft,
                    overrides: [
                      ...draft.overrides,
                      { tenantId: "", mode: "force_on" as OverrideMode },
                    ],
                  })
                }
                className="text-sm text-[var(--accent)] disabled:opacity-40"
              >
                + override
              </button>
            </div>
            <ul className="space-y-2">
              {draft.overrides.map((o, i) => (
                <li key={i} className="flex flex-wrap gap-2">
                  <input
                    value={o.tenantId}
                    placeholder="tenant_id"
                    disabled={flag.lifecycle === "deprecado" || flag.lifecycle === "eliminado"}
                    onChange={(e) => {
                      const overrides = [...draft.overrides];
                      overrides[i] = { ...o, tenantId: e.target.value };
                      setDraft({ ...draft, overrides });
                    }}
                    className="min-w-[140px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                  />
                  <select
                    value={o.mode}
                    disabled={flag.lifecycle === "deprecado" || flag.lifecycle === "eliminado"}
                    onChange={(e) => {
                      const overrides = [...draft.overrides];
                      overrides[i] = {
                        ...o,
                        mode: e.target.value as OverrideMode,
                      };
                      setDraft({ ...draft, overrides });
                    }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                  >
                    <option value="force_on">force_on</option>
                    <option value="force_off">force_off</option>
                  </select>
                  <button
                    type="button"
                    className="text-sm text-[var(--danger)]"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        overrides: draft.overrides.filter((_, j) => j !== i),
                      })
                    }
                  >
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={() => void saveRules().catch((e) => setError(e.message))}
            disabled={flag.lifecycle === "deprecado" || flag.lifecycle === "eliminado"}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[#04140f] hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            Guardar reglas ({env})
          </button>
        </div>
      </section>

      {pendingProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6">
            <h2 className="text-lg font-semibold">¿Confirmar cambio en production?</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Este cambio afecta la evaluación en production y se propagará en &lt; 1
              min sin redeploy.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
                onClick={() => setPendingProd(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white"
                onClick={() => {
                  void pendingProd()
                    .catch((e) => setError(e.message))
                    .finally(() => setPendingProd(null));
                }}
              >
                Confirmar en production
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
