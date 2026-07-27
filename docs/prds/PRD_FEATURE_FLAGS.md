# PRD — Feature Flags internas

**Estado:** MVP aceptado (2026-07-27; evidencia Spec 14)  
**Versión:** 1.0  
**Producto:** Herramienta interna de activación/desactivación de features

### Stack técnico (bloqueado)

| Capa | Tecnología | Ubicación |
|------|------------|-----------|
| Frontend | Next.js + Tailwind CSS | `apps/web` |
| API | Hono | `apps/api` |
| Persistencia | Drizzle ORM + SQLite/libSQL | `packages/db` |
| Dominio / tests | TypeScript + Vitest | `packages/domain` |
| Monorepo | pnpm workspaces (sin Turborepo) | raíz |

---


## 1) Contexto y problema

Hoy activar o desactivar una feature implica un deploy. Eso retrasa experimentos, rollouts graduales y respuestas ante incidentes, y acopla cambios de producto al ciclo de release.

Necesitamos una herramienta interna que permita encender o apagar features por **ambiente**, por **empresa (tenant)** y por **porcentaje de tráfico**, sin redeploy, con persistencia local y operación simple.

---

## 2) Objetivo

Permitir a operadores internos controlar flags booleanas en runtime (dev / staging / production) con:

- override por empresa (`force_on` / `force_off`);
- rollout porcentual sticky por `user_id`;
- default de ambiente y `safe_default` ante fallos;
- propagación en production en menos de 1 minuto, sin deploy.

**Éxito del MVP:** un operador autenticado con el usuario demo puede crear una flag, definir reglas por ambiente/empresa/%, confirmar un cambio en production y ver el efecto en evaluación en < 1 min, persistido en SQLite.

---

## 3) Público objetivo y usuarios

| Actor | Descripción | Capacidades en v1 |
|-------|-------------|-------------------|
| Operador interno | Persona del equipo (producto, engineering, ops) que usa el panel | Ver y cambiar flags en todos los ambientes, incluido production |
| Sistema consumidor | Backend/BFF/servicios que evalúan flags en runtime | Consultar evaluación vía SDK/cache local |

**Autenticación (bloqueada):** un único **usuario demo**. Sin OAuth, sin roles, sin RBAC, sin segundo aprobador.

Cualquiera autenticado con el usuario demo puede ver y editar. Los cambios en **production** requieren confirmación explícita (“¿Activar en producción?” / equivalente según la acción).

---

## 4) Alcance

### In scope

- Flags booleanas con clave estable.
- Ambientes independientes: `dev`, `staging`, `production`.
- Targeting: ambiente + empresa (tenant) + rollout %.
- Overrides por tenant: `force_on` / `force_off`.
- Precedencia fija: empresa → % → default de ambiente.
- Rollout % sticky por `user_id` (hash estable).
- Default global `off`; `safe_default` configurable (`off` por defecto; `on` tipicamente para flags GA).
- Ciclo de vida: `experimental` → `GA` → `deprecado` → `eliminado`.
- Panel interno con login de usuario demo.
- Observabilidad operativa: estado, reglas, último cambio (quién/cuándo), exposición teórica (= % configurado).
- Persistencia en **SQLite** local.
- Evaluación en runtime vía SDK + cache local (TTL 30–60s).
- Fallback a `safe_default` si falla la lectura/servicio.
- Propagación de cambios en production en **< 1 minuto**, sin redeploy.
- Confirmación explícita al cambiar flags en production.

### Out of scope

- OAuth, SSO, roles (Viewer/Editor/Admin), permisos avanzados, aprobación dual.
- Configuración arbitraria / parámetros de negocio (límites, textos, URLs) como valor de la flag.
- Targeting por usuario individual, región, plan, atributos custom o reglas compuestas (AND/OR).
- Listas masivas complejas más allá de `force_on` / `force_off` por tenant.
- Analytics de exposición **medida** (telemetría real de tráfico).
- Multi-región, alta disponibilidad distribuida, o persistencia distinta de SQLite.
- SDKs multi-lenguaje exhaustivos más allá de lo necesario para el MVP consumidor acordado en implementación.
- Workflows de compliance formales (SOX, etc.).

---

## 5) Conceptos de dominio

### Feature flag

Entidad con:

- `key` estable (ej. `billing_v2`, `new_dashboard`);
- valor booleano en evaluación (`true` / `false`);
- `lifecycle`: `experimental` | `GA` | `deprecado` | `eliminado`;
- `safe_default`: `off` | `on` (usado si falla la evaluación/lectura);
- metadatos de auditoría del último cambio.

La herramienta **activa/desactiva**; no almacena configuración de negocio arbitraria.

### Ambiente

Uno de: `dev`, `staging`, `production`. Cada ambiente tiene reglas **independientes** y un **default de ambiente** (globalmente `off`, salvo que se defina lo contrario vía reglas/`safe_default` según corresponda).

