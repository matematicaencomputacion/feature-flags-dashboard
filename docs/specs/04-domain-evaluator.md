# Spec 04 — Domain evaluator

## Objetivo

Implementar en `@ff/domain` la lógica pura de evaluación de flags (precedencia, rollout sticky, lifecycle, safe_default, cache TTL) con tests Vitest.

## Contexto y dependencias

- Paquete: `packages/domain` (`@ff/domain`).
- Sin I/O de red ni DB en este paquete.
- Vitest ya configurado (Spec 02).

### Tipos (contrato)

```ts
type Environment = "dev" | "staging" | "production";
type Lifecycle = "experimental" | "GA" | "deprecado" | "eliminado";
type SafeDefault = "off" | "on";
type OverrideMode = "force_on" | "force_off";

type TenantOverride = { tenantId: string; mode: OverrideMode };

type EnvironmentRules = {
  environment: Environment;
  defaultOn: boolean;
  rolloutPercent: number; // 0–100
  overrides: TenantOverride[];
};

type FeatureFlag = {
  key: string;
  lifecycle: Lifecycle;
  safeDefault: SafeDefault;
  rules: EnvironmentRules[];
};

type EvaluateResult = {
  enabled: boolean;
  reason:
    | "force_on"
    | "force_off"
    | "rollout"
    | "default"
    | "safe_default"
    | "eliminado"
    | "not_found";
};
```

### Algoritmo `evaluateFlag(flag, { environment, tenantId, userId })`

1. Si `flag` es null/undefined → `{ enabled: false, reason: "not_found" }`.
2. Si `lifecycle === "eliminado"` → `{ enabled: false, reason: "eliminado" }`.
3. Buscar rules del `environment`. Si no hay → usar `safe_default` (`on`⇒true) con reason `safe_default`.
4. Si existe override del `tenantId`:
   - `force_off` → false (aunque % = 100)
   - `force_on` → true (aunque % = 0)
5. Si `rolloutPercent > 0` y `inRollout(userId, percent)` → true, reason `rollout`.
6. Si no → `defaultOn`, reason `default`.

### Rollout sticky

- Hash estable FNV-1a 32-bit (o equivalente documentado) sobre `userId`.
- Inclusión: `hash(userId) % 100 < rolloutPercent`.
- Mismo `userId` ⇒ mismo resultado siempre.

### Lifecycle helpers

- Orden: `experimental` → `GA` → `deprecado` → `eliminado` (solo +1 paso).
- `allowsNewRules`: true solo para `experimental` | `GA`.
- `deprecado`: se evalúa; no admite reglas nuevas (enforcement en API, helper aquí).

### Fallback

`evaluateWithFallback(flag, ctx, { fetchFailed: true })` → siempre `safe_default` de la flag (si no hay flag → off).

### Cache

Clase `TtlCache<T>` con TTL ms en rango **30000–60000** (default 45000). `get`/`set`/`invalidate`.

## Alcance

### In scope

- Archivos en `packages/domain/src/`: `types.ts`, `hash.ts`, `evaluate.ts`, `lifecycle.ts`, `cache.ts`, `index.ts`
- Tests: precedencia force_off vs 100%, force_on vs 0%, sticky, lifecycle, fallback
- Export público desde `index.ts`

### Out of scope

- Persistencia, HTTP, UI
- Targeting por región/plan/usuario individual / AND-OR
- Config no booleana

## Tareas en orden

1. Implementar tipos y constantes `ENVIRONMENTS`, `LIFECYCLES`.
2. Implementar `stableHash` + `inRollout`.
3. Implementar `evaluateFlag` + `evaluateWithFallback`.
4. Implementar helpers de lifecycle.
5. Implementar `TtlCache` con validación de rango TTL.
6. Escribir tests en `evaluate.test.ts` (reemplazar/ besides smoke).
7. Exportar API pública; `pnpm --filter @ff/domain test` verde.

## Criterios de aceptación verificables

- **CA-04-01** `force_off` + `rolloutPercent=100` ⇒ `enabled=false`, reason `force_off` (RF-13).
- **CA-04-02** `force_on` + `rolloutPercent=0` ⇒ `enabled=true`, reason `force_on` (RF-14).
- **CA-04-03** Mismo `userId` con 50% produce el mismo booleano en ≥10 evaluaciones (RF-15).
- **CA-04-04** Con 50% y ≥20 userIds distintos, hay al menos un in y un out.
- **CA-04-05** `evaluateWithFallback(..., { fetchFailed: true })` con `safeDefault=on` ⇒ enabled true, reason `safe_default` (RF-25).
- **CA-04-06** `canTransitionLifecycle("experimental","GA")` true; `"experimental"→"deprecado"` false (RF-06).
- **CA-04-07** `allowsNewRules("deprecado")` === false (RF-07).
- **CA-04-08** `TtlCache` rechaza TTL fuera de 30–60s (throw).
- **CA-04-09** `pnpm --filter @ff/domain test` exit 0.

## Notas técnicas

- Precedencia documentada: empresa → % → default (RNF-07).
- No medir tráfico real; % es teórico (RF-20).
- Mantener el paquete sin dependencias de runtime salvo tipos TS.
- El hash debe ser determinista entre procesos Node (no `Math.random`).
