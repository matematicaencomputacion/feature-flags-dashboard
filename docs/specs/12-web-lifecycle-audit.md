# Spec 12 — Web lifecycle and audit

## Objetivo

Completar el detalle de flag con avance de lifecycle, checklist de eliminación y visualización clara de auditoría (último cambio).

## Contexto y dependencias

- Página detalle Spec 11: `/flags/[key]`
- API Spec 06 `PATCH /flags/:key`:

```json
{
  "lifecycle": "GA",
  "safeDefault": "on",
  "cleanupChecklistConfirmed": true,
  "confirmProduction": true
}
```

- Orden lifecycle: `experimental` → `GA` → `deprecado` → `eliminado` (solo un paso).
- A `eliminado` requiere checkbox UI: “Código ya no depende de esta flag” → envía `cleanupChecklistConfirmed: true` (RF-08).
- Cualquier PATCH de lifecycle/safeDefault requiere confirmación production (modal Spec 11 reutilizable) porque afecta evaluación global/prod (RF-17).
- `lastChange` viene en GET flag: `{ by, at, summary }` (RF-19, RF-21, RNF-06).

### UI

- Badge/estado lifecycle actual
- Botón “Avanzar a {next}” si hay next
- Si next === eliminado: checkbox checklist obligatorio para habilitar botón
- Opcional v1: toggle `safe_default` off/on (si se implementa, también con modal confirm)
- Bloque “Último cambio” siempre visible cuando exista
- Tras avanzar a deprecado: el editor de reglas (Spec 11) permanece disabled

## Alcance

### In scope

- Controles lifecycle + checklist
- Reuso modal confirm production
- Mostrar auditoría lastChange

### Out of scope

- Historial completo paginado de audit_log (MVP: último cambio basta; si GET ya trae solo last, OK)
- Borrado físico de filas DB fuera del lifecycle eliminado

## Tareas en orden

1. Añadir `updateFlagMeta` en `src/lib/api.ts`.
2. UI lifecycle en detalle.
3. Integrar modal confirm antes del PATCH.
4. Enviar checklist solo al pasar a eliminado.
5. Refrescar flag tras éxito; verificar reglas disabled en deprecado.

## Criterios de aceptación verificables

- **CA-12-01** Desde experimental se puede avanzar a GA tras confirmar (RF-06).
- **CA-12-02** No hay control que salte experimental→deprecado en un click.
- **CA-12-03** A eliminado sin checkbox no se puede confirmar; con checkbox + confirm sí (RF-08).
- **CA-12-04** Tras deprecado, UI de reglas no permite guardar (RF-07 + Spec 11).
- **CA-12-05** lastChange se actualiza en pantalla tras el PATCH (RF-19, RF-21).
- **CA-12-06** Cancelar modal no cambia lifecycle.

## Notas técnicas

- Username audit siempre `demo` en MVP.
- Mensaje modal puede reutilizarse: “Este cambio afecta la evaluación en production…”.
- Mantener `safeDefault` editable solo si no complica; si se omite en UI, aún debe mostrarse el valor actual.