Staging y production usan la herramienta como fuente de verdad operativa. En local se puede mockear; no sustituye la fuente de verdad en staging/prod.

### Targeting rule

Regla asociada a una flag + ambiente, de uno de estos tipos:

1. **Override de empresa:** `tenant_id` + `force_on` | `force_off`.
2. **Rollout porcentual:** entero 0–100; inclusión sticky por hash de `user_id`.
3. **Default de ambiente:** valor base si no aplica override ni % (default global = `off`).

Flags en estado `deprecado` **siguen evaluándose** pero **no admiten reglas nuevas**.  
Flags `eliminado` no se evalúan; la eliminación exige que el código ya no dependa de la flag (checklist de cleanup).

### Evaluador

Componente (SDK + cache local) que, dado `flag_key`, `environment`, `tenant_id`, `user_id`, devuelve `true` | `false` según precedencia:

1. Override por empresa (`force_on` / `force_off`) — gana siempre sobre el %.
2. % de tráfico (hash estable de `user_id`).
3. Default del ambiente.

Si no puede obtener reglas actualizadas: retorna `safe_default` de la flag (`off` por defecto).

Cache local con TTL 30–60s. Cambios en production visibles en evaluación en < 1 min.

---

## 6) Requerimientos funcionales

### Autenticación y acceso

- **RF-01** El sistema permite iniciar sesión únicamente con un usuario demo predefinido.
- **RF-02** Un usuario autenticado puede listar, crear, editar y consultar el detalle de todas las flags en todos los ambientes.
- **RF-03** No existen roles, OAuth ni controles de permiso por ambiente o por acción (más allá de la confirmación de production).

### Gestión de flags

- **RF-04** Se puede crear una flag con `key` estable, única, y `safe_default` (`off` por defecto).
- **RF-05** Toda flag nueva inicia en lifecycle `experimental` y default de ambiente `off`.
- **RF-06** Se puede cambiar el lifecycle en el orden: `experimental` → `GA` → `deprecado` → `eliminado`.
- **RF-07** En estado `deprecado`, la flag sigue evaluándose y se rechaza la creación de reglas nuevas.
- **RF-08** La transición a `eliminado` solo es posible si se cumple el checklist de que el código ya no depende de la flag (el sistema exige confirmación de checklist).
- **RF-09** Flags en `GA` pueden tener `safe_default = on`; el default global del sistema permanece `off`.

### Targeting y reglas

- **RF-10** Por cada par flag + ambiente se pueden definir: default de ambiente, rollout % (0–100), y N overrides `force_on`/`force_off` por `tenant_id`.
- **RF-11** Las reglas de `dev`, `staging` y `production` son independientes entre sí.
- **RF-12** El evaluador aplica precedencia: override empresa → % → default ambiente.
- **RF-13** Un tenant con `force_off` evalúa `false` aunque el % global sea 100.
- **RF-14** Un tenant con `force_on` evalúa `true` aunque el % global sea 0.
- **RF-15** El % incluye al usuario si `hash_estable(user_id) % 100 < porcentaje`, de forma sticky para el mismo `user_id`.
- **RF-16** No se pueden crear reglas de targeting distintas de ambiente, empresa y %.

### Cambios en production

- **RF-17** Toda creación, edición o borrado de regla/estado que afecte `production` requiere confirmación explícita en UI antes de persistir.
- **RF-18** Los cambios en `dev` y `staging` no requieren esa confirmación.

### Observabilidad operativa

- **RF-19** El detalle de una flag muestra: estado/lifecycle, `safe_default`, reglas activas por ambiente (empresas, %, default), último cambio (usuario demo + timestamp).
- **RF-20** Se muestra exposición teórica igual al % configurado en ese ambiente (no tráfico medido).
- **RF-21** Cada cambio persistido registra quién (usuario demo), cuándo y qué cambió.

### Persistencia y evaluación

- **RF-22** Todas las flags, reglas y auditoría se persisten en SQLite local.
- **RF-23** Existe un endpoint/SDK de evaluación que recibe `flag_key`, `environment`, `tenant_id`, `user_id` y devuelve boolean según RF-12–RF-15.
- **RF-24** El cliente de evaluación usa cache local con TTL configurable entre 30 y 60 segundos.
- **RF-25** Si la lectura de reglas falla, la evaluación retorna `safe_default` de la flag.
- **RF-26** Un cambio guardado en production es visible para nuevas evaluaciones (post-TTL/invalidación) en menos de 1 minuto, sin redeploy.

---

## 7) Requerimientos no funcionales

