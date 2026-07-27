# Spec 14 — MVP acceptance

## Objetivo

Verificar end-to-end que el sistema cumple los criterios de aceptación del MVP del PRD, con una checklist ejecutable y evidencia reproducible.

## Contexto y dependencias

- Requiere specs 01–13 implementadas (13 opcional solo si el CA de cache se valida vía SDK; si 13 no está, validar fallback con evaluateWithFallback unitario + simulate API down para client si existe).
- PRD: `docs/prds/PRD_FEATURE_FLAGS.md` §8.
- Stack: pnpm monorepo; API `:8787`; Web `:3000`; SQLite `data/feature-flags.db`.
- Usuario demo: `demo` / `demo`.
- Precedencia: force_on/force_off → % sticky user_id → default ambiente.
- Sin OAuth/roles; sin analytics medidos.

### Comandos base

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm --filter @ff/api dev
pnpm --filter @ff/web dev
pnpm test
```

### Escenario de datos de prueba

Flag: `mvp_check`  
Production: `rolloutPercent=100`, override `tenantId=acme` mode `force_off`  
Staging: `rolloutPercent=50` sin overrides  
Users: elegir `user-a` y `user-b` tales que uno in y uno out a 50% (descubrir vía evaluate loop).

## Alcance

### In scope

- Checklist CA MVP 1–13 del PRD
- Evidencia: resultados de curl + UI + tests automatizados existentes
- Documento de corrida: `docs/specs/14-mvp-acceptance-run.md` (crear al ejecutar) **o** marcar checkboxes abajo en PR

### Out of scope

- Performance formal p99 en CI
- Penetration test
- Features v2 (región, planes, OAuth)

## Tareas en orden

1. Levantar DB migrate/seed + api + web.
2. Ejecutar `pnpm test` (domain + sdk).
3. Recorrer checklist “Criterios” abajo en orden, anotando pass/fail.
4. Para cada fail: abrir bug con spec de origen (01–13).
5. Cuando todo PASS, marcar MVP aceptado en README o PRD estado.

## Criterios de aceptación verificables

Mapa 1:1 con PRD §8:

- **CA-14-01 Login demo** — Solo demo/demo entra; no hay OAuth/roles en UI/API (PRD #1, RF-01/03).
- **CA-14-02 CRUD flag** — Crear `mvp_check` boolean con safe_default off y lifecycle experimental (PRD #2, RF-04/05).
- **CA-14-03 Tres ambientes** — Configurar % distintos en dev/staging/production y verificar GET flag (PRD #3, RF-11).
- **CA-14-04 Override empresa** — force_on y force_off respetados sobre % vía `/evaluate` (PRD #4, RF-13/14).
- **CA-14-05 Rollout sticky** — Con 50% y dos user_id fijos, in/out estables en ≥5 evaluates cada uno (PRD #5, RF-15).
- **CA-14-06 Precedencia** — force_off + %100 ⇒ enabled false (PRD #6).
- **CA-14-07 Confirmación prod** — UI: cancelar no persiste; confirmar sí (PRD #7, RF-17). API: PUT prod sin confirm → 400.
- **CA-14-08 Observabilidad** — Detalle muestra lifecycle, reglas, lastChange, % teórico (PRD #8, RF-19/20).
- **CA-14-09 Lifecycle deprecado** — No permite reglas nuevas; evaluate sigue respondiendo (PRD #9, RF-07).
- **CA-14-10 SQLite persistente** — Reiniciar API; GET flags conserva `mvp_check` (PRD #10, RF-22).
- **CA-14-11 Cache + fallback** — Con API caída o fetch mock fail, SDK/`evaluateWithFallback` devuelve safe_default (PRD #11, RF-25).
- **CA-14-12 Sin redeploy** — Cambiar % en production (confirmado) cambia evaluate en < 60s sin rebuild del consumidor (PRD #12, RF-26). Si SDK cachea, validar post-TTL o `invalidate`.
- **CA-14-13 Fuera de alcance** — No existen APIs/UI de OAuth, roles, targeting región/plan/user individual, ni exposición medida (PRD #13).

**MVP aceptado solo si CA-14-01 … CA-14-13 = PASS.**

### Matriz de automatización (2026-07-27)

| CA | Automatizado | Dónde | Manual residual |
|----|--------------|-------|-----------------|
| CA-14-01 Login | Sí | `e2e/tests/auth.spec.ts` (panel) | — |
| CA-14-02 CRUD UI | Sí | `e2e/tests/flags-create.spec.ts` (panel) | — |
| CA-14-03 Tres ambientes | Sí | `apps/api/src/spec14-acceptance.test.ts` | — |
| CA-14-04 Override empresa | Sí | `spec14-acceptance` + domain `evaluate.test` | — |
| CA-14-05 Sticky 50% in/out | Sí | `spec14-acceptance` + `sdk/client.integration.test` | — |
| CA-14-06 Precedencia | Sí | `spec14-acceptance` + domain + SDK integ | — |
| CA-14-07 Confirm prod | Sí | e2e production-confirm + API `confirmProduction` | — |
| CA-14-08 Observabilidad UI | Sí | `e2e/tests/observability.spec.ts` (panel) | — |
| CA-14-09 Lifecycle deprecado | Sí | `spec14-acceptance` (PUT 400 + evaluate OK) | UI disabled post-deprecado (opcional) |
| CA-14-10 SQLite persistente | Sí (conexión) | `spec14-acceptance` close/reopen archivo temp | Reinicio de proceso OS completo (opcional) |
| CA-14-11 Cache + fallback | Sí | `packages/sdk` + domain `evaluateWithFallback` | — |
| CA-14-12 Sin redeploy | Sí (inmediato) | `spec14-acceptance` PUT % → evaluate &lt; 60s | Smoke consumidor externo real |
| CA-14-13 Fuera de alcance | Sí (guardrail) | `spec14-acceptance` 404 OAuth/roles + shape evaluate | Revisión UI puntual en release |

Filas de panel (`e2e/…`) dependen de la suite Playwright del monorepo; el resto corre con `pnpm test`.

### Corrida registrada

Evidencia reproducible: [`14-mvp-acceptance-run.md`](./14-mvp-acceptance-run.md)
(2026-07-27, Windows checkout). CA-14-01 … CA-14-13 = PASS → MVP aceptado en README.

## Notas técnicas

- Evidencia mínima por CA: comando + response snippet o captura breve.
- Spec 13 (`@ff/sdk`) está en main: CA-14-11 se valida con tests del SDK +
  `evaluateWithFallback` de domain + catch de `/evaluate` en la API.
- No relajar premisas: pnpm, SQLite local, usuario demo, boolean flags.
- Esta spec no agrega features; solo verificación.
