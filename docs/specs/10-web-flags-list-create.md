# Spec 10 — Web flags list and create

## Objetivo

Pantalla de listado de flags y creación de una flag nueva desde el panel.

## Contexto y dependencias

- Requiere Spec 09 (token en `localStorage` `ff_token`).
- API Spec 06:
  - `GET /flags` → `{ items: FeatureFlag[] }`
  - `POST /flags` body `{ key, safeDefault? }` → `{ flag }`
- `key` pattern: `^[a-z][a-z0-9_]*$`
- FeatureFlag incluye `lifecycle`, `safeDefault`, `rules[]`, `lastChange?`.

### UI `/flags`

- Header “Flags” + botón Salir
- Form crear: input key + botón Crear (safeDefault default off, no hace falta exponerlo en v1 UI)
- Lista clickeable → navega a `/flags/[key]` (detalle Spec 11; link puede existir ya)
- Por cada item mostrar: `key`, `lifecycle`, hint exposición teórica prod `~{rolloutPercent}%`
- Estado vacío: mensaje para crear la primera
- Errores API visibles

### Cliente API

```ts
listFlags(): Promise<{ items: FeatureFlag[] }>
createFlag(key: string, safeDefault?: "off" | "on"): Promise<{ flag: FeatureFlag }>
```

Ambos con Bearer token.

## Alcance

### In scope

- List + create en `/flags`
- Refresh de lista tras create
- Validación HTML pattern del key

### Out of scope

- Editor de reglas (11)
- Lifecycle controls (12)
- Confirmación production (no aplica al create metadata inicial; create no es “activar en prod” de reglas — OK sin modal)

## Tareas en orden

1. Extender `src/lib/api.ts` con list/create.
2. Implementar UI list + form en `src/app/flags/page.tsx`.
3. Manejar 401 → logout/redirect login.
4. Link a detalle `/flags/[key]`.
5. Probar crear `billing_v2` y verla en lista.

## Criterios de aceptación verificables

- **CA-10-01** Con sesión demo, la lista muestra flags existentes del GET (RF-02).
- **CA-10-02** Crear key válida aparece en la lista sin recargar manual completa (RF-04, RF-05).
- **CA-10-03** Key inválida (`Billing-V2`) no se envía o API 400 y se muestra error.
- **CA-10-04** Key duplicada muestra error (409).
- **CA-10-05** Cada item muestra lifecycle y % teórico de production (RF-20 hint).

## Notas técnicas

- No cards decorativas innecesarias; lista simple.
- Texto de ayuda: “Precedencia: empresa → % → default”.
- `safeDefault` al crear: omitir (API default off).
