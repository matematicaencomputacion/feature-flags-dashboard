"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";

/**
 * Guard client-side para rutas protegidas: exige token en localStorage y
 * sesión vigente vía GET /auth/me. Token ausente o vencido → limpia y
 * redirige a login.
 */
export function useRequireAuth(): { ready: boolean } {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!localStorage.getItem("ff_token")) {
        router.replace("/");
        return;
      }
      try {
        await getMe();
        if (!cancelled) setReady(true);
      } catch {
        localStorage.removeItem("ff_token");
        router.replace("/");
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { ready };
}
