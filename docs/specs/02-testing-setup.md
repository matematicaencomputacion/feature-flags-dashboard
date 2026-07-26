# Spec 02 — Testing setup

## Objetivo

Configurar Vitest en el monorepo (root + por paquete) con un test verde de humo, para habilitar criterios `CA-*` de specs posteriores.

## Contexto y dependencias

- Requiere monorepo pnpm de Spec 01:
  - `packages/domain` → `@ff/domain`
  - `apps/api` → `@ff/api`
  - root con `pnpm-workspace.yaml`
- Runner: **Vitest** (no Jest).
- Esta spec no implementa el evaluador completo; solo infraestructura + 1 test de humo en domain.

### Scripts objetivo

Root `package.json`:

```json
{
  "scripts": {
    "test": "pnpm -r --filter @ff/domain --filter @ff/api --filter @ff/db test",
    "test:domain": "pnpm --filter @ff/domain test"
  }
}
```

Cada paquete con tests debe exponer `"test": "vitest run"`.

### Ejemplo de test verde (obligatorio)

Archivo: `packages/domain/src/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest runs in @ff/domain", () => {
    expect(1 + 1).toBe(2);
  });
});
```

## Alcance

### In scope

- Vitest como devDependency en `@ff/domain` (mínimo) y config `vitest.config.ts`
- Script `test` en root que ejecute al menos `@ff/domain`
- Un test verde de humo
- Documentar en README cómo correr tests: `pnpm test`

### Out of scope

- Coverage gates / CI
- E2E Playwright/Cypress
- Tests del evaluador (Spec 04) o API (Specs 05–08)

## Tareas en orden

1. Añadir `vitest` a `packages/domain`.
2. Crear `packages/domain/vitest.config.ts` (`environment: "node"`).
3. Crear `packages/domain/src/smoke.test.ts` (test verde).
4. Añadir script `"test": "vitest run"` en `@ff/domain`.
5. Añadir script `"test"` en root que invoque el filter de domain (y stubs `test` no-op o vacíos en otros paquetes si hace falta para `-r`).
6. Ejecutar `pnpm test` y confirmar exit code 0.
7. Actualizar README root con la sección Testing.

## Criterios de aceptación verificables

- **CA-02-01** `pnpm test` (desde la raíz) termina con exit code 0.
- **CA-02-02** La salida de Vitest muestra al menos 1 test passed en `@ff/domain`.
- **CA-02-03** Existe `packages/domain/vitest.config.ts`.
- **CA-02-04** README documenta `pnpm test`.
- **CA-02-05** No se usa Jest (`package.json` sin dependencia `jest`).

## Notas técnicas

- Preferir `vitest run` en CI/scripts (no watch).
- Los tests de lógica de flags irán en `packages/domain/src/*.test.ts` (Spec 04).
- Si un workspace aún no tiene tests, su script `test` puede ser `"echo 'no tests yet'"` temporalmente; el root debe seguir en verde.
