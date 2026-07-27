/**
 * Hash estable (FNV-1a 32-bit) para sticky rollout.
 * Inclusión: hash(seed) % 100 < percent
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Semilla del rollout. Incluye flagKey y environment para que el bucket de un
 * usuario sea independiente entre flags y entre ambientes: sin esto, el mismo
 * `userId` cae siempre en el mismo percentil y dos flags al 10% impactan
 * exactamente al mismo 10% de la base (RF-15, rollouts no correlacionados).
 */
export function rolloutSeed(
  flagKey: string,
  environment: string,
  userId: string,
): string {
  return `${flagKey}:${environment}:${userId}`;
}

/** `seed` debe construirse con `rolloutSeed`, no ser el `userId` pelado. */
export function inRollout(seed: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return stableHash(seed) % 100 < percent;
}
