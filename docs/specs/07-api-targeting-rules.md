# Spec 07 — API targeting rules

## Objetivo

Permitir upsert de reglas por ambiente (default, rollout %, overrides force_on/force_off) con independencia entre ambientes, bloqueo en deprecado, confirmación en production y auditoría.

## Contexto y dependencias

- Tablas Spec 03: `targeting_rules`, `tenant_overrides`, `audit_log`, `flags`.
- Domain Spec 04: `allowsNewRules(lifecycle)`.
- Auth Spec 05; Flags Spec 06 (flag debe existir).
- Ambientes válidos: `dev` | `staging` | `production`.
- Targeting permitido únicamente: ambiente + empresa + % (RF-16).

### Contrato

#### `PUT /flags/:key/rules/:environment`

Headers: `Authorization: Bearer <token>`

Request:

```json
{
  "defaultOn": false,
  "rolloutPercent": 50,
  "overrides": [
    { "tenantId": "acme", "mode": "force_off" },
    { "tenantId": "globex", "mode": "force_on" }
  ],
  "confirmProduction": false
}
```

Reglas de validación:

- `environment` path ∈ {dev, staging, production}
- `rolloutPercent` entero 0–100
- `mode` ∈ {force_on, force_off}
- Si `lifecycle` de la flag no permite reglas nuevas (`deprecado`|`eliminado`) → 400
- Si `environment === "production"` y `confirmProduction !== true` → 400 con mensaje claro
- En `dev`/`staging`, `confirmProduction` no es requerido (RF-18)
- Reemplazo total de overrides del par flag+env (delete + insert)
- Upsert de la fila `targeting_rules`
- Audit summary ejemplo: `Updated production: default=false, %=50, overrides=2`

Response 200: `{ "flag": FeatureFlag }` (shape Spec 06).

## Alcance

### In scope

- PUT reglas por ambiente
- Independencia: cambiar staging no muta production (RF-11)
- Enforcement confirmProduction + allowsNewRules

### Out of scope

- Reglas AND/OR, región, plan, user allowlist genérica
- UI de confirmación (Spec 11); aquí solo contrato API
- Evaluate endpoint (Spec 08)

## Tareas en orden

1. Implementar `upsertEnvironmentRules` en repo.
2. Ruta PUT con zod validation.
3. Mapear errores a 400/404 con `{ error: string }`.
4. Verificar con tres PUTs (dev/staging/prod) valores distintos y leer GET flag.
5. Verificar 400 en production sin confirm y en flag deprecada.

## Criterios de aceptación verificables

- **CA-07-01** PUT staging con % = 25 y override acme force_on persiste y aparece en GET flag (RF-10).
- **CA-07-02** PUT production sin `confirmProduction` → 400; con true → 200 (RF-17).
- **CA-07-03** PUT dev no requiere confirm y persiste (RF-18).
- **CA-07-04** Tras deprecar flag, PUT rules → 400; GET evaluate aún posible en Spec 08 (RF-07).
- **CA-07-05** Reglas de `dev` y `production` son independientes tras dos PUTs distintos (RF-11).
- **CA-07-06** Cada PUT exitoso crea `audit_log` (RF-21).
- **CA-07-07** `rolloutPercent=101` → 400.

## Notas técnicas

- Exposición teórica en UI = `rolloutPercent` (RF-20); no calcular tráfico.
- Precedencia de evaluación no se implementa aquí (ya en domain); esta spec solo persiste.
- `tenantId` trim; rechazar vacío.
