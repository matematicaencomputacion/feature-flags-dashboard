export const ENVIRONMENTS = ["dev", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const LIFECYCLES = [
  "experimental",
  "GA",
  "deprecado",
  "eliminado",
] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export type SafeDefault = "off" | "on";
export type OverrideMode = "force_on" | "force_off";

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
