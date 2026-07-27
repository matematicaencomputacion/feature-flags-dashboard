import { TtlCache, type FeatureFlag } from "@ff/domain";

/**
 * Caché de definiciones de flag para el path de evaluación (`POST /evaluate`),
 * que si no pega a SQLite en cada request.
 *
 * La propagación NO depende del TTL: toda escritura invalida la entrada de esa
 * flag antes de responder (ver `repo.ts`), así un kill-switch por `force_off` se
 * ve en la evaluación siguiente. El TTL es sólo la red de seguridad para el caso
 * en que algo mute la base por fuera del repo.
 *
 * LIMITACIÓN CONOCIDA — la invalidación es in-process. Funciona porque el MVP
 * corre una sola instancia de API sobre SQLite local; con varias instancias, la
 * que recibe el PUT invalida su caché y las demás siguen sirviendo la definición
 * vieja hasta que expire el TTL. Vive junto a la limitación que el PRD ya
 * reconoce sobre SQLite como punto único de fallo, y se resolvería con un caché
 * compartido o un canal de invalidación entre instancias.
 */

/** Envuelve el valor para distinguir "cacheado como inexistente" de "no cacheado". */
type CachedFlag = { flag: FeatureFlag | null };

export type FlagLoader = (key: string) => Promise<FeatureFlag | null>;

const DEFAULT_TTL_MS = 45_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 60_000;

let cache = new TtlCache<CachedFlag>(DEFAULT_TTL_MS);
let load: FlagLoader | undefined;

function ttlFromEnv(): number {
  const raw = process.env.FLAG_CACHE_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;

  const ttlMs = Number(raw);
  if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
    throw new Error(
      `FLAG_CACHE_TTL_MS debe estar entre ${MIN_TTL_MS} y ${MAX_TTL_MS} ms (PRD RF-24); recibido: ${raw}`,
    );
  }
  return ttlMs;
}

function debug(event: "hit" | "miss", key: string): void {
  if (process.env.FLAG_CACHE_DEBUG) {
    console.debug(`[flag-cache] ${event}`, key);
  }
}

/**
 * Inyecta el loader en vez de importar el repo: `repo.ts` importa
 * `invalidateFlag` de acá, y si además cacheáramos importando `getFlag` el ciclo
 * quedaría cerrado. `ttlMs` explícito saltea la validación de producto para que
 * los tests puedan usar ventanas cortas.
 */
export function initFlagCache(
  loader: FlagLoader,
  options: { ttlMs?: number } = {},
): void {
  load = loader;
  cache = new TtlCache<CachedFlag>(options.ttlMs ?? ttlFromEnv());
}

export async function getCachedFlag(key: string): Promise<FeatureFlag | null> {
  if (!load) {
    throw new Error("Flag cache sin inicializar: llamá initFlagCache primero");
  }

  const cached = cache.get(key);
  if (cached) {
    debug("hit", key);
    return cached.flag;
  }

  debug("miss", key);
  const flag = await load(key);
  // También se cachea el miss: una key inexistente no puede pegarle a la base en
  // cada request.
  cache.set(key, { flag });
  return flag;
}

/** Invalida una sola flag; cambiar una no puede vaciar el caché de las demás. */
export function invalidateFlag(key: string): void {
  cache.invalidate(key);
}