- **RNF-01 Latencia de evaluación:** la evaluación en caliente (cache hit) no debe añadir latencia percibida material al request del consumidor; objetivo orientativo p99 cache-hit < 5 ms en proceso local.
- **RNF-02 Propagación:** cambios en production visibles en < 60 s (alineado a TTL 30–60s).
- **RNF-03 Disponibilidad degradada:** ante fallo de lectura, el sistema no tumba al consumidor; responde con `safe_default`.
- **RNF-04 Persistencia:** SQLite como única fuente de verdad del panel y reglas en el MVP.
- **RNF-05 Simplicidad operativa:** un solo usuario demo; sin dependencia de IdP externo.
- **RNF-06 Auditabilidad básica:** historial del último cambio (y registro de cambios) consultable desde el detalle de la flag.
- **RNF-07 Claridad de precedencia:** la precedencia empresa > % > default está documentada en UI o docs de operador y es determinística.
- **RNF-08 Independencia de deploy:** activar/desactivar una flag no requiere pipeline de deploy de la aplicación consumidora.

---

## 8) Criterios de aceptación del MVP

El MVP se considera aceptado cuando se cumplen **todos** los siguientes:

1. **Login demo:** se puede entrar solo con el usuario demo; no hay OAuth ni pantalla de roles.
2. **CRUD de flag:** crear flag booleana con `key` única, `safe_default` y lifecycle `experimental`.
3. **Tres ambientes:** configurar reglas distintas en `dev`, `staging` y `production` para la misma flag.
4. **Override empresa:** `force_on` y `force_off` por `tenant_id` se respetan sobre el %.
5. **Rollout %:** con 50% y dos `user_id` fijos, uno queda in / otro out de forma estable en evaluaciones repetidas.
6. **Precedencia:** denylist (`force_off`) con % = 100 ⇒ `false` para ese tenant.
7. **Confirmación prod:** un cambio en production sin confirmar no se persiste; con confirmar, sí.
8. **Observabilidad:** el detalle muestra estado, reglas, último cambio y % teórico.
9. **Lifecycle:** en `deprecado` no se crean reglas nuevas; la evaluación sigue funcionando.
10. **SQLite:** reiniciar la app conserva flags y reglas.
11. **Cache + fallback:** con backend de flags detenido/simulado caído, el SDK/evaluador devuelve `safe_default`.
12. **Sin redeploy:** cambiar una flag en production cambia el resultado de evaluación en < 1 min sin redesplegar el consumidor.
13. **Fuera de alcance verificado:** no existen APIs/UI de OAuth, roles, targeting por región/plan/usuario individual, ni analytics de exposición medida.

---

## 9) Riesgos y supuestos

### Supuestos

- S-01: Un usuario demo es suficiente para el MVP interno; no hay requisito de compliance de acceso en esta fase.
- S-02: Los consumidores pueden enviar `tenant_id` y `user_id` en cada evaluación.
- S-03: Consistencia eventual de hasta ~60 s es aceptable para producto y ops.
- S-04: SQLite en el entorno de la herramienta es aceptable (volumen bajo de flags/reglas).
- S-05: “Exposición” mostrada es el % configurado, no una medición de tráfico real.
- S-06: El default global `off` es el comportamiento seguro para flags nuevas.
- S-07: Staging/production no dependen de mocks locales como fuente de verdad.

### Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Usuario demo compartido sin roles | Cambios accidentales en prod | Confirmación explícita en production + auditoría básica |
| Cache TTL retrasa un kill-switch | Features dañinas siguen activas hasta 60 s | TTL corto (30–60s); documentar límite; kill-switch vía `force_off` / `safe_default` |
| Flags eternas sin cleanup | Deuda técnica | Lifecycle + checklist obligatorio antes de `eliminado` |
| Hash % mal implementado (no sticky) | Experiencia inconsistente | Criterio de aceptación de estabilidad por `user_id` |
| Confundir flag con config store | Alcance creep | Fuera de alcance explícito; solo boolean |
| SQLite como SPOF / no multi-instancia | Límites de escala | Aceptado en MVP; documentar como limitación |
| Fallbacks `on` mal configurados | Comportamiento inesperado ante outage | `safe_default = on` solo consciente (típ. GA); default `off` |

---

## Apéndice — Premisas bloqueadas (1–14)

1. Feature = toggle booleano con clave estable.  
2. Targeting v1 = ambiente + empresa + % tráfico.  
3. Ambientes `dev` / `staging` / `production` independientes; fuente de verdad operativa = herramienta en staging/prod.  
4. Auth = usuario demo; sin OAuth / roles / RBAC.  
5. Todos los autenticados editan; confirmación explícita en production.  
6. Obs = estado, reglas, audit básico, exposición teórica (% configurado).  
7. Precedencia = override empresa → % → default ambiente.  
8. % sticky por `user_id`.  
9. Default global = `off`; `safe_default` explícito.  
10. Lifecycle = experimental → GA → deprecado → eliminado.  
11. Persistencia = SQLite local.  
12. Runtime = SDK + cache TTL 30–60s; propagación < 1 min.  
13. Fallback = `safe_default` de la flag.  
14. Overrides v1 = `force_on` / `force_off` por tenant.
