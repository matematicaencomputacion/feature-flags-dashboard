# Spec 13 — SDK client cache

## Objetivo

Proveer un cliente TypeScript de evaluación con cache local TTL 30–60s y fallback a `safe_default` / stale-while-error si el fetch falla.

## Contexto y dependencias

- Lógica pura reutilizada: `@ff/domain` (`TtlCache`, tipos). **No** `evaluateWithFallback` en el SDK (ver Notas).
- Endpoint: `POST {API_URL}/evaluate` — Spec 08 / `apps/api`.
- Paquete: `packages/sdk` (`@ff/sdk`).
- TTL permitido: 30000–60000 ms (default 45000).
- Propagación percibida < 60s (RF-26, RNF-02).

### API del SDK

```ts
type EvaluateInput = {
  flagKey: string;
  environment: "dev" | "staging" | "production";
  tenantId: string;
  userId: string;
};

type EvaluateResult = { enabled: boolean; reason: string };

function createClient(options: {
  baseUrl: string;          // ej. http://localhost:8787
  ttlMs?: number;           // 30000–60000
  /** Si se conoce el safeDefault local cuando falla la red y nunca hubo cache */
  getSafeDefault?: (flagKey: string) => "off" | "on";
}): {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>;
  invalidate(flagKey?: string): void;
};
```

### Estrategia de cache (MVP) — Opción A

La API pública solo expone `POST /evaluate` → `{ enabled, reason, flagKey }`. **No** hay GET público de definición de flag para consumidores.

Por tanto el SDK cachea **resultados**, no reglas:

- Cache key: `${flagKey}:${environment}:${tenantId}:${userId}`
- Valor: `{ enabled, reason }`
- TTL 30–60s (`TtlCache` de `@ff/domain` para entradas frescas)
- Si fetch falla (red o HTTP no-2xx):
  1. **Stale-while-error:** devolver el último resultado cacheado para esa key aunque el TTL haya vencido.
  2. Si nunca hubo resultado: `getSafeDefault(flagKey)` → enabled; reason `safe_default`. Si no hay getter → `enabled: false`.

Opción B (cachear payload de reglas + `evaluateFlag` offline) queda **fuera de alcance** hasta que exista un endpoint público de definición.

### Por qué no `evaluateWithFallback`

`evaluateWithFallback` / `evaluateFlag` de `@ff/domain` operan sobre un `FeatureFlag` completo (`safeDefault`, rules, overrides). El contrato público de evaluación no devuelve esa definición. Forzar Opción B implicaría inventar un GET o enriquecer `/evaluate` — eso no está en main. El SDK MVP usa Opción A + stale-while-error; la API server-side ya aplica el evaluador de domain sobre definiciones cacheadas in-process.

## Alcance

### In scope

- Package `@ff/sdk`
- `createClient` con TTL + invalidate + stale-while-error
- Tests Vitest con fetch mock + integración contra `app.request`
- Scripts test / typecheck / build en package + root

### Out of scope

- SDKs en otros lenguajes
- Streaming / SSE invalidation
- Auth en evaluate
- Cache de definiciones / Opción B

## Tareas en orden

1. Crear `packages/sdk` con pnpm workspace.
2. Implementar client Opción A + `TtlCache` de domain (+ Map de último valor para stale).
3. Validar rango TTL (throw si fuera de rango).
4. Tests vitest.
5. Ejemplo de uso en README del package.

## Criterios de aceptación verificables

- **CA-13-01** Segunda evaluación idéntica dentro del TTL no vuelve a llamar `fetch` (RF-24).
- **CA-13-02** Tras `invalidate()`, el siguiente evaluate vuelve a fetchear.
- **CA-13-03** Si `fetch` falla sin resultado previo, retorna enabled según safe_default (default off) y reason `safe_default` (RF-25, CA MVP #11). Si había resultado previo, retorna ese (stale-while-error), incluso con TTL vencido.
- **CA-13-04** Constructor / `createClient` con `ttlMs: 1000` lanza error.
- **CA-13-05** `pnpm --filter @ff/sdk test` exit 0.

## Notas técnicas

- RNF-01: evaluación cache-hit debe ser in-memory (sin await de red).
- El cliente **no** requiere redeploy de la app consumidora para ver cambios de flags; solo espera TTL (RNF-08 / RF-26).
- No acoplar al panel ni a Bearer demo.
- `TtlCache.get` de domain elimina entradas vencidas; el SDK retiene el último valor en un Map aparte para stale-while-error sin cambiar la API pública de `TtlCache` (consumida por el flag-cache de la API).
