/**
 * UI-level comparison options: what the options bar edits and what gets persisted.
 * resolveUiOptions turns them into core NormalizeOptions + policy, skipping (and reporting)
 * invalid patterns instead of failing the whole comparison.
 */
import { compilePattern, type ArrayStrategy, type DeepPartial, type NormalizeOptions } from "@config-diff/core";

export type PolicyName = "drift" | "equivalence" | "strict-ci";
export type Mode = NormalizeOptions["mode"];
export type RuleStrategy = "ordered" | "set" | "keyed";

export interface ArrayRuleDraft {
  id: string;
  pattern: string;
  strategy: RuleStrategy;
  /** Key field for 'keyed'. */
  field: string;
}

export interface UiOptions {
  mode: Mode;
  policy: PolicyName;
  emptyStringIsNull: boolean;
  /** Env nesting separator; empty string disables nesting. */
  envSeparator: string;
  arrayRules: ArrayRuleDraft[];
  /** Ignore patterns, separated by commas or newlines. */
  ignore: string;
  mask: boolean;
}

export const DEFAULT_OPTIONS: UiOptions = {
  mode: "loose",
  policy: "equivalence",
  emptyStringIsNull: false,
  envSeparator: "__",
  arrayRules: [],
  ignore: "",
  mask: true,
};

export const POLICY_NAMES: readonly PolicyName[] = ["drift", "equivalence", "strict-ci"];

export interface Preset {
  id: "environments" | "cross-format" | "drift";
  label: string;
  description: string;
  values: Pick<UiOptions, "mode" | "policy" | "emptyStringIsNull">;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "environments",
    label: "Environments",
    description: "Loose matching, every difference is an error (equivalence policy).",
    values: { mode: "loose", policy: "equivalence", emptyStringIsNull: false },
  },
  {
    id: "cross-format",
    label: "Cross-format",
    description: "Loose matching plus empty string equals null, for JSON / YAML / .env pairs.",
    values: { mode: "loose", policy: "equivalence", emptyStringIsNull: true },
  },
  {
    id: "drift",
    label: "Drift vs baseline",
    description: "Strict matching; missing keys are errors, extras and value changes warnings.",
    values: { mode: "strict", policy: "drift", emptyStringIsNull: false },
  },
];

export function applyPreset(o: UiOptions, preset: Preset): UiOptions {
  return { ...o, ...preset.values };
}

export function activePresetId(o: UiOptions): Preset["id"] | null {
  const p = PRESETS.find(
    (p) => p.values.mode === o.mode && p.values.policy === o.policy && p.values.emptyStringIsNull === o.emptyStringIsNull,
  );
  return p?.id ?? null;
}

export function splitPatterns(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface OptionIssue {
  /** 'ignore' or the array rule id. */
  source: string;
  message: string;
}

export interface ResolvedOptions {
  options: DeepPartial<NormalizeOptions>;
  policy: PolicyName;
  envSeparator: string | null;
  issues: OptionIssue[];
}

function patternError(p: string): string | null {
  try {
    compilePattern(p);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function resolveUiOptions(o: UiOptions): ResolvedOptions {
  const issues: OptionIssue[] = [];

  const ignore: string[] = [];
  for (const p of splitPatterns(o.ignore)) {
    const err = patternError(p);
    if (err) issues.push({ source: "ignore", message: err });
    else ignore.push(p);
  }

  const rules: Array<{ pattern: string; strategy: ArrayStrategy }> = [];
  for (const r of o.arrayRules) {
    const pattern = r.pattern.trim();
    if (!pattern) continue; // a blank draft row is not an error
    const err = patternError(pattern);
    if (err) {
      issues.push({ source: r.id, message: err });
      continue;
    }
    if (r.strategy === "keyed") {
      const field = r.field.trim();
      if (!field) {
        issues.push({ source: r.id, message: `Rule "${pattern}": keyed strategy needs a key field` });
        continue;
      }
      rules.push({ pattern, strategy: { keyedBy: field } });
    } else {
      rules.push({ pattern, strategy: r.strategy });
    }
  }

  return {
    options: {
      mode: o.mode,
      coerce: { emptyStringIsNull: o.emptyStringIsNull },
      arrays: { rules },
      ignore,
      mask: { enabled: o.mask },
    },
    policy: o.policy,
    envSeparator: o.envSeparator === "" ? null : o.envSeparator,
    issues,
  };
}

let ruleCounter = 0;
export function newRuleId(): string {
  ruleCounter += 1;
  return `rule-${Date.now().toString(36)}-${ruleCounter}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate untrusted persisted data, falling back to defaults field by field. */
export function sanitizeOptions(raw: unknown): UiOptions {
  if (!isObj(raw)) return DEFAULT_OPTIONS;
  const d = DEFAULT_OPTIONS;
  const rules: ArrayRuleDraft[] = Array.isArray(raw.arrayRules)
    ? raw.arrayRules.filter(isObj).map((r, i) => ({
        id: typeof r.id === "string" && r.id ? r.id : `rule-stored-${i}`,
        pattern: typeof r.pattern === "string" ? r.pattern : "",
        strategy: r.strategy === "set" || r.strategy === "keyed" ? r.strategy : "ordered",
        field: typeof r.field === "string" ? r.field : "",
      }))
    : d.arrayRules;
  return {
    mode: raw.mode === "strict" || raw.mode === "loose" ? raw.mode : d.mode,
    policy: POLICY_NAMES.includes(raw.policy as PolicyName) ? (raw.policy as PolicyName) : d.policy,
    emptyStringIsNull: typeof raw.emptyStringIsNull === "boolean" ? raw.emptyStringIsNull : d.emptyStringIsNull,
    envSeparator: typeof raw.envSeparator === "string" ? raw.envSeparator : d.envSeparator,
    arrayRules: rules,
    ignore: typeof raw.ignore === "string" ? raw.ignore : d.ignore,
    mask: typeof raw.mask === "boolean" ? raw.mask : d.mask,
  };
}
