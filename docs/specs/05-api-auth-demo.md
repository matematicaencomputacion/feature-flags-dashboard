# Spec 05 — API auth demo

## Objetivo

Exponer login/logout/me en la API Hono con un único usuario demo, sin OAuth ni roles.

## Contexto y dependencias

- App: `apps/api` (`@ff/api`), puerto `8787`.
- Stack: Hono + `@hono/node-server`.
- Premisa de producto: un solo usuario demo; sin OAuth, SSO, RBAC, Viewer/Editor/Admin.

### Credenciales demo (fijas)

| Campo | Valor |
|-------|--------|
| username | `demo` |
| password | `demo` |

### Contratos HTTP

#### `POST /auth/login`

Request:

```json
{ "username": "demo", "password": "demo" }
```

Response 200:

```json
{ "token": "<opaque>", "user": { "username": "demo" } }
```

Response 401 si credenciales inválidas: `{ "error": "Invalid credentials" }`.

#### `POST /auth/logout`

Header: `Authorization: Bearer <token>`  
Response 200: `{ "ok": true }` (idempotente si token ausente/inválido).

#### `GET /auth/me`

Header: `Authorization: Bearer <token>`  
200: `{ "user": { "username": "demo" } }`  
401: `{ "error": "Unauthorized" }`

### Middleware

- `requireAuth`: lee Bearer token; si inválido → 401.
- Sesiones in-memory `Map` suficientes para MVP (se pierden al reiniciar API; aceptable).

### CORS

Permitir origen `http://localhost:3000` con headers `Content-Type`, `Authorization`.

## Alcance

### In scope

- Rutas `/auth/login`, `/auth/logout`, `/auth/me`
- Middleware `requireAuth` exportable para rutas `/flags*`
- Mantener `GET /health` público

### Out of scope

- OAuth, JWT firmado con IdP, refresh tokens, roles, 2FA
- Persistencia de sesiones en SQLite
- Rate limiting

## Tareas en orden

1. Crear módulo `apps/api/src/auth.ts` con DEMO_USER, createSession, getSessionUser, requireAuth.
2. Registrar rutas auth en `apps/api/src/app.ts`.
3. Configurar CORS para el web local.
4. Verificar manualmente con curl/Invoke-RestMethod los tres endpoints.
5. Asegurar que rutas futuras de flags usarán `requireAuth` (hook listo aunque aún no existan).

## Criterios de aceptación verificables

- **CA-05-01** `POST /auth/login` con demo/demo → 200 + `token` no vacío (RF-01).
- **CA-05-02** Login con password incorrecto → 401.
- **CA-05-03** `GET /auth/me` con Bearer válido → 200 username demo.
- **CA-05-04** `GET /auth/me` sin token → 401.
- **CA-05-05** No existen rutas ni UI de OAuth/roles en este servicio (RF-03).
- **CA-05-06** `GET /health` sigue público sin Authorization.

## Notas técnicas

- Token sugerido: `demo_` + UUID.
- El “quién” de auditoría en specs posteriores será el username de la sesión (`demo`).
- No devolver el password en ninguna respuesta.
