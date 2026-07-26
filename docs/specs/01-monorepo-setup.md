# Spec 01 — Monorepo setup

## Objetivo

Crear el monorepo base con pnpm workspaces (sin Turborepo) y los cuatro paquetes del MVP, listos para desarrollar TypeScript.

## Contexto y dependencias

- Producto: herramienta interna de feature flags (toggles booleanos por ambiente, empresa y % de tráfico).
- Package manager obligatorio: **pnpm** (no npm workspaces, no Yarn, no Turborepo).
- Node.js ≥ 20.
- Estructura objetivo (rutas absolutas desde la raíz del repo):

```
/
  package.json          # workspaces pnpm
  pnpm-workspace.yaml
  tsconfig.base.json
  apps/
    web/                # Next.js + Tailwind — panel operador
    api/                # Hono — API REST
  packages/
    db/                 # Drizzle ORM + SQLite/libSQL
    domain/             # tipos + lógica pura (sin I/O)
  data/                 # SQLite local (gitignored)
  docs/prds/
  docs/specs/
```

- Nombres de paquetes:
  - `@ff/web` → `apps/web`
  - `@ff/api` → `apps/api`
  - `@ff/db` → `packages/db`
  - `@ff/domain` → `packages/domain`

- Dependencias entre paquetes (en esta spec solo wiring; lógica en specs posteriores):
  - `@ff/api` depende de `@ff/db` y `@ff/domain`
  - `@ff/web` puede depender de `@ff/domain` (tipos)
  - `@ff/db` puede depender de `@ff/domain` (tipos) o mantener tipos locales mínimos

- Si el repo ya existe con npm: migrar a pnpm (`pnpm-workspace.yaml`, eliminar lockfile npm si aplica) sin Turborepo.

## Alcance

### In scope

- `pnpm-workspace.yaml` con `apps/*` y `packages/*`
- `package.json` root con scripts: `dev:api`, `dev:web`, `test`, `build`
- `tsconfig.base.json` estricto compartido
- Scaffold mínimo de cada app/paquete (package.json + tsconfig + entry placeholder)
- Next.js (App Router) + Tailwind en `apps/web`
- Hono + `@hono/node-server` en `apps/api`
- Drizzle + `@libsql/client` declarados en `packages/db`
- `.gitignore`: `node_modules`, `.next`, `dist`, `data/*.db`, `.env*`
- README root con comandos `pnpm install`, `pnpm --filter @ff/api dev`, `pnpm --filter @ff/web dev`

### Out of scope

- Turborepo / Nx
- Lógica de evaluación, schema SQL real, UI de flags, auth
- Docker, CI, deploy
- OAuth / roles

## Tareas en orden

1. Crear `pnpm-workspace.yaml` y `package.json` root (private, scripts).
2. Crear `tsconfig.base.json` (`strict`, `ES2022`, `moduleResolution: Bundler`).
3. Scaffold `packages/domain` con `src/index.ts` exportando un placeholder (`export const DOMAIN_OK = true`).
4. Scaffold `packages/db` con `src/index.ts` placeholder y deps drizzle/`@libsql/client`.
5. Scaffold `apps/api` con Hono `GET /health` → `{ ok: true }` en puerto `8787`.
6. Scaffold `apps/web` con Next.js App Router + Tailwind; página home con título "Feature Flags".
7. Configurar workspace deps (`@ff/domain`, `@ff/db`) vía `workspace:*`.
8. Añadir `.gitignore` y README de arranque.
9. Ejecutar `pnpm install` y verificar que api/web arrancan.

## Criterios de aceptación verificables

- **CA-01-01** Existe `pnpm-workspace.yaml` con packages `apps/*` y `packages/*`. No hay `turbo.json`.
- **CA-01-02** `pnpm install` en la raíz termina sin error.
- **CA-01-03** `pnpm --filter @ff/api dev` deja escuchando `GET http://localhost:8787/health` → JSON `{ "ok": true }`.
- **CA-01-04** `pnpm --filter @ff/web dev` sirve http://localhost:3000 con texto "Feature Flags".
- **CA-01-05** Existen los cuatro paths: `apps/web`, `apps/api`, `packages/db`, `packages/domain`, cada uno con su `package.json` name `@ff/*`.
- **CA-01-06** TypeScript base compartido vía `tsconfig.base.json` referenciado por los paquetes.

## Notas técnicas

- Puertos fijos MVP: API `8787`, Web `3000`.
- Variable de entorno DB (para specs posteriores): `DATABASE_URL=file:./data/feature-flags.db` (path desde raíz o absoluto `file:`).
- No usar npm workspaces; si hay `package-lock.json` legado, preferir `pnpm-lock.yaml` como fuente de verdad.
- Placeholders deben compilar; no dejar paquetes vacíos sin entrypoint.
