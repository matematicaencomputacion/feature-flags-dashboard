import type { Lifecycle } from "./types";

const ORDER: Lifecycle[] = ["experimental", "GA", "deprecado", "eliminado"];

export function canTransitionLifecycle(
  from: Lifecycle,
  to: Lifecycle,
): boolean {
  const fromIdx = ORDER.indexOf(from);
  const toIdx = ORDER.indexOf(to);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}

export function allowsNewRules(lifecycle: Lifecycle): boolean {
  return lifecycle === "experimental" || lifecycle === "GA";
}

export function isEvaluable(lifecycle: Lifecycle): boolean {
  return lifecycle !== "eliminado";
}
