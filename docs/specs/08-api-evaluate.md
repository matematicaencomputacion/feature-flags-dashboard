# Spec 08 — API evaluate

## Objetivo

Exponer `POST /evaluate` para consumidores: recibe flag/ambiente/tenant/user y devuelve boolean usando el evaluador de dominio sobre datos SQLite.

## Contexto y dependencias

- Domain: `evaluateFlag` (Spec 04).
- DB: flags + targeting_rules + tenant_overrides (Spec 03).
- Repo `getFlag` (Spec 06/07).
- **Sin auth de panel** en `/evaluate` (consumidores internos MVP); no exponer escrituras.

### Contrato

#### `POST /evaluate`

Request:

```json
{
  "flagKey": "billing_v2",
  "environment": "production",
  "tenantId": "acme",
  "userId": "user-1"
}
```

Response 200:

```json
{
  "flagKey": "billing_v2",
  "enabled": false,
  "reason": "force_off"
}
```

`reason` ∈ force_on | force_off | rollout | default | safe_default | eliminado | (mapear not_found → safe_default off).

### Comportamiento de error / fallback (RF-25, RNF-03)

- Si la flag no existe → `{ enabled: false, reason: "safe_default" }` (no 404 que tumbe clientes).
- Si ocurre excepción de lectura DB → misma respuesta safe_default off (o safe_default de flag si ya estaba en memoria; MVP: false + safe_default).
- Nunca 5xx por “flag off”; preferir 200 degradado.

### Propagación (RF-26, RNF-02)

- Sin cache server-side obligatorio en MVP API (cache vive en SDK Spec 13).
- Un PUT de reglas + evaluate inmediato debe reflejar el nuevo valor (consistencia read-after-write en mismo proceso API).
- Documentar que clientes con TTL 30–60s verán el cambio en < 60s.

## Alcance

### In scope

- `POST /evaluate` público (sin Bearer)
- Validación de body
- Uso estricto de `evaluateFlag` de `@ff/domain`

### Out of scope

- SDK cache (Spec 13)
- Auth de evaluate / API keys
- Batch evaluate
- Analytics

## Tareas en orden

1. Añadir ruta POST `/evaluate` con zod.
2. Cargar flag; llamar `evaluateFlag`.
3. Normalizar `not_found` → safe_default response.
4. try/catch → fallback seguro.
5. Verificar casos: force_off vs 100%, sticky userIds, default.

## Criterios de aceptación verificables

- **CA-08-01** Evaluate con force_off + %100 ⇒ enabled false (RF-12, RF-13).
- **CA-08-02** Evaluate con force_on + %0 ⇒ enabled true (RF-14).
- **CA-08-03** Dos evaluate seguidos mismo userId/% ⇒ mismo enabled (RF-15).
- **CA-08-04** Flag inexistente ⇒ 200 enabled false reason safe_default (RF-25).
- **CA-08-05** Tras PUT production confirmado, evaluate inmediato (sin reiniciar API) ve el nuevo resultado (RF-26 read-after-write).
- **CA-08-06** Body inválido ⇒ 400.
- **CA-08-07** No requiere Authorization.

## Notas técnicas

- Puerto API: `8787`.
- Ejemplo curl:

```bash
curl -X POST http://localhost:8787/evaluate \
  -H "Content-Type: application/json" \
  -d "{\"flagKey\":\"billing_v2\",\"environment\":\"production\",\"tenantId\":\"acme\",\"userId\":\"u1\"}"
```

- RNF-01 (p99 < 5ms) es objetivo del cache hit en Spec 13; aquí basta evaluación in-process sobre SQLite local.
