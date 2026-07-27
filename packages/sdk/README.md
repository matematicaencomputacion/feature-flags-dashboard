# `@ff/sdk`

Cliente TypeScript para evaluar feature flags en runtime contra la API (`POST /evaluate`), con caché local TTL 30–60s y fallback `safe_default` / stale-while-error.

## Uso

```ts
import { createClient } from "@ff/sdk";

const flags = createClient({
  baseUrl: "http://localhost:8787",
  // ttlMs: 45_000, // opcional; rango 30_000–60_000
});

const { enabled, reason } = await flags.evaluate({
  flagKey: "billing_v2",
  environment: "production",
  tenantId: "acme",
  userId: "user-1",
});

if (enabled) {
  // feature on
}
```

Equivalente al curl del monorepo:

```bash
curl -X POST http://localhost:8787/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"flagKey\":\"billing_v2\",\"environment\":\"production\",\"tenantId\":\"acme\",\"userId\":\"user-1\"}"
```

## Comportamiento

- Cachea el **resultado** `{ enabled, reason }` por `flagKey:environment:tenantId:userId`.
- Si el fetch falla y hay un resultado previo (aunque el TTL haya vencido), lo devuelve (stale-while-error).
- Si nunca hubo resultado: `{ enabled: false, reason: "safe_default" }` (o el valor de `getSafeDefault`).
- `invalidate()` / `invalidate(flagKey)` fuerza el próximo fetch.

No usa `evaluateWithFallback` de `@ff/domain`: esa API opera sobre la definición completa de la flag, y el endpoint público no la expone.
