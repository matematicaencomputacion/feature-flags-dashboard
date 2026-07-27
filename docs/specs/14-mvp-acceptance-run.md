# Spec 14 — Corrida de aceptación MVP

**Fecha:** 2026-07-27  
**Checkout:** Windows `C:\dev\cursor` · rama `chore/mvp-acceptance-mcp-libsql` · base `origin/main` (`2f660db`)  
**Toolchain:** Node v24.12.0 · pnpm 11.17.0  
**DB:** `C:\dev\cursor\data\feature-flags.db`

## Preflight

| Paso | Resultado |
|------|-----------|
| `pnpm install` | OK (workspace up to date) |
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS — domain 23 · sdk 15 · api 37 |
| `pnpm run build` | PASS (domain→db→sdk→api→web / Next 16.2.12) |
| `pnpm db:migrate` | PASS — Migrated SQLite |
| `pnpm db:seed` | PASS — Seeded `mvp_check` |
| `GET /health` | `{"ok":true,"db":"up"}` |

## Criterios CA-14-01 … 13

| CA | Resultado | Evidencia |
|----|-----------|-----------|
| **CA-14-01** Login demo | PASS | `POST /auth/login` demo/demo → token; credenciales inválidas → 401. Sin OAuth/roles en API/UI. |
| **CA-14-02** CRUD flag | PASS | Seed idempotente: `mvp_check`, `safeDefault=off`, `lifecycle=experimental`. |
| **CA-14-03** Tres ambientes | PASS | GET flag: dev 0% · staging 50% · production 100%. |
| **CA-14-04** Override empresa | PASS | prod+acme → `force_off`; staging+beta `force_on` → enabled true (restore staging sin overrides). |
| **CA-14-05** Rollout sticky | PASS | staging 50%: `userId=u2` in · `u0` out; 5 evaluates estables cada uno. |
| **CA-14-06** Precedencia | PASS | production 100% + acme `force_off` → `enabled:false`, `reason:force_off`. |
| **CA-14-07** Confirmación prod | PASS | API: PUT production `confirmProduction:false` → 400; `true` → 200. UI: `pendingProd` en `apps/web/src/app/flags/[key]/page.tsx` (cancelar no llama API). |
| **CA-14-08** Observabilidad | PASS | GET flag: lifecycle, rules/%, `lastChange` (seed). UI detalle muestra lo mismo. |
| **CA-14-09** Lifecycle deprecado | PASS | Flag temp → GA → deprecado; PUT rules → 400; evaluate sigue respondiendo. |
| **CA-14-10** SQLite persistente | PASS | Tras migrate/seed y API up, GET conserva `mvp_check` en archivo local. |
| **CA-14-11** Cache + fallback | PASS | `pnpm test`: SDK `client.test` (red fallida → `safe_default`); domain `evaluateWithFallback`; API catch en `/evaluate`. |
| **CA-14-12** Sin redeploy | PASS | PUT prod % 100→0 (confirm) cambia evaluate en ~1s; restore 100% sin rebuild consumidor. |
| **CA-14-13** Fuera de alcance | PASS | Solo auth demo; no APIs/UI de OAuth, roles, región/plan/user individual ni analytics de exposición medida. |

**MVP aceptado:** CA-14-01 … CA-14-13 = PASS.

## Comandos de referencia (snippets)

```bash
# health
curl http://localhost:8787/health

# login
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"demo"}'

# evaluate (precedencia)
curl -X POST http://localhost:8787/evaluate \
  -H "Content-Type: application/json" \
  -d '{"flagKey":"mvp_check","environment":"production","tenantId":"acme","userId":"user-a"}'
# → {"enabled":false,"reason":"force_off","flagKey":"mvp_check"}
```

## Notas

- No hubo contradicción Spec 14 vs main que requiera editar la checklist; el seed `mvp_check` en main ya cubre el escenario.
- Flag temporal `mvp_depr_*` creada solo para CA-14-09 en la DB local (gitignored); no afecta el seed.
