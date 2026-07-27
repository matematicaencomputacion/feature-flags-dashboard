# Feature Flags (MVP)

Herramienta interna de feature flags según [`docs/prds/PRD_FEATURE_FLAGS.md`](docs/prds/PRD_FEATURE_FLAGS.md).

## Stack

| Pieza | Tecnología |
|-------|------------|
| Frontend | Next.js + Tailwind (`apps/web`) |
| API | Hono (`apps/api`) |
| Persistencia | Drizzle ORM + SQLite/libSQL (`packages/db`) |
| Dominio | TypeScript + Vitest (`packages/domain`) |
| SDK | Cliente evaluate + cache TTL (`packages/sdk`) |

## Estructura

```
apps/web          Panel (login demo, flags, reglas)
apps/api          API REST + evaluación
packages/db       Schema Drizzle / SQLite
packages/domain   Evaluador, hash sticky, lifecycle
packages/sdk      Cliente HTTP de evaluación + cache local
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
- **Las sesiones viven en memoria del proceso.** Expiran a las 8 horas de creadas
  (`SESSION_TTL_MS`), sin renovarse por uso, y un barrido cada 10 minutos saca las
  vencidas. Reiniciar la API desloguea a todo el mundo, y con varias instancias el
  token emitido por una no sirve en las otras.

## Setup

Monorepo **pnpm** (sin Turborepo). La versión está anclada en el campo
`packageManager` del `package.json` raíz, así que con [corepack](https://nodejs.org/api/corepack.html)
habilitado (`corepack enable pnpm`) no hace falta instalar nada más.

Requiere **Node ≥ 22.13**: pnpm 11 usa `node:sqlite`, que no existe en Node 20.

```bash
pnpm install
pnpm test           # dominio + sdk + api
pnpm run typecheck  # tsc --noEmit en domain, db, sdk, api (tests incluidos) y web
pnpm run build
pnpm db:migrate
pnpm db:seed        # flag mvp_check (escenario Spec 14)
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

Con el SDK (`@ff/sdk`):

```ts
import { createClient } from "@ff/sdk";

const flags = createClient({ baseUrl: "http://localhost:8787" });
const { enabled } = await flags.evaluate({
  flagKey: "billing_v2",
  environment: "production",
  tenantId: "acme",
  userId: "user-1",
});
```

## Base de datos

SQLite en `data/feature-flags.db`. El schema vive solo en
`packages/db/src/schema.ts`; las migraciones versionadas están en
`packages/db/drizzle/` (generadas con drizzle-kit).

```bash
pnpm run db:generate   # tras cambiar schema.ts → SQL en packages/db/drizzle/
pnpm run db:migrate    # aplica migraciones pendientes (también al arrancar la API)
```

La API llama al mismo migrator en el arranque (`ensureSchema` → `runMigrations`).
Si ya tenías un `data/feature-flags.db` creado con el DDL antiguo (sin tabla
`__drizzle_migrations`), borrá el archivo y volvé a migrar.
