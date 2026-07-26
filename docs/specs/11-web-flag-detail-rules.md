# Spec 11 — Web flag detail and rules

## Objetivo

Página de detalle de flag para editar reglas por ambiente (default, %, overrides) con confirmación explícita en production y exposición teórica.

## Contexto y dependencias

- Ruta: `apps/web/src/app/flags/[key]/page.tsx`
- API:
  - `GET /flags/:key` (Spec 06)
  - `PUT /flags/:key/rules/:environment` (Spec 07)
- Ambientes: `dev` | `staging` | `production`
- Overrides: `{ tenantId, mode: "force_on" | "force_off" }[]`
- Production: la UI **debe** pedir confirmación antes de llamar API con `confirmProduction: true` (RF-17).
- dev/staging: guardar directo con `confirmProduction: false` (RF-18).
- Si lifecycle es `deprecado` o `eliminado`: deshabilitar edición de reglas (RF-07).

### UI requerida

1. Header con `key`, lifecycle, safe_default, último cambio (by/at/summary) si existe (RF-19).
2. Tabs/botones de ambiente.
3. Checkbox default ON.
4. Input rollout % 0–100.
5. Texto: `Exposición teórica: ~{N}% del tráfico en {env}` (RF-20) — N = valor configurado, no medido.
6. Lista editable de overrides + agregar/quitar.
7. Botón Guardar reglas.
8. Modal confirmación si env=production:
   - Título: “¿Confirmar cambio en production?”
   - Acciones: Cancelar / Confirmar en production
   - Solo tras Confirmar se hace el PUT con `confirmProduction: true`.
9. Hint de precedencia visible: empresa → % → default.

### Contrato PUT (recordatorio)

```json
{
  "defaultOn": false,
  "rolloutPercent": 50,
  "overrides": [{ "tenantId": "acme", "mode": "force_off" }],
  "confirmProduction": true
}
```

## Alcance

### In scope

- Detalle + editor de reglas por ambiente
- Modal production
- Manejo de errores API

### Out of scope

- Avance de lifecycle / checklist eliminado (Spec 12)
- SDK
- Analytics reales

## Tareas en orden

1. Fetch flag por key al montar; redirect login si no hay token.
2. Estado draft por ambiente sincronizado al cambiar tab.
3. Implementar save + modal production.
4. Deshabilitar controles si deprecado/eliminado.
5. Verificar que Cancelar en modal no llama API.

## Criterios de aceptación verificables

- **CA-11-01** Se ven reglas de los 3 ambientes al cambiar tabs (RF-11, RF-19).
- **CA-11-02** Guardar en staging sin modal persiste (RF-18).
- **CA-11-03** Guardar en production abre modal; Cancelar no persiste (RF-17, CA MVP #7).
- **CA-11-04** Confirmar production persiste %/overrides y refresca lastChange.
- **CA-11-05** Se muestra exposición teórica = % configurado (RF-20).
- **CA-11-06** Se pueden agregar force_on y force_off por tenantId (RF-10).
- **CA-11-07** En deprecado, guardar reglas está bloqueado en UI.

## Notas técnicas

- Filtrar overrides con `tenantId` vacío antes del PUT.
- No implementar targeting fuera de empresa/%/ambiente.
- El modal es la “confirmación explícita en UI” del PRD; el API también valida.
