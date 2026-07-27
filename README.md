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

## Limitaciones conocidas

- **SQLite como punto único de fallo**, ya reconocido en el PRD.
- **El caché de evaluación es in-process.** `POST /evaluate` sirve desde un caché
  con TTL (`FLAG_CACHE_TTL_MS`, 30–60s, default 45s) que cada escritura invalida
  al instante. Eso alcanza con una sola instancia de API; con varias, la que
  recibe el cambio invalida el suyo y las demás sirven la definición vieja hasta
  que expire el TTL. Resolverlo pide un caché compartido o un canal de
  invalidación entre instancias.

## Setup

Monorepo **pnpm** (sin Turborepo). La versión está anclada en el campo
`packageManager` del `package.json` raíz, así que con [corepack](https://nodejs.org/api/corepack.html)
habilitado (`corepack enable pnpm`) no hace falta instalar nada más.

```bash
pnpm install
pnpm test           # dominio + api
pnpm run typecheck  # tsc --noEmit en domain, db y api
pnpm run build
```

## Desarrollo

Terminal 1 — API (puerto 8787):

```bash
pnpm run dev:api    # equivalente: pnpm --filter @ff/api run dev
```

Terminal 2 — Web (puerto 3000):

```bash
pnpm run dev:web    # equivalente: pnpm --filter @ff/web run dev
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
