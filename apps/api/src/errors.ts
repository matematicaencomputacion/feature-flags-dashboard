import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Error de dominio con status HTTP tipado. Reemplaza el
 * `Object.assign(new Error(...), { status })` que no tipaba contra Hono.
 */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}

/**
 * Detecta violación de constraint UNIQUE recorriendo la cadena de `cause`:
 * drizzle envuelve el error del driver, así que el texto del `LibsqlError`
 * (`SQLITE_CONSTRAINT_*`) no está en `error.message` sino más abajo.
 */
export function isUniqueViolation(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; current && depth < 5; depth++) {
    const err = current as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof err.code === "string" ? err.code : "";
    const message = typeof err.message === "string" ? err.message : "";
    if (code.startsWith("SQLITE_CONSTRAINT") || /unique constraint/i.test(message)) {
      return true;
    }
    current = err.cause;
  }
  return false;
}

/**
 * Traduce cualquier error a `{ status, message }`. Los errores no esperados no
 * filtran su mensaje interno al cliente: se loggean y salen como 500 genérico.
 */
export function toHttpResponse(e: unknown): {
  status: ContentfulStatusCode;
  message: string;
} {
  if (e instanceof HttpError) {
    return { status: e.status, message: e.message };
  }
  console.error("[api] unhandled error", e);
  return { status: 500, message: "Internal server error" };
}
