import { inRollout } from "./hash";
import type {
  EnvironmentRules,
  EvaluateContext,
  EvaluateResult,
  FeatureFlag,
  SafeDefault,
} from "./types";

function rulesForEnv(
  flag: FeatureFlag,
  environment: EvaluateContext["environment"],
): EnvironmentRules | undefined {
  return flag.rules.find((r) => r.environment === environment);
}

function fromSafeDefault(safeDefault: SafeDefault): EvaluateResult {
  return {
    enabled: safeDefault === "on",
    reason: "safe_default",
  };
}

/**
 * Precedencia: override empresa → % → default ambiente.
 * Flags eliminadas no se evalúan (safe_default / not applicable → false via eliminado).
 */
export function evaluateFlag(
  flag: FeatureFlag | null | undefined,
  ctx: Omit<EvaluateContext, "flagKey">,
): EvaluateResult {
  if (!flag) {
    return { enabled: false, reason: "not_found" };
  }

  if (flag.lifecycle === "eliminado") {
    return { enabled: false, reason: "eliminado" };
  }

  const rules = rulesForEnv(flag, ctx.environment);
  if (!rules) {
    return fromSafeDefault(flag.safeDefault);
  }

  const override = rules.overrides.find((o) => o.tenantId === ctx.tenantId);
  if (override?.mode === "force_off") {
    return { enabled: false, reason: "force_off" };
  }
  if (override?.mode === "force_on") {
    return { enabled: true, reason: "force_on" };
  }

  if (rules.rolloutPercent > 0) {
    const included = inRollout(ctx.userId, rules.rolloutPercent);
    if (included) {
      return { enabled: true, reason: "rollout" };
    }
    // Si hay % configurado y el usuario no entra, cae al default del ambiente
  }

  return {
    enabled: rules.defaultOn,
    reason: "default",
  };
}

/** Fallback cuando falla la lectura remota (RF-25). */
export function evaluateWithFallback(
  flag: FeatureFlag | null | undefined,
  ctx: Omit<EvaluateContext, "flagKey">,
  opts?: { fetchFailed?: boolean },
): EvaluateResult {
  if (opts?.fetchFailed) {
    if (!flag) {
      return { enabled: false, reason: "safe_default" };
    }
    return fromSafeDefault(flag.safeDefault);
  }
  return evaluateFlag(flag, ctx);
}
