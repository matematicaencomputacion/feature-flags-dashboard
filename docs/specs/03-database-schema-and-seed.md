# Spec 03 — Database schema and seed

## Objetivo

Definir el schema Drizzle + SQLite/libSQL, migraciones/bootstrap y un seed mínimo para desarrollo local.

## Contexto y dependencias

- Paquete: `packages/db` (`@ff/db`).
- Driver: `@libsql/client` + `drizzle-orm` (dialect sqlite).
- Archivo DB por defecto: `data/feature-flags.db` en la raíz del monorepo.
- Env: `DATABASE_URL` (ej. en WSL2/Linux `file:/root/dev/feature-flags-dashboard/data/feature-flags.db`, o `file:../../data/feature-flags.db` relativo al proceso).
- Dominio de producto (repetido aquí):
  - Ambientes: `dev` | `staging` | `production`
  - Lifecycle: `experimental` | `GA` | `deprecado` | `eliminado`
  - `safe_default`: `off` | `on`
  - Override: `force_on` | `force_off`
  - Default global de ambiente al crear flag: `off`, rollout `0`

### Schema obligatorio

#### Tabla `flags`

| Columna | Tipo | Notas |
|---------|------|--------|
| `key` | TEXT PK | snake_case estable, ej. `billing_v2` |
| `lifecycle` | TEXT NOT NULL | default `experimental` |
| `safe_default` | TEXT NOT NULL | default `off` |
| `created_at` | TEXT NOT NULL | ISO-8601 |
| `updated_at` | TEXT NOT NULL | ISO-8601 |

#### Tabla `environment_rules`

Una fila por par (`flag_key`, `environment`). (Nombre histórico en esta spec: `targeting_rules`; en main la tabla es `environment_rules`.)

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | INTEGER PK AI | |
| `flag_key` | TEXT NOT NULL FK → flags.key ON DELETE CASCADE | |
| `environment` | TEXT NOT NULL | `dev`/`staging`/`production` |
| `default_on` | INTEGER NOT NULL | 0/1 boolean |
| `rollout_percent` | INTEGER NOT NULL | 0–100 |
| UNIQUE(`flag_key`, `environment`) | | |

#### Tabla `tenant_overrides`

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | INTEGER PK AI | |
| `flag_key` | TEXT NOT NULL FK → flags.key ON DELETE CASCADE | |
| `environment` | TEXT NOT NULL | |
| `tenant_id` | TEXT NOT NULL | |
| `mode` | TEXT NOT NULL | `force_on` \| `force_off` |
| UNIQUE(`flag_key`, `environment`, `tenant_id`) | | |

#### Tabla `audit_log`

| Columna | Tipo | Notas |
|---------|------|--------|
| `id` | INTEGER PK AI | |
| `flag_key` | TEXT NOT NULL | |
| `by` | TEXT NOT NULL | usuario demo |
| `at` | TEXT NOT NULL | ISO-8601 |
| `summary` | TEXT NOT NULL | descripción corta del cambio |

### Seed mínimo

Alineado al escenario de Spec 14 (aceptación MVP). Idempotente: re-correr no duplica filas UNIQUE ni auditoría del seed.

- Flag `mvp_check`: lifecycle `experimental`, `safe_default=off`
- Tres `environment_rules`:
  - `dev`: `default_on=0`, `rollout_percent=0`
  - `staging`: `default_on=0`, `rollout_percent=50`, sin overrides
  - `production`: `default_on=0`, `rollout_percent=100`
- En `production`: override `tenant_id=acme`, `mode=force_off`
- Un `audit_log`: `by=seed`, summary del seed de `mvp_check`

(El seed histórico de esta spec mencionaba `billing_v2`; prevalece el escenario de Spec 14 / main.)

## Alcance

### In scope

- `packages/db/src/schema.ts` con las 4 tablas
- Client factory `createDb(url)`
- Script de migrate/bootstrap idempotente (`CREATE TABLE IF NOT EXISTS…`)
- Script de seed idempotente (upsert por key)
- Export público desde `packages/db/src/index.ts`

### Out of scope

- API HTTP
- Evaluador
- UI
- Multi-tenant DB / Postgres / Turso cloud (solo file local)

## Tareas en orden

1. Implementar `schema.ts` con Drizzle sqlite-core.
2. Implementar `client.ts` (`createClient` + `drizzle`).
3. Implementar `migrate.ts` / bootstrap SQL idempotente; crear carpeta `data/` si no existe.
4. Implementar `seed.ts` con datos mínimos arriba.
5. Añadir scripts en `@ff/db`: `"migrate"`, `"seed"`.
6. Exponer scripts root: `pnpm db:migrate`, `pnpm db:seed`.
7. Correr migrate + seed y abrir/verificar filas (vía script o query).

## Criterios de aceptación verificables

- **CA-03-01** Tras `pnpm db:migrate`, existen las tablas `flags`, `environment_rules`, `tenant_overrides`, `audit_log` en el archivo SQLite.
- **CA-03-02** Tras `pnpm db:seed`, existe flag `mvp_check` con 3 filas en `environment_rules` (una por ambiente).
- **CA-03-03** Seed idempotente: correr seed dos veces no duplica `mvp_check` ni rompe UNIQUE.
- **CA-03-04** Hay al menos 1 fila en `audit_log` para `mvp_check` con `by=seed`.
- **CA-03-05** Hay override seed `acme`/`force_off` en `production`; staging sin overrides; staging `rollout_percent=50`; production `rollout_percent=100`.
- **CA-03-06** Reiniciar el proceso y reabrir la misma `DATABASE_URL` conserva los datos (RF-22 / RNF-04).

## Notas técnicas

- Usar boolean mode de Drizzle (`integer mode: 'boolean'`) para `default_on` si se desea; persistido como 0/1.
- No analytics de exposición medida: `rollout_percent` es la exposición teórica.
- La API (specs 06–07) leerá estas tablas; mantener nombres de columnas estables.
- Path recomendado al correr desde `apps/api`: resolver a `<repo>/data/feature-flags.db`.
