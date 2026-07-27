import { inRollout, rolloutSeed } from "./hash";
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
 * Precedencia (PRD §6 / RF-12): override empresa → % → default ambiente.
 *
 * El % es terminal cuando está configurado (`rolloutPercent > 0`): el default de
 * ambiente es "el valor base si no aplica override ni %" (PRD §6). Si el default
 * pisara al usuario excluido del bucket, un `defaultOn=true` con rollout 10%
 * daría `true` para todos y el porcentaje sería decorativo.
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
    const seed = rolloutSeed(flag.key, rules.environment, ctx.userId);
    return {
      enabled: inRollout(seed, rules.rolloutPercent),
      reason: "rollout",
    };
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
