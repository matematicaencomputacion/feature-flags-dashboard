# Spec 09 — Web login shell

## Objetivo

Implementar en Next.js el login con usuario demo y el shell básico del panel (post-login redirect).

## Contexto y dependencias

- App: `apps/web` (`@ff/web`), Next.js App Router + Tailwind, puerto `3000`.
- API: `http://localhost:8787` (configurable con `NEXT_PUBLIC_API_URL`).
- Auth API (Spec 05):
  - `POST /auth/login` body `{ username, password }` → `{ token, user }`
  - Credenciales: `demo` / `demo`
- Sin OAuth, sin selector de roles, sin SSO.

### Persistencia de sesión cliente

- Guardar token en `localStorage` clave `ff_token`.
- Enviar `Authorization: Bearer <token>` en llamadas autenticadas (specs 10+).

### Rutas UI

| Ruta | Comportamiento |
|------|----------------|
| `/` | Formulario login; si ya hay token → redirect `/flags` |
| `/flags` | Placeholder o lista (lista real Spec 10); requiere token o redirect `/` |

### UI mínima login

- Título de producto: **Feature Flags** (hero/brand visible)
- Campos usuario/password
- CTA Entrar
- Hint visible: usuario demo `demo / demo`
- Error visible si 401

## Alcance

### In scope

- Página login funcional contra API real
- Helper `src/lib/api.ts` con `login` / `logout` / `API_URL`
- Layout root + estilos Tailwind base
- Guard cliente: sin token no entra a `/flags`

### Out of scope

- CRUD flags (10), detalle (11), lifecycle UI (12)
- Diseño design-system externo
- SSR auth / httpOnly cookies (MVP localStorage ok)

## Tareas en orden

1. Configurar `NEXT_PUBLIC_API_URL` default `http://localhost:8787`.
2. Implementar `login`/`logout` en `src/lib/api.ts`.
3. Implementar `src/app/page.tsx` login.
4. Crear shell `/flags` (puede mostrar “Cargando flags…” hasta Spec 10).
5. Botón Salir que borre token y vuelva a `/`.
6. Verificar flujo manual demo/demo.

## Criterios de aceptación verificables

- **CA-09-01** Con API arriba, login demo/demo redirige a `/flags` y persiste `ff_token` (RF-01).
- **CA-09-02** Password incorrecto muestra error y no navega.
- **CA-09-03** Visitar `/flags` sin token redirige a `/`.
- **CA-09-04** No hay botones/links de OAuth ni pantalla de roles (RF-03, CA MVP #1).
- **CA-09-05** Logout limpia token y vuelve a login.

## Notas técnicas

- CORS debe estar habilitado en API para `http://localhost:3000` (Spec 05).
- Preferir `"use client"` en páginas que tocan localStorage.
- No almacenar password.
