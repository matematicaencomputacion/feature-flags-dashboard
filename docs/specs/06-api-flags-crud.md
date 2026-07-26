# Spec 06 — API flags CRUD

## Objetivo

Implementar listado, creación, detalle y actualización de metadata de flags (lifecycle, safe_default) con auditoría y confirmación para cambios que afectan production.

## Contexto y dependencias

- `apps/api` + `@ff/db` schema (Spec 03) + `@ff/domain` lifecycle helpers (Spec 04) + auth (Spec 05).
- Todas las rutas `/flags*` requieren `Authorization: Bearer <token>`.
- Al crear una flag:
  - `lifecycle = experimental`
  - `safe_default = off` (o body opcional `off`|`on`; default off)
  - Crear 3 filas `targeting_rules` (dev/staging/production) con `default_on=false`, `rollout_percent=0`
  - Escribir `audit_log`

### Contratos

#### `GET /flags`

200:

```json
{ "items": [ /* FeatureFlag[] */ ] }
```

`FeatureFlag` shape:

```json
{
  "key": "billing_v2",
  "lifecycle": "experimental",
  "safeDefault": "off",
  "rules": [
    {
      "environment": "dev",
      "defaultOn": false,
      "rolloutPercent": 0,
      "overrides": []
    }
  ],
  "lastChange": { "by": "demo", "at": "2026-01-01T00:00:00.000Z", "summary": "..." }
}
```

#### `POST /flags`

Request:

```json
{ "key": "billing_v2", "safeDefault": "off" }
```

Reglas de `key`: `^[a-z][a-z0-9_]*$`, única.  
201 → `{ "flag": FeatureFlag }`  
409 si existe.

#### `GET /flags/:key`

200 `{ "flag": FeatureFlag }` | 404.

#### `PATCH /flags/:key`

Request:

```json
{
  "lifecycle": "GA",
  "safeDefault": "on",
  "cleanupChecklistConfirmed": false,
  "confirmProduction": true
}
```

Reglas:

- Transición lifecycle solo +1 paso (domain helper).
- A `eliminado` exige `cleanupChecklistConfirmed: true`.
- Cualquier cambio de `lifecycle` o `safeDefault` exige `confirmProduction: true` (afecta evaluación en prod) → si falta, 400.
- `safeDefault=on` permitido especialmente en GA (RF-09); no bloquear en otros estados salvo producto diga lo contrario — permitir siempre pero default off al crear.
- Escribir audit_log.

## Alcance

### In scope

- GET/POST/PATCH flags como arriba
- Hydratar `rules` + `overrides` + `lastChange` desde DB
- Validación zod (o equivalente)

### Out of scope

- Upsert de targeting (Spec 07)
- Evaluate (Spec 08)
- UI

## Tareas en orden

1. Capa repo: `listFlags`, `getFlag`, `createFlag`, `updateFlagMeta`.
2. Asegurar schema/migrate al boot de la API.
3. Registrar rutas con `requireAuth`.
4. Validar key y lifecycle.
5. Tests manuales o vitest de API si ya hay harness; mínimo verificación curl.
6. Documentar ejemplos en README api si existe.

## Criterios de aceptación verificables

- **CA-06-01** Con token demo, `POST /flags` crea flag con lifecycle `experimental`, 3 environments default off (RF-04, RF-05).
- **CA-06-02** `GET /flags` incluye la flag creada (RF-02).
- **CA-06-03** `PATCH` experimental→GA con `confirmProduction:true` funciona (RF-06).
- **CA-06-04** `PATCH` experimental→deprecado directo → 400.
- **CA-06-05** `PATCH` a eliminado sin checklist → 400; con checklist + confirm → 200 (RF-08).
- **CA-06-06** `PATCH` sin `confirmProduction` → 400.
- **CA-06-07** Cada create/patch deja fila en `audit_log` (RF-21).
- **CA-06-08** Sin Bearer → 401.

## Notas técnicas

- Usuario de audit = sesión (`demo`).
- Flags `deprecado` aún se listan y se evalúan; el bloqueo de reglas nuevas es Spec 07.
- No implementar OAuth/roles.
