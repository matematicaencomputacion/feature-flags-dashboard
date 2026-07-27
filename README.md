# Feature Flags (MVP)

Herramienta interna de feature flags según [`docs/prds/PRD_FEATURE_FLAGS.md`](docs/prds/PRD_FEATURE_FLAGS.md).

## Stack

| Pieza | Tecnología |
|-------|------------|
| Frontend | Next.js + Tailwind (`apps/web`) |
| API | Hono (`apps/api`) |
| Persistencia | Drizzle ORM + SQLite/libSQL (`packages/db`) |
| Dominio | TypeScript + Vitest (`packages/domain`) |

## Estructura

```
apps/web          Panel (login demo, flags, reglas)
apps/api          API REST + evaluación
packages/db       Schema Drizzle / SQLite
packages/domain   Evaluador, hash sticky, lifecycle
docs/prds         PRD (fuente de verdad de producto)
```

## Premisas (bloqueadas)

- Toggle booleano; targeting: ambiente + empresa + %
- Ambientes: `dev` / `staging` / `production`
- Auth: usuario demo (`demo` / `demo`) — sin OAuth ni roles
- Precedencia: `force_on`/`force_off` → % sticky por `user_id` → default
- Persistencia local SQLite; cache TTL 30–60s; fallback `safe_default`

## Setup

```bash
npm install
npm run test
```

## Desarrollo

Terminal 1 — API (puerto 8787):

```bash
npm run dev:api
```

Terminal 2 — Web (puerto 3000):

```bash
npm run dev:web
```

Abrir http://localhost:3000 → login `demo` / `demo`.

## Evaluación (consumidores)

```bash
curl -X POST http://localhost:8787/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"flagKey\":\"billing_v2\",\"environment\":\"production\",\"tenantId\":\"acme\",\"userId\":\"user-1\"}"
```

## Base de datos

SQLite en `data/feature-flags.db` (se crea al arrancar la API).
