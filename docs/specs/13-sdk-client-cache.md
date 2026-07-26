# Spec 13 — SDK client cache

## Objetivo

Proveer un cliente TypeScript de evaluación con cache local TTL 30–60s y fallback a `safe_default` si el fetch falla.

## Contexto y dependencias

- Lógica pura: `@ff/domain` (`evaluateFlag`, `evaluateWithFallback`, `TtlCache`, tipos) — Spec 04.
- Endpoint: `POST {API_URL}/evaluate` — Spec 08.
- Paquete sugerido: `packages/sdk` nombre `@ff/sdk` **o** módulo `packages/domain/src/client.ts` si se quiere evitar nuevo package; **preferido: `packages/sdk`** para no mezclar I/O en domain.
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

class FeatureFlagClient {
  constructor(options: {
    baseUrl: string;          // ej. http://localhost:8787
    ttlMs?: number;           // 30000–60000
    /** Si se conoce el safeDefault local cuando falla la red */
    getSafeDefault?: (flagKey: string) => "off" | "on";
  });

  /** Evalúa usando cache de respuesta o reglas según diseño abajo */
  evaluate(input: EvaluateInput): Promise<{ enabled: boolean; reason: string }>;

  invalidate(flagKey?: string): void;
}
```

### Estrategia de cache (MVP)

Opción A (simple, alineada a `/evaluate`):

- Cache key: `${flagKey}:${environment}:${tenantId}:${userId}`
- Valor: `{ enabled, reason }`
- TTL 30–60s
- Si fetch falla: usar `getSafeDefault(flagKey)` → enabled; reason `safe_default`. Si no hay getter → false.

Opción B (más fiel a “cache de reglas”):

- Cachear payload de flag/rules y evaluar offline con `evaluateFlag`.
- Requiere endpoint de lectura de flag o embed rules en evaluate response.

**Elegir Opción A** salvo que ya exista GET público de definición; documentar la elección en Notas.

### Tests

- Mock fetch: primer call hit network, segundo dentro de TTL no llama fetch.
- Fetch reject → reason `safe_default`.

## Alcance

### In scope

- Package `@ff/sdk` (o client acordado)
- `FeatureFlagClient` con TTL + invalidate
- Tests Vitest con fetch mock
- Script test en package + root filter

### Out of scope

- SDKs en otros lenguajes
- Streaming / SSE invalidation
- Auth en evaluate

## Tareas en orden

1. Crear `packages/sdk` con pnpm workspace.
2. Implementar client Opción A + `TtlCache` de domain o copia interna.
3. Validar rango TTL (throw si fuera de rango).
4. Tests vitest.
5. Ejemplo de uso en README del package.

## Criterios de aceptación verificables

- **CA-13-01** Segunda evaluación idéntica dentro del TTL no vuelve a llamar `fetch` (RF-24).
- **CA-13-02** Tras `invalidate()`, el siguiente evaluate vuelve a fetchear.
- **CA-13-03** Si `fetch` falla, retorna enabled según safe_default (default off) y reason `safe_default` (RF-25, CA MVP #11).
- **CA-13-04** Constructor con `ttlMs: 1000` lanza error.
- **CA-13-05** `pnpm --filter @ff/sdk test` exit 0.

## Notas técnicas

- RNF-01: evaluación cache-hit debe ser in-memory (sin await de red).
- El cliente **no** requiere redeploy de la app consumidora para ver cambios de flags; solo espera TTL (RNF-08 / RF-26).
- No acoplar al panel ni a Bearer demo.
