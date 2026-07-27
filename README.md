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

## Estado del repo

El PRD y las specs describen el monorepo sobre **pnpm**; hoy está instalado con
**npm workspaces** (`package-lock.json`). La migración a pnpm es parte de la
spec 01 y hasta que se ejecute, los comandos de este README son los válidos.

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

```bash
npm install
npm run test        # tests de dominio
npm run typecheck   # tsc --noEmit en domain, db y api
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
