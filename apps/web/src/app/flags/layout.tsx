"use client";

import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function FlagsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready } = useRequireAuth();

  if (!ready) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10 text-[var(--muted)]">
        Cargando…
      </main>
    );
  }

  return children;
}
