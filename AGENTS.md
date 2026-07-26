# AGENTS.md

Punto de entrada para agentes y personas nuevas en el repo. Leelo antes de tocar código.

## Producto

**Feature Flags Dashboard**: herramienta interna para activar o desactivar features sin deploy, por **ambiente** (`dev` / `staging` / `production`), por **empresa** (`tenantId`) y por **porcentaje de tráfico** (sticky por `userId`).

Flags booleanas, no configuración arbitraria. Login con usuario demo (`demo` / `demo`), sin OAuth ni roles.

Fuente de verdad de producto: `docs/prds/PRD_FEATURE_FLAGS.md`. Si el código la contradice, gana el PRD.

## Stack

Monorepo pnpm (sin Turborepo) · TypeScript · Next.js + Tailwind · Hono · Drizzle ORM + SQLite/libSQL · Vitest.

## Estructura

```
apps/web          Panel del operador (Next.js App Router)
apps/api          API REST y endpoint de evaluación (Hono, :8787)
packages/domain   Tipos y lógica pura: evaluador, hash sticky, lifecycle
packages/db       Schema Drizzle, cliente libSQL, migraciones
docs/prds         PRD (qué construimos y por qué)
docs/specs        Specs de implementación, numeradas
data/             SQLite local (gitignored)
```


