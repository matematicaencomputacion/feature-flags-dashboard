/**
 * Hash estable (FNV-1a 32-bit) para sticky rollout por user_id.
 * Inclusión: hash(userId) % 100 < percent
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function inRollout(userId: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return stableHash(userId) % 100 < percent;
}
