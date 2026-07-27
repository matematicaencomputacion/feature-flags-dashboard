export const ENVIRONMENTS = ["dev", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const LIFECYCLES = [
  "experimental",
  "GA",
  "deprecado",
  "eliminado",
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const SAFE_DEFAULTS = ["off", "on"] as const;
export type SafeDefault = (typeof SAFE_DEFAULTS)[number];

export const OVERRIDE_MODES = ["force_on", "force_off"] as const;
export type OverrideMode = (typeof OVERRIDE_MODES)[number];

export type TenantOverride = {
  tenantId: string;
  mode: OverrideMode;
};

export type EnvironmentRules = {
  environment: Environment;
  /** Default del ambiente; global del sistema = off */
  defaultOn: boolean;
  /** Rollout 0–100; exposición teórica = este valor */
  rolloutPercent: number;
  overrides: TenantOverride[];
};

export type FeatureFlag = {
  key: string;
  lifecycle: Lifecycle;
  safeDefault: SafeDefault;
  rules: EnvironmentRules[];
  lastChange?: {
    by: string;
    at: string;
    summary: string;
  };
};

export type EvaluateContext = {
  flagKey: string;
  environment: Environment;
  tenantId: string;
  userId: string;
};

export type EvaluateResult = {
  enabled: boolean;
  reason:
    | "force_on"
    | "force_off"
    | "rollout"
    | "default"
    | "safe_default"
    | "eliminado"
    | "not_found";
};
