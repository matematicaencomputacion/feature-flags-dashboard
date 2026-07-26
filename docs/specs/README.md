# Specs — Feature Flags MVP

Fuente de producto: `docs/prds/PRD_FEATURE_FLAGS.md`.

Cada archivo en esta carpeta sigue la plantilla obligatoria y es **autocontenido** (un agente puede implementarlo leyendo solo ese archivo).

## Orden de implementación

| # | Spec | Depende de |
|---|------|------------|
| 01 | [01-monorepo-setup.md](./01-monorepo-setup.md) | — |
| 02 | [02-testing-setup.md](./02-testing-setup.md) | 01 |
| 03 | [03-database-schema-and-seed.md](./03-database-schema-and-seed.md) | 01 |
| 04 | [04-domain-evaluator.md](./04-domain-evaluator.md) | 01, 02 |
| 05 | [05-api-auth-demo.md](./05-api-auth-demo.md) | 01 |
| 06 | [06-api-flags-crud.md](./06-api-flags-crud.md) | 03, 04, 05 |
| 07 | [07-api-targeting-rules.md](./07-api-targeting-rules.md) | 03, 04, 05, 06 |
| 08 | [08-api-evaluate.md](./08-api-evaluate.md) | 04, 06, 07 |
| 09 | [09-web-login-shell.md](./09-web-login-shell.md) | 05 |
| 10 | [10-web-flags-list-create.md](./10-web-flags-list-create.md) | 06, 09 |
| 11 | [11-web-flag-detail-rules.md](./11-web-flag-detail-rules.md) | 07, 10 |
| 12 | [12-web-lifecycle-audit.md](./12-web-lifecycle-audit.md) | 06, 11 |
| 13 | [13-sdk-client-cache.md](./13-sdk-client-cache.md) | 04, 08 |
| 14 | [14-mvp-acceptance.md](./14-mvp-acceptance.md) | 01–13 |

## Plantilla obligatoria

1. Objetivo  
2. Contexto y dependencias  
3. Alcance (In scope / Out of scope)  
4. Tareas en orden  
5. Criterios de aceptación verificables  
6. Notas técnicas  

## Decisiones de stack (globales)

- Package manager: **pnpm** workspaces (sin Turborepo)
- `apps/web` — Next.js + Tailwind
- `apps/api` — Hono
- `packages/db` — Drizzle + SQLite/libSQL
- `packages/domain` — tipos + lógica pura + Vitest
- Auth: usuario demo `demo` / `demo` (sin OAuth/roles)
